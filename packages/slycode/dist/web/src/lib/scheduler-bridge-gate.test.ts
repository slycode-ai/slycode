/**
 * Scheduler bridge gate (card #0363): a tick against a dead bridge must not
 * run the automation/scheduled-prompt scan at all, so nothing gets stamped or
 * claimed; a tick against a live bridge runs as before.
 *
 *   ./bridge/node_modules/.bin/tsx --test web/src/lib/scheduler-bridge-gate.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sched-gate-'));
process.env.SLYCODE_HOME = tmpDir;
process.env.SLYCODE_AUTOMATION_LOG = path.join(tmpDir, 'automation.log');
Object.assign(process.env, { NODE_ENV: 'production' }); // getBridgeUrl honors BRIDGE_URL only in production

type Mode = 'refuse' | '503' | 'ok';
let mode: Mode = 'refuse';
let server: http.Server;
let sched: typeof import('./scheduler');

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url !== '/health') { res.statusCode = 404; res.end(); return; }
    if (mode === 'refuse') { req.socket.destroy(); return; }   // looks like ECONNREFUSED to fetch
    res.statusCode = mode === 'ok' ? 200 : 503;
    res.end(JSON.stringify({ status: mode }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  process.env.BRIDGE_URL = `http://127.0.0.1:${port}`;
  // Load AFTER the env is set — BRIDGE_URL is read once at module load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sched = require('./scheduler') as typeof import('./scheduler');
});

after(async () => {
  await new Promise<void>(r => server.close(() => r()));
});

test('bridge connection dropped → tick skipped, scan never runs, lastCheck untouched', async () => {
  mode = 'refuse';
  const r = await sched.runSchedulerTick();
  assert.equal(r.ran, false);
  const info = sched.getSchedulerTickInfo();
  assert.equal(info.lastCheck, null, 'checkAutomations did not run (it stamps lastCheck first thing)');
  assert.equal(info.bridgeDown, true);
  assert.equal(info.ticksSkippedBridgeDown, 1);
});

test('bridge 503 → still skipped, counter increments', async () => {
  mode = '503';
  const r = await sched.runSchedulerTick();
  assert.equal(r.ran, false);
  const info = sched.getSchedulerTickInfo();
  assert.equal(info.lastCheck, null);
  assert.equal(info.ticksSkippedBridgeDown, 2);
});

test('bridge healthy → tick runs, bridgeDown clears, lastCheck stamped', async () => {
  mode = 'ok';
  const r = await sched.runSchedulerTick();
  assert.equal(r.ran, true);
  const info = sched.getSchedulerTickInfo();
  assert.notEqual(info.lastCheck, null);
  assert.equal(info.bridgeDown, false);
  assert.equal(info.ticksSkippedBridgeDown, 2, 'no further skips once alive');
});
