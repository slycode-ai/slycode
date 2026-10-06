/**
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/visible-viewport.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bottomSheetMaxHeight, visibleBottom, visibleViewport } from './visible-viewport';
import { placePopover } from './popover-placement';

test('without visualViewport the layout height is all there is', () => {
  assert.deepEqual(visibleViewport({ innerHeight: 800 }), { top: 0, height: 800, bottomInset: 0 });
  assert.deepEqual(visibleViewport({ innerHeight: 800, visualViewport: null }), { top: 0, height: 800, bottomInset: 0 });
});

test('a keyboard shrinks the visible area and leaves an inset below it', () => {
  // Phone: 844 px layout, keyboard takes the bottom 336 px.
  assert.deepEqual(visibleViewport({ innerHeight: 844, visualViewport: { height: 508, offsetTop: 0 } }), { top: 0, height: 508, bottomInset: 336 });
});

test('a visual viewport scrolled down (iOS with the keyboard up) moves the top', () => {
  const v = visibleViewport({ innerHeight: 844, visualViewport: { height: 508, offsetTop: 120 } });
  assert.deepEqual(v, { top: 120, height: 508, bottomInset: 216 });
  assert.equal(visibleBottom({ innerHeight: 844, visualViewport: { height: 508, offsetTop: 120 } }), 628);
});

test('never taller than the layout viewport, never negative', () => {
  assert.deepEqual(visibleViewport({ innerHeight: 600, visualViewport: { height: 700, offsetTop: 0 } }), { top: 0, height: 600, bottomInset: 0 });
  assert.deepEqual(visibleViewport({ innerHeight: 600, visualViewport: { height: 0, offsetTop: 0 } }), { top: 0, height: 600, bottomInset: 0 });
  const odd = visibleViewport({ innerHeight: 600, visualViewport: { height: 300, offsetTop: 500 } });
  assert.ok(odd.height >= 0 && odd.bottomInset >= 0);
  assert.equal(odd.top + odd.height + odd.bottomInset, 600);
});

test('a bottom sheet takes at most 85% of what can be seen', () => {
  assert.equal(bottomSheetMaxHeight({ top: 0, height: 508, bottomInset: 336 }), 431);
});

test('an anchored popover capped to the visible bottom stays above the keyboard', () => {
  const win = { innerHeight: 844, visualViewport: { height: 508, offsetTop: 0 } };
  const p = placePopover({ top: 90, bottom: 120, right: 380 }, { width: 390, height: visibleBottom(win) });
  assert.equal(p.side, 'below');
  assert.equal(p.maxHeight, 508 - 120 - 8 - 12);
});
