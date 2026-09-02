import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderProviderIds, applyProviderPrefs } from './provider-prefs.server';

const IDS = ['claude', 'codex', 'gemini', 'opencode'];

test('orderProviderIds: prefs order first, rest keep registry order, unknown ids dropped', () => {
  assert.deepEqual(orderProviderIds(IDS, { order: ['opencode', 'nope', 'codex'], disabled: [] }), ['opencode', 'codex', 'claude', 'gemini']);
  assert.deepEqual(orderProviderIds(IDS, { order: [], disabled: [] }), IDS);
});

test('applyProviderPrefs: omits disabled providers and reorders the rest', () => {
  const data = { providers: Object.fromEntries(IDS.map(id => [id, { id }])), defaults: { global: { provider: 'claude' } } };
  const out = applyProviderPrefs(data, { order: ['opencode'], disabled: ['claude', 'codex', 'gemini'] });
  assert.deepEqual(Object.keys(out.providers!), ['opencode']);
  assert.deepEqual(out.defaults, data.defaults, 'defaults untouched');
  assert.deepEqual(Object.keys(data.providers), IDS, 'input not mutated');
});

test('applyProviderPrefs: empty prefs is a no-op', () => {
  const data = { providers: Object.fromEntries(IDS.map(id => [id, { id }])) };
  assert.deepEqual(Object.keys(applyProviderPrefs(data, { order: [], disabled: [] }).providers!), IDS);
});
