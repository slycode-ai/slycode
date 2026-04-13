import type { ResponseEntry } from './types.js';
/**
 * In-memory store for cross-card prompt responses.
 * Manages the response callback protocol: register → poll → deliver.
 * Handles call locking and late response injection tracking.
 */
export declare class ResponseStore {
    private responses;
    private cleanupTimer;
    start(): void;
    stop(): void;
    /**
     * Register a pending response for a --wait prompt.
     * Also acts as a call lock on the target session.
     */
    register(responseId: string, callingSession: string, targetSession: string): void;
    /**
     * Poll for a response by ID.
     */
    poll(responseId: string): ResponseEntry | null;
    /**
     * Deliver a response (called by sly-kanban respond via POST /responses/:id).
     * Returns the entry so the caller can check if late injection is needed.
     */
    deliver(responseId: string, data: string): ResponseEntry | null;
    onResponseDelivered: ((targetSession: string) => void) | null;
    /**
     * Mark that the caller has timed out and stopped polling.
     * Late responses should be injected into the calling session's PTY.
     */
    markCallerTimedOut(responseId: string): void;
    /**
     * Check if a session is locked by an active --wait call.
     */
    isSessionLocked(sessionName: string): boolean;
    /**
     * Get the active lock info for a session (for error messages).
     */
    getActiveLock(sessionName: string): {
        callingSession: string;
        lockedAt: number;
    } | null;
    /**
     * Remove expired entries (older than TTL).
     */
    private cleanup;
}
