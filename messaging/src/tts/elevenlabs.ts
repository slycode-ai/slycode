/**
 * ElevenLabs TTS adapter (feature 087; behaviour moved verbatim from
 * messaging/src/tts.ts and voices.ts).
 *
 * BYTE-IDENTITY: the request URL, headers and body are pinned by
 * tts/elevenlabs.golden.test.ts against captures from the pre-refactor code.
 */
import type { VoiceConfig } from '../types.js';
import { toElevenLabsText } from './speech-markup.js';
import type { ProviderRenderRequest, SourceAudio, TtsProvider, VoiceInfo, VoiceQuery, VoiceRef } from './provider.js';
import { VoiceLookupError } from './errors.js';
import { RenderCancelledError, VoicesUnavailableError } from './errors.js';

export const ELEVENLABS_MODEL_ID = 'eleven_v3';
/** Max concurrent ElevenLabs requests (the plan's hard cap is 3); extra callers queue. */
export const ELEVENLABS_CONCURRENCY = 2;

const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75 } as const;

export class ElevenLabsProvider implements TtsProvider {
  readonly id = 'elevenlabs' as const;
  readonly label = 'ElevenLabs';
  readonly model = ELEVENLABS_MODEL_ID;
  /** Single request per render: every SlyCode cap (speak, /voice, generate) is within ElevenLabs' limit. */
  readonly maxRenderChars = Number.POSITIVE_INFINITY;
  readonly concurrency = ELEVENLABS_CONCURRENCY;
  /** Speed goes in the request body (voice_settings.speed). */
  readonly nativeSpeed = true;

  constructor(private readonly config: VoiceConfig, private readonly fetchImpl?: typeof fetch) {}

  isConfigured(): boolean {
    return !!this.config.elevenlabsApiKey;
  }

  envDefaultVoice(): VoiceRef | null {
    return this.config.elevenlabsVoiceId
      ? { provider: 'elevenlabs', id: this.config.elevenlabsVoiceId, name: 'env default' }
      : null;
  }

  builtinDefaultVoice(): VoiceRef | null {
    return null;
  }

  cacheKeyParts(): unknown[] {
    return [ELEVENLABS_MODEL_ID, { ...VOICE_SETTINGS, speed: this.config.elevenlabsSpeed }];
  }

  async render(req: ProviderRenderRequest): Promise<SourceAudio> {
    // Resolve fetch at call time so tests can stub globalThis.fetch.
    const doFetch = this.fetchImpl ?? globalThis.fetch;
    const abortError = (): Error =>
      req.signal.reason instanceof Error ? req.signal.reason : new RenderCancelledError();
    if (req.signal.aborted) throw abortError();
    let response: Response;
    try {
      response = await doFetch(`https://api.elevenlabs.io/v1/text-to-speech/${req.voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.config.elevenlabsApiKey,
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: toElevenLabsText(req.chunk.script),
          model_id: ELEVENLABS_MODEL_ID,
          voice_settings: {
            stability: VOICE_SETTINGS.stability,
            similarity_boost: VOICE_SETTINGS.similarity_boost,
            speed: this.config.elevenlabsSpeed,
          },
          output_format: 'mp3_44100_128',
        }),
        signal: req.signal,
      });
    } catch (err) {
      if (req.signal.aborted) throw abortError();
      throw err;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
    }

    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await response.arrayBuffer();
    } catch (err) {
      if (req.signal.aborted) throw abortError();
      throw err;
    }
    return { kind: 'mp3', data: Buffer.from(arrayBuffer) };
  }

  async searchVoices(query: VoiceQuery, opts: { strict?: boolean } = {}): Promise<VoiceInfo[]> {
    const rows = opts.strict
      ? await searchElevenLabsVoicesStrict(this.config.elevenlabsApiKey, query.text)
      : await searchElevenLabsVoices(this.config.elevenlabsApiKey, query.text);
    return rows.map(v => ({ ...v, provider: 'elevenlabs' as const }));
  }

  /**
   * What a user typed → a voice. Unchanged from feature 086: a 20-character
   * id is taken as an id (ElevenLabs ids are not re-verified); anything else
   * must match exactly ONE voice name (case-insensitive) in a strict search.
   */
  async resolveVoiceValue(value: string): Promise<VoiceRef> {
    const wanted = value.trim();
    if (ELEVENLABS_ID_PATTERN.test(wanted)) return { provider: 'elevenlabs', id: wanted, name: wanted };
    const candidates = await this.searchVoices({ text: wanted }, { strict: true });
    const exact = candidates.filter(v => v.name.trim().toLowerCase() === wanted.toLowerCase());
    if (exact.length === 1) return { provider: 'elevenlabs', id: exact[0].voice_id, name: exact[0].name };
    if (exact.length === 0) {
      throw new VoiceLookupError('voice_not_found', `No voice named exactly '${wanted}'. Use \`sly-messaging voices "${wanted}"\` to list candidates and set by id.`, candidates.slice(0, 10));
    }
    throw new VoiceLookupError('voice_ambiguous', `${exact.length} voices are named '${wanted}'; set by id instead.`, exact);
  }
}

/** ElevenLabs voice ids are 20 alphanumeric characters. */
export const ELEVENLABS_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

// --- Voice search (moved from voices.ts; messaging/src/voices.ts re-exports) ---

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description: string;
  labels: Record<string, string>;
  /** ElevenLabs' sample clip (https), when the API gives one. */
  preview_url?: string;
}

async function fetchVoiceList(url: string, headers: Record<string, string>, fallbackCategory: string): Promise<ElevenLabsVoice[]> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new VoicesUnavailableError(`ElevenLabs voices request failed (${res.status}) for ${url}`);
  const data = await res.json();
  return (data.voices || []).map((v: any) => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category || fallbackCategory,
    description: v.description || '',
    labels: v.labels || {},
    // The library's own sample clip; the web picker plays it instead of a paid render.
    ...(typeof v.preview_url === 'string' && /^https:\/\//.test(v.preview_url) ? { preview_url: v.preview_url } : {}),
  }));
}

function mergeVoices(personal: ElevenLabsVoice[], shared: ElevenLabsVoice[]): ElevenLabsVoice[] {
  const seen = new Set<string>();
  const merged: ElevenLabsVoice[] = [];
  for (const v of [...personal, ...shared]) {
    if (!seen.has(v.voice_id)) {
      seen.add(v.voice_id);
      merged.push(v);
    }
  }
  return merged;
}

/**
 * Like searchElevenLabsVoices but an upstream failure (network, non-2xx)
 * THROWS VoicesUnavailableError instead of degrading to an empty list, so
 * callers that need to distinguish "no such voice" from "could not ask" (the
 * project voice setter, feature 086) never report an outage as "not found".
 */
export async function searchElevenLabsVoicesStrict(apiKey: string, query?: string): Promise<ElevenLabsVoice[]> {
  const headers = { 'xi-api-key': apiKey };
  const personalParams = new URLSearchParams({ page_size: '10' });
  const sharedParams = new URLSearchParams({ page_size: '10' });
  if (query) {
    personalParams.set('search', query);
    sharedParams.set('search', query);
  }
  try {
    const [personal, shared] = await Promise.all([
      fetchVoiceList(`https://api.elevenlabs.io/v2/voices?${personalParams}`, headers, 'personal'),
      fetchVoiceList(`https://api.elevenlabs.io/v1/shared-voices?${sharedParams}`, headers, 'community'),
    ]);
    return mergeVoices(personal, shared);
  } catch (err) {
    if (err instanceof VoicesUnavailableError) throw err;
    throw new VoicesUnavailableError(`ElevenLabs voices unavailable: ${(err as Error).message}`);
  }
}

/** Lenient search (Telegram picker): an upstream failure degrades to an empty list. */
export async function searchElevenLabsVoices(apiKey: string, query?: string): Promise<ElevenLabsVoice[]> {
  const headers = { 'xi-api-key': apiKey };
  const lenient = (url: string, fallbackCategory: string) =>
    fetchVoiceList(url, headers, fallbackCategory).catch(() => [] as ElevenLabsVoice[]);
  const personalParams = new URLSearchParams({ page_size: '10' });
  const sharedParams = new URLSearchParams({ page_size: '10' });
  if (query) {
    personalParams.set('search', query);
    sharedParams.set('search', query);
  }
  const [personal, shared] = await Promise.all([
    lenient(`https://api.elevenlabs.io/v2/voices?${personalParams}`, 'personal'),
    lenient(`https://api.elevenlabs.io/v1/shared-voices?${sharedParams}`, 'community'),
  ]);
  return mergeVoices(personal, shared);
}
