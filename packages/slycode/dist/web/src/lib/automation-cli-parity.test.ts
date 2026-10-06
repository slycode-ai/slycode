/**
 * Scheduler ↔ CLI parity for automation runs (card #0373).
 *
 * `sly-kanban automation run` (scripts/kanban.js) can't import the TS rule, so
 * it mirrors planAutomationSession / resolveFreshness. This suite runs the real
 * scheduler path (triggerAutomation) and the real CLI against ONE fake bridge
 * and asserts both send the same create request — same session name (canonical
 * vs project-ID alias), same fresh flag — for each case.
 *
 * TZ is unset for both; the workspace .env says Australia/Melbourne, which
 * both must pick up exactly as the scheduler's loadParentEnv does. One case is
 * built so Melbourne and UTC disagree on whether the conversation is 7 days old.
 *
 *   ./bridge/node_modules/.bin/tsx --test web/src/lib/automation-cli-parity.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { execFile } from 'child_process';
import type { AddressInfo } from 'net';
import type { KanbanCard } from './types';
import { calendarDaysBetween } from './automation-freshness';
import { getBridgeUrl } from './paths';

const KANBAN = path.resolve(__dirname, '../../../scripts/kanban.js');
const WORKSPACE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'slycode-parity-')));
const PROJECT = path.join(WORKSPACE, 'proj');
const PROJECT_ID = 'parity-alias';            // registry id ≠ session key "proj" → an alias name exists
const CARD_ID = 'card-parity-1';
const CANONICAL = `proj:claude:card:${CARD_ID}`;
const ALIAS = `${PROJECT_ID}:claude:card:${CARD_ID}`;
const WORKSPACE_TZ = 'Australia/Melbourne';
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const automation = {
  enabled: false, schedule: '0 6 * * *', scheduleType: 'recurring' as const, provider: 'claude',
  freshSession: false, freshSessionDays: 7, reportViaMessaging: false,
};
const card = {
  id: CARD_ID, number: 1, title: 'Parity thing', description: 'Do the parity thing', type: 'chore',
  priority: 'medium', areas: [], tags: [], problems: [], checklist: [], order: 10,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', automation,
} as unknown as KanbanCard;

// ---------------------------------------------------------------------------
// Fake bridge: per-name session answers; records every create request.
// ---------------------------------------------------------------------------

type Answer = { http?: number; body: unknown };
let answers: Record<string, Answer> = {};
const creates: { name: string; fresh: boolean }[] = [];
let server: http.Server;
let bridgeUrl = '';

function startBridge(): Promise<void> {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const url = req.url || '';
      if (req.method === 'POST' && url === '/sessions') {
        const body = JSON.parse(raw);
        creates.push({ name: body.name, fresh: body.fresh });
        answers[body.name] = { body: { status: 'running' } };   // later liveness checks see it alive
        res.end(JSON.stringify({
          status: 'running', pid: 1,
          delivery: { outcome: 'delivered', verified: true, mode: body.fresh ? 'cli_arg' : 'verified_paste', attempts: 1, resends: 0, warnings: [] },
        }));
        return;
      }
      const m = req.method === 'GET' && url.match(/^\/sessions\/([^/]+)$/);
      if (m) {
        const a = answers[decodeURIComponent(m[1])] ?? { body: null };
        res.statusCode = a.http ?? 200;
        res.end(JSON.stringify(a.body));
        return;
      }
      if (req.method === 'GET' && url.endsWith('/input-region')) {
        res.end(JSON.stringify({ classification: 'idle' }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => {
    bridgeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    r();
  }));
}

// ---------------------------------------------------------------------------
// Workspace: .env with a non-UTC TZ, a registry entry whose id differs from
// the project's session key, and the project's board.
// ---------------------------------------------------------------------------

let scheduler: typeof import('./scheduler');

before(async () => {
  fs.writeFileSync(path.join(WORKSPACE, '.env'), `# workspace env\nTZ=${WORKSPACE_TZ}\n`);
  fs.mkdirSync(path.join(WORKSPACE, 'projects'));
  fs.writeFileSync(path.join(WORKSPACE, 'projects', 'registry.json'),
    JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'Parity', path: PROJECT }] }));
  fs.mkdirSync(path.join(PROJECT, 'documentation'), { recursive: true });
  fs.writeFileSync(path.join(PROJECT, 'documentation', 'kanban.json'), JSON.stringify({
    project_id: PROJECT_ID, stages: { backlog: [card], design: [], implementation: [], testing: [], done: [] },
    last_updated: card.updated_at, nextCardNumber: 2,
  }, null, 2));

  await startBridge();

  // Outside production the scheduler ignores BRIDGE_URL and talks to the real
  // local bridge (getBridgeUrl). Redirect that base to the fake and refuse
  // every other URL, so a test run can never reach a live bridge.
  const schedulerBridge = getBridgeUrl();
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(schedulerBridge)) return Promise.reject(new Error(`parity test blocked fetch: ${url}`));
    return realFetch(bridgeUrl + url.slice(schedulerBridge.length), init);
  }) as typeof fetch;

  // The scheduler reads all of this at module load, so set it first and
  // require in place (tsx runs this file as CJS).
  delete process.env.TZ;
  process.env.SLYCODE_HOME = WORKSPACE;
  process.env.SLYCODE_AUTOMATION_LOG = path.join(WORKSPACE, 'automation.log');
  process.env.SLYCODE_LIVENESS_CHECK_MS = '5';
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  scheduler = require('./scheduler') as typeof import('./scheduler');
});

after(() => {
  server.close();
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
});

async function viaScheduler(start: Record<string, Answer>) {
  answers = structuredClone(start);
  creates.length = 0;
  await scheduler.triggerAutomation(card, PROJECT_ID, PROJECT, { trigger: 'manual' });
  assert.equal(creates.length, 1, 'scheduler sent one create');
  return creates[0];
}

function viaCli(start: Record<string, Answer>): Promise<{ name: string; fresh: boolean }> {
  answers = structuredClone(start);
  creates.length = 0;
  const env: NodeJS.ProcessEnv = { ...process.env, SLYCODE_HOME: WORKSPACE, BRIDGE_URL: bridgeUrl, SLYCODE_SESSION: '' };
  delete env.TZ;   // this process's TZ was filled from the workspace .env by the scheduler import
  return new Promise((resolve, reject) => {
    execFile('node', [KANBAN, 'automation', 'run', CARD_ID], { cwd: PROJECT, env, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`CLI failed: ${stderr || stdout}`));
      if (creates.length !== 1) return reject(new Error(`CLI sent ${creates.length} creates:\n${stdout}`));
      resolve(creates[0]);
    });
  });
}

const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

/**
 * A start time that is 7+ calendar days old in Melbourne but not in UTC, or the
 * reverse (Melbourne runs 10–11 h ahead, so a window always exists). Taken from
 * the middle of the window so the seconds between runs can't cross it.
 */
function straddlingStart(): { iso: string; melbourneFresh: boolean } {
  const now = new Date();
  const hits: Date[] = [];
  for (let h = 0; h <= 72; h++) {
    const start = new Date(now.getTime() - 6 * DAY - h * HOUR);
    const mel = calendarDaysBetween(start, now, WORKSPACE_TZ) >= 7;
    const utc = calendarDaysBetween(start, now, 'UTC') >= 7;
    if (mel !== utc) hits.push(start);
  }
  assert.ok(hits.length > 0, 'a Melbourne/UTC straddle window exists');
  const start = hits[Math.floor(hits.length / 2)];
  return { iso: start.toISOString(), melbourneFresh: calendarDaysBetween(start, now, WORKSPACE_TZ) >= 7 };
}

test('both sides resolve the scheduler timezone from the workspace .env when TZ is unset', () => {
  assert.equal(scheduler.getConfiguredTimezone().timezone, WORKSPACE_TZ);
});

test('parity: same session name and fresh flag from scheduler and CLI', async () => {
  const straddle = straddlingStart();
  const cases: { label: string; start: Record<string, Answer>; expect: { name: string; fresh: boolean } }[] = [
    {
      label: 'TZ unset + Melbourne .env: the day count follows Melbourne, not UTC',
      start: { [CANONICAL]: { body: { status: 'stopped', conversationStartedAt: straddle.iso } } },
      expect: { name: CANONICAL, fresh: straddle.melbourneFresh },
    },
    {
      label: 'alias only, overdue → the alias is rolled over in place',
      start: { [ALIAS]: { body: { status: 'stopped', conversationStartedAt: daysAgo(10) } } },
      expect: { name: ALIAS, fresh: true },
    },
    {
      label: 'alias only, running, inside the window → the alias is resumed',
      start: { [ALIAS]: { body: { status: 'running', conversationStartedAt: daysAgo(1) } } },
      expect: { name: ALIAS, fresh: false },
    },
    {
      label: 'live alias beats a stopped canonical; its old conversation is due',
      start: {
        [CANONICAL]: { body: { status: 'stopped', conversationStartedAt: daysAgo(1) } },
        [ALIAS]: { body: { status: 'running', conversationStartedAt: daysAgo(10) } },
      },
      expect: { name: ALIAS, fresh: true },
    },
    {
      label: "status tie → canonical, and canonical's conversation decides",
      start: {
        [CANONICAL]: { body: { status: 'running', conversationStartedAt: daysAgo(1) } },
        [ALIAS]: { body: { status: 'running', conversationStartedAt: daysAgo(10) } },
      },
      expect: { name: CANONICAL, fresh: false },
    },
    {
      label: 'canonical probe fails → resume canonical, never a fresh stop',
      start: { [CANONICAL]: { http: 500, body: { error: 'boom' } } },
      expect: { name: CANONICAL, fresh: false },
    },
  ];

  for (const c of cases) {
    const web = await viaScheduler(c.start);
    const cli = await viaCli(c.start);
    assert.deepEqual(web, c.expect, `scheduler: ${c.label}`);
    assert.deepEqual(cli, c.expect, `CLI: ${c.label}`);
  }
});
