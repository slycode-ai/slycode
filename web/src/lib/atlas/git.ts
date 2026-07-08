/**
 * Code Mode — git lens operations (feature 076). Server-side only.
 *
 * Thin, read-only wrappers over the git CLI for the project the user is
 * viewing. Every call is execFile (never a shell string), windowsHide, with
 * timeouts and output caps. Non-git projects surface as { isRepo: false }
 * rather than errors so the UI can hide the lens gracefully.
 */

import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const GIT_OPTS = { windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 } as const;

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: root, ...GIT_OPTS });
  return stdout;
}

export interface GitFileStatus {
  path: string;
  /** porcelain status letter shown to the user (M/A/D/R/?/…) */
  status: string;
  category: 'staged' | 'unstaged' | 'untracked';
}

export interface GitStatusResult {
  isRepo: boolean;
  branch?: string;
  files: GitFileStatus[];
}

export async function gitStatus(root: string): Promise<GitStatusResult> {
  let branch: string;
  try {
    branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    return { isRepo: false, files: [] };
  }
  const out = await git(root, ['status', '--porcelain']);
  const files: GitFileStatus[] = [];
  // Leading spaces on the X column are significant — trimEnd only.
  for (const line of out.split('\n').map(l => l.replace(/[\r\n]+$/, ''))) {
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    const p = line.slice(3);
    if (x === '?' && y === '?') {
      files.push({ path: p, status: '?', category: 'untracked' });
      continue;
    }
    if (x !== ' ' && x !== '?') files.push({ path: p, status: x, category: 'staged' });
    if (y !== ' ' && y !== '?') files.push({ path: p, status: y, category: 'unstaged' });
  }
  return { isRepo: true, branch, files };
}

/** Unified diff for one file (worktree vs HEAD), or the whole worktree. */
export async function gitDiff(root: string, relPath?: string): Promise<string> {
  const base = ['diff', 'HEAD', '--no-color', '--no-ext-diff'];
  const args = relPath ? [...base, '--', relPath] : base;
  try {
    return await git(root, args);
  } catch {
    // No HEAD yet (fresh repo) — diff against the empty tree.
    const empty = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    return git(root, relPath ? ['diff', empty, '--no-color', '--', relPath] : ['diff', empty, '--no-color']);
  }
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string; // ISO
  subject: string;
}

const LOG_SEP = '\x1f';

export async function gitLog(root: string, relPath?: string, limit = 50): Promise<GitLogEntry[]> {
  const fmt = ['%H', '%h', '%an', '%aI', '%s'].join(LOG_SEP);
  const args = ['log', `--max-count=${Math.min(limit, 200)}`, `--pretty=format:${fmt}`];
  if (relPath) args.push('--follow', '--', relPath);
  let out: string;
  try {
    out = await git(root, args);
  } catch {
    return [];
  }
  return out
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [hash, shortHash, author, date, subject] = line.split(LOG_SEP);
      return { hash, shortHash, author, date, subject };
    });
}

export interface BlameLine {
  line: number;
  shortHash: string;
  author: string;
  date: string; // ISO
  summary: string;
}

/** Per-line blame via `git blame --line-porcelain`. */
export async function gitBlame(root: string, relPath: string): Promise<BlameLine[]> {
  const posix = relPath.replace(/\\/g, '/');
  // Containment: blame paths go through the same rule as file access.
  if (posix.startsWith('/') || posix.includes('..') || /^[a-zA-Z]:/.test(posix)) {
    throw new Error('Invalid path');
  }
  const out = await git(root, ['blame', '--line-porcelain', '--', posix]);
  const lines: BlameLine[] = [];
  const meta: Record<string, { author: string; date: string; summary: string }> = {};
  let current: { hash: string; line: number } | null = null;

  for (const raw of out.split('\n')) {
    const head = raw.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (head) {
      current = { hash: head[1], line: parseInt(head[2], 10) };
      if (!meta[current.hash]) meta[current.hash] = { author: '', date: '', summary: '' };
      continue;
    }
    if (!current) continue;
    if (raw.startsWith('author ')) meta[current.hash].author = raw.slice(7);
    else if (raw.startsWith('author-time ')) {
      meta[current.hash].date = new Date(parseInt(raw.slice(12), 10) * 1000).toISOString();
    } else if (raw.startsWith('summary ')) meta[current.hash].summary = raw.slice(8);
    else if (raw.startsWith('\t')) {
      const m = meta[current.hash];
      lines.push({
        line: current.line,
        shortHash: current.hash.slice(0, 8),
        author: m.author,
        date: m.date,
        summary: m.summary,
      });
      current = null;
    }
  }
  return lines;
}

/** Diff of ONE commit (what it changed vs its parent). */
export async function gitShow(root: string, ref: string, relPath?: string): Promise<string> {
  if (!/^[0-9a-f]{4,40}$/i.test(ref)) throw new Error('Invalid ref');
  const args = ['show', ref, '--no-color', '--no-ext-diff', '--format='];
  if (relPath) args.push('--', relPath);
  return git(root, args);
}

export interface BranchInfo { name: string; current: boolean }

export async function gitBranches(root: string): Promise<{ current: string; branches: BranchInfo[] }> {
  const out = await git(root, ['branch', '--list', '--format=%(HEAD)%(refname:short)']);
  const branches: BranchInfo[] = out
    .split('\n')
    .filter(Boolean)
    .map(line => ({ name: line.slice(1), current: line[0] === '*' }));
  return { current: branches.find(b => b.current)?.name ?? '', branches };
}

const BRANCH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/**
 * Switch (or create + switch) a branch. Git itself is the safety net: it
 * refuses checkouts that would clobber local changes — we surface its stderr
 * verbatim so the user sees the real reason.
 */
export async function gitSwitchBranch(
  root: string,
  branch: string,
  create: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!BRANCH_NAME_RE.test(branch) || branch.includes('..') || branch.endsWith('.lock')) {
    return { ok: false, error: 'Invalid branch name' };
  }
  const args = create ? ['checkout', '-b', branch] : ['checkout', branch];
  try {
    await git(root, args);
    return { ok: true };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const detail = (err.stderr || err.message || 'checkout failed').trim();
    return { ok: false, error: detail.split('\n').slice(0, 3).join(' ').slice(0, 400) };
  }
}

/** Per-file churn (commit touch counts) over a window — Phase 2 fog input. */
export async function gitChurn(root: string, days = 14): Promise<Record<string, number>> {
  let out: string;
  try {
    out = await git(root, ['log', `--since=${days}.days`, '--name-only', '--pretty=format:']);
  } catch {
    return {};
  }
  const churn: Record<string, number> = {};
  for (const line of out.split('\n')) {
    const f = line.trim();
    if (!f) continue;
    const posix = f.replace(/\\/g, '/');
    if (path.posix.isAbsolute(posix)) continue;
    churn[posix] = (churn[posix] ?? 0) + 1;
  }
  return churn;
}
