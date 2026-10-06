import { type AdmitRequest, type RenderJob } from './tts/render-job.js';
import type { AudioFormat, ScriptChunk, SourceAudio, TtsProviderId, VoiceRef } from './tts/provider.js';
import { type Pcm } from './tts/audio-encode.js';
/** Chunks rendered at once per job (inside the provider semaphore and limiter). */
export declare const JOB_CHUNK_CONCURRENCY = 3;
/** Length guard (coarse, NOT completeness): a clip under this share of its expected length fails. */
export declare const TRUNC_RATIO = 0.35;
export declare const WORDS_PER_SECOND = 2.6;
/** Text without spaces (CJK): characters per second (phase 0: ja 5.4–6.0, zh 4.4). */
export declare const CJK_CHARS_PER_SECOND = 5;
/**
 * Coarse length guard for PCM chunks. Checked only when there is enough text
 * to estimate: ≥8 whitespace words, or (no-space scripts) ≥16 letters. It is
 * NOT a completeness check — a clip cut at 70% passes; under-8-word text is
 * never checked; the provider's own finish reason is the primary signal.
 */
export declare function assertPlausibleLength(chunk: ScriptChunk, pcm: Pcm): void;
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
export declare const defaultRenderChunk: RenderChunkFn;
/** Reject bad PCM before it can be cached (P2): empty/too short, or implausibly short for its text. */
export declare function validateChunkSource(chunk: ScriptChunk, source: SourceAudio): void;
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
export declare const DEFAULT_RENDER_CACHE_SIZE = 50;
export declare class SpeechRenderer {
    private readonly cache;
    private readonly inflight;
    private readonly renderChunk;
    private readonly encode;
    private readonly cacheSize;
    constructor(opts?: {
        renderChunk?: RenderChunkFn;
        encode?: EncodeFn;
        cacheSize?: number;
    });
    get size(): number;
    admit(req: Omit<AdmitRequest, 'now'>): RenderJob;
    /** Render (or reuse) the source audio for an admitted job. */
    renderSource(job: RenderJob, signal?: AbortSignal): Promise<RenderSourceResult>;
    /** Admit, render and encode in one call (the common path). */
    renderSpeech(req: RenderSpeechRequest): Promise<RenderSpeechResult>;
    /** Encode inside the job's deadline (and the caller's signal). */
    encodeWithin(job: RenderJob, source: SourceAudio, format: AudioFormat, signal?: AbortSignal): Promise<Buffer>;
    private awaitChunk;
    private remember;
}
