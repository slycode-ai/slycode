/**
 * Session transport seam (feature 085).
 *
 * A transport answers four questions the bridge used to answer only by
 * reading the terminal: how the session's conversation id is established,
 * how a prompt is delivered and confirmed, how the provider's sessions are
 * enumerated for recovery, and what to do at spawn/stop. Two implementations:
 *
 *   pty-scrape   — Claude, Codex, Gemini: transcript-file detection + the
 *                  snapshot-classifier delivery ladder (existing behaviour,
 *                  delegated back into SessionManager unchanged).
 *   opencode-api — OpenCode: the TUI process serves an HTTP API on a
 *                  bridge-assigned loopback port; identity, delivery and turn
 *                  state come from that API.
 *
 * SessionManager owns mutexes, write queues, persistence and PTY lifecycle;
 * transports never touch those directly.
 */
import type { ProviderConfig, ProviderTransport } from '../provider-utils.js';
import type { DeliveryResult, Session } from '../types.js';
export interface SessionCandidate {
    sessionId: string;
    timestampMs: number | null;
}
export interface SpawnPlanInput {
    providerConfig: ProviderConfig;
    providerId: string;
    cwd: string;
    /** True when this spawn resumes an existing conversation. */
    resume: boolean;
    /** The stored conversation id when resuming (null otherwise). */
    storedSessionId: string | null;
    /** Initial prompt for providers whose prompt.type is 'transport' (delivered after spawn). */
    initialPrompt?: string;
    /** Whether the permission-skip flag is in effect (transports may auto-reply to permission events). */
    skipPermissions: boolean;
}
/** The subset of a live or persisted session a transport may consult for recovery. */
export interface SessionLike {
    name?: string;
    cwd: string;
    provider?: string;
    claudeSessionId?: string | null;
    transportState?: Record<string, unknown>;
}
export interface SpawnPlan {
    /** Extra argv appended after the registry-built args. */
    extraArgs: string[];
    /** Extra environment for the PTY process. */
    env: Record<string, string>;
    /**
     * Conversation id known BEFORE the process starts (feature 081 for
     * pty-scrape providers with a sessionIdFlag; always for opencode-api).
     * Null = the id must be discovered after launch.
     */
    assignedSessionId: string | null;
    /** True when the assigned id still needs confirming against the provider (081 fallback). */
    assignedIdUnverified: boolean;
    /** Provider session directory captured at spawn (pty-scrape) or null. */
    sessionDir: string | null;
    /** Snapshot of session files that existed before spawn (pty-scrape) — opaque to the manager. */
    beforeFiles: string[];
    /** Whether post-launch detection should arm for this spawn. */
    armDetection: boolean;
    /** Opaque per-session state to persist alongside the session record (e.g. port, password). */
    transportState?: Record<string, unknown>;
}
/**
 * Hooks a transport may call back into SessionManager. Kept deliberately
 * small: the pty-scrape ladder lives in the manager and is invoked through
 * `performVerifiedDelivery`; detection claims go through `claimDetectedSessionId`.
 */
export interface TransportHooks {
    performVerifiedDelivery(sessionName: string, prompt: string): Promise<DeliveryResult>;
    startDetection(sessionName: string, providerId: string, beforeFiles: string[]): void;
    /** Bind a conversation id learned after spawn (persisted by the manager). */
    claimSessionId(sessionName: string, sessionId: string): Promise<void>;
}
export interface SessionTransport {
    readonly id: ProviderTransport;
    /** Decide argv/env/identity for a spawn. Called before the PTY exists. */
    planSpawn(input: SpawnPlanInput): Promise<SpawnPlan>;
    /** Called once the PTY is running and the session is registered. */
    afterSpawn(session: Session, plan: SpawnPlan, hooks: TransportHooks): Promise<void>;
    /** Deliver a prompt and report a typed DeliveryResult. Caller holds the submit mutex. */
    deliver(session: Session, prompt: string, hooks: TransportHooks): Promise<DeliveryResult>;
    /** Whether post-launch detection / recovery by candidate listing applies. */
    supportsDetection(providerConfig: ProviderConfig, cwd: string): boolean;
    /**
     * Provider sessions for `cwd`, newest first, excluding `excludeFiles`
     * (the spawn-time snapshot). Used by detection, relink, link and 081 verify.
     */
    listCandidates(providerId: string, cwd: string, excludeFiles?: string[], session?: SessionLike): Promise<SessionCandidate[]>;
    /** Session is being stopped (before the PTY is signalled). */
    onStop(session: Session): Promise<void>;
}
