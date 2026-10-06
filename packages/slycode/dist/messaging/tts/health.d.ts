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
import { type ActiveProvider, type TtsProviderId, type TtsProviderRegistry } from './provider.js';
export type SpeechProviderId = 'elevenlabs' | 'gemini';
export type SpeechProviderSource = 'state' | 'env' | 'auto';
export type SpeechReasonCode = 'no_key' | 'provider_unavailable' | 'encoder_unavailable' | 'messaging_down';
export interface SpeechProviderStatus {
    /** Key present in .env. */
    configured: boolean;
    /** Provider exists in this build. */
    available: boolean;
    defaultVoice: {
        id: string;
        name: string;
    } | null;
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
    reason: {
        code: SpeechReasonCode;
        message: string;
    } | null;
    providers: Record<SpeechProviderId, SpeechProviderStatus>;
    warnings: string[];
}
export interface SpeechHealthInput {
    active: ActiveProvider;
    registry: TtsProviderRegistry;
    config: VoiceConfig;
    revision: number;
    /** Install-level default voice stored in messaging-state.json, per provider. */
    storedDefault: (provider: TtsProviderId) => {
        id: string;
        name: string;
    } | null;
    /** Names of registered projects with no voice of their own for this provider. */
    projectsWithoutVoice: (provider: TtsProviderId) => string[];
    /** Ready-made warnings for the active provider's designed voices near or past expiry (phase 4). */
    expiryWarnings?: (provider: TtsProviderId) => string[];
    /** WASM encoder load state (only matters for providers that return PCM). */
    encoder?: {
        state: 'unknown' | 'ready' | 'failed';
        error?: string;
    };
}
export declare function buildSpeechHealth(input: SpeechHealthInput): SpeechHealth;
