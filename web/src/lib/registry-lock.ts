/**
 * Registry write lock — FAIL-CLOSED (card #0381, Codex fix loop 2).
 *
 * Unlike the advisory board lock (board-lock.ts, which deliberately proceeds
 * unlocked after ~500 ms), a registry writer NEVER runs its mutation without
 * owning this lock: a status write that silently raced another writer could
 * re-enable a paused project's automations. So:
 *   - contention → wait with exponential backoff (+ jitter) up to a deadline;
 *   - a stale lock is recovered only when provably stale: its owner pid is
 *     dead on this host, or it is older than STALE_MS (no registry write
 *     takes anywhere near that long) — and only under the separate recovery
 *     lock `<lock>.recover`, re-checking that the main lock is still exactly
 *     the stale one observed (so racing recoverers never delete a live
 *     writer's lock). A stale recovery lock fails closed, naming the file;
 *   - deadline reached, or any lock error other than "already exists" →
 *     RegistryLockError, nothing written. Callers surface it (web 503, CLI
 *     exit 1).
 *
 * Lockfile: `<registry>.lock` = {pid, host, token, ts}. Shared with
 * scripts/kanban.js withRegistryLock() — keep the two in lockstep.
 */

import { promises as fs } from 'fs';
import os from 'os';

export class RegistryLockError extends Error {
  readonly status = 503;
}

/** Recover a lock this old even if its pid looks alive (pid reuse, other host). */
export const REGISTRY_LOCK_STALE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_BACKOFF_MS = 200;

interface LockInfo { pid?: number; host?: string; token?: string; ts?: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lockTimeoutMs(): number {
  const env = Number(process.env.SLYCODE_REGISTRY_LOCK_TIMEOUT_MS);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_TIMEOUT_MS;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'; // exists, not ours
  }
}

function describe(info: LockInfo | null): string {
  if (!info?.pid) return 'another writer';
  return `pid ${info.pid}${info.host && info.host !== os.hostname() ? ` on ${info.host}` : ''}`;
}

/** What an acquirer saw when it found the main lock held. */
interface Observed { raw: string; info: LockInfo | null; ino: number; mtimeMs: number }

/** A recovery lock older than this (or with a dead owner) is itself stale. */
export const RECOVERY_LOCK_STALE_MS = 10_000;

function isStale(info: LockInfo | null, mtimeMs: number): boolean {
  const deadOwner = !!info?.pid && info.host === os.hostname() && !pidAlive(info.pid);
  return deadOwner || Date.now() - mtimeMs > REGISTRY_LOCK_STALE_MS;
}

/**
 * Test seam (#0381 final verify): lets a test hold one recoverer between
 * observing a stale lock and recovering it, to force the two-recoverer race.
 */
export const registryLockTestHooks: {
  afterObserveStale?: () => Promise<void> | void;
  afterRecovered?: () => Promise<void> | void;
  /** Outcome of each serialized recovery attempt (true = removed the observed stale lock). */
  afterRecoveryAttempt?: (recovered: boolean) => void;
} = {};

/**
 * Serialized stale-lock recovery (#0381 final verify — two recoverers racing
 * must never delete a LIVE writer's lock):
 *   1. take the separate recovery lock `<lock>.recover` (O_EXCL);
 *   2. re-read the main lock and unlink it ONLY if it is still exactly the
 *      stale lock this caller observed (same inode, mtime and content) and
 *      still stale;
 *   3. release the recovery lock.
 * Plain acquirers never touch the recovery lock. A recovery lock held by a
 * live recoverer = contention (back off). A STALE recovery lock is not
 * guessed at: fail closed with a message naming the file to delete.
 * Returns true when the observed stale lock is gone (retry acquisition now).
 */
async function recoverStaleLock(lockPath: string, observed: Observed): Promise<boolean> {
  const recoverPath = `${lockPath}.recover`;
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await fs.writeFile(recoverPath, JSON.stringify({ pid: process.pid, host: os.hostname(), token, ts: Date.now() }), { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    // Another recoverer is at it — or a crashed one left its lock behind.
    let rInfo: LockInfo | null = null;
    let rMtime = Date.now();
    try {
      rMtime = (await fs.stat(recoverPath)).mtimeMs;
      rInfo = JSON.parse(await fs.readFile(recoverPath, 'utf-8')) as LockInfo;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; // just released — retry
    }
    const deadOwner = !!rInfo?.pid && rInfo.host === os.hostname() && !pidAlive(rInfo.pid);
    if (deadOwner || Date.now() - rMtime > RECOVERY_LOCK_STALE_MS) {
      throw new RegistryLockError(
        `A stale registry recovery lock is blocking writes. Make sure no SlyCode process is writing projects, then delete ${recoverPath} and try again. Nothing was changed.`,
      );
    }
    return false; // live recoverer — contention
  }
  try {
    let st;
    let raw: string;
    try {
      st = await fs.stat(lockPath);
      raw = await fs.readFile(lockPath, 'utf-8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true; // already gone
      throw e;
    }
    let info: LockInfo | null = null;
    try { info = JSON.parse(raw) as LockInfo; } catch { /* unparseable — identity check still applies */ }
    const sameLock = st.ino === observed.ino && st.mtimeMs === observed.mtimeMs && raw === observed.raw;
    if (!sameLock || !isStale(info, st.mtimeMs)) return false; // replaced by a live writer — leave it
    await fs.unlink(lockPath);
    return true;
  } finally {
    try {
      const current = JSON.parse(await fs.readFile(recoverPath, 'utf-8')) as LockInfo;
      if (current.token === token) await fs.unlink(recoverPath);
    } catch { /* already gone */ }
  }
}

/** Run `fn` while owning the registry lock. Never runs `fn` unlocked. */
export async function withRegistryLock<T>(
  registryPath: string,
  fn: () => Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const lockPath = `${registryPath}.lock`;
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const deadline = Date.now() + (opts.timeoutMs ?? lockTimeoutMs());
  let backoff = 10;
  let holder: LockInfo | null = null;

  for (;;) {
    try {
      await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, host: os.hostname(), token, ts: Date.now() }), { flag: 'wx' });
      break; // acquired
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw new RegistryLockError(`Could not take the project registry lock (${code ?? 'error'}: ${(err as Error).message}). Nothing was changed.`);
      }
    }
    // Held by someone else: stale → serialized recovery; otherwise back off until the deadline.
    holder = null;
    let observed: Observed | null = null;
    try {
      const st = await fs.stat(lockPath);
      const raw = await fs.readFile(lockPath, 'utf-8');
      try { holder = JSON.parse(raw) as LockInfo; } catch { /* mid-write or corrupt: judge by age only */ }
      observed = { raw, info: holder, ino: st.ino, mtimeMs: st.mtimeMs };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue; // released meanwhile — retry now
      throw new RegistryLockError(`Could not read the project registry lock (${(err as Error).message}). Nothing was changed.`);
    }
    if (isStale(observed.info, observed.mtimeMs)) {
      await registryLockTestHooks.afterObserveStale?.();
      let recovered: boolean;
      try {
        recovered = await recoverStaleLock(lockPath, observed);
        registryLockTestHooks.afterRecoveryAttempt?.(recovered);
      } catch (err) {
        if (err instanceof RegistryLockError) throw err;
        throw new RegistryLockError(`Could not recover a stale project registry lock (${(err as Error).message}). Nothing was changed.`);
      }
      if (recovered) {
        await registryLockTestHooks.afterRecovered?.();
        continue;
      }
    }
    if (Date.now() >= deadline) {
      throw new RegistryLockError(`The project registry is busy (locked by ${describe(holder)}). Nothing was changed — try again in a moment.`);
    }
    await sleep(Math.min(backoff, Math.max(0, deadline - Date.now())) + Math.floor(Math.random() * 10));
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }

  try {
    return await fn();
  } finally {
    try {
      const current = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as LockInfo;
      if (current.token === token) await fs.unlink(lockPath);
    } catch { /* already gone */ }
  }
}
