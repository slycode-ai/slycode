/**
 * Shared speech renderer for /tts/generate and /tts/render (feature 086).
 *
 * Wraps `renderTtsAudio` with:
 *   - a bounded LRU render cache keyed on voice + model + voice settings +
 *     format + text, so a repeated "done" never re-hits ElevenLabs;
 *   - coalescing of concurrent identical requests onto one in-flight
 *     promise (a burst of the same text renders once).
 *
 * Cache hits still return audio: whether a cached clip is DELIVERED is the
 * caller's (bridge's) decision, not the renderer's. Never touches disk and
 * never references a channel.
 */
import { renderTtsAudio, TTS_MODEL_ID, RenderCancelledError } from './tts.js';
import type { VoiceConfig } from './types.js';

export type RenderFn = typeof renderTtsAudio;

export interface RenderSpeechOpts {
  text: string;
  format: 'ogg' | 'mp3';
  /** Explicit voice id; undefined → env default inside renderTtsAudio. */
  voiceId?: string;
  /**
   * Caller's abort signal (e.g. HTTP request closed). Coalesced requesters
   * share one render; it is aborted only when EVERY requester has aborted
   * (a requester without a signal pins it alive).
   */
  signal?: AbortSignal;
}

interface InflightRender { promise: Promise<Buffer>; controller: AbortController; live: number; pinned: boolean }

export interface RenderSpeechResult {
  buffer: Buffer;
  format: 'ogg' | 'mp3';
  /** The voice id actually used (explicit, else env default, else null). */
  voiceId: string | null;
  /** True when served from the render cache (no ElevenLabs call). */
  cached: boolean;
}

export const DEFAULT_RENDER_CACHE_SIZE = 50;

export class SpeechRenderer {
  private readonly cache = new Map<string, Buffer>();
  private readonly inflight = new Map<string, InflightRender>();
  private readonly render: RenderFn;
  private readonly cacheSize: number;

  constructor(
    private readonly config: VoiceConfig,
    opts: { render?: RenderFn; cacheSize?: number } = {},
  ) {
    this.render = opts.render ?? renderTtsAudio;
    this.cacheSize = opts.cacheSize ?? DEFAULT_RENDER_CACHE_SIZE;
  }

  /** Cache key: everything that changes the audio bytes. */
  cacheKey(opts: RenderSpeechOpts): string {
    const voiceId = opts.voiceId || this.config.elevenlabsVoiceId || '';
    return JSON.stringify([
      voiceId,
      TTS_MODEL_ID,
      { stability: 0.5, similarity_boost: 0.75, speed: this.config.elevenlabsSpeed },
      opts.format,
      opts.text,
    ]);
  }

  get size(): number {
    return this.cache.size;
  }

  async renderSpeech(opts: RenderSpeechOpts): Promise<RenderSpeechResult> {
    const key = this.cacheKey(opts);
    const voiceId = opts.voiceId ?? this.config.elevenlabsVoiceId ?? null;

    const hit = this.cache.get(key);
    if (hit) {
      // LRU touch
      this.cache.delete(key);
      this.cache.set(key, hit);
      return { buffer: hit, format: opts.format, voiceId: voiceId || null, cached: true };
    }

    if (opts.signal?.aborted) throw new RenderCancelledError();
    let entry = this.inflight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const promise = this.render(opts.text, this.config, { format: opts.format, voiceIdOverride: opts.voiceId, signal: controller.signal })
        .then((r) => {
          this.remember(key, r.buffer);
          return r.buffer;
        })
        .finally(() => {
          this.inflight.delete(key);
        });
      entry = { promise, controller, live: 0, pinned: false };
      this.inflight.set(key, entry);
    }
    const shared = entry;
    let onAbort: (() => void) | undefined;
    if (opts.signal) {
      shared.live++;
      onAbort = () => {
        shared.live--;
        if (shared.live <= 0 && !shared.pinned) shared.controller.abort();
      };
      opts.signal.addEventListener('abort', onAbort, { once: true });
    } else {
      shared.pinned = true;
    }
    try {
      const buffer = await shared.promise;
      return { buffer, format: opts.format, voiceId: voiceId || null, cached: false };
    } finally {
      if (opts.signal && onAbort) {
        opts.signal.removeEventListener('abort', onAbort);
        if (!opts.signal.aborted) shared.live--;
      }
    }
  }

  private remember(key: string, buffer: Buffer): void {
    if (this.cacheSize <= 0) return;
    this.cache.set(key, buffer);
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
