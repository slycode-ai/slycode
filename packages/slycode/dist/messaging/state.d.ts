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
