import type { BridgeSessionInfo, BridgeCreateSessionRequest, Channel, InstructionFileCheck } from './types.js';
export declare class BridgeClient {
    private baseUrl;
    constructor(bridgeUrl: string);
    getSession(name: string): Promise<BridgeSessionInfo | null>;
    listSessions(): Promise<BridgeSessionInfo[]>;
    /**
     * Get sessions for a project, matching the first session-name segment
     * against any of the provided keys. Pass just a projectId for backward
     * compat (matches that single key); pass a key array to support aliases
     * (e.g. canonical sessionKey + legacy project.id form).
     */
    getProjectSessions(projectIdOrKeys: string | string[]): Promise<BridgeSessionInfo[]>;
    /** Get card IDs with currently active sessions (isActive from /stats). */
    getActiveCardSessions(projectIds: string[]): Promise<Set<string>>;
    /** Get lastActive timestamps for card sessions (from /sessions, includes stopped). */
    getCardSessionRecency(projectIds: string[]): Promise<Map<string, string>>;
    createSession(request: BridgeCreateSessionRequest): Promise<BridgeSessionInfo>;
    sendInput(name: string, data: string): Promise<boolean>;
    sendImage(name: string, filePath: string, cwd?: string, aliases?: string[]): Promise<{
        filename: string;
    }>;
    stopSession(name: string, aliases?: string[]): Promise<{
        stopped: boolean;
        reason?: string;
    }>;
    getGitStatus(cwd: string): Promise<{
        branch: string | null;
        uncommitted: number;
    } | null>;
    checkInstructionFile(provider: string, cwd: string): Promise<InstructionFileCheck>;
    /**
     * Try canonical name first, then each alias. Returns whichever exists on
     * the bridge (running, detached, or stopped with persisted state). Returns
     * null when none of the candidates are known to the bridge.
     *
     * Error handling: bridge-down errors abort the whole search (no point
     * trying further candidates against an unreachable bridge). Per-candidate
     * HTTP errors (e.g. transient 5xx on one specific name) log and continue
     * so a single bad response doesn't prevent finding the alias session.
     *
     * Public so callers (stop/restart/sendImage/sendInput) can pre-resolve
     * before performing direct ops, since those endpoints require the exact
     * stored name.
     */
    resolveExistingSession(canonical: string, aliases?: string[]): Promise<{
        name: string;
        info: BridgeSessionInfo;
    } | null>;
    ensureSession(sessionName: string, cwd: string, provider?: string, prompt?: string, createInstructionFile?: boolean, model?: string, aliases?: string[]): Promise<{
        session: BridgeSessionInfo;
        permissionMismatch?: boolean;
    }>;
    sendMessage(sessionName: string, cwd: string, message: string, provider?: string, createInstructionFile?: boolean, model?: string, aliases?: string[]): Promise<{
        permissionMismatch?: boolean;
    }>;
    restartSession(sessionName: string, cwd: string, provider: string, prompt?: string, model?: string, aliases?: string[]): Promise<BridgeSessionInfo>;
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
