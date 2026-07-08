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
import type { KanbanCard, KanbanBoard, AutomationConfig } from './types';
import { loadRegistry } from './registry';
import { cronToHumanReadable } from './cron-utils';
import { getSlycodeRoot, getBridgeUrl } from './paths';
import { computeSessionKey } from './session-keys';
import { readStatus, formatStatusForPrompt } from './status';
import { atomicWriteFile } from './atomic-write';
import { withBoardLock } from './board-lock';

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

const AUTOMATION_LOG_PATH = path.join(os.homedir(), '.slycode', 'logs', 'automation.log');
const AUTOMATION_LOG_MAX_BYTES = 1_000_000; // 1MB cap

// Fresh session path: simple liveness check after startup
const LIVENESS_CHECK_MS = 20_000; // Wait 20s then check if session is alive

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
/** Mirror of the bridge's DeliveryResult (feature 070) — kept loose so an older/newer bridge can't break logging. */
interface DeliveryInfo {
  outcome: 'delivered' | 'failed' | 'ambiguous' | 'blocked';
  verified: boolean;
  mode: string;
  attempts: number;
  resends: number;
  warnings: string[];
  reason?: string;
  polls?: string[];
  elapsedMs?: number;
}

interface AutomationLogEntry {
  timestamp: string;
  cardId: string;
  cardTitle: string;
  projectId: string;
  trigger: 'scheduled' | 'manual';
  provider: string;
  sessionName: string;
  fresh: boolean;
  bridgeRequest: { status: number; resumed?: boolean; pid?: number; error?: string } | null;
  livenessCheck: { type: string; result: string; delayMs?: number; exitCode?: number; exitedAt?: string } | null;
  delivery?: DeliveryInfo | null;
  outcome: 'success' | 'error';
  error: string | null;
  elapsedMs: number;
}

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
  };
}
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
 * Prevents self-perpetuating loops when post-fire recompute lands another
 * past `nextRun` (fire took longer than one cron period; or process died
 * before the line ~723 recompute landed).
 *
 * One-shot: unchanged — uses the stored ISO timestamp directly.
 */
export function isDue(config: AutomationConfig): boolean {
  if (!config.enabled || !config.schedule) return false;
  const now = Date.now();

  if (config.scheduleType === 'one-shot') {
    const target = new Date(config.schedule);
    return !isNaN(target.getTime()) && target.getTime() <= now;
  }

  // Re-fire guard: never fire twice within RE_FIRE_GUARD_MS of the previous fire.
  if (config.lastRun) {
    const lastRunMs = new Date(config.lastRun).getTime();
    if (!isNaN(lastRunMs) && (now - lastRunMs) < RE_FIRE_GUARD_MS) {
      return false;
    }
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

  lines.push('======================');
  return lines.join('\n');
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
    buildRunHeader(card, config, options.trigger),
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

  try {
    slog(`Creating session: ${sessionName} (fresh: ${isFresh}, provider: ${provider})`);

    // Create session — delivery semantics by path (feature 070):
    // - fresh=true: prompt passed as CLI arg (argv delivery guarantee)
    // - fresh=false + session live: the bridge runs the SELF-VERIFYING submit
    //   (verifyDelivery flag) — input-region classification before/after
    //   Enter, Enter-only resend — and returns a typed `delivery` result.
    // - fresh=false + session stopped: bridge resumes; the prompt rides as a
    //   CLI arg on POSIX (delivery.mode 'cli_arg') or a deferred paste on
    //   Windows ('deferred_paste').
    const createRes = await fetchWithTimeout(`${BRIDGE_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: sessionName,
        provider,
        skipPermissions: true,
        cwd,
        prompt: fullPrompt,
        fresh: isFresh,
        verifyDelivery: true,
      }),
    }, VERIFIED_SUBMIT_TIMEOUT_MS);

    if (!createRes.ok && createRes.status === 409 && !isFresh) {
      // Legacy safety net (the current bridge returns 200 on live-session
      // reuse). Route through the verified submit endpoint — the scheduler
      // never hand-rolls paste+Enter anymore.
      bridgeRequestInfo = { status: 409 };
      slog(`Session ${sessionName} returned 409, submitting via verified endpoint`);
      const subRes = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}/submit-verified`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: fullPrompt, force: true }),
      }, VERIFIED_SUBMIT_TIMEOUT_MS);
      if (!subRes.ok) {
        const body = await subRes.text();
        return logAndReturn({ cardId: card.id, projectId, success: false, sessionName, error: `Input failed (${subRes.status}): ${body}`, failureKind: 'hard' });
      }
      const sub = await subRes.json();
      deliveryInfo = sub.delivery ?? null;
    } else if (!createRes.ok) {
      let errorDetail: string;
      try {
        const body = await createRes.json();
        errorDetail = body.error || JSON.stringify(body);
      } catch {
        errorDetail = await createRes.text();
      }
      bridgeRequestInfo = { status: createRes.status, error: errorDetail };
      return logAndReturn({ cardId: card.id, projectId, success: false, error: `Session create failed (${createRes.status}): ${errorDetail}`, failureKind: 'hard' });
    } else {
      const createData = await createRes.json();
      bridgeRequestInfo = { status: createRes.status, resumed: createData.resumed, pid: createData.pid };
      deliveryInfo = createData.delivery ?? null;
      slog(`Session created: ${sessionName} (status: ${createData.status}, resumed: ${createData.resumed}, pid: ${createData.pid}, delivery: ${deliveryInfo ? `${deliveryInfo.outcome}/${deliveryInfo.mode}` : 'none'})`);
    }

    // --- Fresh session path ---
    // Prompt was delivered via CLI args. Just verify the session didn't crash.
    // No retry needed — OS guarantees prompt delivery.
    if (isFresh) {
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
    }

    // --- Resume paths (feature 070) ---
    // The bridge reported HOW the prompt was delivered via the typed
    // `delivery` result. No scheduler-side activity polling remains.

    if (!deliveryInfo) {
      // verifyDelivery was requested but the bridge returned no delivery
      // result — it is running a pre-070 build. Fail LOUDLY rather than
      // silently regressing to unverified delivery (the restart-gotcha that
      // plagued every previous fix in this saga).
      return logAndReturn({
        cardId: card.id, projectId, success: false, sessionName, failureKind: 'hard',
        error: 'Bridge returned no delivery result — the bridge service is running an old build; restart it (feature 070)',
      });
    }

    if (deliveryInfo.mode === 'cli_arg' || deliveryInfo.mode === 'deferred_paste') {
      // Resume-from-stopped: the prompt rode the spawn (argv on POSIX,
      // deferred paste on Windows). Same liveness semantics as fresh.
      const liveness = await checkSessionAlive(sessionName);
      livenessInfo = { type: 'checkSessionAlive', result: liveness.status, delayMs: LIVENESS_CHECK_MS, exitCode: liveness.exitCode, exitedAt: liveness.exitedAt };
      if (liveness.status === 'stopped' && liveness.exitCode !== 0) {
        const exitDetail = liveness.exitCode !== undefined ? ` (exit code ${liveness.exitCode})` : '';
        return logAndReturn({ cardId: card.id, projectId, success: false, sessionName, error: `Session stopped during startup${exitDetail}`, failureKind: 'hard' });
      }
      // Startup-dialog check (phase B): same gap as the fresh path — a
      // resumed-from-stopped session can surface an update/trust dialog that
      // blocks the argv-delivered prompt while liveness reads 'running'.
      if (liveness.status === 'running' && await checkStartupBlocked(sessionName)) {
        return logAndReturn({
          cardId: card.id, projectId, success: false, sessionName, deliveryOutcome: 'blocked', failureKind: 'hard',
          error: 'Session started but is blocked by an update/trust dialog — clear it in the terminal; the prompt was passed at startup and should run once cleared',
        });
      }
      return logAndReturn({ cardId: card.id, projectId, success: true, sessionName, deliveryOutcome: deliveryInfo.outcome });
    }

    // Verified paste path (live session) — the bridge's verdict is final.
    livenessInfo = { type: 'verifiedSubmit', result: deliveryInfo.outcome };
    if (deliveryInfo.warnings?.length) {
      slog(`Delivery warnings for ${card.id}: ${deliveryInfo.warnings.join('; ')}`);
    }

    if (deliveryInfo.outcome === 'delivered') {
      if (deliveryInfo.resends > 0) {
        slog(`Delivery recovered via Enter resend for ${card.id} (attempts=${deliveryInfo.attempts}, resends=${deliveryInfo.resends})`);
      }
      return logAndReturn({ cardId: card.id, projectId, success: true, sessionName, deliveryOutcome: 'delivered' });
    }

    if (deliveryInfo.outcome === 'blocked') {
      return logAndReturn({
        cardId: card.id, projectId, success: false, sessionName, deliveryOutcome: 'blocked', failureKind: 'hard',
        error: `Session blocked by an update/dialog — clear it in the terminal to continue (${deliveryInfo.reason || 'blocked'})`,
      });
    }

    // 'failed' | 'ambiguous' — both are loud; neither leaves a silent queue.
    return logAndReturn({
      cardId: card.id, projectId, success: false, sessionName, deliveryOutcome: deliveryInfo.outcome, failureKind: 'hard',
      error: `Prompt delivery ${deliveryInfo.outcome}: ${deliveryInfo.reason || 'unknown'} (attempts=${deliveryInfo.attempts}, resends=${deliveryInfo.resends}, polls=${deliveryInfo.polls?.join(',') || 'n/a'})`,
    });
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
): { command: string; args: string[] } {
  const lines = [`Automation failed: ${cardTitle}`];
  if (sessionName) lines.push(`Session: ${sessionName}`);
  lines.push(`Error: ${error}`);
  lines.push(`Log: ~/.slycode/logs/automation.log`);
  const msg = lines.join('\n');
  return { command: 'sly-messaging', args: ['send', msg] };
}

async function sendErrorNotification(cardTitle: string, error: string, sessionName?: string): Promise<void> {
  try {
    const { execFileSync } = await import('child_process');
    const { command, args } = buildErrorNotificationArgs(cardTitle, error, sessionName);
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
async function checkAutomations(): Promise<void> {
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

  // Initial check
  checkAutomations();
  checkAtlasRefreshes();

  // Periodic check (atlas scan rides the same tick, isolated by its own try/catch)
  setCheckTimer(setInterval(() => {
    checkAutomations();
    checkAtlasRefreshes();
  }, CHECK_INTERVAL_MS));
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
