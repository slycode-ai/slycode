/**
 * Den status filter (card #0381).
 *
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/den-filter.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShowParam, serializeShow, toggleShown, statusCounts, denView, canReorder } from './den-filter';

test('parseShowParam: default Active, drops junk, keeps valid', () => {
  assert.deepEqual([...parseShowParam(null)], ['active']);
  assert.deepEqual([...parseShowParam('')], ['active']);
  assert.deepEqual([...parseShowParam('nope,,x')], ['active']);
  assert.deepEqual([...parseShowParam('paused, archived')].sort(), ['archived', 'paused']);
});

test('serializeShow: default → null, otherwise canonical order', () => {
  assert.equal(serializeShow(new Set(['active'])), null);
  assert.equal(serializeShow(new Set(['archived', 'active', 'paused'])), 'active,paused,archived');
  assert.equal(serializeShow(new Set(['paused'])), 'paused');
});

test('toggleShown: adds, removes, never empties', () => {
  assert.deepEqual([...toggleShown(new Set(['active']), 'paused')].sort(), ['active', 'paused']);
  assert.deepEqual([...toggleShown(new Set(['active', 'paused']), 'active')], ['paused']);
  assert.deepEqual([...toggleShown(new Set(['active']), 'active')], ['active'], 'last chip stays on');
});

test('statusCounts treats absent/unknown as active', () => {
  assert.deepEqual(statusCounts([{}, { status: 'paused' }, { status: 'bogus' }, { status: 'archived' }]),
    { active: 2, paused: 1, complete: 0, archived: 1 });
});

test('denView: active first then paused then complete, registry order within; archived as cold rows', () => {
  const ps = [
    { id: 'c1', status: 'complete' }, { id: 'a1' }, { id: 'p1', status: 'paused' },
    { id: 'x1', status: 'archived' }, { id: 'a2', status: 'active' }, { id: 'p2', status: 'paused' },
  ];
  const all = denView(ps, new Set(['active', 'paused', 'complete', 'archived'] as const));
  assert.deepEqual(all.tiles.map(p => p.id), ['a1', 'a2', 'p1', 'p2', 'c1']);
  assert.deepEqual(all.cold.map(p => p.id), ['x1']);
  const def = denView(ps, new Set(['active'] as const));
  assert.deepEqual(def.tiles.map(p => p.id), ['a1', 'a2']);
  assert.deepEqual(def.cold, []);
});

test('canReorder only on the default view', () => {
  assert.equal(canReorder(new Set(['active'])), true);
  assert.equal(canReorder(new Set(['active', 'paused'])), false);
});
