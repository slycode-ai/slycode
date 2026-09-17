/**
 * Tests for the bridge readiness gate (card #0363).
 *
 *   ./bridge/node_modules/.bin/tsx --test web/src/lib/bridge-readiness.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeBridge, waitForBridgeReady } from './bridge-readiness';

type FetchImpl = typeof fetch;

function fetchSequence(outcomes: Array<'ok' | 'refused' | '503'>): { fetchImpl: FetchImpl; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const o = outcomes[Math.min(i++, outcomes.length - 1)];
    if (o === 'refused') throw new TypeError('fetch failed: ECONNREFUSED');
    return new Response(null, { status: o === 'ok' ? 200 : 503 });
  }) as unknown as FetchImpl;
  return { fetchImpl, calls };
}

/** Fake clock: sleep() advances time instead of waiting. */
function fakeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
  };
}

test('probeBridge: 200 → true, hits /health', async () => {
  const { fetchImpl, calls } = fetchSequence(['ok']);
  assert.equal(await probeBridge('http://b:1', { fetchImpl }), true);
  assert.deepEqual(calls, ['http://b:1/health']);
});

test('probeBridge: ECONNREFUSED → false, never throws', async () => {
  const { fetchImpl } = fetchSequence(['refused']);
  assert.equal(await probeBridge('http://b:1', { fetchImpl }), false);
});

test('probeBridge: non-2xx → false', async () => {
  const { fetchImpl } = fetchSequence(['503']);
  assert.equal(await probeBridge('http://b:1', { fetchImpl }), false);
});

test('waitForBridgeReady: ready immediately → one probe, no warning', async () => {
  const { fetchImpl, calls } = fetchSequence(['ok']);
  const warns: string[] = [];
  const clock = fakeClock();
  const r = await waitForBridgeReady('http://b:1', { fetchImpl, ...clock, warn: m => warns.push(m) });
  assert.deepEqual(r, { ready: true, attempts: 1, waitedMs: 0 });
  assert.equal(calls.length, 1);
  assert.deepEqual(warns, []);
});

test('waitForBridgeReady: refused then ready → polls until ready, progress warning at warnEveryMs', async () => {
  const { fetchImpl } = fetchSequence(['refused', 'refused', 'refused', 'refused', 'refused', 'refused', 'ok']);
  const warns: string[] = [];
  const clock = fakeClock();
  const r = await waitForBridgeReady('http://b:1', {
    fetchImpl, ...clock, warn: m => warns.push(m), intervalMs: 2_000, warnEveryMs: 10_000, maxWaitMs: 60_000,
  });
  assert.equal(r.ready, true);
  assert.equal(r.attempts, 7);
  assert.equal(r.waitedMs, 12_000);
  assert.equal(warns.length, 1, 'one progress warning at the 10s mark');
  assert.match(warns[0], /Waiting for bridge/);
});

test('waitForBridgeReady: never ready → bounded, final warning, ready=false', async () => {
  const { fetchImpl } = fetchSequence(['refused']);
  const warns: string[] = [];
  const clock = fakeClock();
  const r = await waitForBridgeReady('http://b:1', {
    fetchImpl, ...clock, warn: m => warns.push(m), intervalMs: 2_000, warnEveryMs: 10_000, maxWaitMs: 60_000,
  });
  assert.equal(r.ready, false);
  assert.equal(r.waitedMs, 60_000, 'gives up exactly at the bound');
  assert.equal(r.attempts, 31);
  assert.match(warns[warns.length - 1], /not ready after 60s/);
  assert.match(warns[warns.length - 1], /proceeding/);
});
