/**
 * Per-process TTS runtime (feature 087): the provider registry, the shared
 * SpeechRenderer and the install-wide resolution rules, bound to the
 * messaging state. index.ts routes and the Telegram commands go through this
 * so every path resolves provider and voice the same way.
 */
import type { StateManager } from '../state.js';
import type { VoiceConfig } from '../types.js';
import { SpeechRenderer } from '../tts-render.js';
import { type SpeechHealth } from './health.js';
import { type ActiveProvider, type TtsProvider, type TtsProviderId, type TtsProviderRegistry, type VoiceRef, type VoiceSource } from './provider.js';
export interface SwitchProblem {
    projectId: string;
    projectName: string;
    voice: {
        id: string;
        name: string;
    } | null;
    reason: string;
    fix: string;
}
export interface SwitchCheck {
    ok: boolean;
    status: number;
    error?: 'provider_unavailable' | 'provider_unconfigured' | 'unusable_voices';
    message?: string;
    refusals: SwitchProblem[];
    unverified: SwitchProblem[];
}
export interface ResolvedVoice {
    voice: VoiceRef;
    source: VoiceSource;
}
export declare class TtsRuntime {
    readonly config: VoiceConfig;
    private readonly state;
    readonly registry: TtsProviderRegistry;
    readonly renderer: SpeechRenderer;
    constructor(config: VoiceConfig, state: StateManager, opts?: {
        registry?: TtsProviderRegistry;
        renderer?: SpeechRenderer;
    });
    /** The install's active provider right now (state switch → TTS_PROVIDER → auto). */
    active(): ActiveProvider;
    revision(): number;
    health(): SpeechHealth;
    /**
     * Designed voices within EXPIRY_WARNING_DAYS of expiry (or past it) for a
     * provider, one line per voice naming everything that uses it (projects,
     * the install default). The fix suggests --recreate only with a recipe.
     */
    expiryWarnings(provider: TtsProviderId, now?: number): string[];
    /** The active provider, or a TtsProviderError('tts_unconfigured') carrying the health reason. */
    requireActive(): TtsProvider;
    /**
     * A specific provider for a caller that names one (e.g. `voice set --provider`),
     * defaulting to the active one. Unknown or unavailable providers fail loudly.
     */
    providerFor(requested: unknown): TtsProvider;
    /** Voice for a render triggered by a session (Telegram /voice): explicit → project/ambient slot → env → built-in. */
    voiceForSession(provider: TtsProvider, session: string | undefined, explicit?: string): ResolvedVoice;
    /** Voice for a programmatic render (speak, generate): explicit → project/session slot → env → built-in. */
    voiceForContext(provider: TtsProvider, ctx: {
        projectId?: string;
        session?: string;
    }, explicit?: string): ResolvedVoice;
    /**
     * Check a switch to `target` against what is known (design §2). Refusals:
     * no key; a project with no voice at all; a stored voice that is expired
     * (by its stored expiresAt) or confirmed missing; an invalid env default
     * that some project would use. Voices that cannot be checked because the
     * provider is unreachable are reported as `unverified` and do not block.
     * ElevenLabs ids are not re-verified (no expiry; they were in use).
     */
    validateSwitch(target: TtsProviderId, now?: number): Promise<SwitchCheck>;
    /** Validate, then switch. Returns the check (with the new health on success). */
    switchProvider(target: TtsProviderId): Promise<SwitchCheck & {
        health?: SpeechHealth;
    }>;
    /** Raw TTS_PROVIDER value that was set but not understood (for a startup warning), else null. */
    invalidProviderEnv(): string | null;
    providerIds(): TtsProviderId[];
}
