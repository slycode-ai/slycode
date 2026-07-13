/**
 * Session-id detection decision helpers (feature 080).
 *
 * Pure functions only — no fs, no timers, no session-manager imports — so the
 * re-arm gating and relink candidate filtering can be table-tested directly
 * (same pattern as reaper.ts evaluateCandidate / submit-verify.ts classifier).
 */
/** Cooldown between detection re-arms so bursty input doesn't churn directory scans. */
export declare const GUID_REARM_COOLDOWN_MS = 5000;
/** Files older than session createdAt minus this slack cannot belong to the session. */
export declare const RELINK_LIFETIME_SLACK_MS = 60000;
export interface ArmDecisionInput {
    hasId: boolean;
    cancelled: boolean;
    inFlight: boolean;
    lastArmedAt: number | null;
    now: number;
    cooldownMs?: number;
}
/**
 * Should an input-delivery/attach event (re-)arm the session-id watch?
 * Replaces the old once-only `guidRetryAttempted` debounce.
 */
export declare function shouldArmDetection(input: ArmDecisionInput): boolean;
export interface RelinkCandidate {
    sessionId: string;
    /** Best-known creation/activity timestamp for the file (epoch ms); null when unknown. */
    timestampMs: number | null;
}
export interface RelinkFilterOptions {
    /** Provider ids already claimed by any session (active or persisted). */
    claimed: Set<string>;
    /** The relinking session's own current id — stays eligible despite being claimed. */
    ownPrevious: string | null;
    /** The relinking session's createdAt (epoch ms); null skips the lifetime check. */
    createdAtMs: number | null;
    slackMs?: number;
}
/**
 * Filter relink candidates, preserving input order (callers pass newest-first):
 * - drop ids claimed by OTHER sessions (own previous id stays eligible)
 * - drop files that predate the session's creation (minus slack) — they cannot
 *   hold this session's conversation. Unknown timestamps are kept.
 */
export declare function filterRelinkCandidates(candidates: RelinkCandidate[], opts: RelinkFilterOptions): RelinkCandidate[];
