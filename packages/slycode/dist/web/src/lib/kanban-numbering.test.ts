/**
 * Tests for card numbering invariants (card numbers as first-class identifiers).
 *
 * Covers the safety claims the number-resolution feature rests on:
 *  - ensureCardNumbers assigns unique numbers, idempotently
 *  - nextCardNumber is monotonic — never lowered, even after the
 *    highest-numbered card is deleted (numbers are never reused)
 *  - allocation respects nextCardNumber floors above the current max
 *    (the cold-storage belt: writeKanban raises nextCardNumber past the
 *    highest archived number, so hot+cold uniqueness holds)
 *  - formatCardNumber display form
 *
 * Self-contained node:test script (matches kanban-cold.test.ts). Run via the
 * tsx binary in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/kanban-numbering.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureCardNumbers, formatCardNumber } from './kanban-numbering';
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

function board(stages: Partial<KanbanStages>, nextCardNumber?: number): KanbanBoard {
  return {
    project_id: 'p',
    stages: {
      backlog: [],
      design: [],
      implementation: [],
      testing: [],
      done: [],
      ...stages,
    },
    last_updated: '',
    ...(nextCardNumber != null ? { nextCardNumber } : {}),
  } as KanbanBoard;
}

function allNumbers(b: KanbanBoard): number[] {
  return Object.values(b.stages)
    .flat()
    .map((c) => c.number)
    .filter((n): n is number => n != null);
}

test('ensureCardNumbers: assigns unique sequential numbers to unnumbered cards', () => {
  const b = board({
    backlog: [card('a'), card('b')],
    done: [card('c', { number: 5 })],
  });
  ensureCardNumbers(b);
  const nums = allNumbers(b);
  assert.equal(nums.length, 3);
  assert.equal(new Set(nums).size, 3, 'numbers must be unique');
  assert.ok(nums.every((n) => n >= 1));
  assert.equal(b.nextCardNumber, Math.max(...nums) + 1);
});

test('ensureCardNumbers: idempotent — second run changes nothing', () => {
  const b = board({ backlog: [card('a'), card('b', { number: 3 })] });
  ensureCardNumbers(b);
  const snapshot = JSON.stringify(b);
  ensureCardNumbers(b);
  assert.equal(JSON.stringify(b), snapshot);
});

test('nextCardNumber is monotonic — deleting the highest card never lowers it', () => {
  const b = board({ backlog: [card('a', { number: 41 }), card('b', { number: 42 })] });
  ensureCardNumbers(b);
  assert.equal(b.nextCardNumber, 43);

  // Delete the highest-numbered card, then add a new unnumbered card.
  b.stages.backlog = b.stages.backlog.filter((c) => c.id !== 'b');
  b.stages.backlog.push(card('c'));
  ensureCardNumbers(b);

  const c = b.stages.backlog.find((x) => x.id === 'c')!;
  // Allocation starts one past max(hotMax, nextCardNumber) — gaps are fine,
  // reuse never happens. 42 was deleted; the new card must land above 43.
  assert.equal(c.number, 44, 'deleted numbers are never reused');
  assert.equal(b.nextCardNumber, 45);
});

test('allocation respects a nextCardNumber floor above the hot max (cold belt)', () => {
  // Simulates the writeKanban cold-storage belt: archived card #100 lives in
  // the cold file, so nextCardNumber was raised to 101 even though the hot
  // board only holds low numbers. New allocations must start at the floor —
  // that is what guarantees hot+cold uniqueness.
  // Allocation starts at max(hotMax, nextCardNumber) + 1 — one past the
  // floor, guaranteeing no collision with any number the floor represents.
  const b = board({ backlog: [card('a', { number: 2 }), card('new')] }, 101);
  ensureCardNumbers(b);
  const fresh = b.stages.backlog.find((c) => c.id === 'new')!;
  assert.equal(fresh.number, 102, 'must allocate above cold-held numbers');
  assert.equal(b.nextCardNumber, 103);
});

test('formatCardNumber: pads to 4 digits, no padding past 9999', () => {
  assert.equal(formatCardNumber(1), '#0001');
  assert.equal(formatCardNumber(274), '#0274');
  assert.equal(formatCardNumber(9999), '#9999');
  assert.equal(formatCardNumber(10000), '#10000');
});
