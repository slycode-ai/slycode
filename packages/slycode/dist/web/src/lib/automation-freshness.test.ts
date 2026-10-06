/**
 * Tests for the automation fresh-or-resume decision (card #0373).
 *
 *   ./bridge/node_modules/.bin/tsx --test web/src/lib/automation-freshness.test.ts
 *
 * scripts/kanban.js mirrors resolveFreshness for `automation run`; the
 * boundary-day and missing-start cases here are the ones it must agree on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysToKey, calendarDaysBetween, formatSessionHeaderLine, freshMode, isValidFreshDays,
  localDateKey, planAutomationSession, resolveFreshness, selectAutomationSession,
  type FreshnessProbe, type SessionProbe,
} from './automation-freshness';

const MEL = 'Australia/Melbourne';
const every = (days?: number) => ({ freshSession: false, freshSessionDays: days });
const withSession = (conversationStartedAt?: string, createdAt?: string): FreshnessProbe =>
  ({ ok: true, session: { conversationStartedAt, createdAt } });

test('modes: existing booleans keep their meaning; days only count when freshSession is false', () => {
  assert.equal(freshMode({ freshSession: true }), 'always');
  assert.equal(freshMode({ freshSession: true, freshSessionDays: 7 }), 'always');
  assert.equal(freshMode({ freshSession: false }), 'never');
  assert.equal(freshMode(every(7)), 'interval');
  for (const bad of [0, -1, 1.5, 366, NaN]) assert.equal(freshMode(every(bad)), 'never', `days=${bad}`);
  assert.ok(isValidFreshDays(1) && isValidFreshDays(365));
});

test('always and never ignore the session age', () => {
  const old = withSession('2026-01-01T00:00:00.000Z');
  const now = new Date('2026-10-01T12:00:00.000Z');
  assert.equal(resolveFreshness({ freshSession: true }, old, now, MEL).fresh, true);
  const never = resolveFreshness({ freshSession: false }, old, now, MEL);
  assert.equal(never.fresh, false);
  assert.equal(never.reason, 'never');
});

test('boundary day: a daily run seconds short of 7×24h is still day 7 and goes fresh', () => {
  // Session created 4s after a 22:50 Melbourne fire; seven days later the cron fires at 22:50:00.
  const started = '2026-05-24T12:50:04.836Z';            // 22:50:04 AEST
  const day6 = new Date('2026-05-30T12:50:00.000Z');
  const day7 = new Date('2026-05-31T12:50:00.000Z');      // elapsed 7d − 4.8s
  const resumed = resolveFreshness(every(7), withSession(started), day6, MEL);
  assert.equal(resumed.fresh, false);
  assert.equal(resumed.reason, 'within-window');
  assert.equal(resumed.nextFreshDate, '2026-05-31');
  const fresh = resolveFreshness(every(7), withSession(started), day7, MEL);
  assert.equal(fresh.fresh, true);
  assert.equal(fresh.reason, 'age');
  assert.equal(fresh.ageDays, 7);
});

test('DST week: the spring-forward week is 7 days, not 7×24h', () => {
  // Melbourne DST starts 2026-10-04 02:00 → 03:00. 23:00 local on 1 Oct and 8 Oct.
  const started = '2026-10-01T13:00:00.000Z';             // 23:00 AEST
  const sevenLater = new Date('2026-10-08T12:00:00.000Z'); // 23:00 AEDT, elapsed 6d23h
  assert.equal(resolveFreshness(every(7), withSession(started), sevenLater, MEL).fresh, true);
});

test('days are counted in the given timezone', () => {
  const started = new Date('2026-05-24T15:00:00.000Z');   // 24 May UTC, 25 May 01:00 Melbourne
  const now = new Date('2026-05-31T05:00:00.000Z');       // 31 May both
  assert.equal(calendarDaysBetween(started, now, 'UTC'), 7);
  assert.equal(calendarDaysBetween(started, now, MEL), 6);
  assert.equal(localDateKey(started, 'Not/AZone'), '2026-05-24', 'unknown zone falls back to UTC');
});

test('conversationStartedAt wins over createdAt; createdAt is the fallback for older bridges', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const recentConversation = resolveFreshness(every(7), withSession('2026-09-30T12:00:00.000Z', '2026-05-24T12:50:04.836Z'), now, 'UTC');
  assert.equal(recentConversation.fresh, false);
  const oldBridge = resolveFreshness(every(7), withSession(undefined, '2026-05-24T12:50:04.836Z'), now, 'UTC');
  assert.equal(oldBridge.fresh, true);
  assert.equal(oldBridge.conversationStartedAt, '2026-05-24T12:50:04.836Z');
});

test('missing start on a present record → fresh (age-unknown)', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  for (const probe of [withSession(), withSession('garbage', 'also garbage')]) {
    const d = resolveFreshness(every(7), probe, now, 'UTC');
    assert.equal(d.fresh, true);
    assert.equal(d.reason, 'age-unknown');
  }
});

test('no record → resume path (bridge starts a new conversation); probe failure → resume, never stop', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  assert.deepEqual(resolveFreshness(every(7), { ok: true, session: null }, now, 'UTC'), { fresh: false, reason: 'no-session' });
  assert.deepEqual(resolveFreshness(every(7), { ok: false }, now, 'UTC'), { fresh: false, reason: 'probe-failed' });
});

test('addDaysToKey crosses month and year ends', () => {
  assert.equal(addDaysToKey('2026-05-28', 7), '2026-06-04');
  assert.equal(addDaysToKey('2026-12-30', 3), '2027-01-02');
});

test('header line says what the agent should expect', () => {
  const now = new Date('2026-05-30T12:50:00.000Z');
  const started = '2026-05-24T12:50:04.836Z';
  const resumed = resolveFreshness(every(7), withSession(started), now, MEL);
  assert.equal(formatSessionHeaderLine(resumed, every(7), MEL),
    'Session: resumed (conversation started 2026-05-24; fresh start due on or after 2026-05-31)');
  const fresh = resolveFreshness(every(7), withSession(started), new Date('2026-06-01T12:50:00.000Z'), MEL);
  assert.equal(formatSessionHeaderLine(fresh, every(7), MEL),
    'Session: fresh (previous conversation started 2026-05-24, 8 days ago; limit 7 days)');
  assert.equal(formatSessionHeaderLine({ fresh: false, reason: 'no-session' }, every(7), MEL), null);
  assert.equal(formatSessionHeaderLine({ fresh: false, reason: 'never' }, { freshSession: false }, MEL), null);
});

// ---------------------------------------------------------------------------
// Session choice: canonical vs project-ID alias (shared with the CLI)
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-01T12:00:00.000Z');
const OLD = '2026-09-20T12:00:00.000Z';   // 11 days
const NEW = '2026-09-30T12:00:00.000Z';   // 1 day
const found = (status: string, conversationStartedAt?: string): SessionProbe => ({ ok: true, info: { status, conversationStartedAt } });
const missing: SessionProbe = { ok: true, info: null };
const plan = (
  canonical: SessionProbe | null, alias: SessionProbe | null,
  config: { freshSession: boolean; freshSessionDays?: number } = every(7), aliasName: string | null = 'proj-id:claude:card:c1',
) =>
  planAutomationSession({ config, canonicalName: 'proj:claude:card:c1', aliasName, canonical, alias, now: NOW, timeZone: 'UTC' });

test('selection: canonical unless the alias ranks strictly higher', () => {
  assert.equal(selectAutomationSession(found('stopped'), found('running')), 'alias');
  assert.equal(selectAutomationSession(missing, found('stopped')), 'alias');
  assert.equal(selectAutomationSession(found('running'), found('running')), 'canonical', 'tie converges on canonical');
  assert.equal(selectAutomationSession(found('stopped'), found('stopped')), 'canonical');
  assert.equal(selectAutomationSession(found('stopped'), null), 'canonical');
});

test('alias-only, overdue → rolls the alias over in place (no canonical beside it)', () => {
  const p = plan(missing, found('running', OLD));
  assert.equal(p.sessionName, 'proj-id:claude:card:c1');
  assert.equal(p.selected, 'alias');
  assert.equal(p.freshness.fresh, true);
  assert.equal(p.freshness.reason, 'age');
});

test('alias-only, inside the window → resumes the alias', () => {
  const p = plan(missing, found('stopped', NEW));
  assert.equal(p.sessionName, 'proj-id:claude:card:c1');
  assert.equal(p.freshness.fresh, false);
});

test("the age comes from the selected record's conversation", () => {
  // Live alias with an old conversation beats a stopped canonical with a new one.
  assert.equal(plan(found('stopped', NEW), found('running', OLD)).freshness.fresh, true);
  // Canonical wins the tie, so its new conversation decides.
  const p = plan(found('running', NEW), found('running', OLD));
  assert.equal(p.sessionName, 'proj:claude:card:c1');
  assert.equal(p.freshness.fresh, false);
});

test('no alias name, probe failure, and fresh-every-run', () => {
  assert.equal(plan(found('running', OLD), found('running', OLD), every(7), null).sessionName, 'proj:claude:card:c1');
  assert.equal(plan({ ok: false, info: null }, null).freshness.reason, 'probe-failed');
  const always = plan(null, null, { freshSession: true });
  assert.equal(always.sessionName, 'proj:claude:card:c1');
  assert.equal(always.freshness.fresh, true);
});
