/**
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/popover-placement.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placePopover } from './popover-placement';

const vp = { width: 1200, height: 900 };

test('a gear near the top opens below, capped to the room left in the viewport', () => {
  const p = placePopover({ top: 130, bottom: 160, right: 1140 }, vp);
  assert.deepEqual(p, { side: 'below', top: 168, right: 60, maxHeight: 900 - 160 - 8 - 12 });
});

test('a gear near the bottom opens above when there is more room there', () => {
  const p = placePopover({ top: 800, bottom: 830, right: 1180 }, vp);
  assert.equal(p.side, 'above');
  assert.equal(p.side === 'above' && p.bottom, 900 - 800 + 8);
  assert.equal(p.maxHeight, 800 - 8 - 12);
});

test('below wins whenever it has comfortable room, even if above has more', () => {
  assert.equal(placePopover({ top: 480, bottom: 500, right: 600 }, vp).side, 'below');
});

test('never negative; never past the right edge', () => {
  const tiny = placePopover({ top: 5, bottom: 30, right: 1300 }, { width: 1200, height: 40 });
  assert.ok(tiny.maxHeight >= 0);
  assert.equal(tiny.right, 12);
});
