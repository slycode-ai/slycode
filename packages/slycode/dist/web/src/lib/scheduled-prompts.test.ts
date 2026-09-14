/**
 * Tests for the scheduled-prompt rules (card #0352): tick classification,
 * input validation, the prompt stamp, and the picker helpers.
 *
 * Self-contained node:test script (matches scheduler.test.ts). Run via the tsx
 * binary in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/scheduled-prompts.test.ts
 *
 * Exits 0 on success, 1 on any assertion failure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEDULED_PROMPT_LIMITS,
  autoDayFor,
  buildScheduledPromptBody,
  classifyScheduledPrompt,
  formatCountdown,
  formatFireTime,
  nextPendingFireAt,
  offsetFireAt,
  providerFromSessionName,
  timeOfDayFireAt,
  validateScheduledPromptInput,
} from './scheduled-prompts';
import type { ScheduledPrompt } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-09-11T12:00:00.000Z');
const HOST = 'this-box';

function entry(overrides: Partial<ScheduledPrompt> = {}): ScheduledPrompt {
  return {
    id: 'sp-1', message: 'continue', fireAt: new Date(NOW - MIN).toISOString(),
    createdAt: new Date(NOW - HOUR).toISOString(), sessionName: 'p:claude:card:card-1',
    provider: 'claude', host: HOST, state: 'pending', ...overrides,
  };
}

// ---------------------------------------------------------------------------
// classifyScheduledPrompt
// ---------------------------------------------------------------------------

test('pending + due → fire', () => {
  assert.equal(classifyScheduledPrompt(entry(), NOW, HOST), 'fire');
});

test('pending + exactly now → fire (boundary)', () => {
  assert.equal(classifyScheduledPrompt(entry({ fireAt: new Date(NOW).toISOString() }), NOW, HOST), 'fire');
});

test('pending + future → skip', () => {
  assert.equal(classifyScheduledPrompt(entry({ fireAt: new Date(NOW + MIN).toISOString() }), NOW, HOST), 'skip');
});

test('pending + other host → skip, even when due', () => {
  assert.equal(classifyScheduledPrompt(entry({ host: 'other-box' }), NOW, HOST), 'skip');
});

test('pending + past the catch-up window → missed', () => {
  const late = new Date(NOW - SCHEDULED_PROMPT_LIMITS.catchUpWindowMs - MIN).toISOString();
  assert.equal(classifyScheduledPrompt(entry({ fireAt: late }), NOW, HOST), 'missed');
});

test('pending + inside the catch-up window → fire (web restart catch-up)', () => {
  const late = new Date(NOW - SCHEDULED_PROMPT_LIMITS.catchUpWindowMs + MIN).toISOString();
  assert.equal(classifyScheduledPrompt(entry({ fireAt: late }), NOW, HOST), 'fire');
});

test('pending + unparseable fireAt → missed (never wedges the tick)', () => {
  assert.equal(classifyScheduledPrompt(entry({ fireAt: 'garbage' }), NOW, HOST), 'missed');
});

test('firing + fresh claim → skip (kickoff in flight)', () => {
  assert.equal(classifyScheduledPrompt(entry({ state: 'firing', firedAt: new Date(NOW - MIN).toISOString() }), NOW, HOST), 'skip');
});

test('firing + stale claim → interrupted (crashed mid-fire)', () => {
  const stale = new Date(NOW - SCHEDULED_PROMPT_LIMITS.firingStaleMs - MIN).toISOString();
  assert.equal(classifyScheduledPrompt(entry({ state: 'firing', firedAt: stale }), NOW, HOST), 'interrupted');
});

test('terminal + young → skip (kept as history)', () => {
  assert.equal(classifyScheduledPrompt(entry({ state: 'delivered', finishedAt: new Date(NOW - HOUR).toISOString() }), NOW, HOST), 'skip');
});

test('terminal + older than retention → prune', () => {
  const old = new Date(NOW - SCHEDULED_PROMPT_LIMITS.retentionMs - MIN).toISOString();
  for (const state of ['delivered', 'failed', 'cancelled', 'missed'] as const) {
    assert.equal(classifyScheduledPrompt(entry({ state, finishedAt: old }), NOW, HOST), 'prune', state);
  }
});

test('terminal from another host is still pruned (history is host-agnostic)', () => {
  const old = new Date(NOW - SCHEDULED_PROMPT_LIMITS.retentionMs - MIN).toISOString();
  assert.equal(classifyScheduledPrompt(entry({ state: 'cancelled', host: 'other', finishedAt: old }), NOW, HOST), 'prune');
});

// ---------------------------------------------------------------------------
// validateScheduledPromptInput
// ---------------------------------------------------------------------------

test('validate: ok → trimmed message, ISO fireAt', () => {
  const v = validateScheduledPromptInput({ message: '  continue  ', fireAt: new Date(NOW + 5 * MIN).toISOString() }, NOW);
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.message, 'continue');
    assert.equal(v.fireAt, new Date(NOW + 5 * MIN).toISOString());
  }
});

test('validate: empty message rejected', () => {
  const v = validateScheduledPromptInput({ message: '   ', fireAt: new Date(NOW + 5 * MIN).toISOString() }, NOW);
  assert.equal(v.ok, false);
});

test('validate: over-length message rejected', () => {
  const v = validateScheduledPromptInput({ message: 'x'.repeat(SCHEDULED_PROMPT_LIMITS.maxMessageChars + 1), fireAt: new Date(NOW + 5 * MIN).toISOString() }, NOW);
  assert.equal(v.ok, false);
});

test('validate: less than a minute ahead rejected; exactly a minute accepted', () => {
  assert.equal(validateScheduledPromptInput({ message: 'x', fireAt: new Date(NOW + 30_000).toISOString() }, NOW).ok, false);
  assert.equal(validateScheduledPromptInput({ message: 'x', fireAt: new Date(NOW + MIN).toISOString() }, NOW).ok, true);
});

test('validate: bad date rejected', () => {
  assert.equal(validateScheduledPromptInput({ message: 'x', fireAt: 'tomorrow-ish' }, NOW).ok, false);
});

// ---------------------------------------------------------------------------
// Prompt body
// ---------------------------------------------------------------------------

test('body: one stamp line, blank line, message; elapsed is set→fired', () => {
  const body = buildScheduledPromptBody(
    { message: 'continue', createdAt: new Date(NOW - (6 * HOUR + 17 * MIN)).toISOString(), fireAt: new Date(NOW).toISOString() },
    new Date(NOW),
    'UTC',
  );
  const lines = body.split('\n');
  assert.match(lines[0], /^\[Scheduled send · set Fri 05:43, fired Fri 12:00 · 6h 17m elapsed\]$/);
  assert.equal(lines[1], '');
  assert.equal(lines[2], 'continue');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

test('providerFromSessionName', () => {
  assert.equal(providerFromSessionName('claude-master:codex:card:card-1'), 'codex');
  assert.equal(providerFromSessionName('claude-master:claude:card:card-1'), 'claude');
  assert.equal(providerFromSessionName('claude-master:global'), null);
  assert.equal(providerFromSessionName('claude-master:card:card-1'), null);
});

test('nextPendingFireAt picks the earliest pending, ignores finished', () => {
  const list = [
    entry({ id: 'a', state: 'delivered', fireAt: new Date(NOW - HOUR).toISOString() }),
    entry({ id: 'b', fireAt: new Date(NOW + 3 * HOUR).toISOString() }),
    entry({ id: 'c', fireAt: new Date(NOW + HOUR).toISOString() }),
  ];
  assert.equal(nextPendingFireAt(list), list[2].fireAt);
  assert.equal(nextPendingFireAt([]), null);
});

test('offsetFireAt rounds up to the next whole minute', () => {
  const now = new Date(NOW + 20_000); // 12:00:20
  const d = offsetFireAt(15 * MIN, now);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getTime(), NOW + 16 * MIN);
});

test('timeOfDayFireAt / autoDayFor flip to tomorrow once the time has passed', () => {
  const now = new Date(2026, 8, 11, 19, 43, 0); // local 19:43
  const today = timeOfDayFireAt('02:00', 'today', now)!;
  assert.equal(today.getHours(), 2);
  assert.equal(today.getDate(), 11);
  assert.equal(autoDayFor('02:00', now), 'tomorrow');
  assert.equal(autoDayFor('23:30', now), 'today');
  const tomorrow = timeOfDayFireAt('02:00', 'tomorrow', now)!;
  assert.equal(tomorrow.getDate(), 12);
  assert.equal(timeOfDayFireAt('25:00', 'today', now), null);
  assert.equal(timeOfDayFireAt('nope', 'today', now), null);
});

test('formatFireTime: HH:mm within 24h, weekday beyond', () => {
  const now = new Date(2026, 8, 11, 19, 43, 0);
  const soon = new Date(2026, 8, 12, 2, 0, 0);
  const far = new Date(2026, 8, 15, 2, 0, 0);
  assert.equal(formatFireTime(soon.toISOString(), now), '02:00');
  assert.match(formatFireTime(far.toISOString(), now), /^\w{3} 02:00$/);
});

test('formatCountdown', () => {
  const now = new Date(NOW);
  assert.equal(formatCountdown(new Date(NOW + 6 * HOUR + 14 * MIN).toISOString(), now), 'in 6h 14m');
  assert.equal(formatCountdown(new Date(NOW + 3 * MIN).toISOString(), now), 'in 3m');
  assert.equal(formatCountdown(new Date(NOW + 10_000).toISOString(), now), 'due now');
  assert.equal(formatCountdown(new Date(NOW - 2 * HOUR).toISOString(), now), '2h 0m ago');
});
