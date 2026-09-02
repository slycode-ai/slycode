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
  assert.equal(out.defaults!.global!.provider, 'opencode', 'disabled default falls back to the first enabled provider');
  assert.deepEqual(Object.keys(data.providers), IDS, 'input not mutated');
});

test('applyProviderPrefs: defaults pointing at a disabled provider fall back to the first enabled one', () => {
  const data = {
    providers: Object.fromEntries(IDS.map(id => [id, { id }])),
    defaults: {
      global: { provider: 'claude', skipPermissions: true },
      projects: { p1: { provider: 'codex' }, p2: { provider: 'opencode' } },
    },
  };
  const out = applyProviderPrefs(data, { order: ['opencode'], disabled: ['claude', 'codex', 'gemini'] });
  assert.equal(out.defaults!.global!.provider, 'opencode');
  assert.equal(out.defaults!.projects!.p1.provider, 'opencode');
  assert.equal(out.defaults!.projects!.p2.provider, 'opencode', 'already-enabled default untouched in value');
  assert.equal((out.defaults!.global as { skipPermissions?: boolean }).skipPermissions, true, 'other default fields preserved');
  assert.equal(data.defaults.global.provider, 'claude', 'stored data not mutated');
});

test('applyProviderPrefs: empty prefs is a no-op', () => {
  const data = { providers: Object.fromEntries(IDS.map(id => [id, { id }])) };
  assert.deepEqual(Object.keys(applyProviderPrefs(data, { order: [], disabled: [] }).providers!), IDS);
});
