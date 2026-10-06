import type { NavigationTarget, PendingInstructionFileConfirm, Project, ResponseMode } from './types.js';
import { type TtsProviderId, type VoiceRef } from './tts/provider.js';
import type { VoiceRecipe } from './tts/custom-voices.js';
/** A stored voice. ElevenLabs slots stay {id, name}; other providers may carry kind/expiry. */
export interface StoredVoice {
    id: string;
    name: string;
    kind?: VoiceRef['kind'];
    expiresAt?: string;
}
export declare class StateManager {
    private state;
    private voiceId;
    private voiceName;
    private responseMode;
    private voiceTone;
    private voiceEchoEnabled;
    private selectedProvider;
    private selectedModel;
    private providerOverrides;
    private targetPrefs;
    /** Install-level default voice for non-ElevenLabs providers (ElevenLabs: voiceId/voiceName). */
    private defaultVoices;
    /** Explicit install-wide TTS provider switch (null = follow TTS_PROVIDER / auto). */
    private ttsProvider;
    /** Increments on every successful provider switch; pickers use it to reject stale picks. */
    private ttsProviderRevision;
    /** Designed-voice recipes by voice id (feature 087 phase 4), kept after delete so a voice can be recreated. */
    private customVoices;
    private _pendingInstructionFileConfirm;
    private chatId;
    constructor();
    private loadProjects;
    private loadState;
    private saveState;
    /**
     * Persist and THROW on failure. Used by callers whose HTTP/CLI contract
     * must not report success for an in-memory change that would vanish on
     * restart (project voice setter, feature 086). Existing callers keep the
     * log-only saveState().
     */
    private saveStateStrict;
    private writeStateFile;
    getProjects(): Project[];
    getSelectedProject(): Project | null;
    reloadProjects(): void;
    /**
     * For every project in the registry, ensure targetPrefs has explicit values
     * for any field that's currently missing. Anchors with the current top-level
     * (most-recently-set) value at the moment of anchoring. After this runs, a
     * write to one project's voice/mode/tone no longer leaks to other projects
     * via the top-level mirror.
     */
    private anchorProjectsFromRegistry;
    selectGlobal(): void;
    selectProject(projectId: string): Project | null;
    selectCard(projectId: string, cardId: string, stage?: string): Project | null;
    getTarget(): NavigationTarget;
    /**
     * Resolve the canonical sessionKey for the currently-selected project.
     * Reloads the project registry first so a path edit / sessionKey recompute
     * elsewhere is reflected immediately. Falls back to raw projectId when no
     * matching project (preserves old behavior for unmigrated state).
     */
    private currentProjectKey;
    getSessionName(): string;
    /**
     * Alias session names to try alongside getSessionName(). Returns names built
     * from the project's legacy id form (sessionKeyAliases) so messaging can
     * find pre-migration sessions before falling back to creating new ones
     * under the canonical sessionKey.
     */
    getSessionNameAliases(): string[];
    /** Get session name in old format (without provider segment) for backward compat lookups. */
    getLegacySessionName(): string;
    getSessionCwd(): string;
    getSelectedCardId(): string | null;
    /** Returns the project id for the active target, or null when at global. */
    private getCurrentProjectId;
    private prefsFor;
    private writePref;
    private clearPref;
    private slotFor;
    private writeSlot;
    private clearSlot;
    /** Install-level default voice for a provider (the inheritance source). */
    private defaultFor;
    private setDefault;
    private static copy;
    /** Install-wide provider switch as stored (null = follow TTS_PROVIDER / auto) and its revision. */
    getTtsProviderChoice(): {
        provider: TtsProviderId | null;
        revision: number;
    };
    /**
     * Switch the install's TTS provider (explicit choice; beats TTS_PROVIDER).
     * Persists strictly and increments the revision, so any picker list made
     * before the switch is recognisably stale. Returns the new revision.
     */
    setTtsProvider(provider: TtsProviderId): number;
    getVoiceRecipe(id: string): VoiceRecipe | null;
    listVoiceRecipes(): Array<{
        id: string;
        recipe: VoiceRecipe;
    }>;
    /**
     * Save (or patch) a recipe and persist STRICTLY: `voice design` must not
     * report success for a recipe that would vanish on restart. On a failed
     * write the in-memory map is rolled back and the error rethrown.
     */
    saveVoiceRecipe(id: string, recipe: VoiceRecipe): void;
    updateVoiceRecipe(id: string, patch: Partial<VoiceRecipe>): void;
    private withRollback;
    /** Install-level default voice for a provider, or null. */
    getDefaultVoice(provider: TtsProviderId): StoredVoice | null;
    getVoice(provider?: TtsProviderId): StoredVoice | null;
    /**
     * Resolve the project id encoded in a session name's first segment
     * (e.g. "claude-master:claude:card:card-123" → "claude-master"). Returns
     * null for the global session or when no project matches. Accepts session
     * keys, aliases, or canonical ids via resolveCanonicalProjectId.
     */
    private projectIdFromSession;
    /**
     * Voice resolved for a specific session/caller, independent of which target
     * the Telegram UI is currently pointed at. This is what TTS render paths
     * should use: a claude-master automation must render in claude-master's
     * voice even if the user last navigated to a different project. Falls back
     * to the ambient getVoice() when the session has no resolvable project.
     */
    getVoiceForSession(session: string | undefined, provider?: TtsProviderId): StoredVoice | null;
    /** Like getVoiceForSession, but reports where the voice came from (project slot vs install default). */
    resolveSessionSlot(session: string | undefined, provider?: TtsProviderId): {
        voice: StoredVoice | null;
        source: 'project' | 'inherited' | null;
    };
    /**
     * Resolve a project's default voice for a programmatic caller (e.g. the
     * /tts/generate endpoint). Prefers an explicit projectId, then the caller's
     * session. Unlike getVoiceForSession, this does NOT fall back to the ambient
     * Telegram target — when no project context resolves it returns null so the
     * caller falls through to the env default. Both projectId and session may
     * be a canonical id, sessionKey, or alias.
     */
    resolveContextVoice(opts: {
        projectId?: string;
        session?: string;
    }, provider?: TtsProviderId): StoredVoice | null;
    /** Like resolveContextVoice, but reports where the voice came from. */
    resolveContextSlot(opts: {
        projectId?: string;
        session?: string;
    }, provider?: TtsProviderId): {
        voice: StoredVoice | null;
        source: 'project' | 'inherited' | null;
    };
    private projectSlot;
    /**
     * Resolve a project id from an explicit id/name/key or from a session name
     * (first segment). Reloads the registry first so projects added after
     * service start resolve. Returns null when nothing matches.
     */
    resolveProjectIdFrom(opts: {
        projectId?: string;
        session?: string;
    }): string | null;
    /** Stored = the project's own override; effective = stored → install default (env/built-in is the caller's fallback). */
    getProjectVoice(projectId: string, provider?: TtsProviderId): {
        stored: StoredVoice | null;
        effective: StoredVoice | null;
        source: 'project' | 'inherited' | null;
    };
    /** The project's slot for every provider (the switch rewrites none of them). */
    getProjectVoiceSlots(projectId: string): Record<TtsProviderId, {
        stored: StoredVoice | null;
        effective: StoredVoice | null;
        source: 'project' | 'inherited' | null;
    }>;
    /** Writes the slot of the VOICE's provider (default ElevenLabs). */
    setProjectVoice(projectId: string, voice: StoredVoice & {
        provider?: TtsProviderId;
    }): void;
    /**
     * Clear the project's override for one provider. This resets the project to
     * the CURRENT inherited default: anchorProjectsFromRegistry() re-anchors the
     * install default into the entry on the next reload, so "clear" never means
     * "permanently follow the workspace default" nor "force the env voice".
     */
    clearProjectVoice(projectId: string, provider?: TtsProviderId): void;
    /**
     * Apply a change to one project's prefs and persist STRICTLY; when the write
     * fails, put the project's prefs back exactly as they were and rethrow, so
     * memory never claims a voice the file does not have (fix loop, #0369).
     */
    private withProjectRollback;
    /**
     * Set the install default for one provider (web picker, #0376): the voice
     * every project without its own inherits. Strict save with rollback, like
     * setProjectVoice; it touches no project's own slot.
     */
    setInstallDefaultVoice(provider: TtsProviderId, voice: StoredVoice): void;
    /** Telegram /voice selection: writes the target project's slot and MIRRORS into the install default. */
    setVoice(id: string, name: string, provider?: TtsProviderId, extra?: Pick<StoredVoice, 'kind' | 'expiresAt'>): void;
    /** Telegram /voice reset: never mirrors. Project/card target clears only that project's slot; global clears the install default. */
    clearVoice(provider?: TtsProviderId): void;
    getResponseMode(): ResponseMode;
    setResponseMode(mode: ResponseMode): void;
    getVoiceEcho(): boolean;
    setVoiceEcho(enabled: boolean): void;
    getVoiceTone(): string | null;
    setVoiceTone(tone: string | null): void;
    getSelectedProvider(): string;
    setSelectedProvider(provider: string): void;
    getSelectedModel(): string;
    setSelectedModel(model: string): void;
    private getOverrideKey;
    getProviderOverride(): string | null;
    setProviderOverride(provider: string): void;
    clearProviderOverride(): void;
    getChatId(): number | null;
    setChatId(chatId: number): void;
    getPendingInstructionFileConfirm(): PendingInstructionFileConfirm | null;
    setPendingInstructionFileConfirm(pending: PendingInstructionFileConfirm): void;
    clearPendingInstructionFileConfirm(): void;
}
