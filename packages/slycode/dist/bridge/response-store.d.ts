import type { ResponseEntry } from './types.js';
/**
 * Metadata for a response ID after its live entry has been removed. Kept
 * in a small ring-buffer so the API can give an actionable error to clients
 * that try to deliver to an ID that has expired or been consumed, instead
 * of a generic 404.
 *
 * Note: payload `data` is intentionally NOT retained — only the envelope.
 */
export interface ExpiredResponseMetadata {
    responseId: string;
    reason: 'expired' | 'consumed';
    issuedAt: number;
    expiredAt: number;
    targetSession: string;
}
export type ExpiryHint = {
    reason: 'expired' | 'consumed' | 'unknown';
    issuedAt?: number;
    expiredAt?: number;
};
/**
 * In-memory store for cross-card prompt responses.
 * Manages the response callback protocol: register → poll → deliver.
 * Handles call locking and late response injection tracking.
 *
 * Delivery is multi-shot within TTL: a second `deliver()` call overwrites
 * the previous payload (the latest delivery wins). For a still-polling caller
 * the recovery window is bounded by the 2 s polling cadence; for a timed-out
 * caller the late-injection path fires on every successful delivery, which
 * gives the caller a full-TTL recovery window via PTY injection.
 */
export declare class ResponseStore {
    private responses;
    private cleanupTimer;
    private recentlyExpired;
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
     *
     * Multi-shot within TTL: a re-delivery while the entry is still in the
     * map overwrites the payload. The first delivery flips status to
     * 'received'; subsequent deliveries keep it there but update data and
     * fire the late-injection trigger again if the caller has timed out.
     */
    deliver(responseId: string, data: string): ResponseEntry | null;
    /**
     * Look up envelope metadata for an ID that is no longer in the live map.
     * Returns 'unknown' when the ID was never seen (typo, or bridge restarted).
     */
    getExpiryHint(responseId: string): ExpiryHint;
    private pushExpired;
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
     * Remove expired entries (older than TTL). Before deleting, push a small
     * envelope into the recentlyExpired ring-buffer so subsequent delivery
     * attempts can be told *why* they failed.
     */
    private cleanup;
}
