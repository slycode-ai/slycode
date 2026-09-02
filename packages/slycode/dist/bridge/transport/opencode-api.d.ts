import type { DeliveryResult, Session } from '../types.js';
import type { SessionTransport, SpawnPlan, SpawnPlanInput, TransportHooks, SessionCandidate, SessionLike } from './types.js';
export declare const HEALTH_TIMEOUT_MS = 20000;
export declare const HEALTH_POLL_MS = 250;
export declare const DELIVERY_CONFIRM_TIMEOUT_MS = 4000;
export declare const DELIVERY_CONFIRM_POLL_MS = 250;
export interface OpenCodeTransportState {
    port: number;
    password: string;
    baseUrl: string;
    /** Set when the server never answered /global/health within the timeout. */
    error?: string;
}
/** Where OpenCode keeps credentials (XDG-style on every platform, incl. Windows). */
export declare function opencodeAuthPath(): string;
/** Cheap pre-flight: a non-empty auth.json means at least one credential exists. */
export declare function hasOpenCodeCredentials(authPath?: string): boolean;
export declare function allocateLoopbackPort(): Promise<number>;
/** Parse `opencode session list --format json` / GET /session rows into candidates. */
export declare function candidatesFromRows(rows: unknown, cwdRealpath: string, excludeIds?: readonly string[]): SessionCandidate[];
export declare class OpenCodeApiTransport implements SessionTransport {
    readonly id: "opencode-api";
    private live;
    planSpawn(input: SpawnPlanInput): Promise<SpawnPlan>;
    afterSpawn(session: Session, plan: SpawnPlan, hooks: TransportHooks): Promise<void>;
    deliver(session: Session, prompt: string): Promise<DeliveryResult>;
    private deliverInternal;
    private result;
    supportsDetection(): boolean;
    listCandidates(_providerId: string, cwd: string, excludeFiles?: string[], session?: SessionLike): Promise<SessionCandidate[]>;
    onStop(session: Session): Promise<void>;
    /** Turn state as last observed on the event stream (diagnostics / callers). */
    turnState(sessionName: string): 'idle' | 'busy' | 'unknown';
    /** Abort the running turn via the API (never Ctrl-C: on an empty composer that exits OpenCode). */
    interrupt(sessionName: string): Promise<boolean>;
    private api;
    private waitForHealth;
    /**
     * Point the attached TUI at our session. Retries briefly: the TUI client
     * connects to its embedded server a beat after the server is healthy, and
     * select-session 404s until then. Returns whether the select ever took.
     */
    private selectSession;
    private userMessageCount;
    private startEventStream;
    private consumeSse;
    private handleEvent;
}
