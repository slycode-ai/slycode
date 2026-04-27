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
const CHECK_INTERVAL_MS = 30_000; // Check every 30 seconds
const GRACE_WINDOW_MS = 60_000;   // Only catch up ticks missed within this window
const FETCH_TIMEOUT_MS = 10_000;  // Timeout for bridge HTTP calls

const AUTOMATION_LOG_PATH = path.join(os.homedir(), '.slycode', 'logs', 'automation.log');
const AUTOMATION_LOG_MAX_BYTES = 1_000_000; // 1MB cap

// Fresh session path: simple liveness check after startup
const LIVENESS_CHECK_MS = 20_000; // Wait 20s then check if session is alive

// Resume session path: differential activity detection + retry
const STARTUP_WAIT_MS = 10_000;   // Wait 10s for Claude to start up (resume path)
const ACTIVITY_CHECK_MS = 5_000;  // Wait 5s between activity checks (resume path)
const RETRY_DELAY_MS = 3_000;     // Delay before retry (resume path only)

/**
 * Fetch with timeout to prevent hung bridge from blocking indefinitely.
 */
async function fetchWithTimeout(url: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Automation run log entry — one per automation execution.
 */
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
    console.error('[scheduler] Failed to write automation log:', err);
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

interface GlobalScheduler {
  [GLOBAL_KEY]?: SchedulerState;
  [TIMER_KEY]?: ReturnType<typeof setInterval> | null;
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

const state: SchedulerState = g[GLOBAL_KEY];

function getCheckTimer() { return g[TIMER_KEY] ?? null; }
function setCheckTimer(t: ReturnType<typeof setInterval> | null) { g[TIMER_KEY] = t; }

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
 * For recurring schedules, compute next tick from lastRun using croner.
 * For one-shot, use the stored schedule (ISO datetime) directly.
 */
function isDue(config: AutomationConfig): boolean {
  if (!config.enabled || !config.schedule) return false;

  if (config.scheduleType === 'one-shot') {
    const target = new Date(config.schedule);
    return !isNaN(target.getTime()) && target.getTime() <= Date.now();
  }

  // Recurring: compute next tick using a grace-aware reference point.
  // If lastRun exists, clamp it to at most GRACE_WINDOW_MS ago so stale
  // ticks (from long-disabled automations) are invisible.
  // If never run, use now — new automations always wait for their first tick.
  try {
    const job = new Cron(config.schedule, { timezone: CONFIGURED_TIMEZONE });
    const now = Date.now();
    const ref = config.lastRun
      ? new Date(Math.max(new Date(config.lastRun).getTime(), now - GRACE_WINDOW_MS))
      : new Date(now);
    const nextTick = job.nextRun(ref);
    if (!nextTick) return false;
    return nextTick.getTime() <= now;
  } catch {
    return false;
  }
}

/**
 * Wait for activity on a resumed session by checking for sustained output.
 *
 * Used only for resume sessions where prompt is pasted into an existing terminal.
 * Takes two readings separated by a delay. If new output appeared between
 * readings, Claude is actively processing.
 *
 * NOT used for fresh sessions — those use checkSessionAlive() instead,
 * because fresh sessions deliver the prompt via CLI args (guaranteed delivery).
 */
async function waitForActivity(sessionName: string): Promise<boolean> {
  // Wait for Claude to process the pasted prompt
  await new Promise(r => setTimeout(r, STARTUP_WAIT_MS));

  // Take baseline reading
  let baseline = 0;
  try {
    const res = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}`);
    if (!res.ok) return false;
    const data = await res.json();
    if (data.status === 'stopped') return false;
    baseline = data.lastOutputAt ? new Date(data.lastOutputAt).getTime() : 0;
  } catch {
    return false;
  }

  // Wait and check for new output since baseline
  await new Promise(r => setTimeout(r, ACTIVITY_CHECK_MS));

  try {
    const res = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}`);
    if (!res.ok) return false;
    const data = await res.json();
    if (data.status === 'stopped') return false;
    const current = data.lastOutputAt ? new Date(data.lastOutputAt).getTime() : 0;
    return current > baseline;
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
  const sessionName = `${sessionKey}:${provider}:card:${card.id}`;
  const cwd = config.workingDirectory || projectPath;

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

  const isFresh = config.freshSession || false;
  const startTime = Date.now();

  // Tracking for automation log
  let bridgeRequestInfo: AutomationLogEntry['bridgeRequest'] = null;
  let livenessInfo: AutomationLogEntry['livenessCheck'] = null;

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
      outcome: result.success ? 'success' : 'error',
      error: result.error || null,
      elapsedMs: Date.now() - startTime,
    });
    return result;
  };

  try {
    console.log(`[scheduler] Creating session: ${sessionName} (fresh: ${isFresh}, provider: ${provider})`);

    // Create session — bridge handles prompt delivery differently based on fresh:
    // - fresh=true: prompt passed as CLI arg (OS-level delivery guarantee)
    // - fresh=false: bridge pastes prompt into existing session via bracketed paste
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
      }),
    });

    if (!createRes.ok && createRes.status === 409 && !isFresh) {
      // Session exists and not fresh — try sending input directly (resume fallback)
      bridgeRequestInfo = { status: 409 };
      console.log(`[scheduler] Session ${sessionName} returned 409, sending prompt via input endpoint`);
      const inputRes = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: `\x1b[200~${fullPrompt}\x1b[201~` }),
      });
      if (inputRes.ok) {
        // Delay before Enter to let PTY process the text
        await new Promise(r => setTimeout(r, 600));
        await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: '\r' }),
        });
      }
      if (!inputRes.ok) {
        const body = await inputRes.text();
        return logAndReturn({ cardId: card.id, projectId, success: false, error: `Input failed (${inputRes.status}): ${body}` });
      }
    } else if (!createRes.ok) {
      let errorDetail: string;
      try {
        const body = await createRes.json();
        errorDetail = body.error || JSON.stringify(body);
      } catch {
        errorDetail = await createRes.text();
      }
      bridgeRequestInfo = { status: createRes.status, error: errorDetail };
      return logAndReturn({ cardId: card.id, projectId, success: false, error: `Session create failed (${createRes.status}): ${errorDetail}` });
    } else {
      const createData = await createRes.json();
      bridgeRequestInfo = { status: createRes.status, resumed: createData.resumed, pid: createData.pid };
      console.log(`[scheduler] Session created: ${sessionName} (status: ${createData.status}, resumed: ${createData.resumed}, pid: ${createData.pid})`);
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
        return logAndReturn({ cardId: card.id, projectId, success: false, sessionName, error: `Session stopped during startup${exitDetail}${aliveDetail}` });
      }
      // 'running' or 'unknown' — session is alive (or bridge is slow). Either way, prompt was delivered.
      return logAndReturn({ cardId: card.id, projectId, success: true, sessionName });
    }

    // --- Resume session path ---
    // Prompt was pasted into the terminal. Paste delivery is unreliable,
    // so we check for activity and retry if needed.
    const active = await waitForActivity(sessionName);
    if (active) {
      livenessInfo = { type: 'waitForActivity', result: 'active' };
      return logAndReturn({ cardId: card.id, projectId, success: true, sessionName });
    }

    // No activity detected — retry by re-sending prompt via bracketed paste
    console.log(`[scheduler] No activity for ${card.id} (resume path), retrying via input...`);
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));

    const pastedPrompt = `\x1b[200~${fullPrompt}\x1b[201~`;
    const retryRes = await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: pastedPrompt }),
    });

    if (retryRes.ok) {
      await new Promise(r => setTimeout(r, 600));
      await fetchWithTimeout(`${BRIDGE_URL}/sessions/${encodeURIComponent(sessionName)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: '\r' }),
      });

      const retryActive = await waitForActivity(sessionName);
      if (retryActive) {
        livenessInfo = { type: 'waitForActivity', result: 'active (retry)' };
        return logAndReturn({ cardId: card.id, projectId, success: true, sessionName });
      }
    }

    livenessInfo = { type: 'waitForActivity', result: 'inactive after retry' };
    return logAndReturn({ cardId: card.id, projectId, success: false, sessionName, error: 'No activity detected after retry' });
  } catch (err) {
    return logAndReturn({ cardId: card.id, projectId, success: false, sessionName, error: (err as Error).message });
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

    await fs.writeFile(kanbanPath, JSON.stringify(board, null, 2) + '\n');
  } catch (err) {
    console.error(`[scheduler] Failed to update card ${cardId}:`, err);
  }
}

/**
 * Send error notification via messaging with actionable detail.
 */
async function sendErrorNotification(cardTitle: string, error: string, sessionName?: string): Promise<void> {
  try {
    const { execSync } = await import('child_process');
    const lines = [`Automation failed: ${cardTitle}`];
    if (sessionName) lines.push(`Session: ${sessionName}`);
    lines.push(`Error: ${error}`);
    lines.push(`Log: ~/.slycode/logs/automation.log`);
    const msg = lines.join('\n').replace(/"/g, '\\"');
    execSync(`sly-messaging send "${msg}"`, {
      timeout: 10_000,
      stdio: 'pipe',
      windowsHide: true,
    });
  } catch {
    console.error(`[scheduler] Failed to send error notification for "${cardTitle}"`);
  }
}

/**
 * Main check loop — scan all projects for due automations
 */
async function checkAutomations(): Promise<void> {
  state.lastCheck = new Date().toISOString();

  try {
    const registry = await loadRegistry();

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

          if (isDue(card.automation)) {
            state.activeKickoffs.add(card.id);

            // Write lastRun BEFORE kickoff so it survives server restarts.
            // Without this, an HMR restart during the ~14s kickoff window
            // loses the in-memory activeKickoffs guard and re-fires the card.
            await updateCardAutomation(project.path, card.id, {
              lastRun: new Date().toISOString(),
            });

            // Fire and forget — don't block the check loop
            (async () => {
              try {
                console.log(`[scheduler] Firing automation: ${card.title} (${card.id})`);
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
                  console.error(`[scheduler] Kickoff failed for ${card.id}: ${result.error}`);
                  // Only send Telegram notification on hard failures — not detection uncertainty.
                  // Hard failures: session crashed (stopped), bridge HTTP error, input failed.
                  const isHardFailure = result.error && (
                    result.error.includes('Session create failed') ||
                    result.error.includes('Session stopped') ||
                    result.error.includes('Input failed') ||
                    result.error.includes('No automation config') ||
                    result.error.includes('No activity detected')
                  );
                  if (isHardFailure) {
                    await sendErrorNotification(card.title, result.error || 'Unknown error', result.sessionName);
                  } else {
                    console.log(`[scheduler] Soft failure for ${card.id}, skipping notification: ${result.error}`);
                  }
                }
              } catch (err) {
                console.error(`[scheduler] Error processing ${card.id}:`, err);
              } finally {
                state.activeKickoffs.delete(card.id);
              }
            })();
          }
        }
      }
    }
  } catch (err) {
    console.error('[scheduler] Check loop error:', err);
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
  console.log('[scheduler] Started. Checking every 30s.');

  // Initial check
  checkAutomations();

  // Periodic check
  setCheckTimer(setInterval(checkAutomations, CHECK_INTERVAL_MS));
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
  console.log('[scheduler] Stopped.');
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
    console.log('[scheduler] Auto-starting on status check');
    startScheduler();
  }
  return {
    running: state.running,
    lastCheck: state.lastCheck,
    activeKickoffs: Array.from(state.activeKickoffs),
  };
}
