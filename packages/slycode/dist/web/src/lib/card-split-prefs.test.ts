/**
 * Tests for the card modal side-by-side preferences (default, per-card
 * override, split ratio).
 *
 * Self-contained script, run via the tsx binary that lives in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/card-split-prefs.test.ts
 *
 * Exits 0 on success, 1 on any assertion failure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readCardSplit, writeCardSplit, readSplitDefault, writeSplitDefault,
  readSplitRatio, writeSplitRatio, DEFAULT_RATIO, MIN_RATIO, MAX_RATIO,
} from './card-split-prefs';

function memStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

test('off by default, for the default and for any card', () => {
  const s = memStore();
  assert.equal(readSplitDefault(s), false);
  assert.equal(readCardSplit('c1', s), false);
});

test('cards with no override follow the default', () => {
  const s = memStore();
  writeSplitDefault(true, s);
  assert.equal(readCardSplit('c1', s), true);
  writeSplitDefault(false, s);
  assert.equal(readCardSplit('c1', s), false);
});

test('an override sticks when the default changes', () => {
  const s = memStore();
  writeCardSplit('c1', true, s);           // differs from default (off)
  writeSplitDefault(true, s);
  writeSplitDefault(false, s);
  assert.equal(readCardSplit('c1', s), true);
  writeSplitDefault(true, s);
  writeCardSplit('c2', false, s);          // explicit off under an on default
  assert.equal(readCardSplit('c2', s), false);
});

test('choosing the same as the default stores nothing', () => {
  const s = memStore();
  writeCardSplit('c1', true, s);
  writeCardSplit('c1', false, s);
  assert.equal(s.m.has('slycode:card-split:c1'), false);
});

test('ratio defaults, clamps and round-trips', () => {
  const s = memStore();
  assert.equal(readSplitRatio(s), DEFAULT_RATIO);
  writeSplitRatio(0.55, s);
  assert.equal(readSplitRatio(s), 0.55);
  writeSplitRatio(0.05, s);
  assert.equal(readSplitRatio(s), MIN_RATIO);
  writeSplitRatio(0.99, s);
  assert.equal(readSplitRatio(s), MAX_RATIO);
  s.setItem('slycode:card-split:ratio', 'garbage');
  assert.equal(readSplitRatio(s), DEFAULT_RATIO);
});

test('throwing storage falls back to defaults', () => {
  const bad = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  assert.equal(readCardSplit('c1', bad), false);
  assert.doesNotThrow(() => writeCardSplit('c1', true, bad));
  assert.equal(readSplitRatio(bad), DEFAULT_RATIO);
});
