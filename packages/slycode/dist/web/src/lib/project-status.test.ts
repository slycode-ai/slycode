/**
 * Project status helpers (card #0381, feature 089).
 *
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/project-status.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectStatus, isProjectActive, isProjectStatus, firesBeforeResume, resumedAtMs,
  statusChangePatch, heldForLabel,
} from './project-status';
import { heldSummary, skippedRunCount, SKIPPED_RUN_CAP } from './project-held';
import type { KanbanBoard } from './types';

const T = Date.parse('2026-10-06T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

test('absent and unknown status read as active', () => {
  assert.equal(projectStatus({}), 'active');
  assert.equal(projectStatus({ status: 'pausd' }), 'active');
  assert.equal(projectStatus({ status: 42 }), 'active');
  assert.equal(projectStatus({ status: 'paused' }), 'paused');
  assert.equal(isProjectActive({ status: 'complete' }), false);
  assert.equal(isProjectActive({ status: 'archived' }), false);
  assert.equal(isProjectActive({}), true);
  assert.equal(isProjectStatus('archived'), true);
  assert.equal(isProjectStatus('Archived'), false);
});

test('firesBeforeResume: fence edges', () => {
  const p = { resumedAt: iso(T) };
  assert.equal(firesBeforeResume(iso(T - 1), p), true);
  assert.equal(firesBeforeResume(iso(T), p), false, 'equal instant is not before');
  assert.equal(firesBeforeResume(iso(T + 1), p), false);
  assert.equal(firesBeforeResume(iso(T - 1), {}), false, 'no resumedAt → no fence');
  assert.equal(firesBeforeResume('garbage', p), false);
  assert.equal(firesBeforeResume(iso(T - 1), { resumedAt: 'garbage' }), false);
  assert.equal(firesBeforeResume(undefined, p), false);
  assert.equal(resumedAtMs(p), T);
  assert.equal(resumedAtMs({}), 0);
  assert.equal(resumedAtMs({ resumedAt: 'x' }), 0);
});

test('statusChangePatch: no-op on unchanged, resumedAt only on → active', () => {
  assert.equal(statusChangePatch({}, 'active', iso(T)), null);
  assert.equal(statusChangePatch({ status: 'paused' }, 'paused', iso(T)), null);
  assert.deepEqual(statusChangePatch({}, 'paused', iso(T)), { status: 'paused', statusChangedAt: iso(T) });
  assert.deepEqual(statusChangePatch({ status: 'paused' }, 'complete', iso(T)), { status: 'complete', statusChangedAt: iso(T) });
  assert.deepEqual(statusChangePatch({ status: 'archived' }, 'active', iso(T)), { status: 'active', statusChangedAt: iso(T), resumedAt: iso(T) });
});

test('heldForLabel', () => {
  assert.equal(heldForLabel(iso(T - 30_000), T), '1m');
  assert.equal(heldForLabel(iso(T - 5 * MIN), T), '5m');
  assert.equal(heldForLabel(iso(T - 3 * 60 * MIN), T), '3h');
  assert.equal(heldForLabel(iso(T - 3 * 24 * 60 * MIN), T), '3d');
  assert.equal(heldForLabel(iso(T - 15 * 24 * 60 * MIN), T), '2w');
  assert.equal(heldForLabel(undefined, T), '');
});

test('skippedRunCount: counts fire times in (from, now], capped, invalid cron → 0', () => {
  assert.equal(skippedRunCount('0 * * * *', T - 3 * 60 * MIN, T, 'UTC'), 3, 'hourly over 3h (12:00 included)');
  assert.equal(skippedRunCount('0 2 * * *', T - 14 * 24 * 60 * MIN, T, 'UTC'), 14);
  assert.equal(skippedRunCount('* * * * *', T - 24 * 60 * MIN, T, 'UTC'), SKIPPED_RUN_CAP);
  assert.equal(skippedRunCount('not a cron', T - 60 * MIN, T, 'UTC'), 0);
  assert.equal(skippedRunCount('0 * * * *', T, T, 'UTC'), 0);
});

test('heldSummary: counts enabled automations, pending prompts, atlas; skipped runs since', () => {
  const board = {
    stages: {
      backlog: [
        { id: 'a', automation: { enabled: true, schedule: '0 * * * *', scheduleType: 'recurring' } },
        { id: 'b', automation: { enabled: false, schedule: '0 * * * *', scheduleType: 'recurring' } },
        { id: 'c', archived: true, automation: { enabled: true, schedule: '0 * * * *', scheduleType: 'recurring' } },
        { id: 'd', automation: { enabled: true, schedule: iso(T - 30 * MIN), scheduleType: 'one-shot', nextRun: iso(T - 30 * MIN) } },
        { id: 'e', scheduled_prompts: [
          { id: 's1', state: 'pending', fireAt: iso(T - 10 * MIN) },
          { id: 's2', state: 'pending', fireAt: iso(T + 10 * MIN) },
          { id: 's3', state: 'delivered', fireAt: iso(T - 10 * MIN) },
        ] },
      ],
    },
  } as unknown as KanbanBoard;
  const h = heldSummary(board, { enabled: true, schedule: '0 * * * *' }, { sinceMs: T - 2 * 60 * MIN, nowMs: T, timezone: 'UTC' });
  assert.equal(h.automations, 2, 'a + d (b disabled, c archived)');
  assert.equal(h.scheduledPrompts, 2);
  assert.equal(h.atlas, true);
  // a: 11:00,12:00 = 2; d: 1; s1: 1; atlas: 2 → 6
  assert.equal(h.skippedRuns, 6);
  const noSince = heldSummary(board, null);
  assert.equal(noSince.skippedRuns, 0);
  assert.equal(noSince.atlas, false);
  assert.deepEqual(heldSummary(null, null), { automations: 0, scheduledPrompts: 0, atlas: false, skippedRuns: 0 });
});
