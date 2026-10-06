/**
 * Minimal HTTP client from the bridge to the messaging service (feature 086).
 *
 * The bridge only ever talks to the ONE URL it was configured with
 * (MESSAGING_URL, see index.ts) — never probed across dev/prod. Used for
 * the TTS readiness probe behind GET /speaker and, in the speak route, for
 * POST /tts/render.
 */

import type { SpeechHealth } from './speech-health.js';

export interface MessagingHealth {
  configured: boolean;
  /** true/false from the service; null when unreachable or not configured */
  tts: boolean | null;
  /** The speech-health DTO (feature 087); null when unreachable or from a pre-087 messaging service. */
  speech: SpeechHealth | null;
  checkedAt: number;
}

/** Accept the DTO only when it has the fields every consumer relies on. */
function parseSpeech(value: unknown): SpeechHealth | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<SpeechHealth>;
  return typeof v.provider === 'string' && typeof v.ready === 'boolean' ? (v as SpeechHealth) : null;
}

export interface RenderRequest {
  text: string;
  session?: string;
  projectId?: string;
  voiceId?: string;
  format?: 'mp3';
}

export interface RenderResult {
  ok: true;
  voiceId: string | null;
  format: string;
  bytes: number;
  dataBase64: string;
}

export class MessagingError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
    this.name = 'MessagingError';
  }
}

const HEALTH_CACHE_MS = 15_000;
const HEALTH_TIMEOUT_MS = 1_500;
export const DEFAULT_RENDER_TIMEOUT_MS = 25_000;

export class MessagingClient {
  private healthCache: MessagingHealth | null = null;
  private healthInFlight: Promise<MessagingHealth> | null = null;

  constructor(private readonly baseUrl: string | null) {}

  get configured(): boolean {
    return !!this.baseUrl;
  }

  /** Cached readiness probe: at most one request per 15 s. */
  async health(now = Date.now()): Promise<MessagingHealth> {
    if (!this.baseUrl) return { configured: false, tts: null, speech: null, checkedAt: now };
    if (this.healthCache && now - this.healthCache.checkedAt < HEALTH_CACHE_MS) return this.healthCache;
    if (this.healthInFlight) return this.healthInFlight;
    this.healthInFlight = this.probe(now).finally(() => { this.healthInFlight = null; });
    return this.healthInFlight;
  }

  private async probe(now: number): Promise<MessagingHealth> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: ctrl.signal });
      const body = res.ok ? await res.json().catch(() => null) : null;
      const speech = parseSpeech(body?.speech);
      // Prefer the DTO's readiness; fall back to the legacy boolean (pre-087 service).
      const tts = speech ? speech.ready : body && typeof body.tts === 'boolean' ? body.tts : null;
      this.healthCache = { configured: true, tts, speech, checkedAt: now };
    } catch {
      this.healthCache = { configured: true, tts: null, speech: null, checkedAt: now };
    } finally {
      clearTimeout(timer);
    }
    return this.healthCache;
  }

  /** Force the next health() call to re-probe (e.g. after a render failure). */
  invalidateHealth(): void {
    this.healthCache = null;
  }

  /**
   * Render speech to an MP3 buffer via messaging's POST /tts/render.
   * Throws MessagingError with the service's error code where available.
   */
  async render(req: RenderRequest, timeoutMs = DEFAULT_RENDER_TIMEOUT_MS): Promise<RenderResult> {
    if (!this.baseUrl) throw new MessagingError('tts_unavailable', 503, 'messaging service not configured');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/tts/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'mp3', ...req }),
        signal: ctrl.signal,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        const code = typeof body?.error === 'string' ? body.error : 'tts_failed';
        const message = typeof body?.message === 'string' ? body.message : `messaging responded ${res.status}`;
        throw new MessagingError(code, res.status, message);
      }
      if (typeof body.dataBase64 !== 'string' || body.dataBase64.length === 0) {
        throw new MessagingError('tts_failed', 502, 'messaging returned no audio');
      }
      return {
        ok: true,
        voiceId: body.voiceId ?? null,
        format: body.format ?? 'mp3',
        bytes: typeof body.bytes === 'number' ? body.bytes : Buffer.byteLength(body.dataBase64, 'base64'),
        dataBase64: body.dataBase64,
      };
    } catch (err) {
      if (err instanceof MessagingError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new MessagingError('render_timeout', 504, `messaging did not respond within ${timeoutMs} ms`);
      }
      throw new MessagingError('tts_unavailable', 503, `messaging unreachable: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---- Singleton (configured from index.ts via MESSAGING_URL) ---------------

let instance: MessagingClient | null = null;

export function configureMessagingClient(baseUrl: string | null): MessagingClient {
  instance = new MessagingClient(baseUrl);
  return instance;
}

export function getMessagingClient(): MessagingClient {
  if (!instance) instance = new MessagingClient(process.env.MESSAGING_URL || null);
  return instance;
}
