/**
 * Den folder collapse state (card #0381, Phase B) — device-local by owner
 * ruling: a phone and a desktop keep their own, and toggling never writes the
 * git-tracked registry. One localStorage key holding the collapsed folder
 * ids. Storage can throw (private windows, blocked site data); every access
 * is guarded and falls back to everything expanded.
 */

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const COLLAPSED_KEY = 'slycode:den:collapsed-folders';

function store(): StorageLike | null {
  try { return window.localStorage; } catch { return null; }
}

export function readCollapsedFolders(s: StorageLike | null = store()): Set<string> {
  try {
    const raw = s?.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Persist the collapsed set. Ids of folders that no longer exist are dropped
 * when `knownIds` is given, so the key never accumulates dead ids.
 */
export function writeCollapsedFolders(collapsed: ReadonlySet<string>, knownIds?: readonly string[], s: StorageLike | null = store()): void {
  const keep = knownIds ? [...collapsed].filter(id => knownIds.includes(id)) : [...collapsed];
  try {
    if (keep.length === 0) s?.removeItem(COLLAPSED_KEY);
    else s?.setItem(COLLAPSED_KEY, JSON.stringify(keep));
  } catch { /* unavailable — collapse lasts until reload */ }
}
