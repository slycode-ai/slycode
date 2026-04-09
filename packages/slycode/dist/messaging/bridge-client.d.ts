import type { BridgeSessionInfo, BridgeCreateSessionRequest, Channel, InstructionFileCheck } from './types.js';
export declare class BridgeClient {
    private baseUrl;
    constructor(bridgeUrl: string);
    getSession(name: string): Promise<BridgeSessionInfo | null>;
    listSessions(): Promise<BridgeSessionInfo[]>;
    getProjectSessions(projectId: string): Promise<BridgeSessionInfo[]>;
    /** Get card IDs with currently active sessions (isActive from /stats). */
    getActiveCardSessions(projectIds: string[]): Promise<Set<string>>;
    /** Get lastActive timestamps for card sessions (from /sessions, includes stopped). */
    getCardSessionRecency(projectIds: string[]): Promise<Map<string, string>>;
    createSession(request: BridgeCreateSessionRequest): Promise<BridgeSessionInfo>;
    sendInput(name: string, data: string): Promise<boolean>;
    sendImage(name: string, filePath: string, cwd?: string): Promise<{
        filename: string;
    }>;
    stopSession(name: string): Promise<{
        stopped: boolean;
        reason?: string;
    }>;
    getGitStatus(cwd: string): Promise<{
        branch: string | null;
        uncommitted: number;
    } | null>;
    checkInstructionFile(provider: string, cwd: string): Promise<InstructionFileCheck>;
    ensureSession(sessionName: string, cwd: string, provider?: string, prompt?: string, createInstructionFile?: boolean, model?: string): Promise<{
        session: BridgeSessionInfo;
        permissionMismatch?: boolean;
    }>;
    sendMessage(sessionName: string, cwd: string, message: string, provider?: string, createInstructionFile?: boolean, model?: string): Promise<{
        permissionMismatch?: boolean;
    }>;
    restartSession(sessionName: string, cwd: string, provider: string, prompt?: string, model?: string): Promise<BridgeSessionInfo>;
    /**
     * Poll bridge stats and send typing indicators while session is active.
     * Returns when the session stops producing output.
     */
    watchActivity(sessionName: string, channel: Channel): Promise<void>;
    /**
     * Start a persistent background monitor that sends typing indicators
     * whenever the targeted session is actively producing output.
     * Polls every 4 seconds (Telegram typing expires after ~5s).
     */
    startActivityMonitor(getSessionName: () => string, channel: Channel): void;
}
