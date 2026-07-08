/**
 * Cold storage for archived kanban cards (feature 077).
 *
 * Archived cards live in `documentation/kanban-archive.json`, the same
 * {project_id, stages, last_updated} shape as the live board. Core rules
 * (KEEP IN SYNC with the CLI mirrors in scripts/kanban.js — getCold /
 * writeKanban partition):
 *
 *  - union-and-dedupe by id, live wins; missing cold file = empty, never error
 *  - a corrupt cold file is read as empty but NEVER written back (no clobber)
 *  - moves always write the DESTINATION file first, so a crash between the two
 *    writes leaves a card in both files (healed by dedupe-on-read), never in
 *    neither
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { KanbanBoard, KanbanStages, KanbanCard, KanbanStage } from '@/lib/types';

export const STAGE_KEYS: KanbanStage[] = ['backlog', 'design', 'implementation', 'testing', 'done'];

export function coldPathFor(kanbanPath: string): string {
  return path.join(path.dirname(kanbanPath), 'kanban-archive.json');
}

export function emptyStages(): KanbanStages {
  return { backlog: [], design: [], implementation: [], testing: [], done: [] };
}

export interface ColdBoardResult {
  board: KanbanBoard;
  /** false when the cold file exists but is unreadable — never write it then */
  writable: boolean;
}

/**
 * Read the cold archive board. Missing file → empty board (writable).
 * Corrupt file → empty board flagged NOT writable so callers can't clobber a
 * recoverable file. Cards whose id also appears in `liveStages` are dropped
 * (live wins) — self-heals the crash-between-writes duplicate state.
 */
export async function readColdBoard(
  kanbanPath: string,
  liveStages?: KanbanStages
): Promise<ColdBoardResult> {
  const coldPath = coldPathFor(kanbanPath);
  const board: KanbanBoard = {
    project_id: '',
    stages: emptyStages(),
    last_updated: new Date().toISOString(),
  };
  let raw: string;
  try {
    raw = await fs.readFile(coldPath, 'utf-8');
  } catch {
    return { board, writable: true }; // missing = no cold cards
  }
  try {
    const parsed = JSON.parse(raw) as KanbanBoard;
    if (!parsed || typeof parsed.stages !== 'object' || parsed.stages === null) {
      throw new Error('missing stages');
    }
    const liveIds = new Set<string>();
    if (liveStages) {
      for (const stage of STAGE_KEYS) {
        for (const card of liveStages[stage] || []) liveIds.add(card.id);
      }
    }
    for (const stage of STAGE_KEYS) {
      const cards = Array.isArray(parsed.stages[stage]) ? parsed.stages[stage] : [];
      board.stages[stage] = cards.filter((c) => c && c.id && !liveIds.has(c.id));
    }
    if (parsed.project_id) board.project_id = parsed.project_id;
    return { board, writable: true };
  } catch (err) {
    console.warn(`kanban-cold: could not parse ${coldPath} — treating as empty (read-only):`, err);
    return { board, writable: false };
  }
}

/**
 * Union live + cold stages, dedupe by id with live winning. Used by readers
 * that must include archived cards (GET ?includeArchived, search).
 */
export function unionStages(live: KanbanStages, cold: KanbanStages): KanbanStages {
  const out = emptyStages();
  for (const stage of STAGE_KEYS) {
    const liveCards = live[stage] || [];
    const liveIds = new Set(liveCards.map((c) => c.id));
    out[stage] = [...liveCards, ...(cold[stage] || []).filter((c) => !liveIds.has(c.id))];
  }
  return out;
}

export interface PartitionResult {
  /** live stages with archived cards removed */
  keep: KanbanStages;
  /** archived cards extracted, with their source stage */
  moved: Array<{ stage: KanbanStage; card: KanbanCard }>;
}

/**
 * Extract archived cards from a set of live stages. The single mechanism
 * behind both the one-time migration of legacy inline-archived boards and
 * steady-state archiving.
 */
export function partitionArchived(stages: KanbanStages): PartitionResult {
  const keep = emptyStages();
  const moved: PartitionResult['moved'] = [];
  for (const stage of STAGE_KEYS) {
    for (const card of stages[stage] || []) {
      if (card.archived) moved.push({ stage, card });
      else keep[stage].push(card);
    }
  }
  return { keep, moved };
}

/** Upsert cards into cold stages (replace by id, else append). Mutates `cold`. */
export function upsertIntoCold(
  cold: KanbanBoard,
  moved: Array<{ stage: KanbanStage; card: KanbanCard }>
): void {
  for (const { stage, card } of moved) {
    const arr = cold.stages[stage] || (cold.stages[stage] = []);
    const idx = arr.findIndex((c) => c.id === card.id);
    if (idx >= 0) arr[idx] = card;
    else arr.push(card);
  }
}

/** Remove cards by id from cold stages. Mutates `cold`; returns removed count. */
export function removeFromCold(cold: KanbanBoard, ids: Set<string>): number {
  let removed = 0;
  for (const stage of STAGE_KEYS) {
    const arr = cold.stages[stage] || [];
    const before = arr.length;
    cold.stages[stage] = arr.filter((c) => !ids.has(c.id));
    removed += before - cold.stages[stage].length;
  }
  return removed;
}

/** Highest card.number held by cold cards (0 when none). */
export function maxColdCardNumber(cold: KanbanBoard): number {
  let max = 0;
  for (const stage of STAGE_KEYS) {
    for (const card of cold.stages[stage] || []) {
      if (card.number != null && card.number > max) max = card.number;
    }
  }
  return max;
}
