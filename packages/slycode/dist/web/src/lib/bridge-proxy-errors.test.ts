/**
 *   ./bridge/node_modules/.bin/tsx --test web/src/lib/bridge-proxy-errors.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeBridgeFetchError, bridgeUnavailablePayload, isBridgeUnavailableStatus } from './bridge-proxy-errors';

function refused(): Error {
  const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:7592'), {
    errno: -111, code: 'ECONNREFUSED', syscall: 'connect', address: '127.0.0.1', port: 7592,
  });
  return Object.assign(new TypeError('fetch failed'), { cause });
}

test('ECONNREFUSED → single short line with address, no stack', () => {
  const line = describeBridgeFetchError(refused());
  assert.equal(line, 'ECONNREFUSED 127.0.0.1:7592');
  assert.ok(!line.includes('\n'));
});

test('cause without code → cause message; plain error → message; non-error → string', () => {
  assert.equal(describeBridgeFetchError(Object.assign(new TypeError('fetch failed'), { cause: new Error('socket hang up') })), 'socket hang up');
  assert.equal(describeBridgeFetchError(new Error('boom')), 'boom');
  assert.equal(describeBridgeFetchError('weird'), 'weird');
});

test('payload: 503 + Retry-After + machine-readable code', () => {
  const p = bridgeUnavailablePayload(refused());
  assert.equal(p.status, 503);
  assert.equal(p.headers['Retry-After'], '2');
  assert.deepEqual(p.body, { error: 'Bridge unavailable', code: 'BRIDGE_UNAVAILABLE', retryAfterMs: 2000, detail: 'ECONNREFUSED 127.0.0.1:7592' });
});

test('isBridgeUnavailableStatus: gateway-class statuses only', () => {
  for (const s of [502, 503, 504]) assert.equal(isBridgeUnavailableStatus(s), true);
  for (const s of [200, 400, 404, 409, 500]) assert.equal(isBridgeUnavailableStatus(s), false);
});
