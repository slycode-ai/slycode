/**
 * What a non-active project is holding back (card #0381) — SERVER ONLY
 * (croner). Pure over its inputs; lib/registry.ts feeds it boards it has
 * already read, and the status API route reuses it for the pause dialog.
 */

import { Cron } from 'croner';
import type { HeldSummary, KanbanBoard, KanbanCard } from './types';
import { isTerminal } from './scheduled-prompts';

export const SKIPPED_RUN_CAP = 99;

/**
 * Fire times of `schedule` in (fromMs, nowMs], capped. Invalid cron → 0.
 * Used for "N runs skipped so far" on a held project.
 */
export function skippedRunCount(
  schedule: string,
  fromMs: number,
  nowMs: number,
  timezone?: string,
  cap: number = SKIPPED_RUN_CAP,
): number {
  if (!Number.isFinite(fromMs) || fromMs >= nowMs) return 0;
  let job: Cron;
  try {
    job = new Cron(schedule, { timezone, paused: true });
  } catch {
    return 0;
  }
  let count = 0;
  let cursor = new Date(fromMs);
  while (count < cap) {
    const next = job.nextRun(cursor);
    if (!next || next.getTime() > nowMs) break;
    count++;
    cursor = next;
  }
  return count;
}

/** Fire times of `schedule` in (fromMs, toMs], capped — for "runs held in the next 24h". */
export function firesBetween(schedule: string, fromMs: number, toMs: number, timezone?: string, cap: number = SKIPPED_RUN_CAP): number {
  return skippedRunCount(schedule, fromMs, toMs, timezone, cap);
}

function allCards(board: KanbanBoard | null): KanbanCard[] {
  if (!board?.stages) return [];
  return Object.values(board.stages).flatMap(list => (list as KanbanCard[]) || []);
}

/**
 * Count the timers a project is holding: enabled automations on live cards,
 * pending scheduled prompts, and whether an atlas schedule is on. When
 * `sinceMs` is given, also count the recurring fire times skipped since then
 * (one-shots count once if their time has passed).
 */
export function heldSummary(
  board: KanbanBoard | null,
  atlas: { enabled?: boolean; schedule?: string | null } | null,
  opts: { sinceMs?: number; nowMs?: number; timezone?: string } = {},
): HeldSummary {
  const nowMs = opts.nowMs ?? Date.now();
  let automations = 0;
  let scheduledPrompts = 0;
  let skippedRuns = 0;
  for (const card of allCards(board)) {
    if (card.archived) continue;
    const a = card.automation;
    if (a?.enabled && a.schedule) {
      automations++;
      if (opts.sinceMs !== undefined) {
        if (a.scheduleType === 'one-shot') {
          const t = Date.parse(a.nextRun || a.schedule);
          if (Number.isFinite(t) && t > opts.sinceMs && t <= nowMs) skippedRuns++;
        } else {
          skippedRuns += skippedRunCount(a.schedule, opts.sinceMs, nowMs, opts.timezone);
        }
      }
    }
    for (const sp of card.scheduled_prompts ?? []) {
      if (isTerminal(sp) || sp.state !== 'pending') continue;
      scheduledPrompts++;
      if (opts.sinceMs !== undefined) {
        const t = Date.parse(sp.fireAt);
        if (Number.isFinite(t) && t > opts.sinceMs && t <= nowMs) skippedRuns++;
      }
    }
  }
  const atlasOn = Boolean(atlas?.enabled && atlas.schedule);
  if (atlasOn && opts.sinceMs !== undefined) {
    skippedRuns += skippedRunCount(atlas!.schedule!, opts.sinceMs, nowMs, opts.timezone);
  }
  return { automations, scheduledPrompts, atlas: atlasOn, skippedRuns: Math.min(skippedRuns, SKIPPED_RUN_CAP) };
}
