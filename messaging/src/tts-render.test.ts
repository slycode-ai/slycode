import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeechRenderer, type RenderFn } from './tts-render.js';
import { textToSpeech, RenderTimeoutError, RenderCancelledError, ttsSemaphoreState, TTS_RENDER_CONCURRENCY } from './tts.js';
import type { VoiceConfig } from './types.js';

const config: VoiceConfig = {
  sttBackend: 'openai',
  openaiApiKey: '',
  whisperCliPath: '',
  whisperModelPath: '',
  awsTranscribeRegion: '',
  awsTranscribeLanguage: 'en-AU',
  awsTranscribeS3Bucket: '',
  elevenlabsApiKey: 'key',
  elevenlabsVoiceId: 'ENVVOICE0000000000000',
  elevenlabsSpeed: 1.0,
};

function stubRenderer(): { render: RenderFn; calls: number; release: () => void } {
  let calls = 0;
  let resolvers: Array<() => void> = [];
  const render: RenderFn = async (text, _cfg, opts) => {
    calls++;
    await new Promise<void>((r) => resolvers.push(r));
    return { buffer: Buffer.from(`${opts.voiceIdOverride ?? 'env'}:${text}`), format: opts.format, sourceMp3: Buffer.alloc(0) };
  };
  const handle = {
    render,
    get calls() { return calls; },
    release: () => { const rs = resolvers; resolvers = []; rs.forEach((r) => r()); },
  };
  return handle;
}

test('cache hit returns the same bytes without calling the renderer again', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer(config, { render: stub.render });
  const p1 = r.renderSpeech({ text: 'done', format: 'mp3', voiceId: 'V1' });
  stub.release();
  const first = await p1;
  assert.equal(first.cached, false);
  assert.equal(stub.calls, 1);

  const second = await r.renderSpeech({ text: 'done', format: 'mp3', voiceId: 'V1' });
  assert.equal(second.cached, true);
  assert.equal(stub.calls, 1);
  assert.equal(second.buffer.toString(), 'V1:done');
  assert.equal(second.voiceId, 'V1');
});

test('different voice, format or text is a different cache entry', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer(config, { render: stub.render });
  const a = r.renderSpeech({ text: 'done', format: 'mp3', voiceId: 'V1' });
  const b = r.renderSpeech({ text: 'done', format: 'mp3', voiceId: 'V2' });
  const c = r.renderSpeech({ text: 'done', format: 'ogg', voiceId: 'V1' });
  const d = r.renderSpeech({ text: 'done!', format: 'mp3', voiceId: 'V1' });
  stub.release();
  await Promise.all([a, b, c, d]);
  assert.equal(stub.calls, 4);
  assert.equal(r.size, 4);
});

test('concurrent identical requests coalesce onto one render', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer(config, { render: stub.render });
  const ps = [1, 2, 3].map(() => r.renderSpeech({ text: 'same', format: 'mp3', voiceId: 'V1' }));
  assert.equal(stub.calls, 1);
  stub.release();
  const results = await Promise.all(ps);
  assert.equal(stub.calls, 1);
  for (const res of results) {
    assert.equal(res.cached, false);
    assert.equal(res.buffer.toString(), 'V1:same');
  }
});

test('cache is bounded (LRU) and evicts the oldest entry', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer(config, { render: stub.render, cacheSize: 2 });
  const p = [
    r.renderSpeech({ text: 'a', format: 'mp3', voiceId: 'V' }),
    r.renderSpeech({ text: 'b', format: 'mp3', voiceId: 'V' }),
  ];
  stub.release();
  await Promise.all(p);
  // touch 'a' so 'b' becomes the oldest
  await r.renderSpeech({ text: 'a', format: 'mp3', voiceId: 'V' });
  const pc = r.renderSpeech({ text: 'c', format: 'mp3', voiceId: 'V' });
  stub.release();
  await pc;
  assert.equal(r.size, 2);
  const again = r.renderSpeech({ text: 'b', format: 'mp3', voiceId: 'V' });
  stub.release();
  assert.equal((await again).cached, false, "'b' should have been evicted");
  // order is now [c, b]: 'c' is still cached, 'a' was evicted when 'b' re-entered
  assert.equal((await r.renderSpeech({ text: 'c', format: 'mp3', voiceId: 'V' })).cached, true);
});

test('env default voice is used when no voiceId is given', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer(config, { render: stub.render });
  const p = r.renderSpeech({ text: 'hi', format: 'mp3' });
  stub.release();
  const res = await p;
  assert.equal(res.voiceId, config.elevenlabsVoiceId);
  assert.equal(res.buffer.toString(), 'env:hi');
});

test('textToSpeech surfaces a RenderTimeoutError when ElevenLabs stalls', async () => {
  const fetchImpl = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  })) as unknown as typeof fetch;
  await assert.rejects(
    textToSpeech('hello', config, undefined, { timeoutMs: 20, fetchImpl }),
    (err: unknown) => err instanceof RenderTimeoutError,
  );
  assert.equal(ttsSemaphoreState().active, 0, 'timeout must release the semaphore slot');
});

test('semaphore bounds concurrent ElevenLabs calls and queues the rest', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const releasers: Array<() => void> = [];
  const fetchImpl = ((_url: string) => new Promise<Response>((resolve) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    releasers.push(() => {
      inFlight--;
      resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    });
  })) as unknown as typeof fetch;

  const calls = [1, 2, 3, 4].map(() => textToSpeech('x', config, undefined, { timeoutMs: 5000, fetchImpl }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(maxInFlight, TTS_RENDER_CONCURRENCY);
  assert.equal(ttsSemaphoreState().waiting, 4 - TTS_RENDER_CONCURRENCY);
  while (releasers.length) {
    releasers.shift()!();
    await new Promise((r) => setTimeout(r, 5));
  }
  const buffers = await Promise.all(calls);
  assert.equal(buffers.length, 4);
  assert.equal(maxInFlight, TTS_RENDER_CONCURRENCY);
  assert.deepEqual(ttsSemaphoreState(), { active: 0, waiting: 0 });
});

function blockingFetch() {
  let calls = 0;
  const releasers: Array<() => void> = [];
  const fetchImpl = ((_url: string) => new Promise<Response>((resolve) => {
    calls++;
    releasers.push(() => resolve(new Response(new Uint8Array([1]), { status: 200 })));
  })) as unknown as typeof fetch;
  return { fetchImpl, get calls() { return calls; }, releaseAll: async () => { while (releasers.length) { releasers.shift()!(); await new Promise((r) => setTimeout(r, 5)); } } };
}

test('queue residence is bounded: a queued render times out without ever calling ElevenLabs', async () => {
  const bf = blockingFetch();
  const busy = Array.from({ length: TTS_RENDER_CONCURRENCY }, () => textToSpeech('busy', config, undefined, { timeoutMs: 5000, fetchImpl: bf.fetchImpl }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(bf.calls, TTS_RENDER_CONCURRENCY);
  await assert.rejects(
    textToSpeech('late', config, undefined, { timeoutMs: 30, fetchImpl: bf.fetchImpl }),
    (err: unknown) => err instanceof RenderTimeoutError,
  );
  assert.equal(bf.calls, TTS_RENDER_CONCURRENCY, 'expired queued work must never be dispatched');
  assert.equal(ttsSemaphoreState().waiting, 0, 'expired waiter removed from the queue');
  await bf.releaseAll();
  await Promise.all(busy);
  assert.deepEqual(ttsSemaphoreState(), { active: 0, waiting: 0 });
});

test('a queued render cancelled by its signal is dropped from the queue and never dispatched', async () => {
  const bf = blockingFetch();
  const busy = Array.from({ length: TTS_RENDER_CONCURRENCY }, () => textToSpeech('busy', config, undefined, { timeoutMs: 5000, fetchImpl: bf.fetchImpl }));
  await new Promise((r) => setTimeout(r, 10));
  const ac = new AbortController();
  const queued = textToSpeech('gone', config, undefined, { timeoutMs: 5000, fetchImpl: bf.fetchImpl, signal: ac.signal });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ttsSemaphoreState().waiting, 1);
  ac.abort();
  await assert.rejects(queued, (err: unknown) => err instanceof RenderCancelledError);
  assert.equal(ttsSemaphoreState().waiting, 0);
  assert.equal(bf.calls, TTS_RENDER_CONCURRENCY);
  await bf.releaseAll();
  await Promise.all(busy);
});

test('an in-flight render cancelled by its signal aborts the ElevenLabs call as cancelled, not timed out', async () => {
  const fetchImpl = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  })) as unknown as typeof fetch;
  const ac = new AbortController();
  const p = textToSpeech('x', config, undefined, { timeoutMs: 5000, fetchImpl, signal: ac.signal });
  await new Promise((r) => setTimeout(r, 5));
  ac.abort();
  await assert.rejects(p, (err: unknown) => err instanceof RenderCancelledError);
  assert.equal(ttsSemaphoreState().active, 0);
});

test('SpeechRenderer keeps a coalesced render alive until every requester has cancelled', async () => {
  const seen: AbortSignal[] = [];
  let resolveRender: (() => void) | undefined;
  const render: RenderFn = async (text, _cfg, opts) => {
    seen.push(opts.signal!);
    await new Promise<void>((r) => { resolveRender = r; });
    return { buffer: Buffer.from(text), format: opts.format, sourceMp3: Buffer.alloc(0) };
  };
  const r = new SpeechRenderer(config, { render });
  const a = new AbortController();
  const b = new AbortController();
  const pa = r.renderSpeech({ text: 'same', format: 'mp3', voiceId: 'V', signal: a.signal });
  const pb = r.renderSpeech({ text: 'same', format: 'mp3', voiceId: 'V', signal: b.signal });
  await new Promise((s) => setTimeout(s, 5));
  assert.equal(seen.length, 1, 'one shared render');
  a.abort();
  assert.equal(seen[0].aborted, false, 'still one live requester');
  b.abort();
  assert.equal(seen[0].aborted, true, 'last requester gone → shared render aborted');
  resolveRender?.();
  await Promise.allSettled([pa, pb]);
});

test('SpeechRenderer: a requester without a signal pins the shared render', async () => {
  const seen: AbortSignal[] = [];
  let resolveRender: (() => void) | undefined;
  const render: RenderFn = async (text, _cfg, opts) => {
    seen.push(opts.signal!);
    await new Promise<void>((r) => { resolveRender = r; });
    return { buffer: Buffer.from(text), format: opts.format, sourceMp3: Buffer.alloc(0) };
  };
  const r = new SpeechRenderer(config, { render });
  const a = new AbortController();
  const pa = r.renderSpeech({ text: 'pin', format: 'mp3', voiceId: 'V', signal: a.signal });
  const pb = r.renderSpeech({ text: 'pin', format: 'mp3', voiceId: 'V' });
  await new Promise((s) => setTimeout(s, 5));
  a.abort();
  assert.equal(seen[0].aborted, false);
  resolveRender?.();
  const [ra, rb] = await Promise.all([pa, pb]);
  assert.equal(ra.buffer.toString(), 'pin');
  assert.equal(rb.buffer.toString(), 'pin');
});
