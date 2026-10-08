/**
 * Project status gate + resume fence (card #0381, feature 089).
 *
 * Drives REAL scheduler ticks (runSchedulerTick) against a temp workspace and
 * a fake bridge that records every request. Proves:
 *   1. A paused / complete / archived project fires NOTHING — no automation,
 *      no scheduled card prompt, no atlas refresh — and its board and atlas
 *      config are not written at all.
 *   2. The same fixture with the project active DOES reach the bridge, so the
 *      harness can see a fire (the gate test is not vacuous).
 *   3. After resume (resumedAt stamped), fire times earlier than resumedAt are
 *      skipped: recurring → nextRun recomputed, one-shot → disabled +
 *      lastResult 'skipped', scheduled prompt → missed (no Telegram notice),
 *      atlas → not due. Fire times after resumedAt still fire.
 *
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/scheduler-project-status.test.ts
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sched-status-'));
const binDir = path.join(tmpDir, 'bin');
const notifyLog = path.join(tmpDir, 'notify.log');
mkdirSync(binDir, { recursive: true });
// Fake sly-messaging: the scheduler shells out to it for failure notices.
// Recording instead of sending keeps the test off the real Telegram bot.
writeFileSync(path.join(binDir, 'sly-messaging'), `#!/bin/sh\nprintf '%s\\n---\\n' "$2" >> "${notifyLog}"\n`);
chmodSync(path.join(binDir, 'sly-messaging'), 0o755);
process.env.PATH = `${binDir}:${process.env.PATH}`;
process.env.SLYCODE_HOME = tmpDir;
process.env.SLYCODE_AUTOMATION_LOG = path.join(tmpDir, 'automation.log');
process.env.SLYCODE_LIVENESS_CHECK_MS = '20';
process.env.TZ = 'UTC'; // CONFIGURED_TIMEZONE — atlas cron below is built in UTC
Object.assign(process.env, { NODE_ENV: 'production' }); // getBridgeUrl honors BRIDGE_URL only in production

const PROJ_DIR = path.join(tmpDir, 'heldproj');   // sessionKey = 'heldproj'
const BOARD = path.join(PROJ_DIR, 'documentation', 'kanban.json');
const ATLAS_CFG = path.join(PROJ_DIR, 'documentation', 'atlas', 'config.json');
const REGISTRY = path.join(tmpDir, 'projects', 'registry.json');
const HOST = os.hostname();
const MIN = 60_000;

interface Rec { method: string; url: string; body: string }
let requests: Rec[] = [];
let route: ((r: Rec) => { status: number; body: unknown } | undefined) | null = null;
let server: http.Server;
let sched: typeof import('./scheduler');
let atlasHooks: typeof import('./atlas/refresh')['atlasTestHooks'];

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.url === '/health') { res.statusCode = 200; res.end('{"status":"ok"}'); return; }
      const rec = { method: req.method || '', url: req.url || '', body };
      requests.push(rec);
      // A test may script a response (and land a pause WHILE this request is
      // in flight — the realistic race). Default: fail fast, which is fine —
      // most tests only care whether the scheduler TRIED to reach the bridge.
      const scripted = route?.(rec);
      res.statusCode = scripted?.status ?? 500;
      res.end(JSON.stringify(scripted?.body ?? { error: 'fake bridge' }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  process.env.BRIDGE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  mkdirSync(path.dirname(REGISTRY), { recursive: true });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sched = require('./scheduler') as typeof import('./scheduler');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  atlasHooks = (require('./atlas/refresh') as typeof import('./atlas/refresh')).atlasTestHooks;
});

after(async () => {
  await new Promise<void>(r => server.close(() => r()));
});

beforeEach(() => {
  requests = [];
  writeFileSync(notifyLog, '');
  delete sched.schedulerTestHooks.beforeClaim;
  delete sched.schedulerTestHooks.beforeDeliver;
  delete atlasHooks.duringSetup;
  route = null;
});

/** Flip the fixture project's status in the registry (what a Den/CLI pause does). */
function setStatus(status: string) {
  const reg = JSON.parse(readFileSync(REGISTRY, 'utf-8'));
  reg.projects[0].status = status;
  reg.projects[0].statusChangedAt = new Date().toISOString();
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n');
}
const posts = () => requests.filter(r => r.method === 'POST');

const iso = (ms: number) => new Date(ms).toISOString();

function card(id: string, extra: Record<string, unknown>) {
  return {
    id, number: Number(id.replace(/\D/g, '')) || 1, title: `Card ${id}`, description: 'x', type: 'chore',
    priority: 'low', order: 0, areas: [], tags: [], problems: [], checklist: [],
    created_at: iso(Date.now() - 86_400_000), updated_at: iso(Date.now() - 86_400_000), ...extra,
  };
}

type TimerKind = 'recurring' | 'oneshot' | 'prompt' | 'atlas';
const ALL_TIMERS: TimerKind[] = ['recurring', 'oneshot', 'prompt', 'atlas'];

/** Every kind of timer (or just `include`), all due right now. */
function writeFixture(opts: { status?: string; resumedAt?: string; dueAt: number; extraCards?: unknown[]; include?: TimerKind[] }) {
  const inc = new Set(opts.include ?? ALL_TIMERS);
  mkdirSync(path.dirname(ATLAS_CFG), { recursive: true });
  const due = iso(opts.dueAt);
  const board = {
    project_id: 'heldproj',
    stages: {
      backlog: [
        card('card-1', inc.has('recurring') ? {
          automation: {
            enabled: true, schedule: '*/5 * * * *', scheduleType: 'recurring', provider: 'claude',
            freshSession: false, reportViaMessaging: false, nextRun: due,
          },
        } : {}),
        card('card-2', inc.has('oneshot') ? {
          automation: {
            enabled: true, schedule: due, scheduleType: 'one-shot', provider: 'claude',
            freshSession: false, reportViaMessaging: false, nextRun: due,
          },
        } : {}),
        card('card-3', inc.has('prompt') ? {
          scheduled_prompts: [{
            id: 'sp-1', message: 'continue', fireAt: due, createdAt: iso(opts.dueAt - 60 * MIN),
            sessionName: 'heldproj:claude:card:card-3', provider: 'claude', host: HOST, state: 'pending',
          }],
        } : {}),
        ...(opts.extraCards ?? []),
      ],
      design: [], implementation: [], testing: [], done: [],
    },
    last_updated: iso(Date.now() - 86_400_000),
  };
  writeFileSync(BOARD, JSON.stringify(board, null, 2) + '\n');
  // Atlas: daily at exactly dueAt's UTC minute, last run 10 minutes before it,
  // so its latest boundary IS dueAt.
  const d = new Date(opts.dueAt);
  const atlasCron = `${d.getUTCMinutes()} ${d.getUTCHours()} * * *`;
  writeFileSync(ATLAS_CFG, JSON.stringify({ enabled: inc.has('atlas'), schedule: atlasCron, provider: null, model: null, last_run: iso(opts.dueAt - 10 * MIN) }, null, 2) + '\n');
  const project: Record<string, unknown> = {
    id: 'heldproj', name: 'Held Project', description: '', path: PROJ_DIR, hasClaudeMd: false,
    masterCompliant: false, areas: [], tags: [], order: 0, sessionKey: 'heldproj', sessionKeyAliases: [],
  };
  if (opts.status) project.status = opts.status;
  if (opts.resumedAt) project.resumedAt = opts.resumedAt;
  writeFileSync(REGISTRY, JSON.stringify({ version: '2.1.0', lastUpdated: iso(Date.now()), projects: [project] }, null, 2) + '\n');
}

const settle = () => new Promise(r => setTimeout(r, 700));
const touchesProject = (r: Rec) => r.url.includes('heldproj') || r.body.includes('heldproj');
const readBoard = () => JSON.parse(readFileSync(BOARD, 'utf-8'));
const findCard = (b: { stages: Record<string, { id: string }[]> }, id: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose fixture reads
  Object.values(b.stages).flat().find(c => c.id === id) as Record<string, any>;

for (const status of ['paused', 'complete', 'archived'] as const) {
  test(`${status} project: three ticks, nothing reaches the bridge, nothing is written`, async () => {
    writeFixture({ status, dueAt: Date.now() - 2 * MIN });
    const boardBefore = readFileSync(BOARD, 'utf-8');
    const atlasBefore = readFileSync(ATLAS_CFG, 'utf-8');
    for (let i = 0; i < 3; i++) {
      const r = await sched.runSchedulerTick();
      assert.equal(r.ran, true, 'bridge is healthy, so the tick body ran');
      await settle();
    }
    assert.deepEqual(requests.filter(touchesProject), [], 'no automation, scheduled prompt or atlas kickoff for a held project');
    assert.equal(requests.length, 0, 'no bridge traffic at all beyond /health');
    assert.equal(readFileSync(BOARD, 'utf-8'), boardBefore, 'held board is byte-identical (no lastRun stamp, no nextRun self-heal, no missed-marking)');
    assert.equal(readFileSync(ATLAS_CFG, 'utf-8'), atlasBefore, 'atlas config untouched');
    assert.equal(readFileSync(notifyLog, 'utf-8'), '', 'no notifications');
  });
}

test('sanity: the same fixture on an ACTIVE project does reach the bridge', async () => {
  writeFixture({ dueAt: Date.now() - 2 * MIN });
  await sched.runSchedulerTick();
  await settle();
  assert.ok(requests.some(touchesProject), 'the harness sees fires — so the held-project test above is meaningful');
  const b = readBoard();
  assert.ok(findCard(b, 'card-1').automation.lastRun, 'recurring automation was stamped and kicked off');
});

test('unknown status value reads as active (a hand-typo must not silently stop automations)', async () => {
  writeFixture({ status: 'pausd', dueAt: Date.now() - 2 * MIN });
  await sched.runSchedulerTick();
  await settle();
  assert.ok(requests.some(touchesProject));
});

test('resume: fire times before resumedAt are skipped, never replayed', async () => {
  const now = Date.now();
  const resumedAt = iso(now - 1 * MIN);
  writeFixture({
    resumedAt,
    dueAt: now - 10 * MIN, // fell while paused
    extraCards: [card('card-9', {
      automation: {
        // Due AFTER the resume — must still fire normally.
        enabled: true, schedule: '*/5 * * * *', scheduleType: 'recurring', provider: 'claude',
        freshSession: false, reportViaMessaging: false, nextRun: iso(now - 20_000),
      },
    })],
  });

  await sched.runSchedulerTick();
  await settle();

  const b = readBoard();
  const recurring = findCard(b, 'card-1').automation;
  assert.equal(recurring.lastRun, undefined, 'held recurring run did not fire');
  assert.ok(Date.parse(recurring.nextRun) > now, `nextRun recomputed into the future (got ${recurring.nextRun})`);
  assert.equal(recurring.enabled, true);

  const oneShot = findCard(b, 'card-2');
  assert.equal(oneShot.automation.lastRun, undefined, 'held one-shot did not fire');
  assert.equal(oneShot.automation.enabled, false, 'one-shot auto-disabled like a fired one-shot');
  assert.equal(oneShot.automation.lastResult, 'skipped');
  assert.match(oneShot.automation.lastError, /paused/i);
  assert.match(String(oneShot.status?.text ?? ''), /skipped/i, 'card auto-status says why');

  const sp = findCard(b, 'card-3').scheduled_prompts[0];
  assert.equal(sp.state, 'missed');
  assert.match(sp.error, /paused/i);

  assert.ok(findCard(b, 'card-9').automation.lastRun, 'an automation due after resumedAt fires as normal');
  const atlasCfg = JSON.parse(readFileSync(ATLAS_CFG, 'utf-8'));
  assert.equal(atlasCfg.last_run, iso(now - 20 * MIN), 'atlas boundary before resumedAt is not caught up');
  assert.ok(!requests.some(r => /ATLAS REFRESH/.test(r.body)), 'no atlas kickoff');
  assert.ok(!requests.some(r => r.body.includes('card-1') || r.url.includes('card-1')), 'held recurring never reached the bridge');
  assert.ok(!requests.some(r => r.body.includes('card-3') || r.url.includes('card-3')), 'held scheduled prompt never reached the bridge');
  assert.doesNotMatch(readFileSync(notifyLog, 'utf-8'), /Scheduled prompt missed/, 'owner-caused miss sends no Telegram error');
});

test('resume: timers due AFTER resumedAt run as normal (atlas included)', async () => {
  const now = Date.now();
  writeFixture({ resumedAt: iso(now - 5 * MIN), dueAt: now - 2 * MIN });
  await sched.runSchedulerTick();
  await settle();
  assert.ok(existsSync(ATLAS_CFG));
  assert.ok(requests.some(r => /ATLAS REFRESH/.test(r.body)), 'atlas boundary after resumedAt kicks off');
  assert.ok(findCard(readBoard(), 'card-1').automation.lastRun, 'recurring due after resume fires');
});

// ---------------------------------------------------------------------------
// Pause landing mid-scan (Codex P1, fix loop): the scan's registry snapshot
// is stale by claim/delivery time — every automatic fire re-checks.
// ---------------------------------------------------------------------------

test('pause lands after the scan, before the claim: nothing claimed, nothing fired', async () => {
  writeFixture({ dueAt: Date.now() - 2 * MIN });
  const boardBefore = readFileSync(BOARD, 'utf-8');
  sched.schedulerTestHooks.beforeClaim = () => setStatus('paused');
  await sched.runSchedulerTick();
  await settle();
  assert.deepEqual(requests, [], 'no bridge traffic');
  assert.equal(readFileSync(BOARD, 'utf-8'), boardBefore, 'timer not consumed (no lastRun stamp)');
});

// The pause lands WHILE an awaited bridge request is in flight (scripted fake
// bridge) — i.e. after every earlier check — so only the last-moment guard,
// right before the next POST, can stop it.

const running = { status: 200, body: { name: 'x', status: 'running', provider: 'claude' } };

test('automation: pause lands during the session probe → no delivery POST, timer un-consumed', async () => {
  writeFixture({ dueAt: Date.now() - 2 * MIN, include: ['recurring'] });
  const due = findCard(readBoard(), 'card-1').automation.nextRun;
  route = (r) => {
    if (r.method === 'GET' && r.url.includes('card-1')) { setStatus('paused'); return running; }
    return undefined;
  };
  await sched.runSchedulerTick();
  await settle();
  assert.ok(requests.some(r => r.method === 'GET' && r.url.includes('card-1')), 'probe ran (pause landed during it)');
  assert.deepEqual(posts(), [], 'no create / submit POST');
  const a = findCard(readBoard(), 'card-1').automation;
  assert.equal(a.lastRun, undefined, 'lastRun stamp rolled back');
  assert.equal(a.nextRun, due, 'nextRun untouched');
  assert.equal(a.enabled, true);
  assert.equal(a.lastResult, undefined, 'not recorded as a failure');
  assert.equal(readFileSync(notifyLog, 'utf-8'), '', 'no failure notification');
});

test('automation: pause lands during a 409 create → the fallback submit is never sent', async () => {
  writeFixture({ dueAt: Date.now() - 2 * MIN, include: ['recurring'] });
  route = (r) => {
    if (r.method === 'GET' && r.url.includes('card-1')) return running;
    if (r.method === 'POST' && r.url === '/sessions') { setStatus('paused'); return { status: 409, body: { error: 'exists' } }; }
    return undefined;
  };
  await sched.runSchedulerTick();
  await settle();
  assert.deepEqual(posts().map(r => r.url), ['/sessions'], 'only the create; no submit-verified fallback');
  const a = findCard(readBoard(), 'card-1').automation;
  assert.equal(a.lastRun, undefined);
  assert.equal(a.lastResult, undefined);
  assert.equal(readFileSync(notifyLog, 'utf-8'), '');
});

test('scheduled send: pause lands during the existence probe → back to pending, nothing sent', async () => {
  writeFixture({ dueAt: Date.now() - 2 * MIN, include: ['prompt'] });
  let gets = 0;
  route = (r) => {
    if (r.method === 'GET' && r.url.includes('card-3')) { if (++gets === 1) setStatus('paused'); return running; }
    return undefined;
  };
  await sched.runSchedulerTick();
  await settle();
  assert.ok(gets >= 1, 'existence probe ran');
  assert.deepEqual(posts(), []);
  const sp = findCard(readBoard(), 'card-3').scheduled_prompts[0];
  assert.equal(sp.state, 'pending');
  assert.equal(sp.firedAt, undefined);
  assert.equal(sp.error, undefined, 'not recorded as failed');
  assert.equal(readFileSync(notifyLog, 'utf-8'), '');
});

test('scheduled send: pause lands during the LIVE probe (second GET) → no submit', async () => {
  writeFixture({ dueAt: Date.now() - 2 * MIN, include: ['prompt'] });
  let gets = 0;
  route = (r) => {
    if (r.method === 'GET' && r.url.includes('card-3')) { if (++gets === 2) setStatus('paused'); return running; }
    return undefined;
  };
  await sched.runSchedulerTick();
  await settle();
  assert.equal(gets, 2, 'existence + live probes ran');
  assert.deepEqual(posts(), []);
  assert.equal(findCard(readBoard(), 'card-3').scheduled_prompts[0].state, 'pending');
});

test('scheduled send: pause lands during the busy 409 → the force retry is never sent', async () => {
  // Due 11 minutes ago: past the 10-minute busy bound, so a busy answer
  // triggers the immediate force retry (inside the 12h catch-up window).
  writeFixture({ dueAt: Date.now() - 11 * MIN, include: ['prompt'] });
  route = (r) => {
    if (r.method === 'GET' && r.url.includes('card-3')) return running;
    if (r.method === 'POST' && r.url.endsWith('/submit-verified')) { setStatus('paused'); return { status: 409, body: { busy: true, error: 'busy' } }; }
    return undefined;
  };
  await sched.runSchedulerTick();
  await settle();
  assert.deepEqual(posts().map(r => r.url), ['/sessions/heldproj%3Aclaude%3Acard%3Acard-3/submit-verified'], 'only the deferred submit; no force paste');
  const sp = findCard(readBoard(), 'card-3').scheduled_prompts[0];
  assert.equal(sp.state, 'pending', 'returned to pending, not failed / forced');
  assert.equal(sp.deliveryNote, undefined);
});

test('atlas: pause lands during its setup reads → no POST, last_run untouched', async () => {
  writeFixture({ dueAt: Date.now() - 2 * MIN, include: ['atlas'] });
  const before = readFileSync(ATLAS_CFG, 'utf-8');
  atlasHooks.duringSetup = () => setStatus('paused');
  await sched.runSchedulerTick();
  await settle();
  assert.deepEqual(posts(), [], 'no atlas POST');
  assert.equal(readFileSync(ATLAS_CFG, 'utf-8'), before, 'last_run untouched');
});

test('manual Run now on a paused project still delivers (explicit actions execute)', async () => {
  writeFixture({ status: 'paused', dueAt: Date.now() - 2 * MIN, include: ['recurring'] });
  const c = findCard(readBoard(), 'card-1');
  await sched.triggerAutomation(c as never, 'heldproj', PROJ_DIR, { trigger: 'manual' });
  assert.ok(posts().length > 0, 'manual run reached the bridge');
  assert.ok(posts().some(r => /Project paused: schedule held; this runs once/.test(r.body)), 'header says why');
});
