/**
 * Tests for isDue() — the firing decision at the heart of the automation scheduler.
 *
 * The web/ package doesn't ship a configured test runner, so this file is a
 * self-contained script. Run via the tsx binary that lives in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/scheduler.test.ts
 *
 * Exits 0 on success, 1 on any assertion failure. Keep it lightweight —
 * node:test/node:assert only, no framework deps.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDue } from './scheduler';
import type { AutomationConfig } from './types';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function baseRecurring(overrides: Partial<AutomationConfig> = {}): AutomationConfig {
  return {
    enabled: true,
    schedule: '0 * * * *', // every hour on the hour
    scheduleType: 'recurring',
    provider: 'claude',
    freshSession: false,
    reportViaMessaging: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Primary path: trust config.nextRun when present
// ---------------------------------------------------------------------------

test('primary: nextRun in the past → fires', () => {
  const cfg = baseRecurring({ nextRun: new Date(Date.now() - 5 * MINUTE).toISOString() });
  assert.equal(isDue(cfg), true);
});

test('primary: nextRun in the future → does not fire', () => {
  const cfg = baseRecurring({ nextRun: new Date(Date.now() + 5 * MINUTE).toISOString() });
  assert.equal(isDue(cfg), false);
});

test('primary: nextRun exactly now → fires (boundary)', () => {
  // ±0 — pass an ISO timestamp at "now" and assert it's at-or-before now.
  const cfg = baseRecurring({ nextRun: new Date().toISOString() });
  assert.equal(isDue(cfg), true);
});

// ---------------------------------------------------------------------------
// Re-fire guard: lastRun within RE_FIRE_GUARD_MS suppresses
// ---------------------------------------------------------------------------

test('re-fire guard: recent lastRun + past nextRun → does NOT fire (loop prevention)', () => {
  const cfg = baseRecurring({
    lastRun: new Date(Date.now() - 10_000).toISOString(),  // 10s ago, within 60s guard
    nextRun: new Date(Date.now() - 5_000).toISOString(),   // past, would otherwise fire
  });
  assert.equal(isDue(cfg), false);
});

test('re-fire guard: lastRun just past the guard window → fires', () => {
  const cfg = baseRecurring({
    lastRun: new Date(Date.now() - 70_000).toISOString(),  // 70s ago, outside 60s guard
    nextRun: new Date(Date.now() - 5_000).toISOString(),
  });
  assert.equal(isDue(cfg), true);
});

// ---------------------------------------------------------------------------
// Fallback (nextRun missing): never-run uses FIRST_FIRE_WINDOW_MS (24h)
// ---------------------------------------------------------------------------

test('fallback: never-run + cron with tick in the last hour → fires (24h first-fire window)', () => {
  // Use a cron tied to the current minute boundary one hour ago.
  // "0 * * * *" fires every hour on the hour; relative to "now", the most
  // recent past tick is somewhere between 0 and 60 minutes ago.
  const cfg = baseRecurring({ schedule: '0 * * * *' });
  // Only assert if the past tick is more than a few seconds old (avoid flake
  // when running exactly on a minute boundary):
  const minutesIntoHour = new Date().getMinutes();
  if (minutesIntoHour >= 1) {
    assert.equal(isDue(cfg), true);
  }
});

test('fallback: never-run + cron whose only tick is in far future → does NOT fire', () => {
  // Cron "0 0 1 1 *" = January 1st 00:00. Almost certainly not within last 24h
  // unless this test runs in the first second of the year.
  const cfg = baseRecurring({ schedule: '0 0 1 1 *' });
  const now = new Date();
  if (now.getMonth() !== 0 || now.getDate() !== 1) {
    assert.equal(isDue(cfg), false);
  }
});

// ---------------------------------------------------------------------------
// Fallback (nextRun missing): has-lastRun uses GRACE_WINDOW_MS (60s)
// ---------------------------------------------------------------------------

test('fallback: has-lastRun + tick within grace → fires', () => {
  // "* * * * *" every minute. lastRun 5 min ago. ref = max(lastRun, now-60s) = now-60s.
  // Next tick after now-60s is the most recent minute boundary, which is ≤ now.
  // But re-fire guard suppresses if lastRun is too recent. lastRun=5min ago is safe.
  const cfg = baseRecurring({
    schedule: '* * * * *',
    lastRun: new Date(Date.now() - 5 * MINUTE).toISOString(),
  });
  assert.equal(isDue(cfg), true);
});

test('fallback: has-lastRun + tick outside grace window → does NOT fire (preserves long-disable invariant)', () => {
  // "0 * * * *" hourly. lastRun 6 months ago. ref = max(6mo-ago, now-60s) = now-60s.
  // Next tick after now-60s is the next hour boundary (or possibly the most recent
  // one if we're within 60s of it). To avoid flake at hour boundaries, only assert
  // when we're well into the hour.
  const minutesIntoHour = new Date().getMinutes();
  if (minutesIntoHour >= 2 && minutesIntoHour <= 58) {
    const cfg = baseRecurring({
      schedule: '0 * * * *',
      lastRun: new Date(Date.now() - 180 * 24 * HOUR).toISOString(),
    });
    assert.equal(isDue(cfg), false);
  }
});

// ---------------------------------------------------------------------------
// One-shot: unchanged behavior
// ---------------------------------------------------------------------------

test('one-shot: target in the past → fires', () => {
  const cfg: AutomationConfig = {
    ...baseRecurring(),
    scheduleType: 'one-shot',
    schedule: new Date(Date.now() - MINUTE).toISOString(),
  };
  assert.equal(isDue(cfg), true);
});

test('one-shot: target in the future → does not fire', () => {
  const cfg: AutomationConfig = {
    ...baseRecurring(),
    scheduleType: 'one-shot',
    schedule: new Date(Date.now() + MINUTE).toISOString(),
  };
  assert.equal(isDue(cfg), false);
});

// ---------------------------------------------------------------------------
// Disable / empty-schedule guards
// ---------------------------------------------------------------------------

test('disabled: enabled=false → never fires', () => {
  const cfg = baseRecurring({
    enabled: false,
    nextRun: new Date(Date.now() - MINUTE).toISOString(),
  });
  assert.equal(isDue(cfg), false);
});

test('empty schedule: schedule="" → never fires', () => {
  const cfg = baseRecurring({
    schedule: '',
    nextRun: new Date(Date.now() - MINUTE).toISOString(),
  });
  assert.equal(isDue(cfg), false);
});

test('invalid cron: schedule="not a cron" → never fires (no throw)', () => {
  const cfg = baseRecurring({
    schedule: 'not a cron',
    // No nextRun → goes to fallback path which must catch the croner throw.
  });
  assert.equal(isDue(cfg), false);
});

// ---------------------------------------------------------------------------
// Regression: the original bug — never-run automation with nextRun in past
// ---------------------------------------------------------------------------

test('REGRESSION: never-run automation with stored past nextRun → fires (this is the bug we fixed)', () => {
  // Mirrors the Worm "General Assistant" reproducer: nextRun stored at create
  // time is past, no lastRun has ever been written. Under the old code path
  // this returned false forever.
  const cfg = baseRecurring({
    schedule: '0 6-22/4 * * *',
    nextRun: new Date(Date.now() - 2 * 24 * HOUR).toISOString(),
    // no lastRun
  });
  assert.equal(isDue(cfg), true);
});

test('REGRESSION: never-run + nextRun missing + cron with recent past tick → fires (CLI-configured automation)', () => {
  // A CLI-configured automation has neither nextRun nor lastRun. Old code
  // returned false; new fallback path with 24h first-fire window fires.
  const cfg = baseRecurring({ schedule: '* * * * *' }); // every minute
  // Should fire as long as we're more than a few seconds into a minute.
  const secondsIntoMinute = new Date().getSeconds();
  if (secondsIntoMinute >= 2) {
    assert.equal(isDue(cfg), true);
  }
});
