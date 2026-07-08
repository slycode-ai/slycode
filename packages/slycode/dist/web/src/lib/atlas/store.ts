/**
 * Atlas artifact store (feature 076) — server-side read layer + staleness.
 *
 * The WEB never writes atlas artifacts (except area rename/pin, the one
 * user-owned mutation) — the sly-atlas CLI is the write path with validation.
 * This module reads documentation/atlas/* and computes the deterministic
 * freshness picture the UI renders: per-area stale flags (source hash
 * mismatches, new files) + churn counts for fog-of-war.
 */

import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  AtlasRoot, AtlasNode, AtlasConfig, NavEvent,
  validateAtlasRoot, validateAtlasNode,
} from './schema';
import { containedPath } from './fs-utils';
import { gitChurn } from './git';

const execFileAsync = promisify(execFile);

export const ATLAS_DIR = ['documentation', 'atlas'] as const;

export function atlasPath(root: string, ...parts: string[]): string {
  return path.join(root, ...ATLAS_DIR, ...parts);
}

export function hashContent(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export interface AreaFreshness {
  areaId: string;
  hasNode: boolean;
  analyzedAt?: string;
  stale: boolean;
  /** why stale: changed/deleted described files + count of new files */
  changedFiles: string[];
  newFiles: number;
  churn: number; // commits touching the area's paths in the churn window
}

export interface AtlasSnapshot {
  exists: boolean;
  root?: AtlasRoot;
  rootErrors?: string[];
  nodes: Record<string, AtlasNode>;
  nodeErrors: Record<string, string[]>;
  freshness: Record<string, AreaFreshness>;
  config?: AtlasConfig | null;
}

/** Load everything the Code Mode UI needs in one pass. */
export async function loadAtlasSnapshot(projectRoot: string): Promise<AtlasSnapshot> {
  const rootDoc = await readJson<AtlasRoot>(atlasPath(projectRoot, 'atlas.json'));
  if (!rootDoc) {
    return { exists: false, nodes: {}, nodeErrors: {}, freshness: {} };
  }
  const rootErrors = validateAtlasRoot(rootDoc);
  const snapshot: AtlasSnapshot = {
    exists: true,
    root: rootDoc,
    rootErrors: rootErrors.length ? rootErrors : undefined,
    nodes: {},
    nodeErrors: {},
    freshness: {},
    config: await readJson<AtlasConfig>(atlasPath(projectRoot, 'config.json')),
  };
  if (rootErrors.length) return snapshot; // invalid root: render nothing AI-ish

  const areaIds = new Set(rootDoc.areas.map(a => a.id));
  const churn = await cachedChurn(projectRoot);

  for (const area of rootDoc.areas) {
    const nodeDoc = await readJson<AtlasNode>(atlasPath(projectRoot, 'nodes', `${area.id}.json`));
    const fresh: AreaFreshness = {
      areaId: area.id,
      hasNode: false,
      stale: true,
      changedFiles: [],
      newFiles: 0,
      churn: sumChurnForPaths(churn, area.paths),
    };
    if (nodeDoc) {
      const errs = validateAtlasNode(nodeDoc, areaIds);
      if (errs.length) {
        snapshot.nodeErrors[area.id] = errs;
      } else {
        snapshot.nodes[area.id] = nodeDoc;
        fresh.hasNode = true;
        fresh.analyzedAt = nodeDoc.updated_at;
        const { changed } = await checkSourceHashes(projectRoot, nodeDoc.source_hashes ?? {});
        fresh.changedFiles = changed;
        fresh.stale = changed.length > 0;
      }
    }
    snapshot.freshness[area.id] = fresh;
  }
  return snapshot;
}

// Churn (14-day git log) is the slow part of the snapshot and the UI polls
// every 15s — cache per project for 60s. HMR-safe via globalThis.
const CHURN_KEY = '__slycode_atlas_churn__';
function churnCache(): Map<string, { at: number; churn: Record<string, number> }> {
  const g = globalThis as unknown as Record<string, Map<string, { at: number; churn: Record<string, number> }>>;
  if (!g[CHURN_KEY]) g[CHURN_KEY] = new Map();
  return g[CHURN_KEY];
}

async function cachedChurn(projectRoot: string): Promise<Record<string, number>> {
  const cache = churnCache();
  const hit = cache.get(projectRoot);
  if (hit && Date.now() - hit.at < 60_000) return hit.churn;
  const churn = await gitChurn(projectRoot).catch(() => ({} as Record<string, number>));
  cache.set(projectRoot, { at: Date.now(), churn });
  return churn;
}

function sumChurnForPaths(churn: Record<string, number>, prefixes: string[]): number {
  let total = 0;
  for (const [file, count] of Object.entries(churn)) {
    if (prefixes.some(p => file === p || file.startsWith(p.endsWith('/') ? p : p + '/'))) total += count;
  }
  return total;
}

/**
 * Sorted project file list (git ls-files, gitignore respected) — used for
 * collection member-list hashes. Must produce the SAME list the CLI sees.
 */
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

/** Member-list hash for a collection prefix — LOCKSTEP with scripts/atlas.js collectionListHash. */
function memberListHash(files: string[], prefix: string): string {
  const norm = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const members = files.filter(f => f === norm || f.startsWith(norm + '/')).sort();
  return hashContent(members.join('\n'));
}

/** Recompute hashes for a node's described sources; report mismatches. */
export async function checkSourceHashes(
  projectRoot: string,
  sourceHashes: Record<string, string>,
  projectFiles?: string[],
): Promise<{ changed: string[] }> {
  const changed: string[] = [];
  let files = projectFiles;
  for (const [rel, expected] of Object.entries(sourceHashes)) {
    // '<prefix>/' entries are collection member-list hashes (CLI convention):
    // membership change (added/removed family member) marks the node stale.
    if (rel.endsWith('/')) {
      if (!files) files = await listProjectFiles(projectRoot);
      if (memberListHash(files, rel) !== expected) changed.push(rel);
      continue;
    }
    let abs: string;
    try {
      abs = containedPath(projectRoot, rel);
    } catch {
      changed.push(rel);
      continue;
    }
    try {
      const buf = await fs.readFile(abs);
      if (hashContent(buf) !== expected) changed.push(rel);
    } catch {
      changed.push(rel); // deleted counts as changed
    }
  }
  return { changed };
}

// ---------------------------------------------------------------------------
// Area rename / pin — the single web-side mutation (user-owned identity).
// ---------------------------------------------------------------------------

export async function updateArea(
  projectRoot: string,
  areaId: string,
  patch: { name?: string; pinned?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = atlasPath(projectRoot, 'atlas.json');
  const rootDoc = await readJson<AtlasRoot>(file);
  if (!rootDoc) return { ok: false, error: 'No atlas' };
  const area = rootDoc.areas.find(a => a.id === areaId);
  if (!area) return { ok: false, error: 'Unknown area' };
  if (patch.name !== undefined) area.name = patch.name;
  if (patch.pinned !== undefined) area.pinned = patch.pinned;
  const errs = validateAtlasRoot(rootDoc);
  if (errs.length) return { ok: false, error: errs.join('; ') };
  const tmp = file + `.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(rootDoc, null, 2) + '\n', 'utf-8');
  await fs.rename(tmp, file);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Nav events (read side — CLI appends, UI polls with a cursor)
// ---------------------------------------------------------------------------

export async function readNavEvents(projectRoot: string, afterTs?: string): Promise<NavEvent[]> {
  const doc = await readJson<{ events: NavEvent[] }>(atlasPath(projectRoot, 'nav-events.json'));
  const events = Array.isArray(doc?.events) ? doc!.events : [];
  if (!afterTs) return events;
  return events.filter(e => e.ts > afterTs);
}
