/**
 * Code Mode / Atlas — filesystem utilities (server-side only).
 *
 * Project resolution + path containment + file tree building for the Code
 * Mode explorer (feature 076). Every API route under /api/atlas/* funnels
 * path handling through here so the containment rule lives in ONE place:
 * any file INSIDE the project root is fair game (dotfiles and .env included —
 * the escape-hatch editor's founding use case); anything that resolves
 * outside the root is rejected.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ResolvedProject {
  id: string;
  root: string;
}

export class AtlasPathError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Resolve a registered project by id; throws AtlasPathError(404) if unknown. */
export async function resolveProject(projectId: string | null): Promise<ResolvedProject> {
  if (!projectId) throw new AtlasPathError('projectId required', 400);
  // Lazy import keeps this module registry-free for the tsx test convention.
  const { loadRegistry } = await import('@/lib/registry');
  const registry = await loadRegistry();
  const project = registry.projects.find(p => p.id === projectId);
  if (!project) throw new AtlasPathError('Project not found', 404);
  return { id: project.id, root: project.path };
}

/**
 * Resolve a repo-relative file path against the project root with containment.
 * Accepts forward or back slashes; rejects anything escaping the root.
 * Returns the absolute OS-native path.
 */
export function containedPath(root: string, relPath: string): string {
  // Normalize to forward slashes so checks behave identically on Windows.
  const posixPath = relPath.replace(/\\/g, '/');
  if (!posixPath || posixPath.startsWith('/') || /^[a-zA-Z]:/.test(posixPath)) {
    throw new AtlasPathError('Invalid path', 400);
  }
  const resolved = path.resolve(root, posixPath);
  const resolvedBase = path.resolve(root);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new AtlasPathError('Access denied', 403);
  }
  return resolved;
}

/** Directories never shown in the tree even when not gitignored. */
const ALWAYS_IGNORED = new Set(['.git', 'node_modules']);

export interface TreeNode {
  name: string;
  path: string; // repo-relative, posix separators
  type: 'dir' | 'file';
  /** gitignored file surfaced for editing (.env & friends) — rendered dimmed */
  ignored?: boolean;
  children?: TreeNode[];
}

/**
 * Build the project file tree.
 *
 * Prefers `git ls-files` (respects .gitignore, includes untracked) so the
 * tree matches what a developer thinks of as "the project" — PLUS
 * individually-ignored files (.env, *.local.json, …), marked `ignored` and
 * rendered dimmed: the editor explicitly supports editing them, so the tree
 * must be able to reach them. Wholly-ignored DIRECTORIES (node_modules/,
 * dist/, .next/ — deps and build output) stay hidden. Falls back to an fs
 * walk with default ignores for non-git projects.
 */
export async function buildTree(root: string): Promise<TreeNode[]> {
  const files = await listProjectFiles(root);
  if (files === null) {
    // not a git repo — bounded walk (already includes dotfiles like .env)
    const out: string[] = [];
    await walk(root, '', out, 0);
    return foldTree(out);
  }
  const ignored = await listIgnoredFiles(root);
  const seen = new Set(files);
  const merged = [...files, ...ignored.filter(f => !seen.has(f))];
  return foldTree(merged, new Set(ignored));
}

async function listProjectFiles(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: root, windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024 },
    );
    const files = stdout.split('\n').filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    // not a git repo
  }
  return null;
}

/** Individually-ignored FILES (`--directory` collapses wholly-ignored dirs to
 *  one `dir/` entry, which we drop — deps/build output stay hidden). */
async function listIgnoredFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
      { cwd: root, windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024 },
    );
    return stdout.split('\n').filter(f => f && !f.endsWith('/'));
  } catch {
    return [];
  }
}

async function walk(root: string, rel: string, out: string[], depth: number): Promise<void> {
  if (depth > 12 || out.length > 20000) return;
  const abs = rel ? path.join(root, rel) : root;
  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (ALWAYS_IGNORED.has(e.name) || e.name === '.next' || e.name === 'dist') continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(root, childRel, out, depth + 1);
    else if (e.isFile()) out.push(childRel);
  }
}

/** Fold a flat file list into a sorted tree (dirs first, then files, alpha). */
export function foldTree(files: string[], ignoredSet?: Set<string>): TreeNode[] {
  interface DirEntry { dirs: Map<string, DirEntry>; files: string[] }
  const rootDir: DirEntry = { dirs: new Map(), files: [] };

  for (const f of files) {
    const parts = f.split('/');
    let cur = rootDir;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = cur.dirs.get(parts[i]);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        cur.dirs.set(parts[i], next);
      }
      cur = next;
    }
    cur.files.push(parts[parts.length - 1]);
  }

  function emit(dir: DirEntry, prefix: string): TreeNode[] {
    const dirNodes = [...dir.dirs.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, entry]): TreeNode => ({
        name,
        path: prefix ? `${prefix}/${name}` : name,
        type: 'dir',
        children: emit(entry, prefix ? `${prefix}/${name}` : name),
      }));
    const fileNodes = dir.files
      .sort((a, b) => a.localeCompare(b))
      .map((name): TreeNode => {
        const p = prefix ? `${prefix}/${name}` : name;
        return {
          name,
          path: p,
          type: 'file',
          ...(ignoredSet?.has(p) ? { ignored: true } : {}),
        };
      });
    return [...dirNodes, ...fileNodes];
  }
  return emit(rootDir, '');
}

/** Max file size the editor will open/save (2 MB). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** NUL-byte binary sniff on the first 8 KB. */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}
