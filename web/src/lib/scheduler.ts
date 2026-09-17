/**
 * Automation Scheduler
 *
 * Server-side scheduler that runs in the Next.js server process.
 * Checks all kanban boards for due automations and kicks them off
 * by creating bridge sessions and injecting prompts.
 *
 * The scheduler is a "session starter" — its job ends once the AI
 * starts processing. Result monitoring is the agent's job.
 */

import { promises as fs } from 'fs';
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { Cron } from 'croner';
import type { KanbanCard, KanbanBoard, AutomationConfig, DeliveryInfo, AutomationLogEntry } from './types';
import { loadRegistry } from './registry';
import { cronToHumanReadable } from './cron-utils';
import { getSlycodeRoot, getBridgeUrl } from './paths';
import { probeBridge, waitForBridgeReady } from './bridge-readiness';
import { computeSessionKey } from './session-keys';
import { readStatus, formatStatusForPrompt } from './status';
import { fetchSpeakerState, formatSpeakerLine, type SpeakerSnapshot } from './speaker-line';
import { atomicWriteFile } from './atomic-write';
import { withBoardLock } from './board-lock';
import { tryAutoStatus } from './status';
import { appendEvent } from './event-log';
import type { ScheduledPrompt } from './types';
import { SCHEDULED_PROMPT_LIMITS, buildScheduledPromptBody, classifyScheduledPrompt } from './scheduled-prompts';
import { mutateCardScheduledPrompts } from './scheduled-prompts-store';

/**
 * Load env vars from the project root .env file if not already set.
 * Next.js only auto-loads .env from web/, but our config lives in the parent.
 */
function loadParentEnv() {
  try {
    const envPath = path.join(getSlycodeRoot(), '.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch { /* no .env file */ }
}

loadParentEnv();

const BRIDGE_URL = getBridgeUrl();
const CONFIGURED_TIMEZONE = process.env.TZ || 'UTC';
const CHECK_INTERVAL_MS = 30_000;                     // Check every 30 seconds
const GRACE_WINDOW_MS = 60_000;                       // Catch up recently-missed ticks when lastRun is present
const FIRST_FIRE_WINDOW_MS = 24 * 60 * 60 * 1000;     // For never-run automations: catch a missed tick up to 24h old
const RE_FIRE_GUARD_MS = 60_000;                      // Minimum gap between fires for the same automation (prevents self-perpetuating loops)
const MAX_KICKOFFS_PER_TICK = 1;                      // Cap parallel kickoffs per scheduler tick (avoids rapid-succession session-association issues)
const FETCH_TIMEOUT_MS = 10_000;  // Timeout for bridge HTTP calls

// NOTE: kanban.json is read-modify-write without a cross-process lock. If two
// scheduler processes share the same documentation/kanban.json (e.g. dev :3003
// AND prod :7591 running at once on the same machine), they can double-fire
// the same automation. Run only one scheduler instance per kanban.json.

// SLYCODE_AUTOMATION_LOG is a test-only override so suites can point the writer at a temp file.
const AUTOMATION_LOG_PATH = process.env.SLYCODE_AUTOMATION_LOG || path.join(os.homedir(), '.slycode', 'logs', 'automation.log');
const AUTOMATION_LOG_MAX_BYTES = 1_000_000; // 1MB cap

// Fresh session path: simple liveness check after startup
// SLYCODE_LIVENESS_CHECK_MS is a test-only override (the suites can't wait 20s per case).
const LIVENESS_CHECK_MS = Number(process.env.SLYCODE_LIVENESS_CHECK_MS) || 20_000; // Wait 20s then check if session is alive

// Resume session path: delivery confirmation is now BRIDGE-SIDE (feature 070).
//
// HISTORY: six iterations of scheduler-side timestamp heuristics
// (lastOutputAt deltas, prePasteAt baselines) failed in both directions —
// false negatives re-pasted the prompt (duplicate fire), false positives let
// a dropped Enter go undetected (silent queue → merged-prompt fire days
// later). The signal class was unfixable from this process: cross-process
// timestamps are skew-fragile and a timestamp cannot distinguish "model is
// responding" from "TUI repainted a spinner".
//
// CURRENT: the bridge physically verifies the submit against its own
// terminal state (input-region classification before/after Enter, Enter-only
// resend, never re-paste) and returns a typed four-state delivery result:
// delivered | failed | ambiguous | blocked. We pass `verifyDelivery: true`
// on POST /sessions and trust the returned `delivery` object. See
// bridge/src/submit-verify.ts and documentation/features/
// 070_self_verifying_prompt_submit.md.
//
// The verified flow can take ~25s worst case (paste settle + poll ladders +
// resends), so those calls use a longer fetch timeout.
const VERIFIED_SUBMIT_TIMEOUT_MS = 60_000;

/**
 * Fetch with timeout to prevent hung bridge from blocking indefinitely.
 */
async function fetchWithTimeout(url: string, opts?: RequestInit, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Automation run log entry — one per automation execution.
 */
// DeliveryInfo and AutomationLogEntry live in @/lib/types — the run-history UI
// is a client component and must not import from this module, which pulls in
// fs/os/child_process. Imported at the top of this file.

/**
 * Append a JSON lines entry to the automation log.
 * Rotates by dropping the oldest half when the file exceeds 1MB.
 */
async function writeAutomationLog(entry: AutomationLogEntry): Promise<void> {
  try {
    const dir = path.dirname(AUTOMATION_LOG_PATH);
    await fs.mkdir(dir, { recursive: true });

    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(AUTOMATION_LOG_PATH, line);

    // Check size and rotate if needed
    try {
      const stat = await fs.stat(AUTOMATION_LOG_PATH);
      if (stat.size > AUTOMATION_LOG_MAX_BYTES) {
        const content = await fs.readFile(AUTOMATION_LOG_PATH, 'utf-8');
        const lines = content.trim().split('\n');
        // Keep the newest half
        const keep = lines.slice(Math.floor(lines.length / 2));
        await fs.writeFile(AUTOMATION_LOG_PATH, keep.join('\n') + '\n');
      }
    } catch { /* rotation is best-effort */ }
  } catch (err) {
    serr('Failed to write automation log:', err);
  }
}

/** Upper bound on how many entries a single read may return (query-param abuse guard). */
const AUTOMATION_LOG_READ_MAX = 200;

/**
 * Read recent automation log entries for one card, newest first.
 *
 * Lives beside writeAutomationLog on purpose: AUTOMATION_LOG_PATH and the
 * AutomationLogEntry shape stay single-source, so a caller (the API route)
 * can't drift from the writer.
 *
 * Tolerant by design — this is diagnostic data, not load-bearing state:
 *   - No log file yet (nothing has ever run) is not an error; returns [].
 *   - Malformed lines are skipped individually. The rotation above slices at a
 *     line boundary, but the file is appended to concurrently, so a torn final
 *     line is possible; one bad line must not lose the whole history.
 */
export async function readAutomationLog(
  cardId: string,
  limit: number,
  logPath: string = AUTOMATION_LOG_PATH,
): Promise<AutomationLogEntry[]> {
  const capped = Math.max(1, Math.min(Math.floor(limit) || 1, AUTOMATION_LOG_READ_MAX));

  let content: string;
  try {
    content = await fs.readFile(logPath, 'utf-8');
  } catch {
    return []; // No log file yet — fresh install, or no automation has run.
  }

  const matches: AutomationLogEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as AutomationLogEntry;
      if (entry?.cardId === cardId) matches.push(entry);
    } catch { /* torn or malformed line — skip it, keep the rest */ }
  }

  // File is append-ordered, so the newest entries are at the end.
  return matches.slice(-capped).reverse();
}

interface LivenessResult {
  status: 'running' | 'stopped' | 'unknown';
  exitCode?: number;
  exitedAt?: string;
}

/**
 * Check if a session is alive after startup (used for fresh sessions).
 *
 * Fresh sessions deliver the prompt via CLI args (OS-level guarantee), so we
 * don't need to verify prompt delivery. We just need to confirm the session
 * didn't crash during startup (e.g. auth failure, invalid config).
 */
async function checkSessionAlive(sessionName: string): Promise<LivenessResult> {
  await new Promise(r => setTimeout(r, LIVENESS_CHECK_MS));
  try {
    const res = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}`);
    if (!res.ok) return { status: 'unknown' };
    const data = await res.json();
    if (data.status === 'stopped') return { status: 'stopped', exitCode: data.exitCode, exitedAt: data.exitedAt };
    if (data.status === 'running' || data.status === 'detached') return { status: 'running' };
    return { status: 'unknown' };
  } catch {
    return { status: 'unknown' };
  }
}

/**
 * Check whether a freshly-spawned session is sitting behind a startup
 * update/trust dialog (feature 070 phase B). On argv-delivery paths the
 * prompt is not lost — it was passed at spawn — but the CLI won't process it
 * until the dialog is cleared, and a bare liveness check reports success.
 */
async function checkStartupBlocked(sessionName: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}/input-region`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.classification === 'no_input_region';
  } catch {
    return false; // best-effort — never fail a kickoff on a probe error
  }
}

/**
 * Get the configured timezone (IANA string) and its abbreviation.
 */
export function getConfiguredTimezone(): { timezone: string; abbreviation: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: CONFIGURED_TIMEZONE,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    const abbr = parts.find(p => p.type === 'timeZoneName')?.value || CONFIGURED_TIMEZONE;
    return { timezone: CONFIGURED_TIMEZONE, abbreviation: abbr };
  } catch {
    return { timezone: 'UTC', abbreviation: 'UTC' };
  }
}

export interface TriggerOptions {
  trigger: 'scheduled' | 'manual';
}

export interface KickoffResult {
  cardId: string;
  projectId: string;
  success: boolean;
  error?: string;
  sessionName?: string;
  /** Structured notification trigger (feature 070) — replaces error-string matching. */
  failureKind?: 'hard' | 'soft';
  /** Bridge delivery outcome when the verified submit ran. */
  deliveryOutcome?: DeliveryInfo['outcome'];
}

interface SchedulerState {
  running: boolean;
  lastCheck: string | null;
  activeKickoffs: Set<string>;
  /** Bridge failed its /health probe on the most recent tick (card #0363). */
  bridgeDown: boolean;
  /** Ticks skipped because the bridge was down — nothing was stamped or claimed. */
  ticksSkippedBridgeDown: number;
}

// Use globalThis to survive HMR reloads — prevents duplicate scheduler intervals.
// Without this, each hot reload creates a new setInterval while the old one keeps running,
// causing multiple schedulers to fight over kanban.json writes.
const GLOBAL_KEY = '__scheduler_state__';
const TIMER_KEY = '__scheduler_timer__';
const INSTANCE_KEY = '__scheduler_instance__';

interface GlobalScheduler {
  [GLOBAL_KEY]?: SchedulerState;
  [TIMER_KEY]?: ReturnType<typeof setInterval> | null;
  [INSTANCE_KEY]?: string;
}

const g = globalThis as unknown as GlobalScheduler;

if (!g[GLOBAL_KEY]) {
  g[GLOBAL_KEY] = {
    running: false,
    lastCheck: null,
    activeKickoffs: new Set(),
    bridgeDown: false,
    ticksSkippedBridgeDown: 0,
  };
}
// HMR: a state object created by an older module version may predate the
// bridge-gate fields.
if (g[GLOBAL_KEY]!.bridgeDown === undefined) g[GLOBAL_KEY]!.bridgeDown = false;
if (g[GLOBAL_KEY]!.ticksSkippedBridgeDown === undefined) g[GLOBAL_KEY]!.ticksSkippedBridgeDown = 0;
if (g[TIMER_KEY] === undefined) {
  g[TIMER_KEY] = null;
}
// Stable per-process instance ID. Survives HMR (we read through globalThis).
// Logged on every scheduler line so we can detect the multi-process case
// (e.g. dev :3003 AND prod :7591 sharing kanban.json) — two distinct instance
// IDs firing the same card within seconds is proof.
if (!g[INSTANCE_KEY]) {
  g[INSTANCE_KEY] = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

const state: SchedulerState = g[GLOBAL_KEY];
const INSTANCE_ID: string = g[INSTANCE_KEY]!;

function getCheckTimer() { return g[TIMER_KEY] ?? null; }
function setCheckTimer(t: ReturnType<typeof setInterval> | null) { g[TIMER_KEY] = t; }

// Tagged logger so every scheduler line includes the instance ID. Use slog()
// in place of `slog('...')` going forward.
function slog(msg: string): void {
  console.log(`[scheduler ${INSTANCE_ID}] ${msg}`);
}
function swarn(msg: string): void {
  console.warn(`[scheduler ${INSTANCE_ID}] ${msg}`);
}
function serr(msg: string, err?: unknown): void {
  if (err !== undefined) {
    console.error(`[scheduler ${INSTANCE_ID}] ${msg}`, err);
  } else {
    console.error(`[scheduler ${INSTANCE_ID}] ${msg}`);
  }
}

/**
 * Calculate next run time for a cron schedule
 */
export function getNextRun(schedule: string, scheduleType: 'recurring' | 'one-shot'): Date | null {
  if (scheduleType === 'one-shot') {
    const d = new Date(schedule);
    return isNaN(d.getTime()) ? null : d;
  }
  try {
    const job = new Cron(schedule, { timezone: CONFIGURED_TIMEZONE });
    const next = job.nextRun();
    return next;
  } catch {
    return null;
  }
}

/**
 * Check if an automation is due to fire.
 *
 * Primary check (recurring): trust stored `config.nextRun` — populated by the
 * web UI's refreshNextRun on save and by the post-fire recompute. This makes
 * the frontend `NOW` badge and the scheduler firing decision share a source
 * of truth.
 *
 * Fallback (recurring): when `nextRun` is missing/unparseable, compute from
 * the cron + a reference time. The reference uses two distinct windows:
 *
 *   - lastRun present     → ref = max(lastRun, now - GRACE_WINDOW_MS).
 *                            Suppresses stale ticks from long-disabled
 *                            automations (re-enable shouldn't fire a backlog).
 *   - lastRun null        → ref = now - FIRST_FIRE_WINDOW_MS (24h).
 *                            Catches the "created today for a tick that
 *                            already passed" case (e.g. created 22:30 with
 *                            cron "0 22 * * *").
 *
 * Re-fire guard: if `lastRun` is within the last RE_FIRE_GUARD_MS, suppress.
 * Applies to BOTH schedule types, and runs before either branch. For recurring
 * cards it prevents self-perpetuating loops when post-fire recompute lands
 * another past `nextRun` (fire took longer than one cron period; or the process
 * died before the recompute landed). For one-shots it is the only persistent
 * restart protection during the kickoff window — see the note at the guard.
 *
 * One-shot: uses the stored ISO timestamp directly, after the re-fire guard.
 */
export function isDue(config: AutomationConfig): boolean {
  if (!config.enabled || !config.schedule) return false;
  const now = Date.now();

  // Re-fire guard: never fire twice within RE_FIRE_GUARD_MS of the previous fire.
  // Deliberately ABOVE the one-shot branch — one-shots need it more than
  // recurring cards do. A past-due one-shot reports due on every tick until
  // enabled:false is persisted, which only happens after the kickoff resolves,
  // so this guard is its sole restart protection in that window. `lastRun` is
  // written optimistically before kickoff (see checkAutomations), so it is
  // already populated by the time a restarted process re-evaluates this.
  if (config.lastRun) {
    const lastRunMs = new Date(config.lastRun).getTime();
    if (!isNaN(lastRunMs) && (now - lastRunMs) < RE_FIRE_GUARD_MS) {
      return false;
    }
  }

  if (config.scheduleType === 'one-shot') {
    const target = new Date(config.schedule);
    return !isNaN(target.getTime()) && target.getTime() <= now;
  }

  // Primary: trust stored config.nextRun when it's a valid timestamp.
  if (config.nextRun) {
    const nextRunMs = new Date(config.nextRun).getTime();
    if (!isNaN(nextRunMs)) {
      return nextRunMs <= now;
    }
  }

  // Fallback: nextRun missing or unparseable — compute from cron.
  try {
    const job = new Cron(config.schedule, { timezone: CONFIGURED_TIMEZONE });
    const refFloor = config.lastRun
      ? Math.max(new Date(config.lastRun).getTime(), now - GRACE_WINDOW_MS)
      : now - FIRST_FIRE_WINDOW_MS;
    // -1ms so a tick landing exactly at refFloor counts as "next" rather than "past".
    const nextTick = job.nextRun(new Date(refFloor - 1));
    if (!nextTick) return false;
    return nextTick.getTime() <= now;
  } catch {
    return false;
  }
}

/**
 * Format a human-friendly datetime with timezone indicator.
 * Uses the configured timezone explicitly rather than server locale.
 * e.g. "Friday, 28 Feb 2026, 14:30 AEST"
 */
function formatDateTime(date: Date): string {
  const tz = CONFIGURED_TIMEZONE;
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });
  const day = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: tz }).format(date);
  const month = date.toLocaleDateString('en-US', { month: 'short', timeZone: tz });
  const year = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: tz }).format(date);
  const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  const { abbreviation } = getConfiguredTimezone();
  return `${dayName}, ${day} ${month} ${year}, ${time} ${abbreviation}`;
}

/**
 * Format a relative duration from a past date to now.
 * e.g. "20h 30m ago", "3d 2h ago", "45m ago"
 */
function formatRelativeTime(past: Date, now: Date): string {
  const diffMs = now.getTime() - past.getTime();
  if (diffMs < 0) return 'in the future';

  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

/**
 * Build the === AUTOMATION RUN === header block.
 */
function buildRunHeader(
  card: KanbanCard,
  config: AutomationConfig,
  trigger: 'scheduled' | 'manual',
  speakerState: SpeakerSnapshot = 'unknown',
): string {
  const now = new Date();
  const lines: string[] = ['=== AUTOMATION RUN ==='];

  lines.push(`Time: ${formatDateTime(now)}`);
  lines.push(`Card: ${card.title} (${card.id})`);
  // Per-fire nonce — forensic aid only (ties a terminal scrollback block to a
  // specific automation.log entry). NOT used by delivery verification.
  lines.push(`Delivery-ID: ${Math.random().toString(16).slice(2, 8)}`);

  if (trigger === 'manual') {
    lines.push('Trigger: manual');
  } else {
    const friendly = cronToHumanReadable(config.schedule, config.scheduleType);
    lines.push(`Trigger: scheduled (${friendly.toLowerCase()})`);
  }

  if (config.lastRun) {
    const lastRunDate = new Date(config.lastRun);
    lines.push(`Last run: ${formatDateTime(lastRunDate)} (${formatRelativeTime(lastRunDate, now)})`);
  } else {
    lines.push('Last run: never');
  }

  // Status line — quoted as untrusted card metadata to mitigate prompt-injection-via-status.
  // Skipped entirely when no status is set.
  const statusObj = readStatus(card.status);
  if (statusObj) {
    for (const line of formatStatusForPrompt(statusObj, now)) lines.push(line);
  }
  // Speaker permission snapshot (feature 086) — runtime state, outside the quoted status block.
  lines.push(formatSpeakerLine(speakerState));

  lines.push('======================');
  return lines.join('\n');
}

export interface DeliverToSessionOptions {
  sessionName: string;
  provider: string;
  cwd: string;
  prompt: string;
  /** Short tag for log lines (card id, scheduled-prompt id). */
  label?: string;
  /**
   * 'force' (default, automations): session-starter semantics — the paste
   * goes in even if the agent is mid-generation (the bridge's busy guard is
   * bypassed). 'defer' (scheduled prompts): for a LIVE session, submit
   * through the bridge's own busy guard (submit-verified, force:false); a
   * 409 busy/locked comes back as `busy: true` (soft) so the caller can try
   * again later. Stopped sessions ignore the policy (resume is never busy).
   */
  busyPolicy?: 'force' | 'defer';
}

/**
 * Verdict of one non-fresh delivery attempt. Field shapes mirror the
 * AutomationLogEntry slots so callers can log without re-mapping.
 */
export interface DeliveryVerdict {
  success: boolean;
  error?: string;
  failureKind?: 'hard' | 'soft';
  deliveryOutcome?: DeliveryInfo['outcome'];
  bridgeRequest: AutomationLogEntry['bridgeRequest'];
  livenessCheck: AutomationLogEntry['livenessCheck'];
  delivery: AutomationLogEntry['delivery'];
  /** busyPolicy 'defer' only: the live session is mid-generation (or call-locked); nothing was pasted. */
  busy?: boolean;
}

/**
 * Deliver a prompt to an existing (live or stopped) session and interpret
 * the bridge's typed delivery result. This is the ONE place that knows how
 * to read a feature-070 verdict — automations (triggerAutomation) and
 * scheduled card prompts (card #0352) both go through it.
 *
 * Delivery semantics by session state (bridge/src/api.ts POST /sessions):
 * - live (running/detached): the bridge runs the SELF-VERIFYING submit
 *   (input-region classification before/after Enter, Enter-only resend) and
 *   returns a typed `delivery` result.
 * - stopped (persisted record): the bridge resumes; the prompt rides as a
 *   CLI arg on POSIX (delivery.mode 'cli_arg') or a deferred paste on
 *   Windows ('deferred_paste'). We then run the liveness + startup-dialog
 *   checks, since argv delivery can't be verified from the input region.
 * - no record at all: the bridge creates a brand-new session. Callers that
 *   must not do that (scheduled prompts) probe GET /sessions/:name first.
 *
 * Never throws — a thrown fetch error becomes a hard failure verdict.
 */
export async function deliverToSession(opts: DeliverToSessionOptions): Promise<DeliveryVerdict> {
  const { sessionName, provider, cwd, prompt } = opts;
  const label = opts.label || sessionName;
  let bridgeRequest: DeliveryVerdict['bridgeRequest'] = null;
  let livenessCheck: DeliveryVerdict['livenessCheck'] = null;
  let delivery: DeliveryVerdict['delivery'] = null;
  const fail = (error: string, deliveryOutcome?: DeliveryInfo['outcome']): DeliveryVerdict => ({
    success: false, error, failureKind: 'hard', bridgeRequest, livenessCheck, delivery,
    ...(deliveryOutcome !== undefined ? { deliveryOutcome } : {}),
  });

  try {
    slog(`Delivering to session: ${sessionName} (provider: ${provider}, for ${label}, busyPolicy: ${opts.busyPolicy ?? 'force'})`);

    if (opts.busyPolicy === 'defer') {
      // Live session → go through the bridge's busy guard instead of the
      // force paste. Stopped/missing → fall through to POST /sessions.
      let live = false;
      try {
        const infoRes = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}`);
        const info = infoRes.ok ? await infoRes.json() : null;
        live = !!info && (info.status === 'running' || info.status === 'detached');
      } catch {
        live = false;
      }
      if (live) {
        const subRes = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}/submit-verified`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, force: false }),
        }, VERIFIED_SUBMIT_TIMEOUT_MS);
        const sub = await subRes.json().catch(() => ({}));
        bridgeRequest = { status: subRes.status };
        if (subRes.status === 409 && (sub.busy || sub.locked)) {
          slog(`Session ${sessionName} is busy (${sub.locked ? 'call-locked' : 'generating'}); deferring for ${label}`);
          return { success: false, busy: true, failureKind: 'soft', error: sub.error || 'Session busy', bridgeRequest, livenessCheck, delivery };
        }
        if (!subRes.ok) {
          return fail(`Input failed (${subRes.status}): ${sub.error || JSON.stringify(sub)}`);
        }
        delivery = sub.delivery ?? null;
        return interpretDelivery();
      }
    }

    const createRes = await fetchWithTimeout(`${BRIDGE_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: sessionName,
        provider,
        skipPermissions: true,
        cwd,
        prompt,
        fresh: false,
        verifyDelivery: true,
      }),
    }, VERIFIED_SUBMIT_TIMEOUT_MS);

    if (!createRes.ok && createRes.status === 409) {
      // Legacy safety net (the current bridge returns 200 on live-session
      // reuse). Route through the verified submit endpoint — the scheduler
      // never hand-rolls paste+Enter anymore.
      bridgeRequest = { status: 409 };
      slog(`Session ${sessionName} returned 409, submitting via verified endpoint`);
      const subRes = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}/submit-verified`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, force: true }),
      }, VERIFIED_SUBMIT_TIMEOUT_MS);
      if (!subRes.ok) {
        const body = await subRes.text();
        return fail(`Input failed (${subRes.status}): ${body}`);
      }
      const sub = await subRes.json();
      delivery = sub.delivery ?? null;
    } else if (!createRes.ok) {
      let errorDetail: string;
      try {
        const body = await createRes.json();
        errorDetail = body.error || JSON.stringify(body);
      } catch {
        errorDetail = await createRes.text();
      }
      bridgeRequest = { status: createRes.status, error: errorDetail };
      return fail(`Session create failed (${createRes.status}): ${errorDetail}`);
    } else {
      const createData = await createRes.json();
      bridgeRequest = { status: createRes.status, resumed: createData.resumed, pid: createData.pid };
      delivery = createData.delivery ?? null;
      slog(`Session ready: ${sessionName} (status: ${createData.status}, resumed: ${createData.resumed}, pid: ${createData.pid}, delivery: ${delivery ? `${delivery.outcome}/${delivery.mode}` : 'none'})`);
    }

    return await interpretDelivery();
  } catch (err) {
    return fail((err as Error).message);
  }

  /** Shared verdict interpretation once `delivery` is known (both paths). */
  async function interpretDelivery(): Promise<DeliveryVerdict> {
    if (!delivery) {
      // verifyDelivery was requested but the bridge returned no delivery
      // result — it is running a pre-070 build. Fail LOUDLY rather than
      // silently regressing to unverified delivery (the restart-gotcha that
      // plagued every previous fix in this saga).
      return fail('Bridge returned no delivery result — the bridge service is running an old build; restart it (feature 070)');
    }

    if (delivery.mode === 'cli_arg' || delivery.mode === 'deferred_paste') {
      // Resume-from-stopped: the prompt rode the spawn (argv on POSIX,
      // deferred paste on Windows). Same liveness semantics as fresh.
      const liveness = await checkSessionAlive(sessionName);
      livenessCheck = { type: 'checkSessionAlive', result: liveness.status, delayMs: LIVENESS_CHECK_MS, exitCode: liveness.exitCode, exitedAt: liveness.exitedAt };
      if (liveness.status === 'stopped' && liveness.exitCode !== 0) {
        const exitDetail = liveness.exitCode !== undefined ? ` (exit code ${liveness.exitCode})` : '';
        return fail(`Session stopped during startup${exitDetail}`);
      }
      // Startup-dialog check (phase B): a resumed-from-stopped session can
      // surface an update/trust dialog that blocks the argv-delivered prompt
      // while liveness reads 'running'.
      if (liveness.status === 'running' && await checkStartupBlocked(sessionName)) {
        return fail('Session started but is blocked by an update/trust dialog — clear it in the terminal; the prompt was passed at startup and should run once cleared', 'blocked');
      }
      return { success: true, deliveryOutcome: delivery.outcome, bridgeRequest, livenessCheck, delivery };
    }

    // Verified paste path (live session) — the bridge's verdict is final.
    livenessCheck = { type: 'verifiedSubmit', result: delivery.outcome };
    if (delivery.warnings?.length) {
      slog(`Delivery warnings for ${label}: ${delivery.warnings.join('; ')}`);
    }

    if (delivery.outcome === 'delivered') {
      if (delivery.resends > 0) {
        slog(`Delivery recovered via Enter resend for ${label} (attempts=${delivery.attempts}, resends=${delivery.resends})`);
      }
      return { success: true, deliveryOutcome: 'delivered', bridgeRequest, livenessCheck, delivery };
    }

    if (delivery.outcome === 'blocked') {
      return fail(`Session blocked by an update/dialog — clear it in the terminal to continue (${delivery.reason || 'blocked'})`, 'blocked');
    }

    // 'failed' | 'ambiguous' — both are loud; neither leaves a silent queue.
    return fail(
      `Prompt delivery ${delivery.outcome}: ${delivery.reason || 'unknown'} (attempts=${delivery.attempts}, resends=${delivery.resends}, polls=${delivery.polls?.join(',') || 'n/a'})`,
      delivery.outcome,
    );
  }
}

/**
 * Kick off a single automation
 */
export async function triggerAutomation(
  card: KanbanCard,
  projectId: string,
  projectPath: string,
  options: TriggerOptions = { trigger: 'scheduled' },
): Promise<KickoffResult> {
  const config = card.automation;
  if (!config) return { cardId: card.id, projectId, success: false, error: 'No automation config' };

  const provider = config.provider || 'claude';
  // Derive canonical sessionKey from path so automation session names match
  // what the CLI creates (scripts/kanban.js:37) and what CardModal writes.
  const sessionKey = computeSessionKey(projectPath);
  const canonicalName = `${sessionKey}:${provider}:card:${card.id}`;
  const cwd = config.workingDirectory || projectPath;
  const isFreshConfig = config.freshSession || false;

  // Probe bridge for any existing session under canonical OR legacy alias and
  // pick the one we should re-attach to. Rules:
  //   1. freshSession=true → always use canonical (we're going to stop+restart
  //      anyway, and writing under alias would perpetuate legacy naming).
  //   2. canonical exists → prefer canonical (converge to canonical going
  //      forward, even if alias also exists from earlier duplicate state).
  //   3. only alias exists → re-attach to alias to avoid creating a parallel
  //      canonical session.
  const aliasName = projectId !== sessionKey
    ? `${projectId}:${provider}:card:${card.id}`
    : null;
  let sessionName = canonicalName;
  if (!isFreshConfig && aliasName) {
    const probe = async (name: string): Promise<unknown | null> => {
      try {
        const res = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(name)}`);
        if (!res.ok) return null;
        return await res.json(); // bridge returns 200/null for missing
      } catch {
        return null;
      }
    };
    const [canonicalInfo, aliasInfo] = await Promise.all([
      probe(canonicalName),
      probe(aliasName),
    ]);
    // Rank candidates by status — operating on the actual live session is
    // more important than converging to canonical naming. Use canonical only
    // when it ranks at least as high as alias, so the canonical-running case
    // wins the tie and we drift toward canonical going forward.
    const rank = (info: unknown): number => {
      if (!info || typeof info !== 'object') return 0;
      const status = (info as { status?: string }).status;
      if (status === 'running' || status === 'detached') return 3;
      if (status === 'creating') return 2;
      if (status === 'stopped') return 1;
      return 0;
    };
    const cRank = rank(canonicalInfo);
    const aRank = rank(aliasInfo);
    const cStatus = (canonicalInfo as { status?: string } | null)?.status ?? 'missing';
    const aStatus = (aliasInfo as { status?: string } | null)?.status ?? 'missing';
    if (aRank > cRank) {
      sessionName = aliasName;
      slog(`Re-attaching to alias ${aliasName} (alias=${aStatus} > canonical=${cStatus})`);
    } else if (cRank > 0 && aRank > 0) {
      slog(`Both canonical and alias exist for ${card.id}; preferring canonical (canonical=${cStatus}, alias=${aStatus})`);
    }
  }

  // Build prompt with run header + card context + description as instruction
  const contextLines: string[] = [
    buildRunHeader(card, config, options.trigger, await fetchSpeakerState(BRIDGE_URL)),
    '',
  ];
  if (card.areas.length > 0) {
    contextLines.push(`Areas: ${card.areas.join(', ')}`);
  }
  if (card.tags.length > 0) {
    contextLines.push(`Tags: ${card.tags.join(', ')}`);
  }
  if (card.checklist.length > 0) {
    const pending = card.checklist.filter(c => !c.done);
    if (pending.length > 0) {
      contextLines.push(`Pending checklist: ${pending.map(c => c.text).join('; ')}`);
    }
  }
  contextLines.push('', '---', '', card.description);

  let fullPrompt = contextLines.join('\n');
  if (config.reportViaMessaging) {
    fullPrompt += '\n\nAfter completing the task, send a summary of the results using the messaging skill: sly-messaging send "<your summary>"';
  }

  const isFresh = isFreshConfig;
  const startTime = Date.now();

  // Tracking for automation log
  let bridgeRequestInfo: AutomationLogEntry['bridgeRequest'] = null;
  let livenessInfo: AutomationLogEntry['livenessCheck'] = null;
  let deliveryInfo: AutomationLogEntry['delivery'] = null;

  const logAndReturn = async (result: KickoffResult): Promise<KickoffResult> => {
    await writeAutomationLog({
      timestamp: new Date().toISOString(),
      cardId: card.id,
      cardTitle: card.title,
      projectId,
      trigger: options.trigger,
      provider,
      sessionName,
      fresh: isFresh,
      bridgeRequest: bridgeRequestInfo,
      livenessCheck: livenessInfo,
      delivery: deliveryInfo,
      outcome: result.success ? 'success' : 'error',
      error: result.error || null,
      elapsedMs: Date.now() - startTime,
    });
    return result;
  };

  if (!isFresh) {
    // Resume / live paths — shared with scheduled card prompts (card #0352).
    // deliverToSession owns the bridge call and the verdict interpretation;
    // this function only maps the verdict onto the automation's KickoffResult.
    const verdict = await deliverToSession({ sessionName, provider, cwd, prompt: fullPrompt, label: card.id });
    bridgeRequestInfo = verdict.bridgeRequest;
    livenessInfo = verdict.livenessCheck;
    deliveryInfo = verdict.delivery;
    return logAndReturn({
      cardId: card.id, projectId, sessionName,
      success: verdict.success,
      ...(verdict.error !== undefined ? { error: verdict.error } : {}),
      ...(verdict.failureKind !== undefined ? { failureKind: verdict.failureKind } : {}),
      ...(verdict.deliveryOutcome !== undefined ? { deliveryOutcome: verdict.deliveryOutcome } : {}),
    });
  }

  try {
    slog(`Creating session: ${sessionName} (fresh: ${isFresh}, provider: ${provider})`);

    // Fresh session path: the prompt is passed as a CLI arg (argv delivery
    // guarantee). Just verify the session didn't crash during startup.
    const createRes = await fetchWithTimeout(`${BRIDGE_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: sessionName,
        provider,
        skipPermissions: true,
        cwd,
        prompt: fullPrompt,
        fresh: true,
        verifyDelivery: true,
      }),
    }, VERIFIED_SUBMIT_TIMEOUT_MS);

    if (!createRes.ok) {
      let errorDetail: string;
      try {
        const body = await createRes.json();
        errorDetail = body.error || JSON.stringify(body);
      } catch {
        errorDetail = await createRes.text();
      }
      bridgeRequestInfo = { status: createRes.status, error: errorDetail };
      return logAndReturn({ cardId: card.id, projectId, success: false, error: `Session create failed (${createRes.status}): ${errorDetail}`, failureKind: 'hard' });
    }

    const createData = await createRes.json();
    bridgeRequestInfo = { status: createRes.status, resumed: createData.resumed, pid: createData.pid };
    deliveryInfo = createData.delivery ?? null;
    slog(`Session created: ${sessionName} (status: ${createData.status}, resumed: ${createData.resumed}, pid: ${createData.pid}, delivery: ${deliveryInfo ? `${deliveryInfo.outcome}/${deliveryInfo.mode}` : 'none'})`);

    const liveness = await checkSessionAlive(sessionName);
    livenessInfo = { type: 'checkSessionAlive', result: liveness.status, delayMs: LIVENESS_CHECK_MS, exitCode: liveness.exitCode, exitedAt: liveness.exitedAt };
    if (liveness.status === 'stopped') {
      // Exit code 0 means the session completed normally — not a failure.
      // Fast automations can finish within the liveness check window.
      if (liveness.exitCode === 0) {
        return logAndReturn({ cardId: card.id, projectId, success: true, sessionName });
      }
      const exitDetail = liveness.exitCode !== undefined ? ` (exit code ${liveness.exitCode})` : '';
      const aliveDetail = liveness.exitedAt ? `, alive ${((new Date(liveness.exitedAt).getTime() - startTime) / 1000).toFixed(1)}s` : '';
      return logAndReturn({ cardId: card.id, projectId, success: false, sessionName, error: `Session stopped during startup${exitDetail}${aliveDetail}`, failureKind: 'hard' });
    }
    // 'running' or 'unknown' — session is alive (or bridge is slow).
    // Startup-dialog check (phase B): alive ≠ processing — an update/trust
    // dialog can hold the argv prompt hostage while the process sits there.
    if (liveness.status === 'running' && await checkStartupBlocked(sessionName)) {
      return logAndReturn({
        cardId: card.id, projectId, success: false, sessionName, deliveryOutcome: 'blocked', failureKind: 'hard',
        error: 'Session started but is blocked by an update/trust dialog — clear it in the terminal; the prompt was passed at startup and should run once cleared',
      });
    }
    return logAndReturn({ cardId: card.id, projectId, success: true, sessionName });
  } catch (err) {
    return logAndReturn({ cardId: card.id, projectId, success: false, sessionName, error: (err as Error).message, failureKind: 'hard' });
  }
}

/**
 * Update a card's automation state in kanban.json
 */
export async function updateCardAutomation(
  projectPath: string,
  cardId: string,
  updates: Partial<AutomationConfig>
): Promise<void> {
  const kanbanPath = path.join(projectPath, 'documentation', 'kanban.json');
  try {
    // Advisory lock around the read-modify-write (feature 077, best-effort —
    // shared with the CLI and the web kanban POST route).
    await withBoardLock(kanbanPath, async () => {
      const content = await fs.readFile(kanbanPath, 'utf-8');
      const board: KanbanBoard = JSON.parse(content);

      for (const stageCards of Object.values(board.stages)) {
        for (const card of stageCards as KanbanCard[]) {
          if (card.id === cardId && card.automation) {
            Object.assign(card.automation, updates);
            // Don't bump card.updated_at for internal automation bookkeeping
            // (lastRun, nextRun, lastResult). This prevents automation cards
            // from floating to the top of search results on every scheduled run.
            break;
          }
        }
      }

      await atomicWriteFile(kanbanPath, JSON.stringify(board, null, 2) + '\n');
    });
  } catch (err) {
    serr(`Failed to update card ${cardId}:`, err);
  }
}

/**
 * Send error notification via messaging with actionable detail.
 */
/**
 * Build the `sly-messaging` invocation for an automation-failure notification.
 * Returns a command + argv array — the message is a single literal argv element,
 * never concatenated into a shell string (cardTitle/error may carry $(), `, etc.).
 * Exported so the no-shell-interpolation property can be regression-tested.
 */
export function buildErrorNotificationArgs(
  cardTitle: string,
  error: string,
  sessionName?: string,
  header: string = 'Automation failed',
): { command: string; args: string[] } {
  const lines = [`${header}: ${cardTitle}`];
  if (sessionName) lines.push(`Session: ${sessionName}`);
  lines.push(`Error: ${error}`);
  lines.push(`Log: ~/.slycode/logs/automation.log`);
  const msg = lines.join('\n');
  return { command: 'sly-messaging', args: ['send', msg] };
}

async function sendErrorNotification(cardTitle: string, error: string, sessionName?: string, header?: string): Promise<void> {
  try {
    const { execFileSync } = await import('child_process');
    const { command, args } = buildErrorNotificationArgs(cardTitle, error, sessionName, header);
    // Pass the message as a literal argv element — never build a shell string.
    // `error`/`cardTitle` can carry $(), backticks, etc.; argv avoids /bin/sh.
    execFileSync(command, args, {
      timeout: 10_000,
      stdio: 'pipe',
      windowsHide: true,
    });
  } catch {
    serr(`Failed to send error notification for "${cardTitle}"`);
  }
}

/**
 * Main check loop — scan all projects for due automations
 */
async function checkAutomations(): Promise<number> {
  state.lastCheck = new Date().toISOString();
  let kickoffsThisTick = 0;

  try {
    const registry = await loadRegistry();

    // Labeled loop so we can stop scanning once we hit the per-tick cap.
    // Deferred cards naturally pick up on the next 30s tick.
    scanLoop:
    for (const project of registry.projects) {
      const kanbanPath = path.join(project.path, 'documentation', 'kanban.json');

      let board: KanbanBoard;
      try {
        const content = await fs.readFile(kanbanPath, 'utf-8');
        board = JSON.parse(content);
      } catch {
        continue; // Skip projects without kanban.json
      }

      for (const [, stageCards] of Object.entries(board.stages)) {
        for (const card of stageCards as KanbanCard[]) {
          if (!card.automation || !card.automation.enabled) continue;
          if (card.archived) continue;
          if (state.activeKickoffs.has(card.id)) continue;

          // Self-heal: a CLI-created or legacy automation may lack nextRun.
          // Compute and persist it so the frontend NOW badge and isDue() share
          // a single source of truth from this point forward.
          if (card.automation.schedule && !card.automation.nextRun) {
            const computed = getNextRun(card.automation.schedule, card.automation.scheduleType);
            if (computed) {
              const iso = computed.toISOString();
              try {
                await updateCardAutomation(project.path, card.id, { nextRun: iso });
                card.automation.nextRun = iso; // keep in-memory copy consistent
              } catch {
                // Non-fatal — isDue's fallback path will still handle it this tick.
              }
            }
          }

          if (isDue(card.automation)) {
            if (kickoffsThisTick >= MAX_KICKOFFS_PER_TICK) {
              // Cap reached. Stop the entire scan — remaining due cards fire on
              // subsequent ticks. This avoids rapid-succession session-association
              // bugs when many automations unstick at once (e.g. post-deploy).
              break scanLoop;
            }
            kickoffsThisTick++;
            state.activeKickoffs.add(card.id);

            // Firing-decision log — captures the entire reasoning behind THIS
            // kickoff in one line. If two scheduler instances both fire the
            // same card, both will print this with their own instance ID and
            // we'll see two distinct lines in the journal/web log.
            const auto = card.automation!;
            const nowMs = Date.now();
            slog(
              `Firing decision for ${card.id} (${card.title}) | ` +
              `project=${project.id} | schedule=${auto.schedule} | ` +
              `scheduleType=${auto.scheduleType ?? 'recurring'} | ` +
              `lastRun=${auto.lastRun ?? '(none)'} | ` +
              `nextRun=${auto.nextRun ?? '(none)'} | ` +
              `nowVsNextRun=${auto.nextRun ? `${((nowMs - new Date(auto.nextRun).getTime()) / 1000).toFixed(1)}s past` : 'n/a'} | ` +
              `kickoffsThisTick=${kickoffsThisTick} | ` +
              `activeKickoffsInThisProcess=${state.activeKickoffs.size}`
            );

            // Write lastRun BEFORE kickoff so it survives server restarts.
            // Without this, an HMR restart during the ~14s kickoff window
            // loses the in-memory activeKickoffs guard and re-fires the card.
            await updateCardAutomation(project.path, card.id, {
              lastRun: new Date().toISOString(),
            });

            // Fire and forget — don't block the check loop
            (async () => {
              try {
                slog(`Firing automation: ${card.title} (${card.id})`);
                const result = await triggerAutomation(card, project.id, project.path);

                const configUpdates: Partial<AutomationConfig> = {
                  lastResult: result.success ? 'success' : 'error',
                  // undefined CLEARS the key: updateCardAutomation does an
                  // Object.assign and the board is then JSON.stringify'd, which
                  // drops undefined values. Without this a stale error would
                  // linger on a card that has since succeeded.
                  lastError: result.success ? undefined : result.error,
                };

                // Calculate next run
                if (card.automation!.scheduleType === 'one-shot') {
                  // One-shot: auto-disable after firing
                  configUpdates.enabled = false;
                } else {
                  const nextRun = getNextRun(card.automation!.schedule, 'recurring');
                  if (nextRun) configUpdates.nextRun = nextRun.toISOString();
                }

                await updateCardAutomation(project.path, card.id, configUpdates);

                if (!result.success) {
                  serr(`Kickoff failed for ${card.id}: ${result.error}`);
                  // Notification gate is the structured failureKind (feature
                  // 070) — string matching silently dropped alerts whenever
                  // error wording changed. Legacy string fallback covers only
                  // results from paths that predate failureKind.
                  const isHardFailure = result.failureKind
                    ? result.failureKind === 'hard'
                    : Boolean(result.error && (
                        result.error.includes('Session create failed') ||
                        result.error.includes('Session stopped') ||
                        result.error.includes('Input failed') ||
                        result.error.includes('No automation config')
                      ));
                  if (isHardFailure) {
                    await sendErrorNotification(card.title, result.error || 'Unknown error', result.sessionName);
                  } else {
                    slog(`Soft failure for ${card.id}, skipping notification: ${result.error}`);
                  }
                }
              } catch (err) {
                serr(`Error processing ${card.id}:`, err);
              } finally {
                state.activeKickoffs.delete(card.id);
              }
            })();
          }
        }
      }
    }
  } catch (err) {
    serr('Check loop error:', err);
  }
  return kickoffsThisTick;
}

// ---------------------------------------------------------------------------
// Scheduled card prompts scan (card #0352)
// ---------------------------------------------------------------------------
//
// One-shot timed sends stored on cards (card.scheduled_prompts). Rides the
// same 30s tick as automations, after them, and shares the per-tick kickoff
// cap so a resume never lands in the same tick as an automation spawn.
// Classification is pure (lib/scheduled-prompts.ts); this function applies
// it: claim on disk → deliver through deliverToSession → record the verdict.

const HOST = os.hostname();

function hhmm(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: CONFIGURED_TIMEZONE });
}

function spKey(id: string): string { return `sp:${id}`; }

async function finishScheduledPrompt(
  project: { id: string; path: string },
  cardId: string,
  entryId: string,
  patch: Partial<ScheduledPrompt> & { state: ScheduledPrompt['state'] },
  status: { text: string; tier: 'high' | 'medium' | 'low' } | null,
): Promise<void> {
  try {
    await mutateCardScheduledPrompts(project.path, cardId, (list, card) => {
      const entry = list.find(e => e.id === entryId);
      if (!entry) return;
      Object.assign(entry, patch, { finishedAt: new Date().toISOString() });
      if (status) tryAutoStatus(card, status);
    });
  } catch (err) {
    serr(`[scheduled-prompts] result write failed for ${entryId}:`, err);
  }
}

function logScheduledPromptEvent(projectId: string, cardId: string, detail: string): void {
  try {
    appendEvent({ type: 'card_prompt', project: projectId, card: cardId, detail, source: 'scheduler', timestamp: new Date().toISOString() });
  } catch (err) {
    swarn(`[scheduled-prompts] event log failed: ${(err as Error).message}`);
  }
}

/**
 * Fire one claimed (state 'firing') entry. Exported for tests — the scan loop
 * calls it fire-and-forget. Busy handling (card #0352 problem): a live
 * session that is mid-generation swallows a forced paste, so the first
 * attempt goes through the bridge's busy guard; busy → the entry returns to
 * 'pending' (deferrals+1) and the next tick retries, until
 * SCHEDULED_PROMPT_LIMITS.busyWaitMaxMs past fireAt — then it is force-pasted
 * and flagged `deliveryNote: 'forced_busy'` so the operator checks it landed.
 */
export async function fireScheduledPrompt(
  project: { id: string; path: string },
  card: KanbanCard,
  entry: ScheduledPrompt,
): Promise<void> {
  const startTime = Date.now();
  const now = new Date();
  const preview = entry.message.length > 60 ? `${entry.message.slice(0, 57)}…` : entry.message;
  let verdictForLog: DeliveryVerdict | null = null;
  let error: string | null = null;
  let outcome: DeliveryInfo['outcome'] | undefined;
  let note: ScheduledPrompt['deliveryNote'] | undefined;

  try {
    // A scheduled send continues a conversation. If the bridge has no record
    // of the session at all (not even a stopped one), fail loudly instead of
    // spawning a stranger session with "continue" in it.
    let exists = false;
    try {
      const res = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(entry.sessionName)}`);
      exists = res.ok && (await res.json()) !== null;
    } catch (err) {
      error = `Bridge unreachable: ${(err as Error).message}`;
    }
    if (!error && !exists) error = `Session ${entry.sessionName} no longer exists — nothing to resume`;

    if (!error) {
      const prompt = buildScheduledPromptBody(entry, now, CONFIGURED_TIMEZONE);
      const base = { sessionName: entry.sessionName, provider: entry.provider, cwd: project.path, prompt, label: entry.id };
      let verdict = await deliverToSession({ ...base, busyPolicy: 'defer' });
      if (verdict.busy) {
        const waitedMs = now.getTime() - Date.parse(entry.fireAt);
        if (waitedMs < SCHEDULED_PROMPT_LIMITS.busyWaitMaxMs) {
          // Defer: back to pending; the next tick re-evaluates (classify → fire).
          const deferrals = (entry.deferrals ?? 0) + 1;
          await mutateCardScheduledPrompts(project.path, card.id, (list) => {
            const e = list.find(x => x.id === entry.id);
            if (e && e.state === 'firing') {
              e.state = 'pending';
              e.deferrals = deferrals;
              e.lastDeferredAt = now.toISOString();
              delete e.firedAt;
            }
          });
          slog(`[scheduled-prompts] deferred ${entry.id} (session busy, deferral #${deferrals}, ${Math.round(waitedMs / 1000)}s past fireAt)`);
          return;
        }
        swarn(`[scheduled-prompts] ${entry.id}: session still busy ${Math.round(waitedMs / 60_000)}m past fireAt — forcing the paste`);
        verdict = await deliverToSession({ ...base, busyPolicy: 'force' });
        note = 'forced_busy';
      } else if ((entry.deferrals ?? 0) > 0) {
        note = 'after_wait';
      }
      verdictForLog = verdict;
      outcome = verdict.deliveryOutcome;
      if (!verdict.success) error = verdict.error || 'Delivery failed';
    }
  } catch (err) {
    error = (err as Error).message;
  }

  const fireLabel = hhmm(now);
  if (!error) {
    const noteText = note === 'forced_busy' ? ' while busy (forced — check it landed)' : note === 'after_wait' ? ` after waiting for the agent (${entry.deferrals ?? 0} deferrals)` : '';
    slog(`[scheduled-prompts] delivered ${entry.id} → ${entry.sessionName} (${outcome ?? 'delivered'})${noteText}`);
    await finishScheduledPrompt(project, card.id, entry.id,
      { state: 'delivered', outcome: outcome ?? 'delivered', ...(note ? { deliveryNote: note } : {}) },
      note === 'forced_busy'
        ? { text: `Scheduled prompt forced into a busy session ${fireLabel} — check it landed`, tier: 'medium' }
        : { text: `Scheduled prompt delivered ${fireLabel}`, tier: 'low' });
    logScheduledPromptEvent(project.id, card.id, `Scheduled prompt delivered ${fireLabel}${noteText}: ${preview}`);
    if (note && verdictForLog?.delivery) {
      // Surface the note in the run log too (feature 083 viewer reads delivery.warnings).
      verdictForLog = { ...verdictForLog, delivery: { ...verdictForLog.delivery, warnings: [...(verdictForLog.delivery.warnings ?? []), `scheduled_prompt:${note}`] } };
    }
  } else {
    serr(`[scheduled-prompts] failed ${entry.id} → ${entry.sessionName}: ${error}`);
    await finishScheduledPrompt(project, card.id, entry.id, { state: 'failed', error, ...(outcome ? { outcome } : {}) },
      { text: 'Scheduled prompt failed — see terminal footer', tier: 'high' });
    logScheduledPromptEvent(project.id, card.id, `Scheduled prompt failed ${fireLabel}: ${error}`);
    await sendErrorNotification(card.title, error, entry.sessionName, 'Scheduled prompt failed');
  }

  await writeAutomationLog({
    timestamp: new Date().toISOString(),
    cardId: card.id,
    cardTitle: card.title,
    projectId: project.id,
    trigger: 'scheduled_prompt',
    provider: entry.provider,
    sessionName: entry.sessionName,
    fresh: false,
    bridgeRequest: verdictForLog?.bridgeRequest ?? null,
    livenessCheck: verdictForLog?.livenessCheck ?? null,
    delivery: verdictForLog?.delivery ?? null,
    outcome: error ? 'error' : 'success',
    error,
    elapsedMs: Date.now() - startTime,
  });
}

/**
 * Scan every board for scheduled prompts. `budget` is the number of kickoffs
 * still allowed this tick (MAX_KICKOFFS_PER_TICK minus automation kickoffs).
 */
async function checkScheduledPrompts(budget: number): Promise<void> {
  const nowMs = Date.now();
  let registry;
  try {
    registry = await loadRegistry();
  } catch (err) {
    serr('[scheduled-prompts] registry load failed:', err);
    return;
  }

  for (const project of registry.projects) {
    const kanbanPath = path.join(project.path, 'documentation', 'kanban.json');
    let board: KanbanBoard;
    try {
      board = JSON.parse(await fs.readFile(kanbanPath, 'utf-8'));
    } catch {
      continue;
    }

    for (const stageCards of Object.values(board.stages)) {
      for (const card of (stageCards as KanbanCard[]) || []) {
        const list = card.scheduled_prompts;
        if (!list || list.length === 0) continue;

        const prune = new Set<string>();
        const missed: ScheduledPrompt[] = [];
        const interrupted: ScheduledPrompt[] = [];
        const due: ScheduledPrompt[] = [];
        for (const entry of list) {
          switch (classifyScheduledPrompt(entry, nowMs, HOST)) {
            case 'prune': prune.add(entry.id); break;
            case 'missed': missed.push(entry); break;
            case 'interrupted': interrupted.push(entry); break;
            case 'fire': due.push(entry); break;
          }
        }

        // Housekeeping transitions — one locked write per card. Re-check
        // state by id inside the lock so a concurrent write can't be undone.
        if (prune.size || missed.length || interrupted.length) {
          const missedIds = new Set(missed.map(e => e.id));
          const interruptedIds = new Set(interrupted.map(e => e.id));
          const finishedAt = new Date().toISOString();
          try {
            await mutateCardScheduledPrompts(project.path, card.id, (live, liveCard) => {
              for (const e of live) {
                if (missedIds.has(e.id) && e.state === 'pending') {
                  Object.assign(e, { state: 'missed', finishedAt, error: 'Fire time passed while the web server or bridge was not running' });
                  tryAutoStatus(liveCard, { text: 'Scheduled prompt missed — web or bridge was down at fire time', tier: 'high' });
                } else if (interruptedIds.has(e.id) && e.state === 'firing') {
                  Object.assign(e, { state: 'failed', finishedAt, error: 'Interrupted — the web server restarted mid-fire' });
                  tryAutoStatus(liveCard, { text: 'Scheduled prompt failed — see terminal footer', tier: 'high' });
                }
              }
              return live.filter(e => !prune.has(e.id));
            });
          } catch (err) {
            serr(`[scheduled-prompts] housekeeping write failed for ${card.id}:`, err);
          }
          for (const e of missed) {
            swarn(`[scheduled-prompts] missed ${e.id} on ${card.id} (fireAt ${e.fireAt})`);
            logScheduledPromptEvent(project.id, card.id, `Scheduled prompt missed (was due ${hhmm(new Date(e.fireAt))}): web or bridge was down`);
            await sendErrorNotification(card.title, `Fire time ${e.fireAt} passed while the web server or bridge was not running`, e.sessionName, 'Scheduled prompt missed');
          }
          for (const e of interrupted) {
            swarn(`[scheduled-prompts] interrupted ${e.id} on ${card.id} (firedAt ${e.firedAt})`);
            logScheduledPromptEvent(project.id, card.id, 'Scheduled prompt failed: interrupted by a web restart mid-fire');
            await sendErrorNotification(card.title, 'Interrupted — the web server restarted mid-fire', e.sessionName, 'Scheduled prompt failed');
          }
        }

        // Fire the due ones, oldest fireAt first, within budget.
        due.sort((a, b) => Date.parse(a.fireAt) - Date.parse(b.fireAt));
        for (const entry of due) {
          if (budget <= 0) return; // remaining due entries pick up next tick
          if (state.activeKickoffs.has(spKey(entry.id))) continue;

          // Claim on disk BEFORE the bridge call so an HMR restart mid-fire
          // cannot re-fire it (mirrors the lastRun-before-kickoff rule).
          let claimed = false;
          const firedAt = new Date().toISOString();
          try {
            await mutateCardScheduledPrompts(project.path, card.id, (live) => {
              const e = live.find(x => x.id === entry.id);
              if (e && e.state === 'pending') { e.state = 'firing'; e.firedAt = firedAt; claimed = true; }
            });
          } catch (err) {
            serr(`[scheduled-prompts] claim failed for ${entry.id}:`, err);
          }
          if (!claimed) continue;

          budget--;
          state.activeKickoffs.add(spKey(entry.id));
          slog(`[scheduled-prompts] firing ${entry.id} on ${card.id} (${card.title}) | fireAt=${entry.fireAt} | ${((nowMs - Date.parse(entry.fireAt)) / 1000).toFixed(1)}s past | session=${entry.sessionName}`);
          (async () => {
            try {
              await fireScheduledPrompt(project, card, { ...entry, state: 'firing', firedAt });
            } catch (err) {
              serr(`[scheduled-prompts] error processing ${entry.id}:`, err);
            } finally {
              state.activeKickoffs.delete(spKey(entry.id));
            }
          })();
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Atlas nightly refresh scan (feature 076)
//
// Product-owned pathway — NOT a user automation card. Each registered project
// may carry documentation/atlas/config.json ({enabled, schedule, last_run}).
// Dueness is stateless: due when the schedule's most recent boundary is later
// than last_run. kickoffAtlasRefresh (lib/atlas/refresh.ts) starts/resumes the
// project's Atlas terminal session and verified-submits the skill prompt; it
// stamps last_run on success, which also serves as the re-fire guard.
// ---------------------------------------------------------------------------

const atlasKickoffsInFlight = new Set<string>();

async function checkAtlasRefreshes(): Promise<void> {
  try {
    const { loadRegistry } = await import('@/lib/registry');
    const { readAtlasConfig, kickoffAtlasRefresh } = await import('@/lib/atlas/refresh');
    // NOTE: dueness lives in atlas/cron-due.ts and walks nextRun() —
    // croner's previousRun() reports actual executions (always null for a
    // pattern-only instance) and silently disabled the nightly when used here.
    const { atlasRefreshDue, latestBoundaryBefore } = await import('@/lib/atlas/cron-due');
    const registry = await loadRegistry();
    const now = Date.now();

    for (const project of registry.projects) {
      if (atlasKickoffsInFlight.has(project.id)) continue;
      let config;
      try {
        config = await readAtlasConfig(project.path);
      } catch {
        continue;
      }
      if (!config.enabled || !config.schedule) continue;
      try {
        new Cron(config.schedule, { timezone: CONFIGURED_TIMEZONE }); // validate only
      } catch {
        swarn(`[atlas] invalid schedule for ${project.id}: ${config.schedule}`);
        continue;
      }

      const lastRun = config.last_run ? Date.parse(config.last_run) : 0;
      if (!atlasRefreshDue(config.schedule, CONFIGURED_TIMEZONE, lastRun, now)) continue;
      const boundary = latestBoundaryBefore(config.schedule, CONFIGURED_TIMEZONE, now);

      atlasKickoffsInFlight.add(project.id);
      void (async () => {
        try {
          slog(`[atlas] refresh due for ${project.id} (boundary ${boundary?.toISOString() ?? 'unknown'})`);
          const result = await kickoffAtlasRefresh(project.id, project.path, 'scheduled');
          if (result.ok) slog(`[atlas] refresh kicked off for ${project.id} → ${result.sessionName}`);
          else serr(`[atlas] refresh failed for ${project.id}: ${result.error}`);
        } catch (err) {
          serr(`[atlas] refresh error for ${project.id}:`, err);
        } finally {
          atlasKickoffsInFlight.delete(project.id);
        }
      })();
    }
  } catch (err) {
    serr('[atlas] scan error:', err);
  }
}

/**
 * One tick: bridge liveness first, then automations, then scheduled card
 * prompts with whatever kickoff budget the automations left, then the atlas
 * scan.
 *
 * Bridge gate (card #0363): a due automation or scheduled prompt is only
 * consumed (lastRun stamped / entry claimed) inside a tick whose /health probe
 * succeeded. While the bridge is down the tick skips entirely, the entries
 * stay due, and they fire on the first tick after the bridge answers. Without
 * this, a fire due at boot was stamped and then lost to ECONNREFUSED because
 * web comes up before the bridge on every platform.
 *
 * Exported for tests; production callers go through startScheduler.
 */
export async function runSchedulerTick(): Promise<{ ran: boolean }> {
  const alive = await probeBridge(BRIDGE_URL);
  if (!alive) {
    state.ticksSkippedBridgeDown++;
    if (!state.bridgeDown) {
      state.bridgeDown = true;
      swarn(`Bridge at ${BRIDGE_URL} is not answering /health — skipping ticks until it does (due automations and scheduled prompts are held, not consumed)`);
    }
    return { ran: false };
  }
  if (state.bridgeDown) {
    state.bridgeDown = false;
    slog(`Bridge at ${BRIDGE_URL} is back — resuming ticks (${state.ticksSkippedBridgeDown} skipped)`);
  }
  await runTickBody();
  return { ran: true };
}

async function runTickBody(): Promise<void> {
  let used = 0;
  try {
    used = await checkAutomations();
  } catch (err) {
    serr('Automation scan error:', err);
  }
  try {
    await checkScheduledPrompts(Math.max(0, MAX_KICKOFFS_PER_TICK - used));
  } catch (err) {
    serr('[scheduled-prompts] scan error:', err);
  }
  checkAtlasRefreshes();
}

/**
 * Start the scheduler
 */
export function startScheduler(): void {
  // Clean up any existing interval (e.g. from a previous HMR version)
  const existing = getCheckTimer();
  if (existing) {
    clearInterval(existing);
    setCheckTimer(null);
  }
  if (state.running) return;
  state.running = true;
  // Startup banner — includes PID, bridge URL, port, and slycode root so we
  // can spot the multi-process scenario (e.g. dev + prod schedulers running
  // against the same kanban.json). If two distinct instance IDs ever appear
  // in the logs around the same time, that's the cause of duplicate fires.
  slog(`Started — pid=${process.pid}, port=${process.env.PORT || 'unknown'}, bridge=${BRIDGE_URL}, slycodeRoot=${getSlycodeRoot()}, tz=${CONFIGURED_TIMEZONE}, checkEvery=${CHECK_INTERVAL_MS / 1000}s`);

  // Initial check — gated on bridge readiness (card #0363). Web starts before
  // the bridge on every platform; poll /health for up to a minute so the first
  // tick lands on a live bridge instead of ECONNREFUSED. On timeout we warn
  // and proceed; the per-tick gate inside runSchedulerTick keeps holding due
  // fires until the bridge answers.
  void (async () => {
    try {
      const wait = await waitForBridgeReady(BRIDGE_URL, { warn: swarn });
      if (wait.ready && wait.attempts > 1) {
        slog(`Bridge ready after ${Math.round(wait.waitedMs / 1000)}s (${wait.attempts} probes) — running first tick`);
      }
      await runSchedulerTick();
    } catch (err) {
      serr('Startup tick error:', err);
    }
  })();

  // Periodic check (scheduled prompts + atlas scans ride the same tick, each
  // isolated by its own try/catch)
  setCheckTimer(setInterval(() => { void runSchedulerTick().catch(err => serr('Tick error:', err)); }, CHECK_INTERVAL_MS));
}

/**
 * Tick bookkeeping for tests and diagnostics. Unlike getSchedulerStatus this
 * never auto-starts the scheduler.
 */
export function getSchedulerTickInfo(): { lastCheck: string | null; bridgeDown: boolean; ticksSkippedBridgeDown: number } {
  return {
    lastCheck: state.lastCheck,
    bridgeDown: state.bridgeDown,
    ticksSkippedBridgeDown: state.ticksSkippedBridgeDown,
  };
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (!state.running) return;
  state.running = false;
  const timer = getCheckTimer();
  if (timer) {
    clearInterval(timer);
    setCheckTimer(null);
  }
  slog('Stopped.');
}

/**
 * Get scheduler status.
 * Auto-starts the scheduler if not running (ensures it works in dev mode
 * where instrumentation.ts may not fire reliably).
 */
export function getSchedulerStatus(): {
  running: boolean;
  lastCheck: string | null;
  activeKickoffs: string[];
} {
  if (!state.running) {
    slog('Auto-starting on status check');
    startScheduler();
  }
  return {
    running: state.running,
    lastCheck: state.lastCheck,
    activeKickoffs: Array.from(state.activeKickoffs),
  };
}
