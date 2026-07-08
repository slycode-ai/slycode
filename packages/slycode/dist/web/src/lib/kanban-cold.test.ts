/**
 * Tests for cold-storage helpers (feature 077).
 *
 * Covers the load-bearing safety invariants from
 * documentation/designs/kanban_json_hardening.md:
 *  - union-and-dedupe by id, live wins
 *  - missing cold file = empty, never an error
 *  - corrupt cold file = readable-as-empty but NOT writable (no clobber)
 *  - crash-duplicated card (present in both files) surfaces exactly once
 *
 * Self-contained node:test script (matches scheduler.test.ts). Run via the tsx
 * binary in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/kanban-cold.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  coldPathFor,
  readColdBoard,
  unionStages,
  partitionArchived,
  upsertIntoCold,
  removeFromCold,
  maxColdCardNumber,
  emptyStages,
} from './kanban-cold';
import type { KanbanBoard, KanbanCard, KanbanStages } from './types';

function card(id: string, overrides: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id,
    title: `Card ${id}`,
    description: '',
    type: 'chore',
    priority: 'low',
    order: 10,
    areas: [],
    tags: [],
    problems: [],
    checklist: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as KanbanCard;
}

function stagesWith(partial: Partial<KanbanStages>): KanbanStages {
  return { ...emptyStages(), ...partial };
}

async function tmpKanbanPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-cold-test-'));
  return path.join(dir, 'kanban.json');
}

test('readColdBoard: missing file → empty board, writable', async () => {
  const kanbanPath = await tmpKanbanPath();
  const { board, writable } = await readColdBoard(kanbanPath);
  assert.equal(writable, true);
  for (const cards of Object.values(board.stages)) assert.equal(cards.length, 0);
});

test('readColdBoard: corrupt file → empty board, NOT writable', async () => {
  const kanbanPath = await tmpKanbanPath();
  await fs.writeFile(coldPathFor(kanbanPath), '{ this is not json');
  const { board, writable } = await readColdBoard(kanbanPath);
  assert.equal(writable, false);
  for (const cards of Object.values(board.stages)) assert.equal(cards.length, 0);
});

test('readColdBoard: drops cold cards whose id exists in live (crash-duplicate heal)', async () => {
  const kanbanPath = await tmpKanbanPath();
  const cold: KanbanBoard = {
    project_id: 'p',
    stages: stagesWith({ done: [card('dup', { archived: true }), card('only-cold', { archived: true })] }),
    last_updated: '',
  };
  await fs.writeFile(coldPathFor(kanbanPath), JSON.stringify(cold));
  const live = stagesWith({ done: [card('dup', { archived: true })] });
  const { board } = await readColdBoard(kanbanPath, live);
  assert.deepEqual(board.stages.done.map((c) => c.id), ['only-cold']);
});

test('unionStages: dedupe by id, live wins', () => {
  const live = stagesWith({ backlog: [card('a', { title: 'live version' })] });
  const cold = stagesWith({
    backlog: [card('a', { title: 'cold version' }), card('b')],
    done: [card('c', { archived: true })],
  });
  const out = unionStages(live, cold);
  assert.equal(out.backlog.length, 2); // a (live) + b — the crash-duplicate shows once
  assert.equal(out.backlog.find((c) => c.id === 'a')!.title, 'live version');
  assert.deepEqual(out.done.map((c) => c.id), ['c']);
});

test('partitionArchived: extracts archived cards with their stage, keeps the rest', () => {
  const stages = stagesWith({
    backlog: [card('live1')],
    done: [card('live2'), card('arch1', { archived: true }), card('arch2', { archived: true })],
  });
  const { keep, moved } = partitionArchived(stages);
  assert.deepEqual(keep.backlog.map((c) => c.id), ['live1']);
  assert.deepEqual(keep.done.map((c) => c.id), ['live2']);
  assert.deepEqual(moved.map((m) => `${m.stage}:${m.card.id}`), ['done:arch1', 'done:arch2']);
});

test('upsertIntoCold: replaces by id, appends new', () => {
  const cold: KanbanBoard = {
    project_id: 'p',
    stages: stagesWith({ done: [card('x', { title: 'old' })] }),
    last_updated: '',
  };
  upsertIntoCold(cold, [
    { stage: 'done', card: card('x', { title: 'new' }) },
    { stage: 'backlog', card: card('y') },
  ]);
  assert.equal(cold.stages.done.length, 1);
  assert.equal(cold.stages.done[0].title, 'new');
  assert.deepEqual(cold.stages.backlog.map((c) => c.id), ['y']);
});

test('removeFromCold: removes by id set, reports count', () => {
  const cold: KanbanBoard = {
    project_id: 'p',
    stages: stagesWith({ done: [card('a'), card('b')], backlog: [card('c')] }),
    last_updated: '',
  };
  const removed = removeFromCold(cold, new Set(['a', 'c', 'not-there']));
  assert.equal(removed, 2);
  assert.deepEqual(cold.stages.done.map((c) => c.id), ['b']);
  assert.equal(cold.stages.backlog.length, 0);
});

test('maxColdCardNumber: highest number across stages, 0 when none', () => {
  const cold: KanbanBoard = {
    project_id: 'p',
    stages: stagesWith({ done: [card('a', { number: 7 }), card('b', { number: 42 })], backlog: [card('c')] }),
    last_updated: '',
  };
  assert.equal(maxColdCardNumber(cold), 42);
  assert.equal(maxColdCardNumber({ project_id: 'p', stages: emptyStages(), last_updated: '' }), 0);
});
