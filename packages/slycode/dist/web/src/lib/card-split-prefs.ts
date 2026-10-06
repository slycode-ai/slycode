/**
 * Card modal "side by side" layout preferences (wide screens only).
 *
 * Three per-browser values, all in localStorage (a layout choice that depends
 * on screen size belongs to the device, not the shared board):
 *   - default: side by side for every card, or not (off out of the box)
 *   - per card: stored ONLY while it differs from the default, so changing the
 *     default carries every card the user never overrode
 *   - ratio: the card column's share of the width, one value for all cards
 *
 * Storage can throw (private windows, blocked site data); every access is
 * guarded and falls back to the defaults.
 */

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const DEFAULT_KEY = 'slycode:card-split:default';
const RATIO_KEY = 'slycode:card-split:ratio';
const cardKey = (cardId: string) => `slycode:card-split:${cardId}`;

export const DEFAULT_RATIO = 0.4;
export const MIN_RATIO = 0.25;
export const MAX_RATIO = 0.7;

function store(): StorageLike | null {
  try { return window.localStorage; } catch { return null; }
}

function get(s: StorageLike | null, key: string): string | null {
  try { return s?.getItem(key) ?? null; } catch { return null; }
}

function set(s: StorageLike | null, key: string, value: string | null) {
  try {
    if (value === null) s?.removeItem(key);
    else s?.setItem(key, value);
  } catch { /* unavailable — the choice lasts until the modal closes */ }
}

export function readSplitDefault(s: StorageLike | null = store()): boolean {
  return get(s, DEFAULT_KEY) === '1';
}

export function writeSplitDefault(on: boolean, s: StorageLike | null = store()) {
  set(s, DEFAULT_KEY, on ? '1' : null);
}

/** Whether this card opens side by side: its own override, else the default. */
export function readCardSplit(cardId: string, s: StorageLike | null = store()): boolean {
  const v = get(s, cardKey(cardId));
  if (v === '1') return true;
  if (v === '0') return false;
  return readSplitDefault(s);
}

export function writeCardSplit(cardId: string, on: boolean, s: StorageLike | null = store()) {
  set(s, cardKey(cardId), on === readSplitDefault(s) ? null : on ? '1' : '0');
}

export function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));
}

export function readSplitRatio(s: StorageLike | null = store()): number {
  const v = get(s, RATIO_KEY);
  return v === null ? DEFAULT_RATIO : clampRatio(parseFloat(v));
}

export function writeSplitRatio(r: number, s: StorageLike | null = store()) {
  const c = clampRatio(r);
  set(s, RATIO_KEY, c === DEFAULT_RATIO ? null : c.toFixed(3));
}
