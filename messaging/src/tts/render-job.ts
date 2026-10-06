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
import { TtsProviderError, VoiceUnusableError } from './errors.js';
import { expiryState, unusableVoiceMessage } from './custom-voices.js';
import { chunkScript, parseSpeech, singleChunk, type SpeechScript } from './speech-markup.js';

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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

export function admitRender(req: AdmitRequest): RenderJob {
  if (req.voice.provider !== req.provider.id) {
    throw new TtsProviderError(
      'voice_provider_mismatch',
      `Voice '${req.voice.name}' belongs to ${req.voice.provider}, not ${req.provider.label}; it cannot be rendered there.`,
    );
  }
  // A designed voice past its stored expiry is refused before any paid call
  // (phase 4); the route adds the recipe-aware fix to the message.
  if (expiryState(req.voice.expiresAt, req.now ?? Date.now())?.state === 'expired') {
    const voice = { id: req.voice.id, name: req.voice.name, expiresAt: req.voice.expiresAt };
    throw new VoiceUnusableError('expired', voice, unusableVoiceMessage(req.provider.label, 'expired', voice, false));
  }
  const script = parseSpeech(req.text);
  // One shared chunker for every path (speak, Telegram, generate) when the text
  // is over the provider's per-request size; ElevenLabs never chunks.
  const chunks: ScriptChunk[] = req.text.length > req.provider.maxRenderChars
    ? chunkScript(script, req.provider.maxRenderChars)
    : [singleChunk(script)];
  const now = req.now ?? Date.now();
  // The provider object itself is not frozen (it is a live adapter); the
  // snapshot fixes WHICH provider, never what it is.
  const job: RenderJob = {
    provider: req.provider,
    providerRevision: req.providerRevision,
    model: req.provider.model,
    voice: deepFreeze({ ...req.voice }),
    script: deepFreeze(script),
    chunks: deepFreeze(chunks),
    deadlineAt: now + req.timeoutMs,
    timeoutMs: req.timeoutMs,
    purpose: req.purpose ?? 'speak',
    speed: req.speed ?? 1,
  };
  return Object.freeze(job);
}

/** Cache identity of one chunk: provider, model/settings, voice and the chunk's EFFECTIVE script (inherited style included). */
export function chunkCacheKey(job: RenderJob, chunk: ScriptChunk): string {
  return JSON.stringify([job.provider.id, job.provider.cacheKeyParts(), job.voice.id, chunk.inheritedStyle, chunk.text]);
}
