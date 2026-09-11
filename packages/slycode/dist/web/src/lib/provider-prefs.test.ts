import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderProviderIds, applyProviderPrefs } from './provider-prefs.server';

const IDS = ['claude', 'codex', 'zeta', 'opencode'];

test('orderProviderIds: prefs order first, rest keep registry order, unknown ids dropped', () => {
  assert.deepEqual(orderProviderIds(IDS, { order: ['opencode', 'nope', 'codex'], disabled: [] }), ['opencode', 'codex', 'claude', 'zeta']);
  assert.deepEqual(orderProviderIds(IDS, { order: [], disabled: [] }), IDS);
});

test('applyProviderPrefs: omits disabled providers and reorders the rest', () => {
  const data = { providers: Object.fromEntries(IDS.map(id => [id, { id }])), defaults: { global: { provider: 'claude' } } };
  const out = applyProviderPrefs(data, { order: ['opencode'], disabled: ['claude', 'codex', 'zeta'] });
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
  const out = applyProviderPrefs(data, { order: ['opencode'], disabled: ['claude', 'codex', 'zeta'] });
  assert.equal(out.defaults!.global!.provider, 'opencode');
  assert.equal(out.defaults!.projects!.p1.provider, 'opencode');
  assert.equal(out.defaults!.projects!.p2.provider, 'opencode', 'already-enabled default untouched in value');
  assert.equal((out.defaults!.global as { skipPermissions?: boolean }).skipPermissions, true, 'other default fields preserved');
  assert.equal(data.defaults.global.provider, 'claude', 'stored data not mutated');
});

test('applyProviderPrefs: defaults pointing at a DELETED provider (absent from the registry) fall back too', () => {
  // Card #0343 regression: a stored default may name a provider that was
  // removed from providers.json entirely. It is not in the disabled list, so
  // the fallback must key on "not among the surviving ids", not "disabled".
  const data = {
    providers: Object.fromEntries(IDS.map(id => [id, { id }])),
    defaults: {
      global: { provider: 'removed-provider', model: 'removed-model-2.5-pro', skipPermissions: true },
      projects: { p1: { provider: 'removed-provider', model: 'removed-model-flash' }, p2: { provider: 'codex', model: 'o3' } },
    },
  };
  const out = applyProviderPrefs(data, { order: [], disabled: [] });
  assert.equal(out.defaults!.global!.provider, IDS[0], 'deleted global default falls back to first enabled');
  assert.equal(out.defaults!.projects!.p1.provider, IDS[0], 'deleted per-project default falls back');
  assert.equal(out.defaults!.projects!.p2.provider, 'codex', 'valid per-project default untouched');
  // Review finding on #0343: rewriting the provider must not forward the old
  // provider's model to the fallback provider's session creation.
  assert.equal((out.defaults!.global as { model?: string }).model, undefined, 'stale model dropped with the rewritten global default');
  assert.equal((out.defaults!.projects!.p1 as { model?: string }).model, undefined, 'stale model dropped with the rewritten per-project default');
  assert.equal((out.defaults!.projects!.p2 as { model?: string }).model, 'o3', 'valid default keeps its model');
  assert.equal((out.defaults!.global as { skipPermissions?: boolean }).skipPermissions, true, 'non-model fields survive the rewrite');
  assert.equal((data.defaults.global as { model?: string }).model, 'removed-model-2.5-pro', 'stored data not mutated');
});

test('applyProviderPrefs: empty prefs is a no-op', () => {
  const data = { providers: Object.fromEntries(IDS.map(id => [id, { id }])) };
  assert.deepEqual(Object.keys(applyProviderPrefs(data, { order: [], disabled: [] }).providers!), IDS);
});
