const RESPONSE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 60 seconds
/**
 * In-memory store for cross-card prompt responses.
 * Manages the response callback protocol: register → poll → deliver.
 * Handles call locking and late response injection tracking.
 */
export class ResponseStore {
    responses = new Map();
    cleanupTimer = null;
    start() {
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    }
    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
    /**
     * Register a pending response for a --wait prompt.
     * Also acts as a call lock on the target session.
     */
    register(responseId, callingSession, targetSession) {
        this.responses.set(responseId, {
            responseId,
            callingSession,
            targetSession,
            status: 'pending',
            createdAt: Date.now(),
        });
    }
    /**
     * Poll for a response by ID.
     */
    poll(responseId) {
        return this.responses.get(responseId) || null;
    }
    /**
     * Deliver a response (called by sly-kanban respond via POST /responses/:id).
     * Returns the entry so the caller can check if late injection is needed.
     */
    deliver(responseId, data) {
        const entry = this.responses.get(responseId);
        if (!entry)
            return null;
        entry.data = data;
        entry.status = 'received';
        return entry;
    }
    /**
     * Mark that the caller has timed out and stopped polling.
     * Late responses should be injected into the calling session's PTY.
     */
    markCallerTimedOut(responseId) {
        const entry = this.responses.get(responseId);
        if (entry) {
            entry.callerTimedOut = true;
        }
    }
    /**
     * Check if a session is locked by an active --wait call.
     */
    isSessionLocked(sessionName) {
        for (const entry of this.responses.values()) {
            if (entry.targetSession === sessionName && entry.status === 'pending' && !entry.callerTimedOut) {
                return true;
            }
        }
        return false;
    }
    /**
     * Get the active lock info for a session (for error messages).
     */
    getActiveLock(sessionName) {
        for (const entry of this.responses.values()) {
            if (entry.targetSession === sessionName && entry.status === 'pending' && !entry.callerTimedOut) {
                return { callingSession: entry.callingSession, lockedAt: entry.createdAt };
            }
        }
        return null;
    }
    /**
     * Remove expired entries (older than TTL).
     */
    cleanup() {
        const now = Date.now();
        for (const [id, entry] of this.responses) {
            if (now - entry.createdAt > RESPONSE_TTL_MS) {
                this.responses.delete(id);
            }
        }
    }
}
//# sourceMappingURL=response-store.js.map