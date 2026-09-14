/**
 * Scheduled card prompts — pure helpers (card #0352).
 *
 * Client-safe: no fs / os / child_process. The scheduler tick, the API route,
 * the terminal-footer popover and the card-face chip all derive their
 * decisions from these functions so the rules live in one place.
 *
 * Storage: `card.scheduled_prompts` (see ScheduledPrompt in ./types).
 * Server IO lives in ./scheduled-prompts-store.ts; the tick lives in
 * ./scheduler.ts (checkScheduledPrompts).
 */

import type { ScheduledPrompt } from './types';

export const SCHEDULED_PROMPT_LIMITS = {
  /** Max pending entries per card — the API rejects beyond this. */
  maxPending: 20,
  /** fireAt must be at least this far ahead at schedule/edit time. */
  minLeadMs: 60_000,
  /** Message length cap (characters). */
  maxMessageChars: 2000,
  /** A pending entry older than this at scan time is marked missed, not fired. */
  catchUpWindowMs: 12 * 60 * 60 * 1000,
  /** A 'firing' entry older than this is a crashed kickoff → failed: interrupted. */
  firingStaleMs: 5 * 60 * 1000,
  /** Finished entries are pruned from the card after this long. */
  retentionMs: 24 * 60 * 60 * 1000,
  /** A due send whose session is busy is deferred tick by tick up to this long past fireAt, then force-pasted and flagged. */
  busyWaitMaxMs: 10 * 60 * 1000,
} as const;

export const TERMINAL_STATES: ReadonlySet<ScheduledPrompt['state']> = new Set(['delivered', 'failed', 'cancelled', 'missed']);

export function isTerminal(entry: Pick<ScheduledPrompt, 'state'>): boolean {
  return TERMINAL_STATES.has(entry.state);
}

export function newScheduledPromptId(now: number = Date.now()): string {
  return `sp-${now}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Provider segment of a card session name: `<key>:<provider>:card:<id>` → provider. */
export function providerFromSessionName(sessionName: string): string | null {
  const idx = sessionName.indexOf(':card:');
  if (idx < 0) return null;
  const head = sessionName.slice(0, idx).split(':');
  return head.length >= 2 ? head[head.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Validation (shared by the API route and the popover's Schedule button)
// ---------------------------------------------------------------------------

export interface ScheduledPromptInput {
  message: string;
  fireAt: string;
}

export type ValidationResult =
  | { ok: true; message: string; fireAt: string }
  | { ok: false; error: string };

/** Strip control characters (keep newlines/tabs), collapse trailing whitespace. */
export function normalizeMessage(raw: string): string {
  return raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

export function validateScheduledPromptInput(input: ScheduledPromptInput, nowMs: number = Date.now()): ValidationResult {
  const message = normalizeMessage(String(input.message ?? ''));
  if (!message) return { ok: false, error: 'Message is empty' };
  if (message.length > SCHEDULED_PROMPT_LIMITS.maxMessageChars) {
    return { ok: false, error: `Message is longer than ${SCHEDULED_PROMPT_LIMITS.maxMessageChars} characters` };
  }
  const t = Date.parse(String(input.fireAt ?? ''));
  if (!Number.isFinite(t)) return { ok: false, error: 'Fire time is not a valid date' };
  if (t - nowMs < SCHEDULED_PROMPT_LIMITS.minLeadMs) {
    return { ok: false, error: 'Fire time must be at least a minute from now' };
  }
  return { ok: true, message, fireAt: new Date(t).toISOString() };
}

// ---------------------------------------------------------------------------
// Tick classification
// ---------------------------------------------------------------------------

export type ScheduledPromptAction = 'skip' | 'fire' | 'missed' | 'interrupted' | 'prune';

/**
 * Decide what the tick does with one entry. Pure; the scheduler applies the
 * result. `host` is os.hostname() of the running web process — an entry
 * scheduled on another machine (kanban.json is committed and pulled) is never
 * fired here, only pruned once it is old.
 */
export function classifyScheduledPrompt(
  entry: ScheduledPrompt,
  nowMs: number,
  host: string,
  limits: typeof SCHEDULED_PROMPT_LIMITS = SCHEDULED_PROMPT_LIMITS,
): ScheduledPromptAction {
  if (isTerminal(entry)) {
    const finished = Date.parse(entry.finishedAt || entry.firedAt || entry.createdAt);
    return Number.isFinite(finished) && nowMs - finished > limits.retentionMs ? 'prune' : 'skip';
  }
  if (entry.host !== host) return 'skip';
  if (entry.state === 'firing') {
    const fired = Date.parse(entry.firedAt || '');
    return Number.isFinite(fired) && nowMs - fired > limits.firingStaleMs ? 'interrupted' : 'skip';
  }
  // pending
  const fireAt = Date.parse(entry.fireAt);
  if (!Number.isFinite(fireAt)) return 'missed';
  if (fireAt > nowMs) return 'skip';
  return nowMs - fireAt > limits.catchUpWindowMs ? 'missed' : 'fire';
}

// ---------------------------------------------------------------------------
// Prompt body
// ---------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function stampTime(d: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}),
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/**
 * One stamp line, blank line, the message. No card-context preamble — a
 * scheduled send continues a conversation, it does not start one. The
 * elapsed figure matters: an agent told "continue" after six idle hours
 * should know time passed.
 */
export function buildScheduledPromptBody(
  entry: Pick<ScheduledPrompt, 'message' | 'createdAt' | 'fireAt'>,
  now: Date = new Date(),
  timeZone?: string,
): string {
  const created = new Date(entry.createdAt);
  const elapsed = formatDuration(now.getTime() - created.getTime());
  const stamp = `[Scheduled send · set ${stampTime(created, timeZone)}, fired ${stampTime(now, timeZone)} · ${elapsed} elapsed]`;
  return `${stamp}\n\n${entry.message}`;
}

// ---------------------------------------------------------------------------
// Card-face / popover helpers
// ---------------------------------------------------------------------------

export function pendingEntries(list: ScheduledPrompt[] | undefined | null): ScheduledPrompt[] {
  return (list ?? []).filter(e => e.state === 'pending' || e.state === 'firing');
}

export function finishedEntries(list: ScheduledPrompt[] | undefined | null): ScheduledPrompt[] {
  return (list ?? []).filter(isTerminal);
}

/** Earliest pending fireAt (ISO) or null. */
export function nextPendingFireAt(list: ScheduledPrompt[] | undefined | null): string | null {
  let best: string | null = null;
  for (const e of pendingEntries(list)) {
    if (best === null || Date.parse(e.fireAt) < Date.parse(best)) best = e.fireAt;
  }
  return best;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Wall-clock label for a fire time, in the BROWSER's local zone (the picker
 * is local, so the label must agree with it — the #0320 lesson).
 * Within 24h: "02:00". Beyond: "Tue 02:00".
 */
export function formatFireTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '?';
  const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (Math.abs(d.getTime() - now.getTime()) < 24 * 60 * 60 * 1000) return hhmm;
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  return `${day} ${hhmm}`;
}

/** "in 6h 14m" / "in 3m" / "due now" / "2h ago". */
export function formatCountdown(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  if (!Number.isFinite(diff)) return '';
  if (diff < 30_000 && diff > -60_000) return 'due now';
  return diff > 0 ? `in ${formatDuration(diff)}` : `${formatDuration(-diff)} ago`;
}

/** Browser-local zone abbreviation, e.g. "AEST" / "GMT+10". */
export function localZoneAbbreviation(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(now);
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Picker helpers — both rows write the same fireAt
// ---------------------------------------------------------------------------

export const QUICK_OFFSETS: { label: string; ms: number }[] = [
  { label: '+15m', ms: 15 * 60_000 },
  { label: '+30m', ms: 30 * 60_000 },
  { label: '+1h', ms: 60 * 60_000 },
  { label: '+2h', ms: 2 * 60 * 60_000 },
  { label: '+4h', ms: 4 * 60 * 60_000 },
  { label: '+8h', ms: 8 * 60 * 60_000 },
];

/** now + offset, rounded UP to the next whole minute. */
export function offsetFireAt(offsetMs: number, now: Date = new Date()): Date {
  const t = now.getTime() + offsetMs;
  return new Date(Math.ceil(t / 60_000) * 60_000);
}

export type PickerDay = 'today' | 'tomorrow';

/** Local wall-clock `HH:mm` on today/tomorrow (browser zone). Null for a bad value. */
export function timeOfDayFireAt(hhmm: string, day: PickerDay, now: Date = new Date()): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (day === 'tomorrow' ? 1 : 0), h, min, 0, 0);
  return d;
}

/** Today if that wall-clock time is still at least minLead ahead, else tomorrow. */
export function autoDayFor(hhmm: string, now: Date = new Date()): PickerDay {
  const today = timeOfDayFireAt(hhmm, 'today', now);
  if (!today) return 'today';
  return today.getTime() - now.getTime() >= SCHEDULED_PROMPT_LIMITS.minLeadMs ? 'today' : 'tomorrow';
}

/** `HH:mm` of a Date in the browser zone (for loading an entry into the picker). */
export function toLocalHHMM(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
