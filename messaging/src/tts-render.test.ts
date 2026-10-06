import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeechRenderer, defaultRenderChunk, type RenderChunkFn, type EncodeFn, type RenderSpeechRequest } from './tts-render.js';
import { textToSpeech, RenderTimeoutError, RenderCancelledError, ttsSemaphoreState, TTS_RENDER_CONCURRENCY } from './tts.js';
import type { SourceAudio, TtsProvider, TtsProviderId } from './tts/provider.js';
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
  geminiApiKey: '',
  geminiTtsModel: 'gemini-3.8-flash-tts',
  geminiTtsVoice: '',
  ttsProviderEnv: '',
  ttsSpeed: 1,
  geminiTtsLanguage: 'en',
};

/** A provider stand-in: renders `${voice}:${text}` as "mp3" bytes. */
function fakeProvider(id: TtsProviderId = 'elevenlabs', render?: TtsProvider['render']): TtsProvider {
  return {
    id, label: id, model: 'm', maxRenderChars: Number.POSITIVE_INFINITY, concurrency: 2,
    nativeSpeed: id === 'elevenlabs', resolveVoiceValue: async (v: string) => ({ provider: id, id: v, name: v }),
    isConfigured: () => true,
    envDefaultVoice: () => null,
    builtinDefaultVoice: () => null,
    cacheKeyParts: () => ['m'],
    searchVoices: async () => [],
    render: render ?? (async (req) => ({ kind: 'mp3', data: Buffer.from(`${req.voiceId}:${req.chunk.text}`) })),
  };
}

const provider = fakeProvider();
const req = (text: string, voiceId: string, extra: Partial<RenderSpeechRequest> = {}): RenderSpeechRequest => ({
  provider, providerRevision: 0, voice: { provider: provider.id, id: voiceId, name: voiceId }, text, format: 'mp3', timeoutMs: 5000, ...extra,
});

/** Encode stub: mp3 passes through; ogg is tagged so tests can see one source served both. */
const encode: EncodeFn = async (src: SourceAudio, fmt) => (fmt === 'mp3' ? src.data : Buffer.concat([Buffer.from('ogg|'), src.data]));

function stubRenderer(): { renderChunk: RenderChunkFn; calls: number; signals: AbortSignal[]; release: () => void } {
  let calls = 0;
  const signals: AbortSignal[] = [];
  let resolvers: Array<() => void> = [];
  const renderChunk: RenderChunkFn = async (job, chunk, signal) => {
    calls++;
    signals.push(signal);
    await new Promise<void>((r) => resolvers.push(r));
    return { kind: 'mp3', data: Buffer.from(`${job.voice.id}:${chunk.text}`) };
  };
  return {
    renderChunk,
    get calls() { return calls; },
    signals,
    release: () => { const rs = resolvers; resolvers = []; rs.forEach((r) => r()); },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('cache hit returns the same bytes without calling the renderer again', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer({ renderChunk: stub.renderChunk, encode });
  const p1 = r.renderSpeech(req('done', 'V1'));
  stub.release();
  const first = await p1;
  assert.equal(first.cached, false);
  assert.equal(stub.calls, 1);

  const second = await r.renderSpeech(req('done', 'V1'));
  assert.equal(second.cached, true);
  assert.equal(stub.calls, 1);
  assert.equal(second.buffer.toString(), 'V1:done');
  assert.equal(second.voiceId, 'V1');
  assert.equal(second.provider, 'elevenlabs');
});

test('different voice or text is a different cache entry; a different FORMAT reuses the one source render (feature 087)', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer({ renderChunk: stub.renderChunk, encode });
  const a = r.renderSpeech(req('done', 'V1'));
  const b = r.renderSpeech(req('done', 'V2'));
  const d = r.renderSpeech(req('done!', 'V1'));
  stub.release();
  await Promise.all([a, b, d]);
  const c = await r.renderSpeech(req('done', 'V1', { format: 'ogg' }));
  assert.equal(stub.calls, 3, 'mp3 and ogg of the same text share one paid render');
  assert.equal(r.size, 3);
  assert.equal(c.cached, true);
  assert.equal(c.buffer.toString(), 'ogg|V1:done');
});

test('the provider is part of the cache key: same voice id and text on another provider renders again', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer({ renderChunk: stub.renderChunk, encode });
  const other = fakeProvider('gemini');
  const p1 = r.renderSpeech(req('same', 'V'));
  const p2 = r.renderSpeech({ ...req('same', 'V'), provider: other, voice: { provider: 'gemini', id: 'V', name: 'V' } });
  stub.release();
  const [x, y] = await Promise.all([p1, p2]);
  assert.equal(stub.calls, 2);
  assert.equal(x.provider, 'elevenlabs');
  assert.equal(y.provider, 'gemini');
});

test('concurrent identical requests coalesce onto one render', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer({ renderChunk: stub.renderChunk, encode });
  const ps = [1, 2, 3].map(() => r.renderSpeech(req('same', 'V1')));
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
  const r = new SpeechRenderer({ renderChunk: stub.renderChunk, encode, cacheSize: 2 });
  const p = [r.renderSpeech(req('a', 'V')), r.renderSpeech(req('b', 'V'))];
  stub.release();
  await Promise.all(p);
  // touch 'a' so 'b' becomes the oldest
  await r.renderSpeech(req('a', 'V'));
  const pc = r.renderSpeech(req('c', 'V'));
  stub.release();
  await pc;
  assert.equal(r.size, 2);
  const again = r.renderSpeech(req('b', 'V'));
  stub.release();
  assert.equal((await again).cached, false, "'b' should have been evicted");
  // order is now [c, b]: 'c' is still cached, 'a' was evicted when 'b' re-entered
  assert.equal((await r.renderSpeech(req('c', 'V'))).cached, true);
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
  await sleep(10);
  assert.equal(maxInFlight, TTS_RENDER_CONCURRENCY);
  assert.equal(ttsSemaphoreState().waiting, 4 - TTS_RENDER_CONCURRENCY);
  while (releasers.length) {
    releasers.shift()!();
    await sleep(5);
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
  return { fetchImpl, get calls() { return calls; }, releaseAll: async () => { while (releasers.length) { releasers.shift()!(); await sleep(5); } } };
}

test('queue residence is bounded: a queued render times out without ever calling ElevenLabs', async () => {
  const bf = blockingFetch();
  const busy = Array.from({ length: TTS_RENDER_CONCURRENCY }, () => textToSpeech('busy', config, undefined, { timeoutMs: 5000, fetchImpl: bf.fetchImpl }));
  await sleep(10);
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
  await sleep(10);
  const ac = new AbortController();
  const queued = textToSpeech('gone', config, undefined, { timeoutMs: 5000, fetchImpl: bf.fetchImpl, signal: ac.signal });
  await sleep(5);
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
  await sleep(5);
  ac.abort();
  await assert.rejects(p, (err: unknown) => err instanceof RenderCancelledError);
  assert.equal(ttsSemaphoreState().active, 0);
});

test('SpeechRenderer keeps a coalesced render alive until every requester has cancelled', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer({ renderChunk: stub.renderChunk, encode });
  const a = new AbortController();
  const b = new AbortController();
  const pa = r.renderSpeech(req('same', 'V', { signal: a.signal }));
  const pb = r.renderSpeech(req('same', 'V', { signal: b.signal }));
  await sleep(5);
  assert.equal(stub.signals.length, 1, 'one shared render');
  a.abort();
  assert.equal(stub.signals[0].aborted, false, 'still one live requester');
  b.abort();
  assert.equal(stub.signals[0].aborted, true, 'last requester gone → shared render aborted');
  stub.release();
  await Promise.allSettled([pa, pb]);
});

test('SpeechRenderer: a requester without a signal pins the shared render', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer({ renderChunk: stub.renderChunk, encode });
  const a = new AbortController();
  const pa = r.renderSpeech(req('pin', 'V', { signal: a.signal }));
  const pb = r.renderSpeech(req('pin', 'V'));
  await sleep(5);
  a.abort();
  assert.equal(stub.signals[0].aborted, false);
  stub.release();
  const [ra, rb] = await Promise.allSettled([pa, pb]);
  assert.equal(ra.status, 'rejected');
  assert.equal(rb.status, 'fulfilled');
  assert.equal((rb as PromiseFulfilledResult<{ buffer: Buffer }>).value.buffer.toString(), 'V:pin');
});

// --- Per-caller deadlines with coalesced waiters (feature 087, Task 3) -------

test('speak joins generate: speak times out at its own deadline, generate still gets the audio', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer({ renderChunk: stub.renderChunk, encode });
  const generate = r.renderSpeech(req('narration', 'V', { timeoutMs: 1000 }));
  await sleep(5);
  const speak = r.renderSpeech(req('narration', 'V', { timeoutMs: 40 }));
  await assert.rejects(speak, (err: unknown) => err instanceof RenderTimeoutError);
  assert.equal(stub.signals[0].aborted, false, 'generate is still waiting, so the shared render lives');
  stub.release();
  assert.equal((await generate).buffer.toString(), 'V:narration');
  assert.equal(stub.calls, 1);
});

test('generate joins speak: the shared render outlives speak\'s deadline and serves generate', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer({ renderChunk: stub.renderChunk, encode });
  const speak = r.renderSpeech(req('summary', 'V', { timeoutMs: 40 }));
  await sleep(5);
  const generate = r.renderSpeech(req('summary', 'V', { timeoutMs: 1000 }));
  await assert.rejects(speak, (err: unknown) => err instanceof RenderTimeoutError);
  await sleep(20);
  assert.equal(stub.signals[0].aborted, false, 'ceiling follows the latest live waiter');
  stub.release();
  assert.equal((await generate).buffer.toString(), 'V:summary');
  assert.equal(stub.calls, 1);
});

test('when every waiter has left, the shared render is aborted and a newcomer starts a fresh one', async () => {
  const stub = stubRenderer();
  const r = new SpeechRenderer({ renderChunk: stub.renderChunk, encode });
  await assert.rejects(r.renderSpeech(req('gone', 'V', { timeoutMs: 20 })), (err: unknown) => err instanceof RenderTimeoutError);
  assert.equal(stub.signals[0].aborted, true);
  assert.ok(stub.signals[0].reason instanceof RenderTimeoutError);
  const fresh = r.renderSpeech(req('gone', 'V', { timeoutMs: 1000 }));
  await sleep(5);
  assert.equal(stub.calls, 2, 'a dead shared render is never joined');
  stub.release();
  assert.equal((await fresh).buffer.toString(), 'V:gone');
});

test('both waiters cancel: the provider call is aborted and its semaphore slot released', async () => {
  let started = 0;
  const blocking = fakeProvider('elevenlabs', (rq) => new Promise((_resolve, reject) => {
    started++;
    rq.signal.addEventListener('abort', () => reject(rq.signal.reason));
  }));
  const r = new SpeechRenderer({ renderChunk: defaultRenderChunk, encode });
  const a = new AbortController();
  const b = new AbortController();
  const base = { ...req('x', 'V'), provider: blocking };
  const pa = r.renderSpeech({ ...base, signal: a.signal });
  const pb = r.renderSpeech({ ...base, signal: b.signal });
  await sleep(5);
  assert.equal(started, 1);
  assert.equal(ttsSemaphoreState('elevenlabs').active, 1);
  a.abort();
  b.abort();
  await Promise.allSettled([pa, pb]);
  await sleep(5);
  assert.deepEqual(ttsSemaphoreState('elevenlabs'), { active: 0, waiting: 0 });
});

test('encode time counts inside the caller\'s deadline', async () => {
  const slowEncode: EncodeFn = async (src) => { await sleep(80); return src.data; };
  const r = new SpeechRenderer({ renderChunk: async (job, chunk) => ({ kind: 'mp3', data: Buffer.from(chunk.text) }), encode: slowEncode });
  await assert.rejects(r.renderSpeech(req('quick render, slow encode', 'V', { timeoutMs: 30 })), (err: unknown) => err instanceof RenderTimeoutError);
});

// --- PCM pipeline (feature 087, phase 2) -----------------------------------------
//
// The length guard is a COARSE check, not proof the clip is complete. These
// fixtures pin what it deliberately does not catch: text under 8 words is never
// checked; a clip cut at 70% of the expected length passes; no-space (CJK) text
// is estimated at 5 chars/s, so it only catches gross truncation.

import { assertPlausibleLength, TRUNC_RATIO, WORDS_PER_SECOND } from './tts-render.js';
import { singleChunk, parseSpeech } from './tts/speech-markup.js';
import { TtsProviderError } from './tts/errors.js';

const RATE = 24000;
const pcmOf = (seconds: number) => ({ data: Buffer.alloc(Math.round(RATE * seconds) * 2, 5), sampleRate: RATE });

/** A provider stand-in returning PCM with a chosen length per chunk text. */
function pcmProvider(secondsFor: (text: string) => number, over: Partial<TtsProvider> = {}): TtsProvider {
  return {
    ...fakeProvider('gemini'), maxRenderChars: 120, nativeSpeed: false,
    render: async (req) => ({ kind: 'pcm', data: pcmOf(secondsFor(req.chunk.text)).data, sampleRate: RATE, channels: 1 }),
    ...over,
  };
}

const twelveWords = 'one two three four five six seven eight nine ten eleven twelve.';
const gReq = (p: TtsProvider, text: string, extra: Partial<RenderSpeechRequest> = {}): RenderSpeechRequest =>
  ({ provider: p, providerRevision: 0, voice: { provider: p.id, id: 'kore', name: 'Kore' }, text, format: 'mp3', timeoutMs: 5000, ...extra });

test('multi-chunk PCM is joined in order with the chunker\'s gaps; one render per chunk', async () => {
  const seen: string[] = [];
  const p = pcmProvider((t) => { seen.push(t); return 0.4 * t.split(/\s+/).length; });
  const r = new SpeechRenderer({ encode: async (src) => (src.kind === 'pcm' ? src.data : src.data) });
  const text = ['alpha', 'bravo', 'charlie', 'delta'].map((w) => `${w} ${twelveWords}`).join(' ').replace('charlie', '\n\ncharlie');
  const job = r.admit(gReq(p, text));
  assert.ok(job.chunks.length >= 2);
  const { source } = await r.renderSource(job);
  const expectedSamples = job.chunks.reduce((n, c, i) => n + Math.round(RATE * 0.4 * c.text.split(/\s+/).length) + (i < job.chunks.length - 1 ? Math.round(RATE * c.gapAfterMs / 1000) : 0), 0);
  assert.equal(source.kind, 'pcm');
  assert.equal(source.data.length / 2, expectedSamples);
  assert.equal(seen.length, job.chunks.length);
});

test('bad audio is rejected regardless of word count', async () => {
  const empty = pcmProvider(() => 0);
  const r = new SpeechRenderer({ encode: async (s) => s.data });
  await assert.rejects(r.renderSpeech(gReq(empty, 'Hi.')), (e: unknown) => e instanceof TtsProviderError && e.code === 'tts_bad_audio' && /empty audio/.test(e.message));
  const blip = pcmProvider(() => 0.05);
  await assert.rejects(new SpeechRenderer({ encode: async (s) => s.data }).renderSpeech(gReq(blip, 'Ok.')), /0\.05 s of audio for speakable text/);
});

test('length guard: gross truncation fails; its known blind spots are pinned', () => {
  const chunk = (t: string) => singleChunk(parseSpeech(t));
  const expected = 12 / WORDS_PER_SECOND;
  assert.throws(() => assertPlausibleLength(chunk(twelveWords), pcmOf(expected * (TRUNC_RATIO - 0.05))), (e: unknown) => e instanceof TtsProviderError && e.code === 'tts_truncated');
  assertPlausibleLength(chunk(twelveWords), pcmOf(expected * 0.7)); // NOT caught: cut at 70%
  assertPlausibleLength(chunk('seven words is too few to check.'), pcmOf(0.3)); // NOT checked: under 8 words
  const cjk = 'テストはすべて通りました残りはモーダルの確認だけです';
  assert.throws(() => assertPlausibleLength(chunk(cjk), pcmOf(0.5)), /should take about/);
  assertPlausibleLength(chunk(cjk), pcmOf(3)); // ~60% of the 5 chars/s estimate passes
});

test('speed: time-stretched only when the provider has no native speed', async () => {
  const gem = pcmProvider(() => 6);
  const fast = await new SpeechRenderer({ encode: async (s) => s.data }).renderSource(new SpeechRenderer().admit(gReq(gem, twelveWords, { speed: 1.2 })));
  assert.ok(Math.abs(fast.source.data.length / 2 / RATE - 6 / 1.2) < 0.06, 'Gemini stretched to 1.2×');
  const native = pcmProvider(() => 6, { nativeSpeed: true });
  const same = await new SpeechRenderer({ encode: async (s) => s.data }).renderSource(new SpeechRenderer().admit(gReq(native, twelveWords, { speed: 1.2 })));
  assert.equal(same.source.data.length / 2 / RATE, 6, 'a native-speed provider is never stretched again');
});

test('purpose decides the 429 retry policy passed to the provider', async () => {
  const seen: Array<boolean | undefined> = [];
  const p = pcmProvider(() => 5, { render: async (req) => { seen.push(req.retryOn429); return { kind: 'pcm', data: pcmOf(5).data, sampleRate: RATE, channels: 1 }; } });
  for (const purpose of ['speak', 'voice', 'generate'] as const) {
    await new SpeechRenderer({ encode: async (s) => s.data }).renderSpeech(gReq(p, `${purpose} ${twelveWords}`, { purpose }));
  }
  assert.deepEqual(seen, [false, true, true]);
});

// --- Fix loop (Codex phase 2 review) ----------------------------------------------

import type { RenderPolicy } from './tts-render.js';

/** Poll until `cond` holds (bounded), instead of guessing how long dispatch takes under load. */
async function until(cond: () => boolean, what: string, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(2);
  }
}

test('a shared render follows its LIVE waiters: deadline and retry policy, in both arrival orders', async () => {
  let policy: RenderPolicy | undefined;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const r = new SpeechRenderer({ renderChunk: async (_job, chunk, _signal, p) => { policy = p!; await gate; return { kind: 'mp3', data: Buffer.from(chunk.text) }; }, encode });
  const t0 = Date.now();
  // generate (retry allowed, long deadline) first, speak joins
  const genAbort = new AbortController();
  const gen = r.renderSpeech(req('shared text', 'V', { purpose: 'generate', timeoutMs: 6000, signal: genAbort.signal }));
  await until(() => policy !== undefined, 'the shared render to start');
  const speak = r.renderSpeech(req('shared text', 'V', { purpose: 'speak', timeoutMs: 1500 }));
  await sleep(5);
  assert.equal(policy!.retryOn429(), true, 'generate is live: a 429 may be retried');
  assert.ok(policy!.deadlineAt() >= t0 + 5900, 'deadline is the latest live one (generate)');
  genAbort.abort();
  await assert.rejects(gen, (e: unknown) => e instanceof RenderCancelledError);
  await until(() => policy!.retryOn429() === false, 'generate to leave');
  assert.ok(policy!.deadlineAt() <= Date.now() + 1500, 'deadline shrinks to speak\'s');
  release();
  assert.equal((await speak).buffer.toString(), 'shared text');

  // speak first, generate joins: retry and deadline extend
  let policy2: RenderPolicy | undefined;
  let release2!: () => void;
  const gate2 = new Promise<void>((res) => { release2 = res; });
  const r2 = new SpeechRenderer({ renderChunk: async (_j, c, _s, p) => { policy2 = p!; await gate2; return { kind: 'mp3', data: Buffer.from(c.text) }; }, encode });
  const s2 = r2.renderSpeech(req('other text', 'V', { purpose: 'speak', timeoutMs: 1500 }));
  await until(() => policy2 !== undefined, 'the second shared render to start');
  assert.equal(policy2!.retryOn429(), false);
  const g2 = r2.renderSpeech(req('other text', 'V', { purpose: 'generate', timeoutMs: 6000 }));
  await until(() => policy2!.retryOn429() === true, 'generate to join');
  assert.ok(policy2!.deadlineAt() > Date.now() + 4000, 'deadline extends to generate\'s');
  release2();
  await Promise.all([s2, g2]);
});

test('the first chunk failure stops the job: no further dispatch, in-flight siblings abort', async () => {
  const started: number[] = [];
  const aborted: number[] = [];
  const p = pcmProvider(() => 5, { maxRenderChars: 70 });
  const r = new SpeechRenderer({
    encode: async (s) => s.data,
    renderChunk: async (job, chunk, signal) => {
      const i = job.chunks.indexOf(chunk);
      started.push(i);
      if (i === 0) { await sleep(5); throw new TtsProviderError('provider_error', 'chunk 0 failed', 502); }
      await new Promise<void>((_res, rej) => signal.addEventListener('abort', () => { aborted.push(i); rej(signal.reason); }, { once: true }));
      throw new Error('unreachable');
    },
  });
  const text = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((w) => `${w} ${twelveWords}`).join(' ');
  const job = r.admit(gReq(p, text));
  assert.ok(job.chunks.length >= 5, `${job.chunks.length} chunks`);
  await assert.rejects(r.renderSource(job), /chunk 0 failed/);
  await sleep(5);
  assert.deepEqual(started.sort(), [0, 1, 2], 'only the first three were ever dispatched');
  assert.deepEqual(aborted.sort(), [1, 2], 'in-flight siblings were aborted');
});

test('bad audio is validated BEFORE caching: the next identical request renders again', async () => {
  let calls = 0;
  const p = pcmProvider(() => 0);
  const r = new SpeechRenderer({
    encode: async (s) => s.data,
    renderChunk: async () => { calls++; return { kind: 'pcm', data: pcmOf(calls === 1 ? 0 : 5).data, sampleRate: RATE, channels: 1 }; },
  });
  await assert.rejects(r.renderSpeech(gReq(p, twelveWords)), (e: unknown) => e instanceof TtsProviderError && e.code === 'tts_bad_audio');
  assert.equal(r.size, 0, 'nothing cached');
  const ok = await r.renderSpeech(gReq(p, twelveWords));
  assert.equal(calls, 2);
  assert.equal(ok.cached, false);
  assert.equal(r.size, 1);
});
