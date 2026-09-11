/**
 * Board settings (feature #0350): validation + root-key preservation.
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/kanban-settings.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readBoardSettings,
  validateSettingsPatch,
  applySettingsPatch,
  writeBoardSettings,
} from './kanban-settings';

test('readBoardSettings: absent, malformed and explicit values', () => {
  assert.deepEqual(readBoardSettings(null), { allowCrossProjectPrompts: false });
  assert.deepEqual(readBoardSettings({}), { allowCrossProjectPrompts: false });
  assert.deepEqual(readBoardSettings({ settings: { allowCrossProjectPrompts: 'yes' as unknown as boolean } }), { allowCrossProjectPrompts: false });
  assert.deepEqual(readBoardSettings({ settings: { allowCrossProjectPrompts: true } }), { allowCrossProjectPrompts: true });
});

test('validateSettingsPatch: refuses unknown keys, non-booleans, empty and non-object payloads', () => {
  assert.ok('error' in validateSettingsPatch(null));
  assert.ok('error' in validateSettingsPatch([]));
  assert.ok('error' in validateSettingsPatch({}));
  assert.ok('error' in validateSettingsPatch({ nope: true }));
  assert.ok('error' in validateSettingsPatch({ allowCrossProjectPrompts: 'true' }));
  const ok = validateSettingsPatch({ allowCrossProjectPrompts: true });
  assert.deepEqual(ok, { patch: { allowCrossProjectPrompts: true } });
});

test('applySettingsPatch: preserves every other root key and stores false explicitly', () => {
  const board = {
    project_id: 'p',
    stages: { backlog: [{ id: 'card-1' }] },
    last_updated: '2026-01-01T00:00:00.000Z',
    nextCardNumber: 42,
    settings: { allowCrossProjectPrompts: true },
    someFutureKey: { keep: 'me' },
  } as unknown as Parameters<typeof applySettingsPatch>[0];

  const next = applySettingsPatch(board, { allowCrossProjectPrompts: false });
  assert.equal(next.project_id, 'p');
  assert.equal(next.nextCardNumber, 42);
  assert.deepEqual((next as unknown as { someFutureKey: unknown }).someFutureKey, { keep: 'me' });
  assert.deepEqual(next.stages, { backlog: [{ id: 'card-1' }] });
  assert.equal(next.settings?.allowCrossProjectPrompts, false);
  assert.notEqual(next.last_updated, board.last_updated);
  // Pure: input untouched
  assert.equal(board.settings?.allowCrossProjectPrompts, true);
});

test('writeBoardSettings: round-trips through disk without dropping root keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-settings-test-'));
  const file = path.join(dir, 'kanban.json');
  await fs.writeFile(file, JSON.stringify({
    project_id: 'p',
    stages: { backlog: [], design: [], implementation: [], testing: [], done: [] },
    last_updated: '2026-01-01T00:00:00.000Z',
    nextCardNumber: 7,
  }));

  const on = await writeBoardSettings(file, { allowCrossProjectPrompts: true });
  assert.deepEqual(on, { allowCrossProjectPrompts: true });
  const afterOn = JSON.parse(await fs.readFile(file, 'utf-8'));
  assert.equal(afterOn.nextCardNumber, 7);
  assert.equal(afterOn.project_id, 'p');
  assert.equal(afterOn.settings.allowCrossProjectPrompts, true);

  const off = await writeBoardSettings(file, { allowCrossProjectPrompts: false });
  assert.deepEqual(off, { allowCrossProjectPrompts: false });
  const afterOff = JSON.parse(await fs.readFile(file, 'utf-8'));
  assert.equal(afterOff.settings.allowCrossProjectPrompts, false);
  assert.equal(afterOff.nextCardNumber, 7);

  await assert.rejects(() => writeBoardSettings(path.join(dir, 'missing.json'), { allowCrossProjectPrompts: true }));
  await fs.rm(dir, { recursive: true, force: true });
});
