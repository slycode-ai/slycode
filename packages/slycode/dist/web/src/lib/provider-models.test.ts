import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelList, parseRecentModels, buildModelEntries, mergeRefreshedModels, type ModelEntry } from './provider-models.server';

type RegistryDoc = {
  providers: Record<string, { model?: { flag: string; available?: ModelEntry[]; refreshCommand?: string[]; refreshedAt?: string } }>;
  defaults: { global: { provider: string; model?: string } };
};

test('parseModelList keeps provider/model lines, drops chrome and duplicates', () => {
  const out = parseModelList([
    'opencode/big-pickle',
    'openai/gpt-5.6-sol',
    '  openai/gpt-5.6-sol  ',
    'Warning: something',
    '',
    'anthropic/claude-sonnet-4-5',
    'not a model line',
  ].join('\n'));
  assert.deepEqual(out, ['opencode/big-pickle', 'openai/gpt-5.6-sol', 'anthropic/claude-sonnet-4-5']);
});

test('parseRecentModels reads the JSON model column of `opencode db` output, most recent first, deduped', () => {
  const out = parseRecentModels([
    'model\ttime_updated',
    '{"id":"gpt-5.6-sol","providerID":"openai","variant":"high"}\t1788076727548',
    '{"id":"gpt-5.6-sol","providerID":"openai","variant":"default"}\t1788076624273',
    '{"providerID":"anthropic","id":"claude-sonnet-4-5"}\t1788068044850',
  ].join('\n'));
  assert.deepEqual(out, ['openai/gpt-5.6-sol', 'anthropic/claude-sonnet-4-5']);
});

test('buildModelEntries puts recently used first, labels without the provider prefix', () => {
  const entries = buildModelEntries(['opencode/a-free', 'openai/gpt-5.6-sol', 'openai/gpt-5.4'], ['openai/gpt-5.4', 'openai/unknown']);
  assert.deepEqual(entries.map(e => e.id), ['openai/gpt-5.4', 'opencode/a-free', 'openai/gpt-5.6-sol']);
  assert.equal(entries[0].label, 'gpt-5.4');
  assert.match(entries[0].description!, /used before/);
  assert.doesNotMatch(entries[1].description!, /used before/);
});

test('mergeRefreshedModels overlays lists without touching other providers or defaults', () => {
  const data: RegistryDoc = {
    providers: {
      claude: { model: { flag: '--model', available: [{ id: 'fable', label: 'Fable' }] } },
      opencode: { model: { flag: '-m', available: [], refreshCommand: ['opencode', 'models'] } },
    },
    defaults: { global: { provider: 'claude', model: 'fable' } },
  };
  const merged = mergeRefreshedModels(data, {
    opencode: { refreshedAt: 't', models: [{ id: 'openai/gpt-5.6-sol', label: 'gpt-5.6-sol' }], recent: [] },
  });
  assert.deepEqual(merged.providers.claude, data.providers.claude);
  assert.equal(merged.providers.opencode.model!.available![0].id, 'openai/gpt-5.6-sol');
  assert.equal(merged.providers.opencode.model!.refreshedAt, 't');
  assert.deepEqual(merged.defaults, data.defaults);
  // Empty refresh data is a no-op
  assert.deepEqual(mergeRefreshedModels(data, {}), data);
  assert.deepEqual(data.providers.opencode.model!.available, [], 'input not mutated');
});
