/**
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/take-recorder-core.test.ts
 *
 * The voice-cloning take recorder's lifecycle with fake browser APIs,
 * including the review fixes: setup failures release the mic and land in
 * 'error'; Stop during the permission prompt cancels the start.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TakeRecorderCore, type RecorderLike, type StreamLike, type TakeEnv, type TakeSnapshot } from './take-recorder-core';

class FakeStream implements StreamLike {
  stopped = 0;
  private tracks = [{ stop: () => { this.stopped++; } }];
  getTracks() { return this.tracks; }
  get live() { return this.stopped === 0; }
}

class FakeRecorder implements RecorderLike {
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio']) });
    this.onstop?.();
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(over: Partial<TakeEnv> = {}) {
  const streams: FakeStream[] = [];
  const recorders: FakeRecorder[] = [];
  const meterClosed: number[] = [];
  const timers = new Set<unknown>();
  const states: TakeSnapshot['state'][] = [];
  let clock = 0;
  const env: TakeEnv = {
    micUnavailable: () => null,
    getUserMedia: async () => { const s = new FakeStream(); streams.push(s); return s; },
    pickMimeType: () => 'audio/webm',
    createRecorder: () => { const r = new FakeRecorder(); recorders.push(r); return r; },
    createMeter: () => ({ read: () => new Float32Array([0.2, -0.2]), close: () => { meterClosed.push(1); } }),
    convert: async () => ({ wavBase64: 'UklGRg==', seconds: 12 }),
    now: () => clock,
    setInterval: () => { const h = Symbol('t'); timers.add(h); return h; },
    clearInterval: (h) => { timers.delete(h); },
    ...over,
  };
  let last: TakeSnapshot | null = null;
  const core = new TakeRecorderCore(30, env, (s) => { last = s; states.push(s.state); });
  return { core, env, streams, recorders, meterClosed, timers, states, snap: () => last ?? core.snapshot, advance: (ms: number) => { clock += ms; } };
}

const flush = () => new Promise((r) => setImmediate(r));

test('happy path: record → stop → processing → done, mic and meter released', async () => {
  const t = setup();
  await t.core.start();
  assert.equal(t.snap().state, 'recording');
  assert.equal(t.timers.size, 1);
  t.core.stop();
  await flush();
  assert.equal(t.snap().state, 'done');
  assert.deepEqual(t.snap().take, { wavBase64: 'UklGRg==', seconds: 12 });
  assert.equal(t.streams[0].live, false, 'tracks stopped');
  assert.equal(t.meterClosed.length, 1, 'meter closed');
  assert.equal(t.timers.size, 0, 'tick cleared');
});

test('review fix: a recorder that cannot be created releases the mic and shows an error (not stuck at starting)', async () => {
  const t = setup({ createRecorder: () => { throw new Error('NotSupportedError: mimeType'); } });
  await t.core.start();
  assert.equal(t.snap().state, 'error');
  assert.match(t.snap().error ?? '', /Recording couldn't start: NotSupportedError: mimeType\. Try again, or upload/);
  assert.equal(t.streams[0].live, false, 'tracks stopped');
  assert.equal(t.meterClosed.length, 1, 'meter closed');
  assert.equal(t.timers.size, 0);
  // And it can be tried again.
  await t.core.start();
  assert.equal(t.snap().state, 'error');
  assert.equal(t.streams.length, 2);
});

test('review fix: a recorder whose start() throws is cleaned up the same way', async () => {
  const t = setup({
    createRecorder: () => {
      const r = new FakeRecorder();
      r.start = () => { throw new Error('InvalidStateError'); };
      return r;
    },
  });
  await t.core.start();
  assert.equal(t.snap().state, 'error');
  assert.equal(t.streams[0].live, false);
  assert.equal(t.meterClosed.length, 1);
});

test('a meter that throws is no reason not to record', async () => {
  const t = setup({ createMeter: () => { throw new Error('no AudioContext'); } });
  await t.core.start();
  assert.equal(t.snap().state, 'recording');
});

test('review fix: Stop while the permission prompt is up cancels the start; a late grant gives the mic straight back', async () => {
  const grant = deferred<StreamLike>();
  const late = new FakeStream();
  const t = setup({ getUserMedia: () => grant.promise });
  const starting = t.core.start();
  assert.equal(t.snap().state, 'starting');
  t.core.stop();
  assert.equal(t.snap().state, 'idle', 'Stop works during starting');
  grant.resolve(late);
  await starting;
  assert.equal(late.live, false, 'the late grant was stopped at once');
  assert.equal(t.recorders.length, 0, 'no recorder was made');
  assert.equal(t.snap().state, 'idle', 'it never starts recording');
  // A fresh start afterwards works normally.
  await t.core.start();
  assert.equal(t.snap().state, 'recording');
});

test('Stop while starting, then the prompt is denied: stays idle, no error from the stale attempt', async () => {
  const grant = deferred<StreamLike>();
  const t = setup({ getUserMedia: () => grant.promise });
  const starting = t.core.start();
  t.core.stop();
  grant.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  await starting;
  assert.equal(t.snap().state, 'idle');
  assert.equal(t.snap().error, null);
});

test('denied permission is a plain error; unmount during the prompt releases a late grant', async () => {
  const denied = setup({ getUserMedia: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); } });
  await denied.core.start();
  assert.equal(denied.snap().state, 'error');
  assert.match(denied.snap().error ?? '', /can't use the microphone/);

  const grant = deferred<StreamLike>();
  const late = new FakeStream();
  const t = setup({ getUserMedia: () => grant.promise });
  const starting = t.core.start();
  t.core.dispose();
  grant.resolve(late);
  await starting;
  assert.equal(late.live, false);
  assert.equal(t.recorders.length, 0);
});

test('auto-stop at the limit; reset mid-recording drops the take and releases the mic', async () => {
  const t = setup();
  await t.core.start();
  // Drive one tick past 30 s by hand (the fake setInterval never fires).
  t.advance(30_100);
  (t.core as unknown as { tick(): void }).tick();
  await flush();
  assert.equal(t.snap().state, 'done');

  const r = setup();
  await r.core.start();
  r.core.reset();
  await flush();
  assert.equal(r.snap().state, 'idle');
  assert.equal(r.snap().take, null);
  assert.equal(r.streams[0].live, false);
  assert.equal(r.timers.size, 0);
});

test('an unreadable recording or file is a plain error', async () => {
  const t = setup({ convert: async () => { throw new Error('decode failed'); } });
  await t.core.takeFile(new Blob(['x']));
  assert.equal(t.snap().state, 'error');
  assert.match(t.snap().error ?? '', /couldn't be read as audio/);
});

test('the mic being unavailable (insecure page) is said up front, without asking for permission', async () => {
  let asked = 0;
  const t = setup({ micUnavailable: () => 'needs https', getUserMedia: async () => { asked++; return new FakeStream(); } });
  await t.core.start();
  assert.equal(t.snap().state, 'error');
  assert.equal(t.snap().error, 'needs https');
  assert.equal(asked, 0);
});
