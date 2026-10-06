/**
 * Fresh-or-resume decision for automation runs (card #0373).
 *
 * Three modes from two fields, so cards written before the interval mode keep
 * their exact behaviour:
 *   freshSession true                        → fresh every run
 *   freshSession false, no freshSessionDays  → never fresh (resume forever)
 *   freshSession false, freshSessionDays N   → fresh once the conversation is N calendar days old
 *
 * Age is measured from the bridge's conversationStartedAt (moved only by a
 * fresh start or a link/relink to a different conversation; kept across
 * resume and bridge restart). Older bridges don't send it, so createdAt is
 * the fallback.
 *
 * Calendar days in the scheduler's timezone, not elapsed hours: a daily run
 * creates its session seconds after the cron fires, so seven days later the
 * elapsed age is 7d minus a few seconds and an hours check would slip a day
 * (DST shifts it by an hour too).
 *
 * Pure and client-safe (no fs/os): the scheduler, the automation panel and the
 * run header all use it. scripts/kanban.js mirrors planAutomationSession and
 * resolveFreshness for `automation run` (it can't import TS) — keep the two in
 * step; automation-cli-parity.test.ts runs both against one fake bridge.
 */

import type { AutomationConfig, AutomationFreshReason } from './types';

export const FRESH_DAYS_MIN = 1;
export const FRESH_DAYS_MAX = 365;
export const FRESH_DAYS_DEFAULT = 7;

export type FreshMode = 'always' | 'interval' | 'never';

type FreshConfig = Pick<AutomationConfig, 'freshSession' | 'freshSessionDays'>;

export function isValidFreshDays(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= FRESH_DAYS_MIN && n <= FRESH_DAYS_MAX;
}

export function freshMode(config: FreshConfig): FreshMode {
  if (config.freshSession) return 'always';
  return isValidFreshDays(config.freshSessionDays) ? 'interval' : 'never';
}

/** The session fields the decision reads (a subset of the bridge's SessionInfo). */
export interface FreshnessSession {
  conversationStartedAt?: string;
  createdAt?: string;
}

/** ok:false = the bridge could not be asked. ok:true with session null = no record. */
export type FreshnessProbe = { ok: true; session: FreshnessSession | null } | { ok: false };

export interface FreshnessDecision {
  fresh: boolean;
  reason: AutomationFreshReason;
  /** Start of the conversation being resumed or replaced, when known. */
  conversationStartedAt?: string;
  /** Whole calendar days since conversationStartedAt. */
  ageDays?: number;
  /** YYYY-MM-DD: the first run on or after this date starts fresh (interval mode, resumed runs). */
  nextFreshDate?: string;
}

/** YYYY-MM-DD of an instant in a timezone; falls back to UTC for an unknown zone. */
export function localDateKey(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(instant);
    const get = (type: string) => parts.find(p => p.type === type)?.value;
    const y = get('year'), m = get('month'), d = get('day');
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch { /* unknown timezone */ }
  return instant.toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const keyToUtcMs = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));

export function addDaysToKey(key: string, days: number): string {
  return new Date(keyToUtcMs(key) + days * DAY_MS).toISOString().slice(0, 10);
}

export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  return Math.round((keyToUtcMs(localDateKey(to, timeZone)) - keyToUtcMs(localDateKey(from, timeZone))) / DAY_MS);
}

function startOf(session: FreshnessSession | null): string | undefined {
  const iso = session?.conversationStartedAt || session?.createdAt;
  return iso && Number.isFinite(Date.parse(iso)) ? iso : undefined;
}

export function resolveFreshness(
  config: FreshConfig,
  probe: FreshnessProbe,
  now: Date,
  timeZone: string,
): FreshnessDecision {
  const mode = freshMode(config);
  const session = probe.ok ? probe.session : null;
  const started = startOf(session);
  const ageDays = started ? calendarDaysBetween(new Date(started), now, timeZone) : undefined;
  const known = started ? { conversationStartedAt: started, ageDays } : {};

  if (mode === 'always') return { fresh: true, reason: 'always', ...known };
  if (mode === 'never') return { fresh: false, reason: 'never', ...known };

  // Interval mode. A missing answer never stops a session; a missing record
  // gets a new conversation from the bridge anyway.
  if (!probe.ok) return { fresh: false, reason: 'probe-failed' };
  if (!session) return { fresh: false, reason: 'no-session' };
  // A record with no usable start can't be shown to be inside the window.
  if (!started || ageDays === undefined) return { fresh: true, reason: 'age-unknown' };

  const days = config.freshSessionDays as number;
  if (ageDays >= days) return { fresh: true, reason: 'age', ...known };
  return {
    fresh: false,
    reason: 'within-window',
    ...known,
    nextFreshDate: addDaysToKey(localDateKey(new Date(started), timeZone), days),
  };
}

/** One bridge `GET /sessions/:name` answer. ok:false = the bridge could not be asked; info null = no such session. */
export interface SessionProbe {
  ok: boolean;
  info: (FreshnessSession & { status?: string }) | null;
}

/** Live beats starting beats stopped beats missing. */
export function rankSessionStatus(info: SessionProbe['info']): number {
  const status = info?.status;
  if (status === 'running' || status === 'detached') return 3;
  if (status === 'creating') return 2;
  if (status === 'stopped') return 1;
  return 0;
}

/**
 * Which record an automation run works on when the card has both a canonical
 * session and a project-ID alias (`<projectId>:…` from before session keys).
 * Canonical unless the alias ranks strictly higher, so a tie converges on
 * canonical while a live alias is never sidelined by a dead canonical.
 */
export function selectAutomationSession(canonical: SessionProbe | null, alias: SessionProbe | null): 'canonical' | 'alias' {
  if (!alias) return 'canonical';
  return rankSessionStatus(alias.info) > rankSessionStatus(canonical?.info ?? null) ? 'alias' : 'canonical';
}

export interface AutomationSessionPlan {
  sessionName: string;
  selected: 'canonical' | 'alias';
  freshness: FreshnessDecision;
}

/**
 * The scheduler's and `sly-kanban automation run`'s single rule (the CLI
 * mirrors it): pick the record, decide fresh or resume on THAT record's
 * conversation, and act under its name. A due fresh start therefore rolls the
 * selected session over in place (the bridge stops it and starts the new
 * conversation under the same name) — never a canonical replacement beside a
 * still-running alias.
 *
 * Fresh-every-run makes no probes and always uses the canonical name (as before).
 */
export function planAutomationSession(input: {
  config: FreshConfig;
  canonicalName: string;
  aliasName: string | null;
  canonical: SessionProbe | null;
  alias: SessionProbe | null;
  now: Date;
  timeZone: string;
}): AutomationSessionPlan {
  const { config, canonicalName, aliasName, canonical, alias, now, timeZone } = input;
  if (config.freshSession) {
    return { sessionName: canonicalName, selected: 'canonical', freshness: resolveFreshness(config, { ok: true, session: null }, now, timeZone) };
  }
  const selected = aliasName ? selectAutomationSession(canonical, alias) : 'canonical';
  const chosen = selected === 'alias' ? alias : canonical;
  const probe: FreshnessProbe = !chosen || chosen.ok ? { ok: true, session: chosen?.info ?? null } : { ok: false };
  return {
    sessionName: selected === 'alias' && aliasName ? aliasName : canonicalName,
    selected,
    freshness: resolveFreshness(config, probe, now, timeZone),
  };
}

/** "24 May", or "24 May 2025" outside the current year. */
export function formatDateKey(key: string, now: Date = new Date()): string {
  const d = new Date(keyToUtcMs(key));
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  if (d.getUTCFullYear() !== now.getUTCFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-GB', opts);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One line for the automation run header, so the agent knows whether to
 * expect earlier context. Null when there is nothing useful to say.
 */
export function formatSessionHeaderLine(
  decision: FreshnessDecision,
  config: FreshConfig,
  timeZone: string,
): string | null {
  const startKey = decision.conversationStartedAt
    ? localDateKey(new Date(decision.conversationStartedAt), timeZone)
    : null;
  const age = decision.ageDays !== undefined ? plural(decision.ageDays, 'day') : null;
  const limit = isValidFreshDays(config.freshSessionDays) ? plural(config.freshSessionDays, 'day') : null;
  switch (decision.reason) {
    case 'always':
      return 'Session: fresh (new conversation every run)';
    case 'age':
      return `Session: fresh (previous conversation started ${startKey}, ${age} ago; limit ${limit})`;
    case 'age-unknown':
      return `Session: fresh (previous conversation's start unknown; limit ${limit})`;
    case 'within-window':
      return `Session: resumed (conversation started ${startKey}; fresh start due on or after ${decision.nextFreshDate})`;
    case 'never':
      return startKey ? `Session: resumed (conversation started ${startKey}, ${age} ago)` : null;
    default:
      return null;
  }
}
