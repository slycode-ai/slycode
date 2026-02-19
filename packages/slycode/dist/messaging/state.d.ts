import type { NavigationTarget, PendingInstructionFileConfirm, Project, ResponseMode } from './types.js';
export declare class StateManager {
    private state;
    private voiceId;
    private voiceName;
    private responseMode;
    private voiceTone;
    private selectedProvider;
    private _pendingInstructionFileConfirm;
    constructor();
    private loadProjects;
    private loadState;
    private saveState;
    getProjects(): Project[];
    getSelectedProject(): Project | null;
    reloadProjects(): void;
    selectGlobal(): void;
    selectProject(projectId: string): Project | null;
    selectCard(projectId: string, cardId: string, stage?: string): Project | null;
    getTarget(): NavigationTarget;
    getSessionName(): string;
    /** Get session name in old format (without provider segment) for backward compat lookups. */
    getLegacySessionName(): string;
    getSessionCwd(): string;
    getSelectedCardId(): string | null;
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
    getPendingInstructionFileConfirm(): PendingInstructionFileConfirm | null;
    setPendingInstructionFileConfirm(pending: PendingInstructionFileConfirm): void;
    clearPendingInstructionFileConfirm(): void;
}
