/**
 * Round-trip tests for the scheduled-prompts store (card #0352).
 *
 * The bug this pins: a store write that leaves the board's root
 * `last_updated` untouched is invisible to the web client (its poll reloads
 * only when that value changes), so a scheduled send vanished from the chip
 * and popover as soon as the modal was reopened. The store must bump the root
 * timestamp on every write while leaving `card.updated_at` alone.
 *
 * Self-contained node:test script (matches scheduler.test.ts). Run via the tsx
 * binary in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/scheduled-prompts-store.test.ts
 *
 * Exits 0 on success, 1 on any assertion failure.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { mutateCardScheduledPrompts, readCardScheduledPrompts } from './scheduled-prompts-store';
import type { KanbanBoard, ScheduledPrompt } from './types';

const root = mkdtempSync(path.join(os.tmpdir(), 'slycode-spstore-'));
const projectPath = path.join(root, 'proj');
const kanbanPath = path.join(projectPath, 'documentation', 'kanban.json');

const CARD_UPDATED = '2026-01-01T00:00:00.000Z';
const ROOT_UPDATED = '2026-01-02T00:00:00.000Z';

async function seed(): Promise<void> {
  await fs.mkdir(path.dirname(kanbanPath), { recursive: true });
  const board = {
    project_id: 'proj',
    last_updated: ROOT_UPDATED,
    stages: {
      backlog: [],
      design: [],
      implementation: [{
        id: 'card-1', number: 1, title: 'T', description: '', type: 'feature', priority: 'high', order: 10,
        areas: [], tags: [], problems: [], checklist: [], created_at: CARD_UPDATED, updated_at: CARD_UPDATED,
      }],
      testing: [],
      done: [],
    },
  };
  await fs.writeFile(kanbanPath, JSON.stringify(board, null, 2) + '\n');
}

async function readBoard(): Promise<KanbanBoard & { last_updated: string }> {
  return JSON.parse(await fs.readFile(kanbanPath, 'utf-8'));
}

function entry(id: string): ScheduledPrompt {
  return {
    id, message: 'continue', fireAt: '2026-01-03T02:00:00.000Z', createdAt: '2026-01-02T19:43:00.000Z',
    sessionName: 'proj:claude:card:card-1', provider: 'claude', host: 'box', state: 'pending',
  };
}

after(async () => { await fs.rm(root, { recursive: true, force: true }); });

test('append → card payload on disk carries scheduled_prompts (what GET /api/kanban returns)', async () => {
  await seed();
  const res = await mutateCardScheduledPrompts(projectPath, 'card-1', (list) => { list.push(entry('sp-a')); });
  assert.ok(res);
  assert.equal(res.stage, 'implementation');
  assert.equal(res.list.length, 1);
  const board = await readBoard();
  const card = board.stages.implementation[0];
  assert.deepEqual(card.scheduled_prompts?.map(e => e.id), ['sp-a']);
  assert.deepEqual(await readCardScheduledPrompts(projectPath, 'card-1'), card.scheduled_prompts);
});

test('THE FIX: every write bumps root last_updated, never card.updated_at', async () => {
  await seed();
  const before = await readBoard();
  assert.equal(before.last_updated, ROOT_UPDATED);
  await mutateCardScheduledPrompts(projectPath, 'card-1', (list) => { list.push(entry('sp-b')); });
  const after1 = await readBoard();
  assert.notEqual(after1.last_updated, ROOT_UPDATED, 'root last_updated must move so the client poll reloads');
  assert.ok(Date.parse(after1.last_updated) > Date.parse(ROOT_UPDATED));
  assert.equal(after1.stages.implementation[0].updated_at, CARD_UPDATED, 'card.updated_at must not churn');
  // A state transition (the tick's fire/finish path) bumps it again.
  await mutateCardScheduledPrompts(projectPath, 'card-1', (list) => { list[0].state = 'delivered'; });
  const after2 = await readBoard();
  assert.ok(Date.parse(after2.last_updated) >= Date.parse(after1.last_updated));
  assert.equal(after2.stages.implementation[0].scheduled_prompts?.[0].state, 'delivered');
});

test('mutate receives the live card (auto-status in the same write) and returns null for unknown cards', async () => {
  await seed();
  const res = await mutateCardScheduledPrompts(projectPath, 'card-1', (list, card) => {
    list.push(entry('sp-c'));
    card.status = { text: 'Scheduled prompt delivered 02:00', setAt: new Date().toISOString(), kind: 'auto', tier: 'low' };
  });
  assert.ok(res);
  const board = await readBoard();
  assert.equal(board.stages.implementation[0].status?.text, 'Scheduled prompt delivered 02:00');
  assert.equal(await mutateCardScheduledPrompts(projectPath, 'card-nope', () => {}), null);
  assert.equal(await readCardScheduledPrompts(projectPath, 'card-nope'), null);
});

test('emptying the list removes the field; a returned array replaces the list', async () => {
  await seed();
  await mutateCardScheduledPrompts(projectPath, 'card-1', (list) => { list.push(entry('sp-d'), entry('sp-e')); });
  await mutateCardScheduledPrompts(projectPath, 'card-1', (list) => list.filter(e => e.id !== 'sp-d'));
  assert.deepEqual((await readCardScheduledPrompts(projectPath, 'card-1'))?.map(e => e.id), ['sp-e']);
  await mutateCardScheduledPrompts(projectPath, 'card-1', () => []);
  const board = await readBoard();
  assert.equal('scheduled_prompts' in board.stages.implementation[0], false);
  assert.deepEqual(await readCardScheduledPrompts(projectPath, 'card-1'), []);
});
