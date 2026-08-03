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
export interface RelinkChoiceOptions {
    /** The relinking session's createdAt (epoch ms); null disables the lifetime preference. */
    createdAtMs: number | null;
    slackMs?: number;
}
/**
 * Choose the candidate an EXPLICIT user relink should bind (feature 080 rev 2).
 *
 * User directive: "if I say relink, I want it to relink" — an explicit relink
 * must succeed whenever any session file exists. Claims held by other session
 * records do NOT veto the choice; the caller transfers the claim instead.
 * Candidates arrive newest-first. Preference order:
 *   1. newest candidate within the session's lifetime (timestamp >= createdAt
 *      minus slack, unknown timestamps count as within) — avoids grabbing an
 *      ancient conversation when a plausible one exists
 *   2. otherwise newest overall (never fail while files exist)
 */
export declare function chooseRelinkCandidate(candidates: RelinkCandidate[], opts: RelinkChoiceOptions): RelinkCandidate | null;
export interface DetectionChoiceOptions {
    /** The detecting session's createdAt (epoch ms); null disables the lifetime bound. */
    createdAtMs: number | null;
    /** Ids already claimed by any session (active or persisted) — never eligible. */
    claimedIds: ReadonlySet<string>;
    slackMs?: number;
}
/**
 * Choose which candidate an AUTOMATIC detection check (spawn watch, 080 re-arm,
 * exit-time last chance) may claim (feature 081).
 *
 * Unlike chooseRelinkCandidate (explicit user action — always succeeds), the
 * automatic paths must stay conservative:
 *   - ids claimed by ANY session are excluded (no transfer)
 *   - lifetime-bounded: files older than createdAt minus slack cannot belong
 *     to this session (unknown timestamps count as within) — closes the
 *     unbounded steal window when a re-armed watch diffs against a stale
 *     spawn-time snapshot hours later
 *   - returns the OLDEST eligible candidate (input arrives newest-first):
 *     deterministic, and the file created soonest after this session's spawn
 *     is the most plausible match among the new files
 */
export declare function chooseDetectionCandidate(candidates: RelinkCandidate[], opts: DetectionChoiceOptions): RelinkCandidate | null;
/** Cooldown between assigned-id verification directory checks. */
export declare const ASSIGNED_ID_VERIFY_COOLDOWN_MS = 15000;
/** Don't declare assigned-id failure before the session is at least this old. */
export declare const ASSIGNED_ID_VERIFY_MIN_AGE_MS = 90000;
/** Consecutive missed checks required before falling back to detection. */
export declare const ASSIGNED_ID_VERIFY_MIN_FAILURES = 3;
export interface AssignedIdVerifyInput {
    /** The assigned id was found among the provider's session files. */
    idPresentInDir: boolean;
    /** Consecutive failed checks, INCLUDING the current one. */
    failures: number;
    /** now - session createdAt (epoch ms delta). */
    ageMs: number;
    minFailures?: number;
    minAgeMs?: number;
}
export type AssignedIdVerdict = 'verified' | 'pending' | 'fallback';
/**
 * Assigned-id verification verdict (feature 081 fallback): if a future CLI
 * update drops or ignores --session-id, the bridge must notice and fall back
 * to file detection instead of confidently recording an id no transcript
 * carries. 'pending' = keep waiting (providers create files lazily — Gemini
 * takes ~30s, and only input events trigger checks); 'fallback' = the id
 * provably never materialized: null it and re-arm detection.
 */
export declare function assessAssignedIdVerification(input: AssignedIdVerifyInput): AssignedIdVerdict;
