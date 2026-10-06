/**
 * Shared speech renderer for every speech path (feature 086; provider-aware
 * since 087): /tts/render (speak), /voice (Telegram) and /tts/generate.
 *
 *   - Admission: the request is frozen into a RenderJob (tts/render-job.ts)
 *     before any queue wait.
 *   - Cache: bounded LRU of provider SOURCE audio per chunk, keyed on
 *     provider + model/settings + voice + the chunk's effective script — so one
 *     paid render serves mp3 and ogg alike.
 *   - Coalescing: concurrent identical chunk renders share one provider call.
 *     Every waiter races the shared call against ITS OWN deadline and signal;
 *     the shared call is aborted only when every waiter has left (timed out or
 *     cancelled), so it lives exactly as long as its latest live deadline.
 *   - Encode runs per request, inside the caller's deadline.
 *
 * Cache hits still return audio: whether a cached clip is DELIVERED is the
 * caller's (bridge's) decision, not the renderer's. Never touches disk and
 * never references a channel.
 */
import { encodeSource, withProviderSlot, RenderCancelledError, RenderTimeoutError } from './tts.js';
import { admitRender, chunkCacheKey, type AdmitRequest, type RenderJob } from './tts/render-job.js';
import type { AudioFormat, ScriptChunk, SourceAudio, TtsProviderId, VoiceRef } from './tts/provider.js';
import { concatPcm, pcmSeconds, validatePcm, type Pcm } from './tts/audio-encode.js';
import { timeStretch } from './tts/time-stretch.js';
import { TtsProviderError } from './tts/errors.js';
import { toGeminiParts } from './tts/speech-markup.js';

/** Chunks rendered at once per job (inside the provider semaphore and limiter). */
export const JOB_CHUNK_CONCURRENCY = 3;
/** Length guard (coarse, NOT completeness): a clip under this share of its expected length fails. */
export const TRUNC_RATIO = 0.35;
export const WORDS_PER_SECOND = 2.6;
/** Text without spaces (CJK): characters per second (phase 0: ja 5.4–6.0, zh 4.4). */
export const CJK_CHARS_PER_SECOND = 5;

/** The words a chunk will actually speak (tags removed). */
function spokenText(chunk: ScriptChunk): string {
  return toGeminiParts(chunk.script).map((p) => p.text).join(' ').replace(/<[^>]*>/g, ' ');
}

/**
 * Coarse length guard for PCM chunks. Checked only when there is enough text
 * to estimate: ≥8 whitespace words, or (no-space scripts) ≥16 letters. It is
 * NOT a completeness check — a clip cut at 70% passes; under-8-word text is
 * never checked; the provider's own finish reason is the primary signal.
 */
export function assertPlausibleLength(chunk: ScriptChunk, pcm: Pcm): void {
  const text = spokenText(chunk);
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const letters = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  let expected = 0;
  if (words >= 8) expected = words / WORDS_PER_SECOND;
  else if (words <= 2 && letters >= 16) expected = letters / CJK_CHARS_PER_SECOND;
  if (expected === 0) return;
  const seconds = pcmSeconds(pcm);
  if (seconds < TRUNC_RATIO * expected) {
    throw new TtsProviderError('tts_truncated', `audio is ${seconds.toFixed(1)} s for text that should take about ${expected.toFixed(1)} s; the provider likely cut it short`, 502);
  }
}

/**
 * Policy of a SHARED chunk render, read by the provider at decision time: it
 * follows the live waiters, not whoever started the render (P2, #0369).
 * deadlineAt = the latest deadline among live waiters; retryOn429 = true while
 * any live waiter may retry (Telegram/generate), false when only speak waits.
 */
export interface RenderPolicy {
  deadlineAt(): number;
  retryOn429(): boolean;
}

/** Render one chunk with the job's provider. Injected in tests. */
export type RenderChunkFn = (job: RenderJob, chunk: ScriptChunk, signal: AbortSignal, policy?: RenderPolicy) => Promise<SourceAudio>;
/** Encode source audio to a delivery format. Injected in tests. */
export type EncodeFn = (source: SourceAudio, format: AudioFormat) => Promise<Buffer>;

export const defaultRenderChunk: RenderChunkFn = (job, chunk, signal, policy) =>
  withProviderSlot(job.provider, signal, () => job.provider.render({
    chunk, voiceId: job.voice.id, signal, deadlineAt: job.deadlineAt, retryOn429: job.purpose !== 'speak', policy,
  }));

/** Reject bad PCM before it can be cached (P2): empty/too short, or implausibly short for its text. */
export function validateChunkSource(chunk: ScriptChunk, source: SourceAudio): void {
  if (source.kind !== 'pcm') return;
  const pcm: Pcm = { data: source.data, sampleRate: source.sampleRate };
  validatePcm(pcm, { speakable: /[\p{L}\p{N}]/u.test(spokenText(chunk)) });
  assertPlausibleLength(chunk, pcm);
}

export interface RenderSpeechRequest extends Omit<AdmitRequest, 'now'> {
  format: AudioFormat;
  /** Caller's abort signal (e.g. HTTP request closed). */
  signal?: AbortSignal;
}

export interface RenderSourceResult {
  job: RenderJob;
  source: SourceAudio;
  /** True when every chunk came from the cache (no provider call). */
  cached: boolean;
}

export interface RenderSpeechResult {
  buffer: Buffer;
  format: AudioFormat;
  provider: TtsProviderId;
  voice: VoiceRef;
  /** The voice id actually used. */
  voiceId: string;
  cached: boolean;
}

interface Waiter { deadlineAt: number; retry: boolean }
interface Inflight { promise: Promise<SourceAudio>; controller: AbortController; live: Set<Waiter>; settled: boolean }

export const DEFAULT_RENDER_CACHE_SIZE = 50;

export class SpeechRenderer {
  private readonly cache = new Map<string, SourceAudio>();
  private readonly inflight = new Map<string, Inflight>();
  private readonly renderChunk: RenderChunkFn;
  private readonly encode: EncodeFn;
  private readonly cacheSize: number;

  constructor(opts: { renderChunk?: RenderChunkFn; encode?: EncodeFn; cacheSize?: number } = {}) {
    this.renderChunk = opts.renderChunk ?? defaultRenderChunk;
    this.encode = opts.encode ?? encodeSource;
    this.cacheSize = opts.cacheSize ?? DEFAULT_RENDER_CACHE_SIZE;
  }

  get size(): number {
    return this.cache.size;
  }

  admit(req: Omit<AdmitRequest, 'now'>): RenderJob {
    return admitRender(req);
  }

  /** Render (or reuse) the source audio for an admitted job. */
  async renderSource(job: RenderJob, signal?: AbortSignal): Promise<RenderSourceResult> {
    const n = job.chunks.length;
    const results: Array<{ source: SourceAudio; cached: boolean }> = new Array(n);
    // The first chunk failure stops the job (P2): no further chunk is
    // dispatched, and in-flight siblings leave their shared renders (which
    // abort if nobody else waits), so a failed job stops paying.
    const jobAbort = new AbortController();
    const jobSignal = signal ? AbortSignal.any([signal, jobAbort.signal]) : jobAbort.signal;
    let firstError: unknown = null;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(JOB_CHUNK_CONCURRENCY, n) }, async () => {
      while (next < n && firstError === null) {
        const i = next++;
        try {
          results[i] = await this.awaitChunk(job, job.chunks[i], jobSignal);
        } catch (err) {
          if (firstError === null) {
            firstError = err;
            jobAbort.abort(new RenderCancelledError());
          }
        }
      }
    }));
    if (firstError !== null) {
      throw signal?.aborted && !(firstError instanceof RenderTimeoutError) ? new RenderCancelledError() : firstError;
    }
    const cached = results.every((r) => r.cached);
    if (results.every((r) => r.source.kind === 'mp3')) {
      if (n !== 1) throw new TtsProviderError('provider_error', 'MP3 sources cannot be joined; this provider must not chunk', 500);
      return { job, source: results[0].source, cached };
    }
    // PCM (Gemini): chunks were validated before caching; join with the chunker's gaps, apply speed.
    const parts = results.map((r, i) => {
      if (r.source.kind !== 'pcm') throw new TtsProviderError('provider_error', 'mixed source kinds in one job', 500);
      return { pcm: { data: r.source.data, sampleRate: r.source.sampleRate } as Pcm, gapAfterMs: job.chunks[i].gapAfterMs };
    });
    let joined = concatPcm(parts);
    if (!job.provider.nativeSpeed && Math.abs(job.speed - 1) > 1e-3) joined = timeStretch(joined, job.speed);
    return { job, source: { kind: 'pcm', data: joined.data, sampleRate: joined.sampleRate, channels: 1 }, cached };
  }

  /** Admit, render and encode in one call (the common path). */
  async renderSpeech(req: RenderSpeechRequest): Promise<RenderSpeechResult> {
    const job = this.admit(req);
    const { source, cached } = await this.renderSource(job, req.signal);
    const buffer = await this.encodeWithin(job, source, req.format, req.signal);
    return { buffer, format: req.format, provider: job.provider.id, voice: job.voice, voiceId: job.voice.id, cached };
  }

  /** Encode inside the job's deadline (and the caller's signal). */
  async encodeWithin(job: RenderJob, source: SourceAudio, format: AudioFormat, signal?: AbortSignal): Promise<Buffer> {
    if (signal?.aborted) throw new RenderCancelledError();
    const remaining = job.deadlineAt - Date.now();
    if (remaining <= 0) throw new RenderTimeoutError(job.timeoutMs);
    return new Promise<Buffer>((resolve, reject) => {
      let done = false;
      const finish = (fn: () => void) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); fn(); };
      const timer = setTimeout(() => finish(() => reject(new RenderTimeoutError(job.timeoutMs))), remaining);
      const onAbort = () => finish(() => reject(new RenderCancelledError()));
      signal?.addEventListener('abort', onAbort, { once: true });
      this.encode(source, format).then((b) => finish(() => resolve(b)), (e) => finish(() => reject(e)));
    });
  }

  private awaitChunk(job: RenderJob, chunk: ScriptChunk, signal?: AbortSignal): Promise<{ source: SourceAudio; cached: boolean }> {
    const key = chunkCacheKey(job, chunk);
    const hit = this.cache.get(key);
    if (hit) {
      // LRU touch
      this.cache.delete(key);
      this.cache.set(key, hit);
      return Promise.resolve({ source: hit, cached: true });
    }
    if (signal?.aborted) return Promise.reject(new RenderCancelledError());
    const remaining = job.deadlineAt - Date.now();
    if (remaining <= 0) return Promise.reject(new RenderTimeoutError(job.timeoutMs));

    let entry = this.inflight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const live = new Set<Waiter>();
      const created: Inflight = { promise: Promise.resolve(null as unknown as SourceAudio), controller, live, settled: false };
      const policy: RenderPolicy = {
        deadlineAt: () => (live.size ? Math.max(...[...live].map((w) => w.deadlineAt)) : Date.now()),
        retryOn429: () => [...live].some((w) => w.retry),
      };
      created.promise = this.renderChunk(job, chunk, controller.signal, policy)
        .then((source) => {
          validateChunkSource(chunk, source); // never cache bad audio (P2)
          this.remember(key, source);
          return source;
        })
        .finally(() => {
          created.settled = true;
          if (this.inflight.get(key) === created) this.inflight.delete(key);
        });
      // Waiters handle rejection; this keeps an abandoned (aborted) render from
      // surfacing as an unhandled rejection.
      created.promise.catch(() => {});
      entry = created;
      this.inflight.set(key, entry);
    }
    const shared = entry;
    const me: Waiter = { deadlineAt: job.deadlineAt, retry: job.purpose !== 'speak' };
    shared.live.add(me);

    return new Promise((resolve, reject) => {
      let done = false;
      const leave = (err: Error) => {
        if (done) return;
        done = true;
        cleanup();
        shared.live.delete(me);
        if (shared.live.size === 0 && !shared.settled) {
          // Last waiter gone: abandon the paid call, and make sure a request
          // arriving now starts a fresh render instead of joining a dead one.
          if (this.inflight.get(key) === shared) this.inflight.delete(key);
          shared.controller.abort(err);
        }
        reject(err);
      };
      const timer = setTimeout(() => leave(new RenderTimeoutError(job.timeoutMs)), remaining);
      const onAbort = () => leave(new RenderCancelledError());
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      shared.promise.then(
        (source) => {
          if (done) return;
          done = true;
          cleanup();
          shared.live.delete(me);
          resolve({ source, cached: false });
        },
        (err) => {
          if (done) return;
          done = true;
          cleanup();
          shared.live.delete(me);
          reject(err);
        },
      );
    });
  }

  private remember(key: string, source: SourceAudio): void {
    if (this.cacheSize <= 0) return;
    this.cache.set(key, source);
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
