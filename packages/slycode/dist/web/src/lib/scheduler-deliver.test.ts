/**
 * Tests for deliverToSession() — the shared non-fresh delivery + verdict
 * interpretation extracted from triggerAutomation (card #0352), and a pin on
 * triggerAutomation itself so automations keep the exact same behaviour
 * through the extraction.
 *
 * A fake bridge is installed on globalThis.fetch; no real bridge, no real
 * sessions. The liveness wait and the automation log path are pointed at
 * test-only env overrides BEFORE the scheduler module loads.
 *
 * Self-contained node:test script (matches scheduler.test.ts). Run via the tsx
 * binary in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/scheduler-deliver.test.ts
 *
 * Exits 0 on success, 1 on any assertion failure.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import type { KanbanCard } from './types';

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'slycode-deliver-'));
const LOG_PATH = path.join(tmpDir, 'automation.log');
process.env.SLYCODE_AUTOMATION_LOG = LOG_PATH;
process.env.SLYCODE_LIVENESS_CHECK_MS = '5';
process.env.SLYCODE_DEFERRED_DELIVERY_WAIT_MS = '1000';
process.env.BRIDGE_URL = 'http://fake-bridge';
// Events (event-log.ts) resolve under SLYCODE_HOME — keep test writes out of the real board.
process.env.SLYCODE_HOME = tmpDir;
// Scheduled runs re-check their project's status in the registry right before
// delivery (#0381) — register 'proj' as an active project so these direct
// calls behave like a scheduler fire for a live project.
mkdirSync(path.join(tmpDir, 'projects'), { recursive: true });
writeFileSync(path.join(tmpDir, 'projects', 'registry.json'), JSON.stringify({
  version: '2.1.0', lastUpdated: '',
  projects: [{ id: 'proj', name: 'Proj', description: '', path: '/tmp/proj', hasClaudeMd: false, masterCompliant: false, areas: [], tags: [], sessionKey: 'proj', sessionKeyAliases: [] }],
}));

// tsx runs this file as CJS (no top-level await), and ESM imports are hoisted
// above the env assignments — so the module under test is loaded with an
// in-place require AFTER the overrides are set.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { deliverToSession, triggerAutomation, fireScheduledPrompt } = require('./scheduler') as typeof import('./scheduler');

// ---------------------------------------------------------------------------
// Fake bridge
// ---------------------------------------------------------------------------

interface Scenario {
  /** Response for POST /sessions */
  create?: { status: number; body: unknown };
  /** Response for POST /sessions/:name/submit-verified (409 fallback) */
  submit?: { status: number; body: unknown };
  /** Response for GET /sessions/:name (liveness) */
  info?: { status: number; body: unknown };
  /** Successive GET /sessions/:name bodies (status 200); the last repeats. Wins over `info`. */
  infoSeq?: unknown[];
  /** Response for GET /sessions/:name/input-region */
  inputRegion?: { classification: string };
  /** Throw on POST /sessions */
  throwOnCreate?: string;
  /** Busy-guard emulation for submit-verified: force:false → 409 busy while true; force:true (or idle) → delivered. */
  busy?: boolean;
}

let scenario: Scenario = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const calls: { method: string; url: string; body?: any }[] = [];
const realFetch = globalThis.fetch;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (method === 'POST' && url.endsWith('/sessions')) {
      if (scenario.throwOnCreate) throw new Error(scenario.throwOnCreate);
      const r = scenario.create ?? { status: 200, body: {} };
      return json(r.status, r.body);
    }
    if (method === 'POST' && url.endsWith('/submit-verified')) {
      if (scenario.busy !== undefined) {
        if (scenario.busy && body?.force === false) {
          return json(409, { success: false, sessionStatus: 'running', isActive: true, busy: true, error: 'Session is currently active (output 1s ago). The AI may be mid-response. Use --force to send anyway.' });
        }
        return json(200, { success: true, delivery: delivered });
      }
      const r = scenario.submit ?? { status: 404, body: { error: 'no scenario' } };
      return json(r.status, r.body);
    }
    if (method === 'GET' && url.endsWith('/input-region')) {
      return json(200, scenario.inputRegion ?? { classification: 'idle' });
    }
    if (method === 'GET' && url.includes('/sessions/') && scenario.infoSeq?.length) {
      const b = scenario.infoSeq.length > 1 ? scenario.infoSeq.shift() : scenario.infoSeq[0];
      return json(200, b);
    }
    if (method === 'GET' && url.includes('/sessions/')) {
      const r = scenario.info ?? { status: 200, body: { status: 'running' } };
      return json(r.status, r.body);
    }
    return json(404, { error: `unhandled ${method} ${url}` });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function reset(s: Scenario) {
  scenario = s;
  calls.length = 0;
}

const BASE = { sessionName: 'proj:claude:card:card-1', provider: 'claude', cwd: '/tmp', prompt: 'continue' };

const delivered = { outcome: 'delivered', verified: true, mode: 'verified_paste', attempts: 1, resends: 0, warnings: [] };

// ---------------------------------------------------------------------------
// deliverToSession — live session (verified paste) verdicts
// ---------------------------------------------------------------------------

test('live: delivered → success with outcome delivered', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: delivered } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, true);
  assert.equal(v.deliveryOutcome, 'delivered');
  assert.equal(v.livenessCheck?.type, 'verifiedSubmit');
  assert.equal(v.bridgeRequest?.status, 200);
  // Exactly one bridge call, and it asked for verified non-fresh delivery.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.fresh, false);
  assert.equal(calls[0].body.verifyDelivery, true);
  assert.equal(calls[0].body.prompt, 'continue');
});

test('live: delivered via Enter resend still succeeds', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: { ...delivered, attempts: 2, resends: 1 } } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, true);
  assert.equal(v.delivery?.resends, 1);
});

test('live: blocked → hard failure, outcome blocked, reason in error', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: { ...delivered, outcome: 'blocked', reason: 'update dialog' } } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.equal(v.failureKind, 'hard');
  assert.equal(v.deliveryOutcome, 'blocked');
  assert.match(v.error!, /update dialog/);
});

test('live: failed → hard failure with attempts/resends/polls detail', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: { ...delivered, outcome: 'failed', reason: 'input never cleared', attempts: 3, resends: 2, polls: ['queued', 'queued'] } } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.equal(v.deliveryOutcome, 'failed');
  assert.match(v.error!, /Prompt delivery failed: input never cleared \(attempts=3, resends=2, polls=queued,queued\)/);
});

test('live: ambiguous → hard failure, outcome ambiguous', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: { ...delivered, outcome: 'ambiguous' } } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.equal(v.deliveryOutcome, 'ambiguous');
  assert.match(v.error!, /Prompt delivery ambiguous: unknown/);
});

test('old bridge build (no delivery object) → loud hard failure', async () => {
  reset({ create: { status: 200, body: { status: 'running' } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.equal(v.failureKind, 'hard');
  assert.match(v.error!, /old build/);
});

// ---------------------------------------------------------------------------
// deliverToSession — resume-from-stopped (cli_arg) verdicts
// ---------------------------------------------------------------------------

const cliArg = { outcome: 'delivered', verified: false, mode: 'cli_arg', attempts: 0, resends: 0, warnings: [] };

test('resume: cli_arg + alive + clear input region → success', async () => {
  reset({ create: { status: 200, body: { status: 'running', resumed: true, pid: 42, delivery: cliArg } }, info: { status: 200, body: { status: 'running' } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, true);
  assert.equal(v.deliveryOutcome, 'delivered');
  assert.equal(v.livenessCheck?.type, 'checkSessionAlive');
  assert.equal(v.livenessCheck?.result, 'running');
  assert.equal(v.bridgeRequest?.resumed, true);
});

test('resume: cli_arg + session died non-zero → hard failure "stopped during startup"', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: cliArg } }, info: { status: 200, body: { status: 'stopped', exitCode: 1 } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.match(v.error!, /Session stopped during startup \(exit code 1\)/);
});

test('resume: cli_arg + exited 0 (finished fast) → success', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: cliArg } }, info: { status: 200, body: { status: 'stopped', exitCode: 0 } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, true);
});

test('resume: cli_arg + alive but startup dialog → blocked hard failure', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: cliArg } }, info: { status: 200, body: { status: 'running' } }, inputRegion: { classification: 'no_input_region' } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.equal(v.deliveryOutcome, 'blocked');
  assert.match(v.error!, /update\/trust dialog/);
});

test('resume: deferred_paste from a bridge without promptDelivery (pre-#0382) keeps the liveness path', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: { ...cliArg, mode: 'deferred_paste' } } }, info: { status: 200, body: { status: 'running' } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, true);
  assert.equal(v.livenessCheck?.type, 'checkSessionAlive');
});

// ---------------------------------------------------------------------------
// Windows deferred paste (card #0382): the bridge's recorded outcome is the verdict
// ---------------------------------------------------------------------------

const deferred = { ...cliArg, mode: 'deferred_paste' };
const pending = { state: 'pending', mode: 'deferred_paste', updatedAt: 'x' };

test('resume: deferred_paste waits for promptDelivery → delivered → success, logged as verified', async () => {
  reset({
    create: { status: 200, body: { status: 'running', resumed: true, delivery: deferred, promptDelivery: pending } },
    infoSeq: [{ status: 'running', promptDelivery: pending }, { status: 'running', promptDelivery: { state: 'delivered', mode: 'deferred_paste', updatedAt: 'y' } }],
  });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, true);
  assert.equal(v.deliveryOutcome, 'delivered');
  assert.equal(v.livenessCheck?.type, 'deferredPaste');
  assert.equal(v.delivery?.verified, true);
  assert.ok(!calls.some(c => c.url.endsWith('/input-region')), 'the bridge verdict replaces the liveness/dialog probes');
});

test('resume: deferred_paste blocked by a startup dialog → hard failure, outcome blocked, says NOT pasted', async () => {
  reset({
    create: { status: 200, body: { status: 'running', delivery: deferred, promptDelivery: pending } },
    infoSeq: [{ status: 'running', promptDelivery: { state: 'blocked', mode: 'deferred_paste', reason: 'blocked_dialog_before_paste', correlationId: '03237d56', updatedAt: 'y' } }],
  });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.equal(v.failureKind, 'hard');
  assert.equal(v.deliveryOutcome, 'blocked');
  assert.match(v.error!, /NOT pasted/);
  assert.match(v.error!, /03237d56/);
});

test('resume: deferred_paste ambiguous / failed → honest hard failure with the reason', async () => {
  for (const [state, reason] of [['ambiguous', 'screen_changed_after_paste'], ['failed', 'input_not_ready']] as const) {
    reset({
      create: { status: 200, body: { status: 'running', delivery: deferred, promptDelivery: pending } },
      infoSeq: [{ status: 'running', promptDelivery: { state, mode: 'deferred_paste', reason, updatedAt: 'y' } }],
    });
    const v = await deliverToSession(BASE);
    assert.equal(v.success, false, state);
    assert.equal(v.deliveryOutcome, state);
    assert.match(v.error!, new RegExp(reason));
    assert.equal(v.delivery?.outcome, state, 'the log records the real outcome, not the bridge placeholder "delivered"');
  }
});

test('resume: deferred_paste still pending at the bound → ambiguous hard failure, never "started"', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: deferred, promptDelivery: pending } }, infoSeq: [{ status: 'running', promptDelivery: pending }] });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.equal(v.deliveryOutcome, 'ambiguous');
  assert.match(v.error!, /still pending/);
});

test('resume: promptDelivery only on the GET (POST answer without it) is still honoured', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: deferred } }, infoSeq: [{ status: 'running', promptDelivery: { state: 'failed', mode: 'deferred_paste', reason: 'session_exited_before_delivery', updatedAt: 'y' } }] });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.match(v.error!, /session_exited_before_delivery/);
});

test('triggerAutomation (fresh, Windows deferred_paste) → waits and records a blocked start honestly', async () => {
  reset({
    create: { status: 200, body: { status: 'running', pid: 7, delivery: deferred, promptDelivery: pending } },
    infoSeq: [{ status: 'running', promptDelivery: { state: 'blocked', mode: 'deferred_paste', reason: 'blocked_dialog_before_paste', updatedAt: 'y' } }],
  });
  const card = automationCard();
  card.automation!.freshSession = true;
  const r = await triggerAutomation(card, 'proj', '/tmp/proj');
  assert.equal(r.success, false);
  assert.equal(r.deliveryOutcome, 'blocked');
  assert.match(r.error!, /NOT pasted/);
  const last = await lastLogEntry();
  assert.equal(last.outcome, 'error');
  assert.match(last.error, /NOT pasted/);
  assert.equal(last.livenessCheck.type, 'deferredPaste');
  assert.equal(last.delivery.outcome, 'blocked');
});

// ---------------------------------------------------------------------------
// deliverToSession — transport failures
// ---------------------------------------------------------------------------

test('409 legacy fallback routes through submit-verified and reads its verdict', async () => {
  reset({ create: { status: 409, body: { error: 'exists' } }, submit: { status: 200, body: { success: true, delivery: delivered } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, true);
  assert.equal(v.bridgeRequest?.status, 409);
  assert.ok(calls.some(c => c.url.endsWith('/submit-verified') && c.body.force === true));
});

test('409 fallback + submit endpoint error → "Input failed"', async () => {
  reset({ create: { status: 409, body: {} }, submit: { status: 404, body: { error: 'gone' } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.match(v.error!, /Input failed \(404\)/);
});

test('non-409 bridge error → "Session create failed (status): detail"', async () => {
  reset({ create: { status: 400, body: { error: 'provider_disabled: codex' } } });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.equal(v.failureKind, 'hard');
  assert.equal(v.error, 'Session create failed (400): provider_disabled: codex');
  assert.equal(v.bridgeRequest?.error, 'provider_disabled: codex');
});

test('fetch throws → hard failure with the thrown message, never rejects', async () => {
  reset({ throwOnCreate: 'ECONNREFUSED' });
  const v = await deliverToSession(BASE);
  assert.equal(v.success, false);
  assert.equal(v.failureKind, 'hard');
  assert.equal(v.error, 'ECONNREFUSED');
});

// ---------------------------------------------------------------------------
// triggerAutomation pin — non-fresh automations behave identically
// ---------------------------------------------------------------------------

function automationCard(): KanbanCard {
  return {
    id: 'card-auto-1', title: 'Nightly thing', description: 'Do the nightly thing',
    type: 'chore', priority: 'medium', order: 10, areas: ['web-frontend'], tags: [],
    problems: [], checklist: [{ id: 'c1', text: 'pending item', done: false }],
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    automation: { enabled: true, schedule: '0 6 * * *', scheduleType: 'recurring', provider: 'claude', freshSession: false, reportViaMessaging: false },
  } as KanbanCard;
}

test('triggerAutomation (non-fresh, live delivered) → success + log entry with delivery', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: delivered } } });
  const r = await triggerAutomation(automationCard(), 'proj', '/tmp/proj');
  assert.equal(r.success, true);
  assert.equal(r.deliveryOutcome, 'delivered');
  assert.equal(r.sessionName, `proj:claude:card:card-auto-1`);
  // The prompt still carries the automation run header + card context.
  const body = calls.find(c => c.method === 'POST')!.body;
  assert.match(body.prompt, /=== AUTOMATION RUN ===/);
  assert.match(body.prompt, /Pending checklist: pending item/);
  assert.match(body.prompt, /Do the nightly thing/);
  assert.equal(body.fresh, false);
  const lines = (await fs.readFile(LOG_PATH, 'utf-8')).trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.cardId, 'card-auto-1');
  assert.equal(last.trigger, 'scheduled');
  assert.equal(last.outcome, 'success');
  assert.equal(last.delivery.outcome, 'delivered');
  assert.equal(last.livenessCheck.type, 'verifiedSubmit');
});

test('triggerAutomation (non-fresh, blocked) → hard failure surfaces unchanged', async () => {
  reset({ create: { status: 200, body: { status: 'running', delivery: { ...delivered, outcome: 'blocked', reason: 'trust prompt' } } } });
  const r = await triggerAutomation(automationCard(), 'proj', '/tmp/proj');
  assert.equal(r.success, false);
  assert.equal(r.failureKind, 'hard');
  assert.equal(r.deliveryOutcome, 'blocked');
  assert.match(r.error!, /trust prompt/);
  const lines = (await fs.readFile(LOG_PATH, 'utf-8')).trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.outcome, 'error');
  assert.match(last.error, /trust prompt/);
});

test('triggerAutomation (fresh) still spawns fresh and passes liveness', async () => {
  reset({ create: { status: 200, body: { status: 'running', pid: 7, delivery: { ...cliArg } } }, info: { status: 200, body: { status: 'running' } } });
  const card = automationCard();
  card.automation!.freshSession = true;
  const r = await triggerAutomation(card, 'proj', '/tmp/proj');
  assert.equal(r.success, true);
  const body = calls.find(c => c.method === 'POST')!.body;
  assert.equal(body.fresh, true);
  const lines = (await fs.readFile(LOG_PATH, 'utf-8')).trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.fresh, true);
  assert.equal(last.livenessCheck.type, 'checkSessionAlive');
});

// ---------------------------------------------------------------------------
// Fresh every N days (card #0373) — the probe's conversation start decides
// ---------------------------------------------------------------------------

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

function intervalCard(days = 7): KanbanCard {
  const card = automationCard();
  card.automation!.freshSessionDays = days;
  return card;
}

async function lastLog() {
  const lines = (await fs.readFile(LOG_PATH, 'utf-8')).trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

test('every N days: conversation past the limit → fresh spawn, logged with reason age', async () => {
  const started = daysAgo(8);
  reset({
    create: { status: 200, body: { status: 'running', pid: 7, delivery: { ...cliArg } } },
    info: { status: 200, body: { status: 'running', createdAt: daysAgo(200), conversationStartedAt: started } },
  });
  const r = await triggerAutomation(intervalCard(7), 'proj', '/tmp/proj', { trigger: 'manual' });
  assert.equal(r.success, true);
  const body = calls.find(c => c.method === 'POST')!.body;
  assert.equal(body.fresh, true);
  assert.match(body.prompt, /Session: fresh \(previous conversation started \d{4}-\d{2}-\d{2}, 8 days ago; limit 7 days\)/);
  const last = await lastLog();
  assert.equal(last.fresh, true);
  assert.equal(last.freshReason, 'age');
  assert.equal(last.conversationStartedAt, started);
  assert.equal(last.trigger, 'manual');
});

test('every N days: conversation inside the limit → resumes, header names the due date', async () => {
  reset({
    create: { status: 200, body: { status: 'running', delivery: delivered } },
    info: { status: 200, body: { status: 'running', createdAt: daysAgo(200), conversationStartedAt: daysAgo(1) } },
  });
  const r = await triggerAutomation(intervalCard(7), 'proj', '/tmp/proj');
  assert.equal(r.success, true);
  const body = calls.find(c => c.method === 'POST')!.body;
  assert.equal(body.fresh, false);
  assert.match(body.prompt, /Session: resumed \(conversation started \d{4}-\d{2}-\d{2}; fresh start due on or after \d{4}-\d{2}-\d{2}\)/);
  const last = await lastLog();
  assert.equal(last.fresh, false);
  assert.equal(last.freshReason, 'within-window');
});

test('every N days: bridge probe fails → resume path, never a fresh stop', async () => {
  reset({
    create: { status: 200, body: { status: 'running', delivery: delivered } },
    info: { status: 500, body: { error: 'boom' } },
  });
  await triggerAutomation(intervalCard(7), 'proj', '/tmp/proj');
  assert.equal(calls.find(c => c.method === 'POST')!.body.fresh, false);
  assert.equal((await lastLog()).freshReason, 'probe-failed');
});

test('never (no freshSessionDays) stays resume even for an ancient conversation', async () => {
  reset({
    create: { status: 200, body: { status: 'running', delivery: delivered } },
    info: { status: 200, body: { status: 'running', conversationStartedAt: daysAgo(400) } },
  });
  await triggerAutomation(automationCard(), 'proj', '/tmp/proj');
  assert.equal(calls.find(c => c.method === 'POST')!.body.fresh, false);
  assert.equal((await lastLog()).freshReason, 'never');
});

// ---------------------------------------------------------------------------
// busyPolicy 'defer' — the bridge's own busy guard decides (card #0352 problem)
// ---------------------------------------------------------------------------

test('defer + live + busy → busy verdict (soft), nothing pasted, no POST /sessions', async () => {
  reset({ busy: true, info: { status: 200, body: { status: 'running' } } });
  const v = await deliverToSession({ ...BASE, busyPolicy: 'defer' });
  assert.equal(v.success, false);
  assert.equal(v.busy, true);
  assert.equal(v.failureKind, 'soft');
  assert.equal(v.bridgeRequest?.status, 409);
  assert.ok(calls.some(c => c.url.endsWith('/submit-verified') && c.body.force === false));
  assert.ok(!calls.some(c => c.method === 'POST' && c.url.endsWith('/sessions')), 'must not fall through to the force paste');
});

test('defer + live + idle → delivered through submit-verified (force:false)', async () => {
  reset({ busy: false, info: { status: 200, body: { status: 'running' } } });
  const v = await deliverToSession({ ...BASE, busyPolicy: 'defer' });
  assert.equal(v.success, true);
  assert.equal(v.deliveryOutcome, 'delivered');
  assert.equal(v.busy, undefined);
  assert.ok(calls.some(c => c.url.endsWith('/submit-verified') && c.body.force === false));
});

test('defer + stopped session → resume path (POST /sessions), busy guard not consulted', async () => {
  reset({ busy: true, info: { status: 200, body: { status: 'stopped', hasHistory: true } }, create: { status: 200, body: { status: 'running', resumed: true, delivery: cliArg } } });
  // liveness after resume reads 'stopped' from the same info scenario; make it exit 0 (finished fast) → success
  scenario.info = { status: 200, body: { status: 'stopped', exitCode: 0 } };
  // But the pre-check needs 'stopped' too — both use the same GET; emulate by ordering: first GET → stopped
  const v = await deliverToSession({ ...BASE, busyPolicy: 'defer' });
  assert.equal(v.success, true);
  assert.ok(calls.some(c => c.method === 'POST' && c.url.endsWith('/sessions') && c.body.fresh === false));
  assert.ok(!calls.some(c => c.url.endsWith('/submit-verified')));
});

test('force policy (automations) ignores busy — POST /sessions as before', async () => {
  reset({ busy: true, create: { status: 200, body: { status: 'running', delivery: delivered } } });
  const v = await deliverToSession({ ...BASE, busyPolicy: 'force' });
  assert.equal(v.success, true);
  assert.ok(calls.some(c => c.method === 'POST' && c.url.endsWith('/sessions')));
  assert.ok(!calls.some(c => c.url.endsWith('/submit-verified')));
});

// ---------------------------------------------------------------------------
// fireScheduledPrompt — busy → deferred → idle → delivered (after_wait);
// busy past the bound → forced + flagged (forced_busy)
// ---------------------------------------------------------------------------

const projectDir = path.join(tmpDir, 'proj');
const kanbanFile = path.join(projectDir, 'documentation', 'kanban.json');
const project = { id: 'proj', path: projectDir };

async function seedBoard(entry: Record<string, unknown>): Promise<KanbanCard> {
  await fs.mkdir(path.dirname(kanbanFile), { recursive: true });
  const card = {
    id: 'card-1', number: 1, title: 'Busy card', description: '', type: 'feature', priority: 'high', order: 10,
    areas: [], tags: [], problems: [], checklist: [], created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    scheduled_prompts: [entry],
  };
  const board = { project_id: 'proj', last_updated: '2026-01-01T00:00:00.000Z', stages: { backlog: [], design: [], implementation: [card], testing: [], done: [] } };
  await fs.writeFile(kanbanFile, JSON.stringify(board, null, 2) + '\n');
  return card as unknown as KanbanCard;
}

async function readEntry(): Promise<Record<string, unknown>> {
  const board = JSON.parse(await fs.readFile(kanbanFile, 'utf-8'));
  return board.stages.implementation[0].scheduled_prompts[0];
}

function firingEntry(fireAtMsAgo: number, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 'sp-busy', message: 'continue', fireAt: new Date(now - fireAtMsAgo).toISOString(), createdAt: new Date(now - fireAtMsAgo - 60_000).toISOString(),
    sessionName: 'proj:claude:card:card-1', provider: 'claude', host: os.hostname(), state: 'firing', firedAt: new Date(now).toISOString(), ...extra,
  };
}

test('fire: busy inside the bound → entry back to pending with deferrals=1, nothing delivered', async () => {
  const entry = firingEntry(60_000); // due 1 min ago
  const card = await seedBoard(entry);
  reset({ busy: true, info: { status: 200, body: { status: 'running' } } });
  await fireScheduledPrompt(project, card, entry as never);
  const e = await readEntry();
  assert.equal(e.state, 'pending');
  assert.equal(e.deferrals, 1);
  assert.equal(e.firedAt, undefined);
  assert.ok(typeof e.lastDeferredAt === 'string');
  assert.ok(!calls.some(c => c.method === 'POST' && c.url.endsWith('/sessions')), 'no force paste while deferring');
});

test('fire: idle after a deferral → delivered with deliveryNote after_wait, log carries the note', async () => {
  const entry = firingEntry(90_000, { deferrals: 1, lastDeferredAt: new Date(Date.now() - 30_000).toISOString() });
  const card = await seedBoard(entry);
  reset({ busy: false, info: { status: 200, body: { status: 'running' } } });
  await fireScheduledPrompt(project, card, entry as never);
  const e = await readEntry();
  assert.equal(e.state, 'delivered');
  assert.equal(e.outcome, 'delivered');
  assert.equal(e.deliveryNote, 'after_wait');
  const board = JSON.parse(await fs.readFile(kanbanFile, 'utf-8'));
  assert.match(board.stages.implementation[0].status.text, /^Scheduled prompt delivered/);
  const lines = (await fs.readFile(LOG_PATH, 'utf-8')).trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.trigger, 'scheduled_prompt');
  assert.ok(last.delivery.warnings.includes('scheduled_prompt:after_wait'));
});

test('fire: still busy past the 10-minute bound → forced paste, deliveryNote forced_busy, status says check', async () => {
  const entry = firingEntry(11 * 60_000, { deferrals: 20 });
  const card = await seedBoard(entry);
  reset({ busy: true, info: { status: 200, body: { status: 'running' } }, create: { status: 200, body: { status: 'running', delivery: delivered } } });
  await fireScheduledPrompt(project, card, entry as never);
  const e = await readEntry();
  assert.equal(e.state, 'delivered');
  assert.equal(e.deliveryNote, 'forced_busy');
  // First the guarded attempt (409 busy), then the force path.
  const guarded = calls.findIndex(c => c.url.endsWith('/submit-verified') && c.body.force === false);
  const forced = calls.findIndex(c => c.method === 'POST' && c.url.endsWith('/sessions'));
  assert.ok(guarded >= 0 && forced > guarded, 'guarded attempt must precede the force');
  const board = JSON.parse(await fs.readFile(kanbanFile, 'utf-8'));
  assert.match(board.stages.implementation[0].status.text, /forced into a busy session .* check it landed/);
  const lines = (await fs.readFile(LOG_PATH, 'utf-8')).trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  assert.ok(last.delivery.warnings.includes('scheduled_prompt:forced_busy'));
});

test('fire: delivered first time, no deferrals → no deliveryNote', async () => {
  const entry = firingEntry(30_000);
  const card = await seedBoard(entry);
  reset({ busy: false, info: { status: 200, body: { status: 'running' } } });
  await fireScheduledPrompt(project, card, entry as never);
  const e = await readEntry();
  assert.equal(e.state, 'delivered');
  assert.equal(e.deliveryNote, undefined);
});

async function lastLogEntry() {
  const lines = (await fs.readFile(LOG_PATH, 'utf-8')).trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}
