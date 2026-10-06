/**
 * Speech-health DTO returned by the messaging service's GET /health as
 * `speech` (feature 087). Type copy of messaging/src/tts/health.ts — the block
 * between the markers must stay byte-identical (messaging/src/tts/health.test.ts
 * checks it). No cross-package imports.
 */
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
