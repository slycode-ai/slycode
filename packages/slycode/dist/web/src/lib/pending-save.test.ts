/**
 * Tests for the flushable save debounce behind ProjectKanban's kanban save
 * (card #0357). Self-contained script, same convention as input-queue.test.ts:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/pending-save.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPendingSave } from './pending-save';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

test('flush cancels the timer and writes the latest value once', async () => {
  const writes: string[] = [];
  const save = createPendingSave<string>(async (v) => { writes.push(v); return true; }, 50);
  save.schedule('a');
  save.schedule('b');
  assert.equal(save.isPending(), true);
  const ok = await save.flush();
  assert.equal(ok, true);
  assert.deepEqual(writes, ['b']);
  assert.equal(save.isPending(), false);
  await new Promise((r) => setTimeout(r, 70));
  assert.deepEqual(writes, ['b'], 'the cancelled timer must not fire a second write');
});

test('flush resolves only after the write has finished', async () => {
  let release: (() => void) | null = null;
  const order: string[] = [];
  const save = createPendingSave<number>(async () => {
    order.push('write-start');
    await new Promise<void>((r) => { release = r; });
    order.push('write-end');
    return true;
  }, 50);
  save.schedule(1);
  const p = save.flush().then(() => order.push('flush-resolved'));
  await tick();
  assert.deepEqual(order, ['write-start']);
  assert.equal(save.isWriting(), true);
  release!();
  await p;
  assert.deepEqual(order, ['write-start', 'write-end', 'flush-resolved']);
});

test('re-scheduling the value being written is a no-op (no double save)', async () => {
  let release: (() => void) | null = null;
  const writes: object[] = [];
  const save = createPendingSave<object>(async (v) => {
    writes.push(v);
    await new Promise<void>((r) => { release = r; });
    return true;
  }, 10);
  const state = { id: 1 };
  save.schedule(state);
  const p = save.flush();
  await tick();
  save.schedule(state); // React effect re-arms with the same object
  assert.equal(save.isPending(), false);
  release!();
  await p;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(writes.length, 1);
});

test('a newer value scheduled during a write runs after it, in order', async () => {
  let release: (() => void) | null = null;
  const writes: string[] = [];
  const save = createPendingSave<string>(async (v) => {
    writes.push(v);
    if (v === 'first') await new Promise<void>((r) => { release = r; });
    return true;
  }, 10);
  save.schedule('first');
  const p1 = save.flush();
  await tick();
  save.schedule('second');
  const p2 = save.flush();
  release!();
  await Promise.all([p1, p2]);
  assert.deepEqual(writes, ['first', 'second']);
});

test('flush with nothing pending and nothing in flight resolves true without writing', async () => {
  let calls = 0;
  const save = createPendingSave<string>(async () => { calls++; return true; }, 10);
  assert.equal(await save.flush(), true);
  assert.equal(calls, 0);
});

test('flush reports a failed write and a throwing writer as false', async () => {
  const failing = createPendingSave<string>(async () => false, 10);
  failing.schedule('x');
  assert.equal(await failing.flush(), false);
  const throwing = createPendingSave<string>(async () => { throw new Error('boom'); }, 10);
  throwing.schedule('x');
  assert.equal(await throwing.flush(), false);
  assert.equal(throwing.isWriting(), false);
});

test('cancel drops the pending value', async () => {
  let calls = 0;
  const save = createPendingSave<string>(async () => { calls++; return true; }, 10);
  save.schedule('x');
  save.cancel();
  assert.equal(save.isPending(), false);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, 0);
});

test('the timer writes on its own after the delay', async () => {
  const writes: string[] = [];
  const save = createPendingSave<string>(async (v) => { writes.push(v); return true; }, 10);
  save.schedule('x');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(writes, ['x']);
});

// ----- Review fixes (card #0357 close-out) -----

test('a flush that joins a failing in-flight write resolves false (P1 #1)', async () => {
  let release: (() => void) | null = null;
  const save = createPendingSave<string>(async () => {
    await new Promise<void>((r) => { release = r; });
    return false;
  }, 10);
  save.schedule('x');
  const first = save.flush();
  await tick();
  assert.equal(save.isPending(), false, 'nothing else pending — the joiner only sees the in-flight write');
  const joiner = save.flush();
  release!();
  assert.equal(await first, false);
  assert.equal(await joiner, false, 'the joined write failed, so the joining flush must not report true');
});

// Gate helper: every write blocks until released by value.
function gated<T extends string>(results: Record<string, boolean> = {}) {
  const gates = new Map<string, () => void>();
  const writes: string[] = [];
  const run = async (v: T) => {
    writes.push(v);
    await new Promise<void>((r) => gates.set(v, r));
    return results[v] ?? true;
  };
  const release = async (v: string) => { gates.get(v)!(); await tick(); await tick(); };
  return { run, writes, release, gates };
}

test('a flush settles only once edits queued during its write are written too (P1 #2)', async () => {
  const g = gated<string>();
  const save = createPendingSave<string>(g.run, 10);
  save.schedule('first');
  let settled = false;
  const p = save.flush().then((ok) => { settled = true; return ok; });
  await tick();
  save.schedule('second'); // edit lands while 'first' is being written
  await g.release('first');
  assert.deepEqual(g.writes, ['first', 'second'], '"second" must be written by the same flush');
  assert.equal(settled, false, 'flush must not settle while "second" is still being written');
  await g.release('second');
  assert.equal(await p, true);
  assert.equal(settled, true);
  assert.equal(save.isPending(), false);
  assert.equal(save.isWriting(), false);
});

test('flush returns the LAST write\'s result when the queue holds several (P1 #2)', async () => {
  // a ok → b fails → c ok: the flush reports c (disk is current).
  const g1 = gated<string>({ b: false });
  const save = createPendingSave<string>(g1.run, 10);
  save.schedule('a');
  const p = save.flush();
  await tick();
  save.schedule('b');
  await g1.release('a');
  save.schedule('c'); // lands while the failing 'b' is in flight
  await g1.release('b');
  await g1.release('c');
  assert.deepEqual(g1.writes, ['a', 'b', 'c']);
  assert.equal(await p, true, 'last write (c) succeeded');

  // ok → bad: the flush reports the failure (disk is stale).
  const g2 = gated<string>({ bad: false });
  const failing = createPendingSave<string>(g2.run, 10);
  failing.schedule('ok');
  const q = failing.flush();
  await tick();
  failing.schedule('bad');
  await g2.release('ok');
  await g2.release('bad');
  assert.equal(await q, false, 'last write failed');
});
