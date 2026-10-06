/**
 * Render admission snapshot (feature 087).
 *
 * The moment a speech request is accepted — before any queue wait — its
 * identity is frozen: provider object, provider revision, model, voice, parsed
 * script and chunks. Everything downstream (queue, provider call, every chunk,
 * encode, cache write, result) uses the snapshot, so an install-wide provider
 * switch while the job waits or runs can never mix providers inside one job.
 */
import type { ScriptChunk, TtsProvider, VoiceRef } from './provider.js';
import { type SpeechScript } from './speech-markup.js';
export interface RenderJob {
    readonly provider: TtsProvider;
    readonly providerRevision: number;
    readonly model: string;
    readonly voice: Readonly<VoiceRef>;
    readonly script: SpeechScript;
    readonly chunks: readonly ScriptChunk[];
    /** This caller's own deadline (queue + render + encode). */
    readonly deadlineAt: number;
    readonly timeoutMs: number;
    /** speak (interactive, never retried), voice (Telegram) or generate. */
    readonly purpose: RenderPurpose;
    /** Provider-neutral speaking speed (applied natively or by time-stretch). */
    readonly speed: number;
}
export type RenderPurpose = 'speak' | 'voice' | 'generate';
export interface AdmitRequest {
    provider: TtsProvider;
    providerRevision: number;
    voice: VoiceRef;
    text: string;
    timeoutMs: number;
    /** Defaults to 'speak'. */
    purpose?: RenderPurpose;
    /** Defaults to 1. */
    speed?: number;
    now?: number;
}
export declare function admitRender(req: AdmitRequest): RenderJob;
/** Cache identity of one chunk: provider, model/settings, voice and the chunk's EFFECTIVE script (inherited style included). */
export declare function chunkCacheKey(job: RenderJob, chunk: ScriptChunk): string;
