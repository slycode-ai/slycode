/**
 * Tests for readAutomationLog() — the reader behind the run-history UI
 * (feature 083).
 *
 * The log is a single global JSONL file shared by every project and card, and
 * it is appended to while being read, so the reader's real job is tolerance:
 * filter to one card, newest first, and never let a torn line or a missing file
 * lose the rest of the history.
 *
 * The web/ package doesn't ship a configured test runner, so this file is a
 * self-contained script. Run via the tsx binary that lives in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/scheduler-log.test.ts
 *
 * Exits 0 on success, 1 on any assertion failure. node:test/node:assert only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { readAutomationLog } from './scheduler';
import type { AutomationLogEntry } from './types';

let tmpDir: string | null = null;

/** Write a fixture log and return its path. */
async function fixture(lines: string[]): Promise<string> {
  if (!tmpDir) tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slycode-logtest-'));
  const p = path.join(tmpDir, `log-${lines.length}-${Math.floor(process.hrtime()[1])}.jsonl`);
  await fs.writeFile(p, lines.join('\n') + (lines.length ? '\n' : ''));
  return p;
}

function entry(cardId: string, timestamp: string, outcome: 'success' | 'error' = 'success'): string {
  const e: AutomationLogEntry = {
    timestamp, cardId, cardTitle: 'T', projectId: 'p',
    trigger: 'scheduled', provider: 'claude', sessionName: 's', fresh: false,
    bridgeRequest: null, livenessCheck: null,
    outcome, error: outcome === 'error' ? 'boom' : null, elapsedMs: 1234,
  };
  return JSON.stringify(e);
}

const day = (n: number) => `2026-07-${String(n).padStart(2, '0')}T00:00:00.000Z`;

test('missing log file returns [] rather than throwing (fresh install)', async () => {
  const missing = path.join(os.tmpdir(), 'slycode-does-not-exist-' + Date.now(), 'automation.log');
  assert.deepEqual(await readAutomationLog('card-A', 20, missing), []);
});

test('empty log file returns []', async () => {
  assert.deepEqual(await readAutomationLog('card-A', 20, await fixture([])), []);
});

test('filters to the requested card when several are interleaved', async () => {
  const p = await fixture([
    entry('card-A', day(1)), entry('card-B', day(2)),
    entry('card-A', day(3)), entry('card-C', day(4)),
  ]);
  const runs = await readAutomationLog('card-A', 20, p);
  assert.equal(runs.length, 2);
  assert.ok(runs.every(r => r.cardId === 'card-A'));
});

test('returns newest first', async () => {
  const p = await fixture([entry('card-A', day(1)), entry('card-A', day(2)), entry('card-A', day(3))]);
  const runs = await readAutomationLog('card-A', 20, p);
  assert.deepEqual(runs.map(r => r.timestamp), [day(3), day(2), day(1)]);
});

test('returns the LAST n entries, not the first n', async () => {
  const p = await fixture(Array.from({ length: 30 }, (_, i) => entry('card-A', day(i + 1))));
  const runs = await readAutomationLog('card-A', 20, p);
  assert.equal(runs.length, 20);
  assert.equal(runs[0].timestamp, day(30), 'newest should be the 30th');
  assert.equal(runs[19].timestamp, day(11), 'oldest returned should be the 11th, not the 1st');
});

test('clamps limit: absurd, zero and negative all stay in range', async () => {
  const p = await fixture(Array.from({ length: 30 }, (_, i) => entry('card-A', day(i + 1))));
  assert.equal((await readAutomationLog('card-A', 99999, p)).length, 30, 'capped at MAX, returns what exists');
  assert.equal((await readAutomationLog('card-A', 0, p)).length, 1, 'zero clamps up to 1');
  assert.equal((await readAutomationLog('card-A', -5, p)).length, 1, 'negative clamps up to 1');
});

test('skips torn and malformed lines but keeps the valid ones around them', async () => {
  const p = await fixture([
    entry('card-A', day(1)),
    '{"timestamp":"2026-07-02T00:00:00.000Z","cardId":"card-A","outc',  // torn mid-write
    'not json at all',
    entry('card-A', day(3), 'error'),
  ]);
  const runs = await readAutomationLog('card-A', 20, p);
  assert.equal(runs.length, 2, 'both valid entries survive');
  assert.equal(runs[0].outcome, 'error');
  assert.equal(runs[0].error, 'boom', 'surviving entry keeps its error text');
});

test('ignores blank lines and trailing newline noise', async () => {
  if (!tmpDir) tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slycode-logtest-'));
  const p = path.join(tmpDir, 'blanks.jsonl');
  await fs.writeFile(p, '\n\n' + entry('card-A', day(4)) + '\n\n\n');
  assert.equal((await readAutomationLog('card-A', 20, p)).length, 1);
});

test('a card with no entries returns []', async () => {
  const p = await fixture([entry('card-A', day(1))]);
  assert.deepEqual(await readAutomationLog('card-UNKNOWN', 20, p), []);
});

test.after(async () => {
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});
