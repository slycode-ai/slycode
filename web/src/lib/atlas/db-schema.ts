/**
 * DB schema view — server-side read layer (feature 079).
 *
 * The deterministic introspection itself lives in scripts/db-introspect.js
 * (single implementation, shared with the sly-atlas CLI). This module loads
 * it at runtime (createRequire — dev: repo root, prod: package dist/scripts),
 * runs it against the project's gitignore-respecting file list, caches the
 * result, and pairs it with the AI annotations artifact (db.json).
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getPackageDir } from '../paths';
import { atlasPath } from './store';
import { DbAnnotations, validateDbAnnotations } from './schema';

const execFileAsync = promisify(execFile);

export interface DbColumn { name: string; type: string; pk: boolean; nullable: boolean }
export interface DbForeignKey { column: string; refTable: string; refColumn?: string }
export interface DbTable { name: string; columns: DbColumn[]; fks: DbForeignKey[] }
export interface DbSource { kind: 'sqlite' | 'prisma' | 'sql'; path: string; tables: DbTable[]; error?: string }
export interface DbIntrospection { sources: DbSource[] }

interface IntrospectModule {
  introspect(projectRoot: string, files: string[]): DbIntrospection;
}

let cachedModule: IntrospectModule | null | undefined;

/** Load scripts/db-introspect.js at runtime. Returns null when unavailable
 *  (feature degrades to "no sources"). */
function loadIntrospectModule(): IntrospectModule | null {
  if (cachedModule !== undefined) return cachedModule;
  const candidates = [
    path.join(getPackageDir(), 'scripts', 'db-introspect.js'),
  ];
  const requireRuntime = createRequire(path.join(process.cwd(), 'noop.js'));
  for (const candidate of candidates) {
    try {
      cachedModule = requireRuntime(candidate) as IntrospectModule;
      return cachedModule;
    } catch { /* try next */ }
  }
  console.warn('[atlas/db] db-introspect.js not found — DB schema view disabled');
  cachedModule = null;
  return null;
}

async function listProjectFiles(projectRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: projectRoot, windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024 },
    );
    return stdout.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// Introspection opens files / dbs — cache per project for 60s (HMR-safe).
const CACHE_KEY = '__slycode_atlas_db__';
function dbCache(): Map<string, { at: number; data: DbIntrospection }> {
  const g = globalThis as unknown as Record<string, Map<string, { at: number; data: DbIntrospection }>>;
  if (!g[CACHE_KEY]) g[CACHE_KEY] = new Map();
  return g[CACHE_KEY];
}

export async function loadDbIntrospection(projectRoot: string): Promise<DbIntrospection> {
  const cache = dbCache();
  const hit = cache.get(projectRoot);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const mod = loadIntrospectModule();
  if (!mod) return { sources: [] };
  let data: DbIntrospection;
  try {
    data = mod.introspect(projectRoot, await listProjectFiles(projectRoot));
  } catch (e) {
    console.warn('[atlas/db] introspection failed:', e);
    data = { sources: [] };
  }
  cache.set(projectRoot, { at: Date.now(), data });
  return data;
}

export async function loadDbAnnotations(projectRoot: string): Promise<DbAnnotations | null> {
  try {
    const doc = JSON.parse(await fs.readFile(atlasPath(projectRoot, 'db.json'), 'utf-8')) as DbAnnotations;
    return validateDbAnnotations(doc).length === 0 ? doc : null;
  } catch {
    return null;
  }
}
