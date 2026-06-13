import type { NavigationTarget, PendingInstructionFileConfirm, Project, ResponseMode } from './types.js';
export declare class StateManager {
    private state;
    private voiceId;
    private voiceName;
    private responseMode;
    private voiceTone;
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
    setVoice(id: string, name: string): void;
    clearVoice(): void;
    getResponseMode(): ResponseMode;
    setResponseMode(mode: ResponseMode): void;
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
