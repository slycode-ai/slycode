/**
 * TTS plumbing shared by every speech path (feature 086, provider-aware since 087):
 * per-provider semaphores, caller deadlines, the legacy ElevenLabs entry point
 * and source-audio encoding. Rendering itself goes through SpeechRenderer
 * (tts-render.ts) and the provider adapters in ./tts/.
 */
import type { VoiceConfig } from './types.js';
import { ElevenLabsProvider, ELEVENLABS_MODEL_ID, ELEVENLABS_CONCURRENCY } from './tts/elevenlabs.js';
import { RenderTimeoutError, RenderCancelledError, TtsProviderError } from './tts/errors.js';
import type { AudioFormat, SourceAudio, TtsProvider, TtsProviderId } from './tts/provider.js';
import { parseSpeech, singleChunk } from './tts/speech-markup.js';
import { encodePcm, writeWav } from './tts/audio-encode.js';

export { RenderTimeoutError, RenderCancelledError } from './tts/errors.js';

/** ElevenLabs model id (kept for callers that predate the provider interface). */
export const TTS_MODEL_ID = ELEVENLABS_MODEL_ID;

// --- Caller deadlines (feature 087): each covers queue wait + render + encode ---

/** `speak` (POST /tts/render) and the legacy direct entry point. */
export const TTS_RENDER_TIMEOUT_MS = parseInt(process.env.TTS_RENDER_TIMEOUT_MS || '20000', 10);
/** Telegram voice replies (POST /voice): a long reply is several Gemini chunks. */
export const TTS_VOICE_TIMEOUT_MS = parseInt(process.env.TTS_VOICE_TIMEOUT_MS || '60000', 10);
/** Web voice-picker previews (POST /voices/preview): one short sentence, someone waiting. */
export const TTS_PREVIEW_TIMEOUT_MS = parseInt(process.env.TTS_PREVIEW_TIMEOUT_MS || '30000', 10);
/** `generate` (POST /tts/generate): long narration. */
export const TTS_GENERATE_TIMEOUT_MS = parseInt(process.env.TTS_GENERATE_TIMEOUT_MS || '120000', 10);

/** Speaking-speed range (ElevenLabs' accepted range; Gemini is time-stretched within it). */
export const SPEED_MIN = 0.7;
export const SPEED_MAX = 1.2;

/**
 * Provider-neutral speaking speed (feature 087): TTS_SPEED, else
 * ELEVENLABS_SPEED, else 1. ElevenLabs keeps receiving exactly
 * ELEVENLABS_SPEED unless TTS_SPEED is set (byte-identical requests for
 * existing installs); out-of-range values are clamped with a warning.
 */
export function speedFromEnv(env: Record<string, string | undefined>): { ttsSpeed: number; elevenlabsSpeed: number; warning: string | null } {
  const raw = env.TTS_SPEED?.trim() || env.ELEVENLABS_SPEED?.trim() || '1.0';
  const parsed = parseFloat(raw);
  const valid = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const ttsSpeed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, valid));
  const source = env.TTS_SPEED?.trim() ? 'TTS_SPEED' : env.ELEVENLABS_SPEED?.trim() ? 'ELEVENLABS_SPEED' : null;
  const warning = source && ttsSpeed !== parsed ? `${source}=${raw} is outside ${SPEED_MIN}–${SPEED_MAX} (or not a number); using ${ttsSpeed}.` : null;
  const elevenlabsSpeed = env.TTS_SPEED?.trim() ? ttsSpeed : parseFloat(env.ELEVENLABS_SPEED || '1.0');
  return { ttsSpeed, elevenlabsSpeed, warning };
}

/** Character cap shared by /voice, /tts/generate and /tts/render (TTS_GENERATE_MAX_TEXT, default 5000). */
export function maxSpeechText(): number {
  return parseInt(process.env.TTS_GENERATE_MAX_TEXT || '5000', 10);
}

/** The /voice refusal for an over-long Telegram reply (feature 087), or null when it fits. */
export function voiceTextLimitError(message: unknown, max = maxSpeechText()): string | null {
  if (typeof message !== 'string' || message.length <= max) return null;
  return `Telegram voice reply too long: ${message.length} characters (fixed limit ${max}; the browser word limit in Voice Settings does not apply here). Shorten it, or send it as text.`;
}

/** Max concurrent ElevenLabs requests; extra callers queue (never rejected). */
export const TTS_RENDER_CONCURRENCY = ELEVENLABS_CONCURRENCY;

// --- Per-provider FIFO semaphores ---------------------------------------------
//
// A burst of speak/generate calls cannot fan out an unbounded number of paid
// requests at once. Queue residence is bounded by the caller's abort signal
// (which fires at the caller's deadline or on cancel): work whose signal has
// fired is removed from the queue and never dispatched (feature 086 review
// finding 8).

interface Waiter { grant: () => void; cancel: (err: Error) => void }

class Semaphore {
  private active = 0;
  private readonly waiters: Waiter[] = [];
  constructor(readonly limit: number) {}

  state(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.waiters.length };
  }

  /** Resolves with a release function; rejects with the signal's reason if it fires first. */
  async acquire(signal: AbortSignal): Promise<() => void> {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.active--;
      const next = this.waiters.shift();
      if (next) next.grant();
    };
    if (signal.aborted) throw abortReason(signal);
    if (this.active < this.limit) {
      this.active++;
      return release;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => { cleanup(); this.active++; resolve(); },
        cancel: (err) => { cleanup(); reject(err); },
      };
      const onAbort = () => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        waiter.cancel(abortReason(signal));
      };
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
    return release;
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new RenderCancelledError();
}

const GEMINI_TTS_CONCURRENCY = parseInt(process.env.GEMINI_TTS_CONCURRENCY || '3', 10);
const semaphores = new Map<TtsProviderId, Semaphore>();

function semaphoreFor(provider: Pick<TtsProvider, 'id' | 'concurrency'>): Semaphore {
  let s = semaphores.get(provider.id);
  if (!s) {
    s = new Semaphore(provider.id === 'gemini' ? GEMINI_TTS_CONCURRENCY : provider.concurrency);
    semaphores.set(provider.id, s);
  }
  return s;
}

/** Run `fn` holding one of the provider's slots; queue wait ends when `signal` fires. */
export async function withProviderSlot<T>(provider: Pick<TtsProvider, 'id' | 'concurrency'>, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  const release = await semaphoreFor(provider).acquire(signal);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Test-only visibility into the ElevenLabs semaphore. */
export function ttsSemaphoreState(provider: TtsProviderId = 'elevenlabs'): { active: number; waiting: number } {
  return semaphores.get(provider)?.state() ?? { active: 0, waiting: 0 };
}

/**
 * A controller that aborts at `deadline` (RenderTimeoutError) or when the
 * caller's own signal fires (RenderCancelledError). `dispose()` clears both.
 */
export function deadlineController(timeoutMs: number, deadline: number, signal?: AbortSignal): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new RenderTimeoutError(timeoutMs)), Math.max(0, deadline - Date.now()));
  const onAbort = () => controller.abort(new RenderCancelledError());
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  return {
    controller,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Legacy direct ElevenLabs render (pre-087 entry point, kept for callers and
 * tests): one deadline covers queue residence AND the ElevenLabs call.
 */
export async function textToSpeech(
  text: string,
  config: VoiceConfig,
  voiceIdOverride?: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<Buffer> {
  const provider = new ElevenLabsProvider(config, opts.fetchImpl);
  const voiceId = voiceIdOverride || config.elevenlabsVoiceId;
  const timeoutMs = opts.timeoutMs ?? TTS_RENDER_TIMEOUT_MS;
  const { controller, dispose } = deadlineController(timeoutMs, Date.now() + timeoutMs, opts.signal);
  try {
    const source = await withProviderSlot(provider, controller.signal, () =>
      provider.render({ chunk: singleChunk(parseSpeech(text)), voiceId, signal: controller.signal }));
    return source.data;
  } finally {
    dispose();
  }
}

/**
 * Encode provider source audio into the format the caller asked for.
 * - MP3 source → mp3: zero transcode, the provider's bytes untouched.
 * - MP3 source → ogg: ffmpeg (Telegram voice bubble); throws on failure so the
 *   caller decides fallback policy (/voice falls back to MP3, generate → 502).
 * - PCM source (Gemini): bundled WASM encoders, phase 2.
 */
export async function encodeSource(source: SourceAudio, format: AudioFormat): Promise<Buffer> {
  if (source.kind === 'mp3') {
    if (format === 'mp3') return source.data;
    if (format === 'ogg') return convertToOgg(source.data);
    // WAV from an MP3 provider: decode to raw samples, then a fresh header (no metadata carried over).
    return writeWav({ data: await decodeMp3ToPcm(source.data), sampleRate: 24000 });
  }
  return encodePcm({ data: source.data, sampleRate: source.sampleRate }, format);
}

/** ffmpeg decode of an MP3 to s16le mono 24 kHz (ElevenLabs → WAV only). */
async function decodeMp3ToPcm(mp3: Buffer): Promise<Buffer> {
  const { spawn } = await import('child_process');
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ['-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    ffmpeg.stdout.on('data', (c: Buffer) => chunks.push(c));
    ffmpeg.stderr.on('data', () => {});
    ffmpeg.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new TtsProviderError('format_unavailable', `WAV from ElevenLabs needs ffmpeg to decode the MP3 (exit ${code}); use mp3 or ogg`, 500))));
    ffmpeg.on('error', () => reject(new TtsProviderError('format_unavailable', 'WAV from ElevenLabs needs ffmpeg, which is not installed; use mp3 or ogg', 500)));
    ffmpeg.stdin.on('error', () => {});
    ffmpeg.stdin.end(mp3);
  });
}

export async function convertToOgg(mp3Buffer: Buffer): Promise<Buffer> {
  // Use ffmpeg to convert MP3 to OGG/Opus (Telegram's preferred format)
  const { spawn } = await import('child_process');

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',       // Read from stdin
      '-c:a', 'libopus',    // Opus codec
      '-b:a', '64k',        // Bitrate
      '-f', 'ogg',          // OGG container
      'pipe:1',             // Write to stdout
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on('data', () => {}); // Suppress ffmpeg stderr

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`ffmpeg not found. Install ffmpeg for voice support: ${err.message}`));
    });

    ffmpeg.stdin.write(mp3Buffer);
    ffmpeg.stdin.end();
  });
}
