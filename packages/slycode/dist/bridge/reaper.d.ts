/**
 * Orphan provider reaper (feature 078).
 *
 * Periodically scans /proc for provider CLI processes (claude/codex/gemini)
 * that were spawned by a SlyCode bridge, lost their bridge (orphaned), and
 * have been inactive for a long time — then terminates them. Without this,
 * every bridge death (restart, crash, HMR purge) leaks 30-340 MB provider
 * processes that accumulate until the box swap-thrashes.
 *
 * Kill rule — ALL of:
 *   1. command is a configured provider (data/providers.json)
 *   2. orphaned/untracked: PPID 1, reparented to systemd/init, or no
 *      controlling TTY — and NOT in the live bridge's session set
 *   3. SlyCode provenance: SLYCODE_SESSION env tag (stamped on every bridge
 *      spawn) or a SlyCode prompt-envelope fingerprint in argv
 *   4. inactive: process age >= idleHours AND CPU ticks unchanged across
 *      >= 2 consecutive sweeps
 *
 * Developer shell/tmux CLI sessions have no provenance and a live parent —
 * they are never touched. Linux-only (/proc); no-op elsewhere.
 *
 * Decision logic is pure (evaluateCandidate) so it can be table-tested
 * without a real /proc — see reaper.test.ts.
 */
export interface ReaperConfig {
    enabled: boolean;
    intervalMinutes: number;
    idleHours: number;
    dryRun: boolean;
}
export declare const DEFAULT_REAPER_CONFIG: ReaperConfig;
/** SIGTERM -> SIGKILL escalation grace. Escalates on the first sweep that runs after this. */
export declare const KILL_GRACE_MS = 60000;
/** CPU must be unchanged across this many consecutive sweep observations before a kill. */
export declare const REQUIRED_QUIET_SWEEPS = 2;
export type SkipEntry = {
    kind: 'pid';
    pid: number;
    raw: string;
} | {
    kind: 'pattern';
    pattern: string;
    raw: string;
};
/** One entry per line; numeric line = PID, anything else = cmdline substring. `#` comments. */
export declare function parseSkipList(content: string): SkipEntry[];
export interface CandidateInfo {
    pid: number;
    /** Process comm (binary name, 15-char truncated) from /proc/<pid>/stat */
    comm: string;
    /** Single-char process state from stat (Z = zombie) */
    state: string;
    ppid: number;
    /** comm of the parent process, null if unreadable */
    parentComm: string | null;
    /** tty_nr != 0 in stat — process has a controlling terminal */
    hasTty: boolean;
    /** argv NUL-split and space-joined */
    cmdline: string;
    /** Value of SLYCODE_SESSION from /proc/<pid>/environ, null if absent/unreadable */
    slycodeSession: string | null;
    /** Absolute start time (epoch ms) */
    startTimeMs: number;
    rssKb: number;
    /** Consecutive sweep observations (incl. current) with unchanged CPU ticks */
    quietSweeps: number;
}
export interface EvalContext {
    /** Provider command names from data/providers.json (e.g. claude, codex, gemini) */
    providerCommands: Set<string>;
    /** PIDs of the bridge's own live sessions — never touched */
    livePids: Set<number>;
    selfPid: number;
    skipEntries: SkipEntry[];
    /** pid -> session name recorded in bridge-sessions.json for non-live sessions */
    staleSessionByPid: Map<number, string>;
    idleMs: number;
    nowMs: number;
}
export type ReaperAction = 'kill' | 'spare' | 'skip';
export interface ReaperDecision {
    action: ReaperAction;
    /** Every signal that fired, for the evidence log */
    reasons: string[];
    /** True when orphan-signature + provenance matched (interesting even if spared) */
    matchedProvenance: boolean;
}
export declare function evaluateCandidate(c: CandidateInfo, ctx: EvalContext): ReaperDecision;
export declare function formatDuration(ms: number): string;
export interface ProcStat {
    comm: string;
    state: string;
    ppid: number;
    ttyNr: number;
    cpuTicks: number;
    startTimeTicks: number;
    rssKb: number;
}
export declare function parseProcStat(raw: string): ProcStat | null;
export interface SweepEntry {
    pid: number;
    comm: string;
    action: ReaperAction;
    reasons: string[];
    signal?: 'SIGTERM' | 'SIGKILL';
    dryRun?: boolean;
    cmdline: string;
}
export interface ReaperDeps {
    config: Partial<ReaperConfig> | undefined;
    getProviderCommands: () => Promise<Set<string>>;
    getLivePids: () => Set<number>;
    getStaleSessionPids: () => Map<number, string>;
    logPath: string;
    skipFilePath: string;
}
export declare class Reaper {
    private readonly config;
    private readonly deps;
    private timer;
    private history;
    private sweeping;
    constructor(deps: ReaperDeps);
    /** Starts the periodic sweep. No-op (with a log line) when disabled or not on Linux. */
    start(): void;
    stop(): void;
    private runSweep;
    /** One full scan. Exposed for the self-test; use start() in production. */
    sweep(nowMs?: number): Promise<SweepEntry[]>;
    private readSkipList;
    private log;
}
export declare function resolveReaperPaths(): {
    logPath: string;
    skipFilePath: string;
};
