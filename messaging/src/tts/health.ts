/**
 * Speech health: ONE DTO for every consumer (feature 087).
 *
 * Defined here; identical type copies live in bridge/src/speech-health.ts and
 * web/src/lib/speech-health.ts (LOCKSTEP block below, checked by
 * tts/health.test.ts — no cross-package imports). Consumers:
 * the bridge messaging client and GET /speaker, the web health proxy,
 * useSpeakerController and VoiceSettingsPopover.
 *
 * Readiness is NOT key presence and NOT voice coverage:
 *   ready = the active provider exists in this build, its key is set and (for
 *   providers that need them) its encoders load. Voice problems (no install
 *   default, expiring custom voices) only affect some projects, so they are
 *   warnings naming those projects — never `ready: false`.
 */
import type { VoiceConfig } from '../types.js';
import {
  PROVIDER_KEY_ENV, PROVIDER_LABELS, PROVIDER_VOICE_ENV, TTS_PROVIDER_IDS,
  type ActiveProvider, type TtsProviderId, type TtsProviderRegistry,
} from './provider.js';

// --- DTO (LOCKSTEP block: copied verbatim to bridge/src/speech-health.ts and web/src/lib/speech-health.ts) ---
export type SpeechProviderId = 'elevenlabs' | 'gemini';
export type SpeechProviderSource = 'state' | 'env' | 'auto';
export type SpeechReasonCode = 'no_key' | 'provider_unavailable' | 'encoder_unavailable' | 'messaging_down';

export interface SpeechProviderStatus {
  /** Key present in .env. */
  configured: boolean;
  /** Provider exists in this build. */
  available: boolean;
  defaultVoice: { id: string; name: string } | null;
  defaultVoiceSource: 'state' | 'env' | 'builtin' | null;
}

export interface SpeechHealth {
  /** The ONE name for the active provider, everywhere. */
  provider: SpeechProviderId;
  providerSource: SpeechProviderSource;
  /** Install-wide provider switch revision (pickers reject stale picks with it). */
  revision: number;
  /** The active provider can render at all (exists, key set, encoders load). Voice gaps are warnings, never readiness. */
  ready: boolean;
  /** Why not ready; show `message` exactly as given. */
  reason: { code: SpeechReasonCode; message: string } | null;
  providers: Record<SpeechProviderId, SpeechProviderStatus>;
  warnings: string[];
}
// --- end DTO ---

export interface SpeechHealthInput {
  active: ActiveProvider;
  registry: TtsProviderRegistry;
  config: VoiceConfig;
  revision: number;
  /** Install-level default voice stored in messaging-state.json, per provider. */
  storedDefault: (provider: TtsProviderId) => { id: string; name: string } | null;
  /** Names of registered projects with no voice of their own for this provider. */
  projectsWithoutVoice: (provider: TtsProviderId) => string[];
  /** Ready-made warnings for the active provider's designed voices near or past expiry (phase 4). */
  expiryWarnings?: (provider: TtsProviderId) => string[];
  /** WASM encoder load state (only matters for providers that return PCM). */
  encoder?: { state: 'unknown' | 'ready' | 'failed'; error?: string };
}

function keyFor(config: VoiceConfig, provider: TtsProviderId): string {
  return provider === 'elevenlabs' ? config.elevenlabsApiKey : config.geminiApiKey;
}

export function buildSpeechHealth(input: SpeechHealthInput): SpeechHealth {
  const { active, registry, config } = input;
  const providers = {} as Record<TtsProviderId, SpeechProviderStatus>;
  for (const id of TTS_PROVIDER_IDS) {
    const adapter = registry[id];
    const stored = input.storedDefault(id);
    const env = adapter?.envDefaultVoice() ?? null;
    const builtin = adapter?.builtinDefaultVoice() ?? null;
    const defaultVoice = stored ?? (env ? { id: env.id, name: env.name } : builtin ? { id: builtin.id, name: builtin.name } : null);
    providers[id] = {
      configured: !!keyFor(config, id),
      available: !!adapter,
      defaultVoice,
      defaultVoiceSource: stored ? 'state' : env ? 'env' : builtin ? 'builtin' : null,
    };
  }

  const label = PROVIDER_LABELS[active.id];
  let reason: SpeechHealth['reason'] = null;
  if (!active.provider) {
    reason = {
      code: 'provider_unavailable',
      message: `TTS provider (${label}) is not available in this version of SlyCode. Switch with \`sly-messaging tts provider elevenlabs\` or update SlyCode.`,
    };
  } else if (!providers[active.id].configured) {
    reason = {
      code: 'no_key',
      message: `TTS provider (${label}): ${PROVIDER_KEY_ENV[active.id]} is not set. Add it to .env and restart the messaging service.`,
    };
  } else if (!active.provider.nativeSpeed && input.encoder?.state === 'failed') {
    reason = {
      code: 'encoder_unavailable',
      message: `TTS provider (${label}): the audio encoders failed to load (${input.encoder.error ?? 'unknown error'}). Reinstall SlyCode (npm install) and restart the messaging service.`,
    };
  }

  const warnings: string[] = [];
  if (!reason && !providers[active.id].defaultVoice) {
    const missing = input.projectsWithoutVoice(active.id);
    if (missing.length > 0) {
      warnings.push(
        `No install-level ${label} default voice: ${missing.length === 1 ? '1 project has' : `${missing.length} projects have`} no ${label} voice and can't speak (${missing.join(', ')}). Set ${PROVIDER_VOICE_ENV[active.id]} in .env or run \`sly-messaging voice set <voice> --project <project>\`.`,
      );
    }
  }

  if (input.expiryWarnings) warnings.push(...input.expiryWarnings(active.id));

  return {
    provider: active.id,
    providerSource: active.source,
    revision: input.revision,
    ready: reason === null,
    reason,
    providers,
    warnings,
  };
}
