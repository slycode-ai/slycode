import type { ResponseEntry } from './types.js';

const RESPONSE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000;  // 60 seconds

/**
 * In-memory store for cross-card prompt responses.
 * Manages the response callback protocol: register → poll → deliver.
 * Handles call locking and late response injection tracking.
 */
export class ResponseStore {
  private responses = new Map<string, ResponseEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Register a pending response for a --wait prompt.
   * Also acts as a call lock on the target session.
   */
  register(responseId: string, callingSession: string, targetSession: string): void {
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
  poll(responseId: string): ResponseEntry | null {
    return this.responses.get(responseId) || null;
  }

  /**
   * Deliver a response (called by sly-kanban respond via POST /responses/:id).
   * Returns the entry so the caller can check if late injection is needed.
   */
  deliver(responseId: string, data: string): ResponseEntry | null {
    const entry = this.responses.get(responseId);
    if (!entry) return null;

    entry.data = data;
    entry.status = 'received';
    return entry;
  }

  /**
   * Mark that the caller has timed out and stopped polling.
   * Late responses should be injected into the calling session's PTY.
   */
  markCallerTimedOut(responseId: string): void {
    const entry = this.responses.get(responseId);
    if (entry) {
      entry.callerTimedOut = true;
    }
  }

  /**
   * Check if a session is locked by an active --wait call.
   */
  isSessionLocked(sessionName: string): boolean {
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
  getActiveLock(sessionName: string): { callingSession: string; lockedAt: number } | null {
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
  private cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.responses) {
      if (now - entry.createdAt > RESPONSE_TTL_MS) {
        this.responses.delete(id);
      }
    }
  }
}
