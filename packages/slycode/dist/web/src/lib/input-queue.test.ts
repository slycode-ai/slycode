/**
 * Tests for InputQueue — the in-order, single-flight, coalescing sender
 * behind raw terminal input (feature 071).
 *
 * The web/ package doesn't ship a configured test runner, so this file is a
 * self-contained script (same convention as skill-update-status.test.ts):
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/input-queue.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputQueue } from './input-queue';

/** A send stub whose resolution is manually controlled per call. */
function makeManualSend() {
  const sent: string[] = [];
  const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  const send = (data: string) =>
    new Promise<void>((resolve, reject) => {
      sent.push(data);
      pending.push({ resolve, reject });
    });
  return { sent, pending, send };
}

const tick = () => new Promise((r) => setImmediate(r));

test('single-flight: second item waits for first send to resolve', async () => {
  const { sent, pending, send } = makeManualSend();
  const q = new InputQueue({ send });

  q.enqueue('a');
  await tick();
  q.enqueue('b');
  await tick();

  assert.equal(sent.length, 1, 'second send must not start while first is in flight');
  pending[0].resolve();
  await tick();
  assert.deepEqual(sent, ['a', 'b']);
  pending[1].resolve();
});

test('coalescing: raw items buffered during flight flush as ONE send', async () => {
  const { sent, pending, send } = makeManualSend();
  const q = new InputQueue({ send });

  q.enqueue('h');
  await tick();
  // Burst while 'h' is in flight
  q.enqueue('e');
  q.enqueue('l');
  q.enqueue('l');
  q.enqueue('o');
  pending[0].resolve();
  await tick();

  assert.deepEqual(sent, ['h', 'ello'], 'burst should coalesce into a single combined send');
  pending[1].resolve();
});

test('paste payloads never merge with neighbouring raw input', async () => {
  const { sent, pending, send } = makeManualSend();
  const q = new InputQueue({ send });
  const paste = '\x1b[200~pasted\x1b[201~';

  q.enqueue('x');
  await tick();
  q.enqueue('a');
  q.enqueue(paste, 'paste');
  q.enqueue('b');
  q.enqueue('\r');
  pending[0].resolve();
  await tick();
  pending[1].resolve(); // 'a'
  await tick();
  pending[2].resolve(); // paste
  await tick();
  pending[3].resolve(); // 'b\r'
  await tick();

  assert.deepEqual(sent, ['x', 'a', paste, 'b\r'],
    'paste must stay standalone; raw items around it keep order and coalesce among themselves');
});

test('Enter after a paste stays AFTER the paste (case c)', async () => {
  const { sent, pending, send } = makeManualSend();
  const q = new InputQueue({ send });
  const paste = '\x1b[200~the prompt\x1b[201~';

  q.enqueue(paste, 'paste');
  q.enqueue('\r');
  await tick();
  assert.deepEqual(sent, [paste], 'Enter must not dispatch before the paste resolves');
  pending[0].resolve();
  await tick();
  assert.deepEqual(sent, [paste, '\r']);
  pending[1].resolve();
});

test('retry then drop: failed item retried per schedule, survivors keep order', async () => {
  const calls: string[] = [];
  let failuresLeft = 3; // 1 initial + 2 retries — exhausts the schedule
  const send = async (data: string) => {
    calls.push(data);
    if (data === 'bad' && failuresLeft-- > 0) throw new Error('network');
  };
  const q = new InputQueue({ send, retryDelaysMs: [1, 1] });

  q.enqueue('bad');
  q.enqueue('good', 'paste'); // paste so it can't coalesce with 'bad'
  await new Promise((r) => setTimeout(r, 50));

  assert.deepEqual(calls, ['bad', 'bad', 'bad', 'good'],
    'bad retried (schedule exhausted) then dropped; good still delivered after');
});

test('transient failure recovers without dropping', async () => {
  const calls: string[] = [];
  let failed = false;
  const send = async (data: string) => {
    calls.push(data);
    if (data === 'flaky' && !failed) {
      failed = true;
      throw new Error('blip');
    }
  };
  const q = new InputQueue({ send, retryDelaysMs: [1, 1] });

  q.enqueue('flaky');
  q.enqueue('next', 'paste');
  await new Promise((r) => setTimeout(r, 30));

  assert.deepEqual(calls, ['flaky', 'flaky', 'next'], 'one retry recovered the item; order preserved');
});

test('dispose drops pending input and ignores future enqueues', async () => {
  const { sent, pending, send } = makeManualSend();
  const q = new InputQueue({ send });

  q.enqueue('a');
  await tick();
  q.enqueue('zombie');
  q.dispose();
  pending[0].resolve();
  await tick();
  q.enqueue('post-dispose');
  await tick();

  assert.deepEqual(sent, ['a'], 'nothing should send after dispose');
  assert.equal(q.pendingCount, 0);
});

test('abort signal disposes the queue', async () => {
  const { sent, pending, send } = makeManualSend();
  const ctrl = new AbortController();
  const q = new InputQueue({ send, signal: ctrl.signal });

  q.enqueue('a');
  await tick();
  q.enqueue('b');
  ctrl.abort();
  pending[0].resolve();
  await tick();

  assert.deepEqual(sent, ['a']);
  assert.equal(q.pendingCount, 0);
});

test('empty enqueue is a no-op', async () => {
  const { sent, send } = makeManualSend();
  const q = new InputQueue({ send });
  q.enqueue('');
  await tick();
  assert.equal(sent.length, 0);
});
