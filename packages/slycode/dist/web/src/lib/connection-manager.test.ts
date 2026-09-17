/**
 * Tests for ConnectionManager's read-only budget report (card #0356):
 * `report()` must track how long a stream has sat in CONNECTING — including
 * after a NATIVE EventSource reconnect, where the browser drops the socket and
 * retries by itself (onerror with readyState CONNECTING, no new EventSource).
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/connection-manager.test.ts
 *
 * The module builds a browser singleton at import time, so minimal fakes for
 * window / document / localStorage / EventSource are installed first and the
 * module is imported dynamically afterwards.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// Order matters: the setup module installs window/document/EventSource fakes
// before the manager's import-time singleton runs.
import { FakeEventSource, clock, realDateNow } from './connection-manager.test-setup';
import { connectionManager } from './connection-manager';

test.after(() => { Date.now = realDateNow; });

// ---- tests ------------------------------------------------------------------

test('report(): a fresh stream counts as one held slot and its CONNECTING age grows until it opens', () => {
  const id = connectionManager.createManagedEventSource('/api/kanban/stream', {});
  const es = FakeEventSource.instances.at(-1)!;
  assert.equal(connectionManager.report().streams, 1);
  clock.t += 4000;
  assert.equal(connectionManager.report().connectingForMs, 4000);
  es.open();
  const r = connectionManager.report();
  assert.equal(r.streams, 1);
  assert.equal(r.connectingForMs, 0, 'cleared on open');
  assert.equal(r.active, true, 'just opened → recently active');
  connectionManager.closeConnection(id);
  assert.equal(connectionManager.report().streams, 0);
});

test('report(): a NATIVE EventSource reconnect re-arms the CONNECTING clock (review P2)', () => {
  const id = connectionManager.createManagedEventSource('/api/bridge/sessions/x/stream', {});
  const es = FakeEventSource.instances.at(-1)!;
  es.open();
  clock.t += 30_000;
  assert.equal(connectionManager.report().connectingForMs, 0);
  // Browser drops the socket and retries by itself — same EventSource object.
  es.nativeReconnect();
  assert.equal(connectionManager.report().connectingForMs, 0, 'clock restarts from the drop');
  clock.t += 6000;
  assert.equal(connectionManager.report().connectingForMs, 6000, 'stall visible again after the first open');
  assert.equal(connectionManager.report().streams, 1, 'a reconnecting source still holds a slot');
  // Repeated onerror while still CONNECTING must not reset the clock.
  es.nativeReconnect();
  clock.t += 1000;
  assert.equal(connectionManager.report().connectingForMs, 7000);
  es.open();
  assert.equal(connectionManager.report().connectingForMs, 0);
  connectionManager.closeConnection(id);
});

test('report(): a source observed CONNECTING with no start time starts its clock at first sight (safety net)', () => {
  const id = connectionManager.createManagedEventSource('/api/bridge/audio/stream', {});
  const es = FakeEventSource.instances.at(-1)!;
  es.open();
  // Flip to CONNECTING without firing onerror at all.
  es.readyState = FakeEventSource.CONNECTING;
  assert.equal(connectionManager.report().connectingForMs, 0);
  clock.t += 5500;
  assert.equal(connectionManager.report().connectingForMs, 5500);
  connectionManager.closeConnection(id);
});

test('report(): a CLOSED source releases its slot and stops the clock while the manager schedules a retry', () => {
  const id = connectionManager.createManagedEventSource('/api/kanban/stream?projectId=p', {});
  const es = FakeEventSource.instances.at(-1)!;
  es.open();
  es.fail();
  const r = connectionManager.report();
  assert.equal(r.streams, 0);
  assert.equal(r.connectingForMs, 0);
  connectionManager.closeConnection(id);
});

test('subscribeReport(): fires on create, open, error and close', () => {
  let n = 0;
  const unsub = connectionManager.subscribeReport(() => { n++; });
  const id = connectionManager.createManagedEventSource('/api/kanban/stream', {});
  const es = FakeEventSource.instances.at(-1)!;
  assert.equal(n, 1, 'create');
  es.open();
  assert.equal(n, 2, 'open');
  es.nativeReconnect();
  assert.equal(n, 3, 'native reconnect');
  connectionManager.closeConnection(id);
  assert.equal(n, 4, 'close');
  unsub();
  connectionManager.closeConnection(connectionManager.createManagedEventSource('/x', {}));
  assert.equal(n, 4, 'unsubscribed');
});
