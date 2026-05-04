/**
 * Kanban card number assignment.
 *
 * KEEP IN SYNC with the canonical CLI implementation in
 * scripts/kanban.js (search for `function ensureCardNumbers`). Both copies
 * MUST produce identical results for the same input — they take turns
 * writing the same kanban.json. The CJS/ESM split between this file
 * (Next.js / TS / ESM) and scripts/kanban.js (Node CLI / CJS) makes a
 * shared package over-engineered for one tiny pure function.
 *
 * Algorithm (idempotent):
 *  1. Walk every card in every stage (including archived).
 *  2. Compute the highest existing `card.number`.
 *  3. Assign sequential numbers to any card with `number == null`,
 *     starting at `max(existingMax, kanban.nextCardNumber ?? 0) + 1`,
 *     in `created_at` ascending order.
 *  4. Set `kanban.nextCardNumber` to one past the highest in-use number,
 *     but never lower it (preserves monotonic allocation across deletions
 *     and across CLI/web write cycles).
 *
 * Pure: mutates the passed-in `kanban` object, no I/O.
 */

import type { KanbanBoard, KanbanCard, KanbanStage } from './types';

const STAGES: KanbanStage[] = ['backlog', 'design', 'implementation', 'testing', 'done'];

function getAllCards(kanban: KanbanBoard): KanbanCard[] {
  const cards: KanbanCard[] = [];
  for (const stage of STAGES) {
    for (const card of kanban.stages[stage] || []) {
      cards.push(card);
    }
  }
  return cards;
}

export function ensureCardNumbers(kanban: KanbanBoard): void {
  const allCards = getAllCards(kanban);
  allCards.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  let maxNumber = 0;
  for (const card of allCards) {
    if (card.number != null && card.number > maxNumber) {
      maxNumber = card.number;
    }
  }

  const unnumbered = allCards.filter((card) => card.number == null);
  let nextNum = Math.max(maxNumber, kanban.nextCardNumber ?? 0) + 1;

  for (const card of unnumbered) {
    card.number = nextNum;
    if (nextNum > maxNumber) maxNumber = nextNum;
    nextNum++;
  }

  const target = maxNumber + 1;
  if (kanban.nextCardNumber == null || kanban.nextCardNumber < target) {
    kanban.nextCardNumber = target;
  }
}
