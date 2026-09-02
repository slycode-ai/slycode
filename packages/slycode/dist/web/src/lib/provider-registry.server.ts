/**
 * Server-side provider registry reader (feature 085 sweep).
 *
 * Single place the web server derives provider-dependent lists from
 * data/providers.json — badge detection rules, direct-path dot-dirs, labels —
 * instead of hardcoding 'claude' | 'codex' | 'gemini'. Server only (uses fs);
 * client components go through /api/providers (see use-providers.ts).
 */
import fs from 'fs';
import path from 'path';
import { getSlycodeRoot } from './paths';

export interface ProviderRegistryEntry {
  id: string;
  displayName: string;
  command: string;
  instructionFile?: string;
  agentIdentity?: string;
  color?: { hex: string; tailwind: { bg: string; text: string }; token?: string };
  detect?: { files?: string[]; dirs?: string[] };
  transport?: string;
}

const CACHE_TTL_MS = 30_000;
let cache: { at: number; entries: ProviderRegistryEntry[] } | null = null;

/** Registry entries in file order; empty array when providers.json is unreadable. */
export function loadProviderRegistrySync(): ProviderRegistryEntry[] {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.entries;
  let entries: ProviderRegistryEntry[] = [];
  try {
    const raw = fs.readFileSync(path.join(getSlycodeRoot(), 'data', 'providers.json'), 'utf-8');
    const data = JSON.parse(raw) as { providers?: Record<string, Omit<ProviderRegistryEntry, 'id'> & { id?: string }> };
    entries = Object.entries(data.providers ?? {}).map(([id, p]) => ({ ...p, id: p.id ?? id }));
  } catch {
    entries = [];
  }
  cache = { at: now, entries };
  return entries;
}

/** Test seam: drop the cache so a rewritten providers.json is re-read. */
export function resetProviderRegistryCache(): void {
  cache = null;
}

/**
 * Dot-prefixed directories that the file/html-attachment routes serve
 * directly from a project root (not via documentation/). Registry `detect.dirs`
 * plus the universal `.agents` directory.
 */
export function directPathDotDirs(entries: ProviderRegistryEntry[] = loadProviderRegistrySync()): string[] {
  const out = new Set<string>(['.agents']);
  for (const e of entries) for (const d of e.detect?.dirs ?? []) if (d.startsWith('.')) out.add(d);
  return [...out];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `^\.(claude|codex|agents|…)` built from the registry. */
export function directPathRegex(entries?: ProviderRegistryEntry[]): RegExp {
  const names = directPathDotDirs(entries).map(d => escapeRegex(d.slice(1)));
  return new RegExp(`^\\.(${names.join('|')})`);
}

/** Which providers a project uses, by the registry's detect rules. */
export function detectProviderPlatforms(
  projectPath: string,
  entries: ProviderRegistryEntry[] = loadProviderRegistrySync(),
): Record<string, boolean> {
  const exists = (p: string) => {
    try { return fs.existsSync(path.join(projectPath, p)); } catch { return false; }
  };
  const out: Record<string, boolean> = {};
  for (const e of entries) {
    const files = e.detect?.files ?? [];
    const dirs = e.detect?.dirs ?? [];
    out[e.id] = files.some(exists) || dirs.some(exists);
  }
  return out;
}
