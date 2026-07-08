/**
 * Advisory board lock (feature 077) — best-effort lockfile around kanban.json
 * read-modify-write, shared with the CLI (scripts/kanban.js acquireBoardLock —
 * keep semantics in lockstep). Shrinks the cross-writer race window; full race
 * elimination is explicitly out of scope (accepted risk — see
 * documentation/designs/kanban_json_hardening.md).
 *
 * Guarantees:
 *  - NEVER blocks an operation: stale locks (> LOCK_STALE_MS) are force-broken
 *    and any unexpected error means "proceed without the lock"
 *  - bounded wait: ~10 × 50ms retries, then proceed anyway
 */

import { promises as fs } from 'fs';

const LOCK_STALE_MS = 5000;
const RETRIES = 10;
const RETRY_DELAY_MS = 50;

function lockPathFor(kanbanPath: string): string {
  return `${kanbanPath}.lock`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquire(lockPath: string, token: string): Promise<boolean> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      // token (not just pid) — concurrent requests in the same Next.js process
      // share a pid, so release must be able to tell its own lock apart.
      await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, token, ts: Date.now() }), {
        flag: 'wx',
      });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return false; // proceed without lock
      try {
        const st = await fs.stat(lockPath);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          await fs.unlink(lockPath); // stale lock from a killed process — break it
          continue;
        }
      } catch {
        return false; // lock vanished or unreadable — proceed
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
  return false; // still locked after retries — advisory only, proceed anyway
}

async function release(lockPath: string, token: string): Promise<void> {
  try {
    // Only unlink if the lock is still OURS — another writer may have broken
    // our lock as stale and taken it.
    const parsed = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
    if (parsed && parsed.token === token) await fs.unlink(lockPath);
  } catch {
    /* ignore */
  }
}

/**
 * Run `fn` under the advisory board lock. The lock is best-effort: `fn` always
 * runs, lock or not. Release happens in finally.
 */
export async function withBoardLock<T>(kanbanPath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = lockPathFor(kanbanPath);
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const held = await acquire(lockPath, token);
  try {
    return await fn();
  } finally {
    if (held) await release(lockPath, token);
  }
}
