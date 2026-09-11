import type { NavigationTarget, PendingInstructionFileConfirm, Project, ResponseMode } from './types.js';
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
    getVoice(): {
        id: string;
        name: string;
    } | null;
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
    getVoiceForSession(session: string | undefined): {
        id: string;
        name: string;
    } | null;
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
    }): {
        id: string;
        name: string;
    } | null;
    /**
     * Resolve a project id from an explicit id/name/key or from a session name
     * (first segment). Reloads the registry first so projects added after
     * service start resolve. Returns null when nothing matches.
     */
    resolveProjectIdFrom(opts: {
        projectId?: string;
        session?: string;
    }): string | null;
    /** Stored = the project's own override; effective = stored → top-level (env default is the caller's fallback). */
    getProjectVoice(projectId: string): {
        stored: {
            id: string;
            name: string;
        } | null;
        effective: {
            id: string;
            name: string;
        } | null;
        source: 'project' | 'inherited' | null;
    };
    setProjectVoice(projectId: string, voice: {
        id: string;
        name: string;
    }): void;
    /**
     * Clear the project's override. This resets the project to the CURRENT
     * inherited default: anchorProjectsFromRegistry() re-anchors the top-level
     * voice into the entry on the next reload, so "clear" never means
     * "permanently follow the workspace default" nor "force the env voice".
     */
    clearProjectVoice(projectId: string): void;
    setVoice(id: string, name: string): void;
    clearVoice(): void;
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
