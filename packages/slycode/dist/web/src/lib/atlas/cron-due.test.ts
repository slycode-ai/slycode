/**
 * Tests for atlas nightly dueness (feature 076) — the regression guard for
 * the croner previousRun() bug that silently disabled the nightly refresh.
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/atlas/cron-due.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atlasRefreshDue, latestBoundaryBefore } from './cron-due';

const TZ = 'Australia/Sydney';
const HOUR = 3600_000;

/** 2026-07-05 03:00 Sydney (AEST, UTC+10) = 2026-07-04T17:00Z */
const BOUNDARY = Date.parse('2026-07-04T17:00:00.000Z');

test('boundary found within the window (the previousRun() regression)', () => {
  // 30 minutes past 3am Sydney — a pattern-only croner previousRun() returned
  // null here, which skipped the fire forever.
  const now = BOUNDARY + 30 * 60_000;
  const b = latestBoundaryBefore('0 3 * * *', TZ, now);
  assert.ok(b, 'must find the 3am boundary');
  assert.equal(b!.getTime(), BOUNDARY);
});

test('fires when lastRun predates the boundary', () => {
  const now = BOUNDARY + 30 * 60_000;
  const lastRun = BOUNDARY - 24 * HOUR; // ran yesterday
  assert.equal(atlasRefreshDue('0 3 * * *', TZ, lastRun, now), true);
});

test('does not refire after running this boundary', () => {
  const now = BOUNDARY + 2 * HOUR;
  const lastRun = BOUNDARY + 5 * 60_000; // ran 5 min after the boundary
  assert.equal(atlasRefreshDue('0 3 * * *', TZ, lastRun, now), false);
});

test('missed boundary older than the window does not fire', () => {
  const now = BOUNDARY + 11 * HOUR; // 2pm — server was down at 3am and beyond the 6h window
  const lastRun = BOUNDARY - 24 * HOUR;
  assert.equal(atlasRefreshDue('0 3 * * *', TZ, lastRun, now), false);
});

test('never-run config fires on the first boundary after enabling', () => {
  const now = BOUNDARY + HOUR;
  assert.equal(atlasRefreshDue('0 3 * * *', TZ, 0, now), true);
});

test('enabled after the boundary passed (outside window) waits for tomorrow', () => {
  const now = BOUNDARY + 11 * HOUR; // enabled at 2pm — matches Greg's real scenario
  assert.equal(atlasRefreshDue('0 3 * * *', TZ, 0, now), false);
});

test('invalid schedule never fires', () => {
  assert.equal(atlasRefreshDue('not a cron', TZ, 0, Date.now()), false);
});

test('frequent schedules stay within the iteration cap', () => {
  const now = BOUNDARY + 30 * 60_000;
  const b = latestBoundaryBefore('*/5 * * * *', TZ, now);
  assert.ok(b && now - b.getTime() <= 5 * 60_000, 'latest 5-min boundary found');
});
