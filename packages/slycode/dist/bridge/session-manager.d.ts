import type { WebSocket } from 'ws';
import type { Response } from 'express';
import type { SessionInfo, CreateSessionRequest, BridgeConfig, BridgeRuntimeConfig, BridgeStats, ActivityTransition, SubmitRequest, SubmitResult, SnapshotResult } from './types.js';
import type { ResponseStore } from './response-store.js';
export declare class SessionManager {
    private sessions;
    private config;
    private runtimeConfig;
    private persistedState;
    private idleCheckTimer;
    private sseHeartbeatTimer;
    constructor(config?: Partial<BridgeConfig>, runtimeConfig?: BridgeRuntimeConfig);
    init(): Promise<void>;
    /**
     * Gracefully shutdown all sessions
     */
    shutdown(): Promise<void>;
    /**
     * Start periodic idle timeout checker
     */
    private startIdleChecker;
    /**
     * Start SSE heartbeat — sends named events to keep connections alive
     * through proxies (Tailscale Serve, Next.js API proxy) that drop idle streams.
     * Uses named events (not SSE comments) so the browser's EventSource API
     * dispatches them to JavaScript handlers, keeping lastConnected fresh.
     */
    private startSSEHeartbeat;
    /**
     * Check for and terminate idle sessions
     */
    private checkIdleSessions;
    private loadPersistedState;
    private savePersistedState;
    private extractGroup;
    /**
     * Convert a new-format session name to old format by removing the provider segment.
     * New: {project}:{provider}:card:{cardId} → Old: {project}:card:{cardId}
     * New: {project}:{provider}:global → Old: {project}:global
     * Returns null if name is not in new format.
     */
    private toLegacySessionName;
    /**
     * Resolve a session name, falling back to legacy format (without provider segment)
     * for backward compatibility with sessions created before multi-provider support.
     */
    resolveSessionName(name: string): string;
    createSession(request: CreateSessionRequest): Promise<SessionInfo>;
    /**
     * Background task to detect provider session ID after spawn
     */
    private detectProviderSessionId;
    private handlePtyOutput;
    /**
     * Deliver a deferred prompt to the PTY.
     * Used on Windows where multi-line prompts can't be passed as CLI arguments
     * through .cmd batch wrappers (cmd.exe interprets newlines as command separators).
     *
     * On Windows, writes in chunks to avoid ConPTY truncation at ~4KB.
     * On all platforms, awaits write completion before sending Enter (fixes
     * intermittent issue where \r fires before large prompts finish writing).
     */
    private deliverPendingPrompt;
    private handlePtyExit;
    getSessionInfo(name: string): SessionInfo | null;
    getSessionCwd(name: string): string | null;
    getAllSessions(): SessionInfo[];
    getGroupStatus(group: string): Record<string, {
        status: string;
        connectedClients: number;
        hasHistory: boolean;
    }>;
    /**
     * Get bridge statistics for health monitoring
     */
    getStats(): BridgeStats;
    /**
     * Check if a specific session is actively producing output.
     * Returns true (active), false (inactive), or null (session not found/not running).
     */
    isSessionActive(name: string): boolean | null;
    /**
     * Get activity transitions for a session (for debugging phantom blips)
     */
    getActivityLog(name: string): ActivityTransition[] | null;
    /**
     * Stop all running sessions (for bulk stop action)
     */
    stopAllSessions(): Promise<number>;
    stopSession(name: string): Promise<SessionInfo | null>;
    /**
     * Delete a session completely (stop if running, remove from persistence)
     */
    deleteSession(name: string): Promise<boolean>;
    /**
     * Re-detect the session ID from the provider's session directory.
     * Finds the most recently modified session file and updates persisted state.
     */
    relinkSession(name: string): Promise<{
        sessionId: string | null;
        previous: string | null;
    }>;
    addClient(name: string, ws: WebSocket): boolean;
    removeClient(name: string, ws: WebSocket): void;
    addSSEClient(name: string, res: Response): boolean;
    removeSSEClient(name: string, res: Response): void;
    private updateClientCount;
    /**
     * Write data to a session's PTY.
     * Uses writeChunkedToPty for ConPTY-safe chunked writes on Windows.
     * If data is wrapped in bracketed paste markers, sends markers atomically
     * and only chunks the inner content to avoid splitting escape sequences.
     */
    writeToSession(name: string, data: string): Promise<boolean>;
    /**
     * Watch for a new unclaimed session file.
     * Uses live getClaimedGuids() checks on each poll iteration to prevent
     * two concurrent watchers from claiming the same GUID.
     */
    private watchForUnclaimedSession;
    /**
     * Get all GUIDs that are already claimed by any session (active or persisted)
     */
    private getClaimedGuids;
    /**
     * Retry GUID detection for sessions that didn't capture it initially.
     * Uses the before-files list AND excludes GUIDs already claimed by other sessions.
     */
    private retryGuidDetection;
    resizeSession(name: string, cols: number, rows: number): boolean;
    sendSignal(name: string, signal: string): boolean;
    private responseStore;
    private submitMutexes;
    private static MAX_PROMPT_DEPTH;
    private static CHAIN_TTL_MS;
    private promptChains;
    setResponseStore(store: ResponseStore): void;
    /**
     * Get the current prompt depth for a session by tracing the call chain.
     */
    private getPromptDepth;
    /**
     * Record a prompt chain link (for depth tracking when session was created with CLI-arg prompt).
     * Returns the recorded depth or an error if max depth exceeded.
     */
    clearPromptChain(sessionName: string): void;
    recordPromptChain(targetSession: string, callingSession: string): {
        success: boolean;
        depth: number;
        error?: string;
    };
    /**
     * Atomically submit a prompt to a session: bracketed paste → delay → Enter.
     * Enforces three-state guard: call-locked, active/busy, idle/ready.
     * Per-session mutex prevents concurrent prompt interleaving.
     * Depth tracking prevents runaway cross-card call chains (max 4 levels).
     */
    submitPrompt(name: string, request: SubmitRequest): Promise<SubmitResult>;
    /**
     * Get a terminal content snapshot for diagnostics.
     * Uses serializeAddon to dump last N lines, strips ANSI codes.
     */
    getSnapshot(name: string, lines?: number): SnapshotResult | null;
}
