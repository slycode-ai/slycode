/**
 * Scheduled card prompts — server-side store (card #0352).
 *
 * The record is `card.scheduled_prompts` in the project's kanban.json. Every
 * write is a read-modify-write under the advisory board lock (shared with the
 * CLI and the web board POST) and never bumps `card.updated_at` — the same
 * bookkeeping rule as updateCardAutomation, so cards don't float to the top
 * of searches every time a send fires.
 *
 * Server-only (fs). Client code imports ./scheduled-prompts instead.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { KanbanBoard, KanbanCard, ScheduledPrompt } from './types';
import { atomicWriteFile } from './atomic-write';
import { withBoardLock } from './board-lock';

export interface MutateResult {
  card: KanbanCard;
  list: ScheduledPrompt[];
  stage: string;
}

function findCard(board: KanbanBoard, cardId: string): { card: KanbanCard; stage: string } | null {
  for (const [stage, cards] of Object.entries(board.stages)) {
    for (const card of (cards as KanbanCard[]) || []) {
      if (card.id === cardId) return { card, stage };
    }
  }
  return null;
}

export function kanbanPathFor(projectPath: string): string {
  return path.join(projectPath, 'documentation', 'kanban.json');
}

/**
 * Read a card's list without taking the lock (readers tolerate a torn
 * moment; the SSE stream will re-push anyway).
 */
export async function readCardScheduledPrompts(projectPath: string, cardId: string): Promise<ScheduledPrompt[] | null> {
  const content = await fs.readFile(kanbanPathFor(projectPath), 'utf-8');
  const board: KanbanBoard = JSON.parse(content);
  const found = findCard(board, cardId);
  return found ? (found.card.scheduled_prompts ?? []) : null;
}

/**
 * Apply `mutate` to the card's list under the board lock and persist.
 * The callback receives the live list (mutate in place or return a new one)
 * and the card itself (so the tick can set auto-status in the same write).
 * Returns null when the card is not on the board.
 */
export async function mutateCardScheduledPrompts(
  projectPath: string,
  cardId: string,
  mutate: (list: ScheduledPrompt[], card: KanbanCard) => ScheduledPrompt[] | void,
): Promise<MutateResult | null> {
  const kanbanPath = kanbanPathFor(projectPath);
  return withBoardLock(kanbanPath, async () => {
    const content = await fs.readFile(kanbanPath, 'utf-8');
    const board: KanbanBoard = JSON.parse(content);
    const found = findCard(board, cardId);
    if (!found) return null;
    const { card, stage } = found;
    const list = card.scheduled_prompts ?? [];
    const next = mutate(list, card) ?? list;
    if (next.length === 0) delete card.scheduled_prompts;
    else card.scheduled_prompts = next;
    // Bump the ROOT last_updated (never card.updated_at): the web client's
    // change detection (10s poll + SSE) reloads only when this value moves.
    // Without it a scheduled/fired send is invisible to open boards until
    // some other save happens — the "chip vanishes on reopen" bug.
    board.last_updated = new Date().toISOString();
    await atomicWriteFile(kanbanPath, JSON.stringify(board, null, 2) + '\n');
    return { card, list: next, stage };
  });
}
