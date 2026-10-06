/**
 * TTS provider contract, registry and install-wide resolution (feature 087).
 *
 * One provider is active per install. The messaging service renders every
 * speech path (Telegram /voice, terminal speak via /tts/render, generate)
 * through the active provider. Phase 1 registers ElevenLabs only; Gemini
 * joins the registry in phase 2.
 */
import type { VoiceConfig } from '../types.js';
import type { SpeechScript, SpeechStyle } from './speech-markup.js';
import { ElevenLabsProvider } from './elevenlabs.js';
import { GeminiProvider } from './gemini.js';
import { TtsProviderError } from './errors.js';

export type TtsProviderId = 'elevenlabs' | 'gemini';
export const TTS_PROVIDER_IDS: readonly TtsProviderId[] = ['elevenlabs', 'gemini'];

export const PROVIDER_LABELS: Record<TtsProviderId, string> = { elevenlabs: 'ElevenLabs', gemini: 'Gemini' };
export const PROVIDER_KEY_ENV: Record<TtsProviderId, string> = { elevenlabs: 'ELEVENLABS_API_KEY', gemini: 'GEMINI_API_KEY' };
export const PROVIDER_VOICE_ENV: Record<TtsProviderId, string> = { elevenlabs: 'ELEVENLABS_VOICE_ID', gemini: 'GEMINI_TTS_VOICE' };

export function isTtsProviderId(v: unknown): v is TtsProviderId {
  return typeof v === 'string' && (TTS_PROVIDER_IDS as readonly string[]).includes(v);
}

/** A voice as stored and passed around: always tied to its provider. */
export interface VoiceRef {
  provider: TtsProviderId;
  id: string;
  name: string;
  kind?: 'prebuilt' | 'library' | 'personal' | 'custom';
  /** Gemini custom voices expire (1-year TTL). */
  expiresAt?: string;
}

/**
 * Search result row. Keeps the pre-087 ElevenLabs field names (`voice_id`,
 * `name`, `category`, `description`, `labels`) so the CLI, the Telegram picker
 * and `/voices/search` callers keep working, plus `provider`.
 */
export interface VoiceInfo {
  provider: TtsProviderId;
  voice_id: string;
  name: string;
  category: string;
  description: string;
  labels: Record<string, string>;
  expiresAt?: string;
  /** A ready-made sample clip (ElevenLabs library voices); Gemini has none, so previews render. */
  preview_url?: string;
}

/** What a provider returns before SlyCode encodes it. */
export type SourceAudio =
  | { kind: 'mp3'; data: Buffer }
  | { kind: 'pcm'; data: Buffer; sampleRate: number; channels: 1 };

export type AudioFormat = 'ogg' | 'mp3' | 'wav';

/** One provider request's worth of speech, with the style it inherits from earlier text. */
export interface ScriptChunk {
  text: string;
  script: SpeechScript;
  inheritedStyle: SpeechStyle;
  gapAfterMs: number;
}

export interface ProviderRenderRequest {
  chunk: ScriptChunk;
  voiceId: string;
  signal: AbortSignal;
  /** The caller's deadline (rate-limit waits must fit inside it). */
  deadlineAt?: number;
  /** Retry once after a provider 429 when it fits the deadline (Telegram, generate — never speak). */
  retryOn429?: boolean;
  /**
   * Live policy of a shared (coalesced) render; when present it overrides
   * deadlineAt/retryOn429 and is read at decision time, so a render follows
   * its live waiters rather than the caller that started it.
   */
  policy?: { deadlineAt(): number; retryOn429(): boolean };
}

export interface VoiceQuery {
  text?: string;
  gender?: string;
  accent?: string;
  /** Exact language code (en-GB) or a prefix (en). */
  language?: string;
  /** Only custom (designed) voices. */
  custom?: boolean;
}

export { VoiceLookupError } from './errors.js';

export interface TtsProvider {
  readonly id: TtsProviderId;
  readonly label: string;
  readonly model: string;
  /** Max characters per provider request; longer text is chunked (phase 2). */
  readonly maxRenderChars: number;
  /** Concurrent provider requests allowed (per-provider semaphore). */
  readonly concurrency: number;
  /** True when the provider applies the speaking speed itself (ElevenLabs); otherwise SlyCode time-stretches. */
  readonly nativeSpeed: boolean;
  isConfigured(): boolean;
  /** Voice from .env (ELEVENLABS_VOICE_ID / GEMINI_TTS_VOICE), or null. */
  envDefaultVoice(): VoiceRef | null;
  /** Built-in fallback when nothing else is set (Gemini: library voice Zuri, en-us-zuri; ElevenLabs: none). */
  builtinDefaultVoice(): VoiceRef | null;
  render(req: ProviderRenderRequest): Promise<SourceAudio>;
  /** `strict`: an upstream failure throws VoicesUnavailableError instead of returning []. */
  searchVoices(query: VoiceQuery, opts?: { strict?: boolean }): Promise<VoiceInfo[]>;
  /**
   * Look a voice up by id: VoiceInfo, null when the provider says it does not
   * exist, or undefined when this provider cannot verify ids (ElevenLabs).
   * Throws VoicesUnavailableError when the provider cannot be reached.
   */
  getVoice?(id: string): Promise<VoiceInfo | null | undefined>;
  /** Resolve what a user typed (id or exact name) to a voice; throws VoiceLookupError. */
  resolveVoiceValue(value: string): Promise<VoiceRef>;
  /** Everything provider-side that changes the audio bytes (model, settings). */
  cacheKeyParts(): unknown[];
  /** Design a voice from a text description (Gemini; feature 087 phase 4). */
  designVoice?(req: VoiceDesignRequest): Promise<DesignedVoice>;
  /** Clone a voice from a sample plus a spoken consent statement (Gemini; #0376). */
  cloneVoice?(req: VoiceCloneRequest): Promise<DesignedVoice>;
  /** Delete a designed voice at the provider; false when it was already gone. */
  deleteVoice?(id: string): Promise<boolean>;
  /** The recipe the provider still holds for a designed voice (null once deleted or unknown). */
  remoteRecipe?(id: string): Promise<{ name: string; description: string; gender?: string; language?: string; expiresAt?: string } | null>;
}

export interface VoiceDesignRequest {
  description: string;
  name: string;
  gender?: string;
  language?: string;
}

/**
 * Two recordings of the same adult speaker, 16-bit mono WAV (24 kHz
 * recommended): a 10–30 s sample and the consent statement. Used for the
 * create call only, never stored (owner ruling, #0376).
 */
export interface VoiceCloneRequest {
  name: string;
  sample: Buffer;
  consent: Buffer;
}

export interface DesignedVoice {
  id: string;
  name: string;
  expiresAt?: string;
  model: string;
  /** The provider's sample clip, decoded to PCM (Gemini returns a WAV). */
  sample: SourceAudio | null;
}

export { TtsProviderError, VoicesUnavailableError } from './errors.js';

export type TtsProviderRegistry = { elevenlabs: TtsProvider } & Partial<Record<TtsProviderId, TtsProvider>>;

/** Build the providers available in this build: ElevenLabs and Gemini (feature 087). */
export function createTtsProviders(config: VoiceConfig, opts: { fetchImpl?: typeof fetch } = {}): TtsProviderRegistry {
  return { elevenlabs: new ElevenLabsProvider(config, opts.fetchImpl), gemini: new GeminiProvider(config, { fetchImpl: opts.fetchImpl }) };
}

export type ProviderSource = 'state' | 'env' | 'auto';

export interface ActiveProvider {
  id: TtsProviderId;
  source: ProviderSource;
  /** null when the chosen provider is not available in this build. */
  provider: TtsProvider | null;
}

/** Parse TTS_PROVIDER; anything unrecognised is ignored (null). */
export function parseProviderEnv(raw: string | undefined): TtsProviderId | null {
  const v = (raw ?? '').trim().toLowerCase();
  return isTtsProviderId(v) ? v : null;
}

/**
 * Install-wide provider: explicit switch stored in messaging-state.json, else
 * TTS_PROVIDER from .env, else auto (ElevenLabs if its key is set, else Gemini
 * if its key is set, else ElevenLabs). Existing installs have neither of the
 * first two and an ElevenLabs key, so they stay on ElevenLabs.
 */
export function resolveActiveProvider(
  stored: TtsProviderId | null,
  config: VoiceConfig,
  registry: TtsProviderRegistry,
): ActiveProvider {
  let id: TtsProviderId;
  let source: ProviderSource;
  const fromEnv = parseProviderEnv(config.ttsProviderEnv);
  if (stored) {
    id = stored;
    source = 'state';
  } else if (fromEnv) {
    id = fromEnv;
    source = 'env';
  } else {
    source = 'auto';
    id = config.elevenlabsApiKey ? 'elevenlabs' : config.geminiApiKey ? 'gemini' : 'elevenlabs';
  }
  return { id, source, provider: registry[id] ?? null };
}

export type VoiceSource = 'explicit' | 'project' | 'inherited' | 'env' | 'builtin';

/**
 * Voice resolution for one provider: explicit → project slot → install default
 * → env default → built-in. Only an EMPTY step falls through; an unusable
 * stored voice is never skipped silently (it fails loudly at render time).
 */
export function resolveVoice(
  provider: TtsProvider,
  steps: { explicit?: string; slot?: { voice: { id: string; name: string } | null; source: 'project' | 'inherited' | null } },
): { voice: VoiceRef; source: VoiceSource } {
  if (steps.explicit) {
    return { voice: { provider: provider.id, id: steps.explicit, name: steps.explicit }, source: 'explicit' };
  }
  const slot = steps.slot;
  if (slot?.voice && slot.source) {
    return { voice: { ...slot.voice, provider: provider.id }, source: slot.source };
  }
  const env = provider.envDefaultVoice();
  if (env) return { voice: env, source: 'env' };
  const builtin = provider.builtinDefaultVoice();
  if (builtin) return { voice: builtin, source: 'builtin' };
  throw new TtsProviderError(
    'no_voice',
    `TTS provider (${provider.label}): no voice to speak with. Set ${PROVIDER_VOICE_ENV[provider.id]} in .env or run \`sly-messaging voice set <voice> --provider ${provider.id}\`.`,
  );
}
