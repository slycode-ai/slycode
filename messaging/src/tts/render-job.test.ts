import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitRender, chunkCacheKey } from './render-job.js';
import { TtsProviderError } from './errors.js';
import { SpeechRenderer, defaultRenderChunk } from '../tts-render.js';
import type { TtsProvider, TtsProviderId, ProviderRenderRequest } from './provider.js';

function provider(id: TtsProviderId, onRender?: (req: ProviderRenderRequest) => Promise<void>): TtsProvider & { renders: string[] } {
  const renders: string[] = [];
  return {
    id, label: id, model: `${id}-model`, maxRenderChars: Number.POSITIVE_INFINITY, concurrency: 1, renders,
    nativeSpeed: id === 'elevenlabs', resolveVoiceValue: async (v: string) => ({ provider: id, id: v, name: v }),
    isConfigured: () => true, envDefaultVoice: () => null, builtinDefaultVoice: () => null,
    cacheKeyParts: () => [`${id}-model`], searchVoices: async () => [],
    render: async (req) => { renders.push(req.chunk.text); await onRender?.(req); return { kind: 'mp3', data: Buffer.from(`${id}:${req.chunk.text}`) }; },
  };
}

test('admission freezes the job: voice, script and chunks cannot be changed afterwards', () => {
  const p = provider('elevenlabs');
  const job = admitRender({ provider: p, providerRevision: 3, voice: { provider: 'elevenlabs', id: 'V', name: 'Vee' }, text: '[excited] hi', timeoutMs: 1000, now: 0 });
  assert.equal(job.deadlineAt, 1000);
  assert.equal(job.providerRevision, 3);
  assert.equal(job.model, 'elevenlabs-model');
  assert.ok(Object.isFrozen(job) && Object.isFrozen(job.voice) && Object.isFrozen(job.script) && Object.isFrozen(job.chunks));
  assert.throws(() => { (job.voice as { id: string }).id = 'X'; }, TypeError);
  assert.throws(() => { (job as { provider: unknown }).provider = provider('gemini'); }, TypeError);
});

test('a voice from another provider is refused at admission (no silent cross-provider render)', () => {
  assert.throws(
    () => admitRender({ provider: provider('elevenlabs'), providerRevision: 0, voice: { provider: 'gemini', id: 'kore', name: 'Kore' }, text: 'x', timeoutMs: 10 }),
    (e: unknown) => e instanceof TtsProviderError && e.code === 'voice_provider_mismatch',
  );
});

test('cache key covers provider, model/settings, voice and the chunk\'s inherited style', () => {
  const job = admitRender({ provider: provider('elevenlabs'), providerRevision: 0, voice: { provider: 'elevenlabs', id: 'V', name: 'V' }, text: 'same words', timeoutMs: 10 });
  const chunk = job.chunks[0];
  const k1 = chunkCacheKey(job, chunk);
  const k2 = chunkCacheKey(job, { ...chunk, inheritedStyle: { mood: 'excited' } });
  assert.notEqual(k1, k2, 'same words under a different inherited mood are different audio');
  const jobB = admitRender({ provider: provider('gemini'), providerRevision: 0, voice: { provider: 'gemini', id: 'V', name: 'V' }, text: 'same words', timeoutMs: 10 });
  assert.notEqual(k1, chunkCacheKey(jobB, jobB.chunks[0]));
});

test('a provider switch while a job is QUEUED leaves it on the provider it was admitted with', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const a = provider('elevenlabs', () => gate);
  const b = provider('gemini');
  let active: TtsProvider = a;
  const renderer = new SpeechRenderer({ renderChunk: defaultRenderChunk, encode: async (s) => s.data });
  const admit = (text: string) => renderer.renderSpeech({ provider: active, providerRevision: 0, voice: { provider: active.id, id: 'V', name: 'V' }, text, format: 'mp3', timeoutMs: 2000 });
  const busy = admit('occupies the only slot');
  await new Promise((r) => setTimeout(r, 5));
  const queued = admit('waits in the queue');   // admitted on A, waits for A's slot
  active = b;                                    // install switches to B
  const next = admit('after the switch');        // admitted on B
  release();
  const [rq, rn] = await Promise.all([queued, next, busy]);
  assert.equal(rq.provider, 'elevenlabs');
  assert.equal(rq.buffer.toString(), 'elevenlabs:waits in the queue');
  assert.deepEqual(a.renders, ['occupies the only slot', 'waits in the queue']);
  assert.equal(rn.provider, 'gemini');
  assert.deepEqual(b.renders, ['after the switch']);
});

test('a switch while a job is IN FLIGHT: it finishes and caches under its own provider', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const a = provider('elevenlabs', () => gate);
  const b = provider('gemini');
  const renderer = new SpeechRenderer({ renderChunk: defaultRenderChunk, encode: async (s) => s.data });
  const voiceA = { provider: 'elevenlabs' as const, id: 'V', name: 'V' };
  const inflight = renderer.renderSpeech({ provider: a, providerRevision: 0, voice: voiceA, text: 'hello', format: 'mp3', timeoutMs: 2000 });
  await new Promise((r) => setTimeout(r, 5));
  const onB = renderer.renderSpeech({ provider: b, providerRevision: 1, voice: { provider: 'gemini', id: 'V', name: 'V' }, text: 'hello', format: 'mp3', timeoutMs: 2000 });
  release();
  const [ra, rb] = await Promise.all([inflight, onB]);
  assert.equal(ra.buffer.toString(), 'elevenlabs:hello');
  assert.equal(rb.buffer.toString(), 'gemini:hello', 'B never received A\'s audio');
  const again = await renderer.renderSpeech({ provider: a, providerRevision: 0, voice: voiceA, text: 'hello', format: 'mp3', timeoutMs: 2000 });
  assert.equal(again.cached, true);
  assert.equal(again.buffer.toString(), 'elevenlabs:hello');
});
