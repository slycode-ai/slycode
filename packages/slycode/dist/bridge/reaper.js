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
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REAPER_CONFIG = {
    enabled: true,
    intervalMinutes: 10,
    idleHours: 24,
    dryRun: false,
};
/** SIGTERM -> SIGKILL escalation grace. Escalates on the first sweep that runs after this. */
export const KILL_GRACE_MS = 60_000;
/** CPU must be unchanged across this many consecutive sweep observations before a kill. */
export const REQUIRED_QUIET_SWEEPS = 2;
// Linux USER_HZ is 100 on every supported platform; only used for age math.
const CLK_TCK = 100;
const PAGE_SIZE_KB = 4;
/**
 * SlyCode prompt-envelope fingerprints. Any of these in argv marks a process
 * as SlyCode-spawned (they never appear in user-initiated CLI sessions).
 * Fallback provenance for orphans predating the SLYCODE_SESSION env tag.
 */
const ARGV_FINGERPRINTS = [
    '[Telegram] Project:',
    '=== AUTOMATION RUN ===',
    '(Reply using /messaging | Mode:',
];
function matchFingerprint(cmdline) {
    for (const fp of ARGV_FINGERPRINTS) {
        if (cmdline.includes(fp))
            return fp;
    }
    // Cross-card prompt format: "Card: <title> [card-<id>]"
    if (cmdline.includes('Card: ') && cmdline.includes('[card-'))
        return 'Card: ... [card-';
    return null;
}
/** One entry per line; numeric line = PID, anything else = cmdline substring. `#` comments. */
export function parseSkipList(content) {
    const entries = [];
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#'))
            continue;
        if (/^\d+$/.test(line)) {
            entries.push({ kind: 'pid', pid: parseInt(line, 10), raw: line });
        }
        else {
            entries.push({ kind: 'pattern', pattern: line, raw: line });
        }
    }
    return entries;
}
function matchSkip(entries, pid, cmdline) {
    for (const e of entries) {
        if (e.kind === 'pid' && e.pid === pid)
            return e;
        if (e.kind === 'pattern' && cmdline.includes(e.pattern))
            return e;
    }
    return null;
}
function basename(p) {
    const ix = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return ix >= 0 ? p.slice(ix + 1) : p;
}
export function evaluateCandidate(c, ctx) {
    const spare = (reason, matchedProvenance = false) => ({ action: 'spare', reasons: [reason], matchedProvenance });
    // 1. Provider command match (comm or argv[0] basename)
    const argv0 = basename(c.cmdline.split(' ')[0] || '');
    if (!ctx.providerCommands.has(c.comm) && !ctx.providerCommands.has(argv0)) {
        return spare('not a provider command');
    }
    // Zombies are the kernel's to reap — signalling them does nothing
    if (c.state === 'Z') {
        return spare('zombie (kernel reaps)');
    }
    // 2. Never touch ourselves or the bridge's live sessions
    if (c.pid === ctx.selfPid) {
        return spare('self');
    }
    if (ctx.livePids.has(c.pid)) {
        return spare('live bridge session');
    }
    // 3. Orphan/untracked signature
    const orphanReasons = [];
    if (c.ppid === 1)
        orphanReasons.push('ppid=1');
    else if (c.parentComm === 'systemd' || c.parentComm === 'init') {
        orphanReasons.push(`reparented to ${c.parentComm} (ppid=${c.ppid})`);
    }
    if (!c.hasTty)
        orphanReasons.push('no controlling tty');
    if (orphanReasons.length === 0) {
        return spare('not orphaned (live parent + tty)');
    }
    // 4. SlyCode provenance
    const provenanceReasons = [];
    if (c.slycodeSession !== null) {
        provenanceReasons.push(`env SLYCODE_SESSION=${c.slycodeSession}`);
        const staleName = ctx.staleSessionByPid.get(c.pid);
        if (staleName !== undefined && staleName === c.slycodeSession) {
            provenanceReasons.push('pid matches persisted session record');
        }
    }
    const fp = matchFingerprint(c.cmdline);
    if (fp)
        provenanceReasons.push(`argv fingerprint: ${fp}`);
    if (provenanceReasons.length === 0) {
        return spare('no slycode provenance');
    }
    const reasons = [...orphanReasons, ...provenanceReasons];
    // 5. Skip-list (checked after provenance so skips of real candidates are logged as such)
    const skip = matchSkip(ctx.skipEntries, c.pid, c.cmdline);
    if (skip) {
        return { action: 'skip', reasons: [...reasons, `skip-list: ${skip.raw}`], matchedProvenance: true };
    }
    // 6. Inactivity: age gate...
    const ageMs = ctx.nowMs - c.startTimeMs;
    if (ageMs < ctx.idleMs) {
        return {
            action: 'spare',
            reasons: [...reasons, `age ${formatDuration(ageMs)} < ${formatDuration(ctx.idleMs)}`],
            matchedProvenance: true,
        };
    }
    // ...and CPU quiet across consecutive sweeps
    if (c.quietSweeps < REQUIRED_QUIET_SWEEPS) {
        return {
            action: 'spare',
            reasons: [...reasons, `awaiting cpu-quiet confirmation (sweep ${c.quietSweeps}/${REQUIRED_QUIET_SWEEPS})`],
            matchedProvenance: true,
        };
    }
    return {
        action: 'kill',
        reasons: [...reasons, `age ${formatDuration(ageMs)}`, `cpu quiet x${c.quietSweeps} sweeps`, `rss ${Math.round(c.rssKb / 1024)}MB`],
        matchedProvenance: true,
    };
}
export function formatDuration(ms) {
    const h = ms / 3_600_000;
    if (h >= 48)
        return `${Math.round(h / 24)}d`;
    if (h >= 1)
        return `${Math.round(h * 10) / 10}h`;
    return `${Math.round(ms / 60_000)}m`;
}
export function parseProcStat(raw) {
    // Format: pid (comm) state ppid ... — comm may contain spaces/parens, so
    // anchor on the LAST ')' rather than splitting naively.
    const close = raw.lastIndexOf(')');
    const open = raw.indexOf('(');
    if (open < 0 || close < 0 || close < open)
        return null;
    const comm = raw.slice(open + 1, close);
    const rest = raw.slice(close + 2).split(' ');
    // rest[0]=state(3) rest[1]=ppid(4) ... fields numbered per proc(5), stat field N = rest[N-3]
    if (rest.length < 22)
        return null;
    return {
        comm,
        state: rest[0],
        ppid: parseInt(rest[1], 10),
        ttyNr: parseInt(rest[4], 10), // field 7
        cpuTicks: parseInt(rest[11], 10) + parseInt(rest[12], 10), // utime(14) + stime(15)
        startTimeTicks: parseInt(rest[19], 10), // field 22
        rssKb: parseInt(rest[21], 10) * PAGE_SIZE_KB, // field 24 (pages)
    };
}
function readProcStat(pid) {
    try {
        return parseProcStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf-8'));
    }
    catch {
        return null;
    }
}
function readCmdline(pid) {
    try {
        const raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
        return raw.split('\0').filter(Boolean).join(' ');
    }
    catch {
        return null;
    }
}
function readSlycodeSession(pid) {
    try {
        const raw = fs.readFileSync(`/proc/${pid}/environ`, 'utf-8');
        for (const entry of raw.split('\0')) {
            if (entry.startsWith('SLYCODE_SESSION='))
                return entry.slice('SLYCODE_SESSION='.length);
        }
        return null;
    }
    catch {
        return null; // unreadable (other user) — provenance signal simply absent
    }
}
let cachedBootTimeMs = null;
function readBootTimeMs() {
    if (cachedBootTimeMs !== null)
        return cachedBootTimeMs;
    try {
        const raw = fs.readFileSync('/proc/stat', 'utf-8');
        const m = raw.match(/^btime (\d+)$/m);
        cachedBootTimeMs = m ? parseInt(m[1], 10) * 1000 : Date.now() - os.uptime() * 1000;
    }
    catch {
        cachedBootTimeMs = Date.now() - os.uptime() * 1000;
    }
    return cachedBootTimeMs;
}
function listProcPids() {
    try {
        return fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)).map(n => parseInt(n, 10));
    }
    catch {
        return [];
    }
}
export class Reaper {
    config;
    deps;
    timer = null;
    history = new Map();
    sweeping = false;
    constructor(deps) {
        this.deps = deps;
        this.config = { ...DEFAULT_REAPER_CONFIG, ...(deps.config ?? {}) };
    }
    /** Starts the periodic sweep. No-op (with a log line) when disabled or not on Linux. */
    start() {
        if (!this.config.enabled) {
            console.log('[reaper] disabled via config');
            return;
        }
        if (os.platform() !== 'linux') {
            console.log(`[reaper] inactive on ${os.platform()} (Linux /proc only)`);
            return;
        }
        const intervalMs = Math.max(1, this.config.intervalMinutes) * 60_000;
        this.timer = setInterval(() => { void this.runSweep(); }, intervalMs);
        this.timer.unref();
        console.log(`[reaper] active: every ${this.config.intervalMinutes}min, idle threshold ${this.config.idleHours}h` +
            `${this.config.dryRun ? ' [DRY-RUN]' : ''} — log: ${this.deps.logPath}`);
        // First sweep immediately — begins the cpu-quiet observation window for
        // any orphans left by a previous bridge (kills need >= 2 sweeps anyway).
        void this.runSweep();
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async runSweep() {
        if (this.sweeping)
            return; // never overlap sweeps
        this.sweeping = true;
        try {
            await this.sweep();
        }
        catch (err) {
            console.error('[reaper] sweep failed:', err.message);
        }
        finally {
            this.sweeping = false;
        }
    }
    /** One full scan. Exposed for the self-test; use start() in production. */
    async sweep(nowMs = Date.now()) {
        const providerCommands = await this.deps.getProviderCommands();
        const skipEntries = this.readSkipList();
        const ctx = {
            providerCommands,
            livePids: this.deps.getLivePids(),
            selfPid: process.pid,
            skipEntries,
            staleSessionByPid: this.deps.getStaleSessionPids(),
            idleMs: this.config.idleHours * 3_600_000,
            nowMs,
        };
        const bootMs = readBootTimeMs();
        const entries = [];
        const seenKeys = new Set();
        for (const pid of listProcPids()) {
            const stat = readProcStat(pid);
            if (!stat)
                continue; // vanished mid-scan
            const cmdline = readCmdline(pid) ?? '';
            // Cheap prefilter: comm or argv[0] basename must be a provider command
            const argv0 = basename(cmdline.split(' ')[0] || '');
            if (!providerCommands.has(stat.comm) && !providerCommands.has(argv0))
                continue;
            const startTimeMs = bootMs + (stat.startTimeTicks / CLK_TCK) * 1000;
            const key = `${pid}:${Math.round(startTimeMs)}`; // survives PID reuse
            seenKeys.add(key);
            const prev = this.history.get(key);
            const quietSweeps = prev && prev.cpuTicks === stat.cpuTicks ? prev.quietSweeps + 1 : 1;
            const hist = { cpuTicks: stat.cpuTicks, quietSweeps, termSentAt: prev?.termSentAt };
            this.history.set(key, hist);
            const parentStat = stat.ppid > 0 ? readProcStat(stat.ppid) : null;
            const candidate = {
                pid,
                comm: stat.comm,
                state: stat.state,
                ppid: stat.ppid,
                parentComm: parentStat?.comm ?? null,
                hasTty: stat.ttyNr !== 0,
                cmdline,
                slycodeSession: readSlycodeSession(pid),
                startTimeMs,
                rssKb: stat.rssKb,
                quietSweeps,
            };
            const decision = evaluateCandidate(candidate, ctx);
            const entry = {
                pid,
                comm: stat.comm,
                action: decision.action,
                reasons: decision.reasons,
                cmdline,
            };
            if (decision.action === 'kill') {
                if (this.config.dryRun) {
                    entry.dryRun = true;
                }
                else {
                    const escalate = hist.termSentAt !== undefined && nowMs - hist.termSentAt >= KILL_GRACE_MS;
                    entry.signal = escalate ? 'SIGKILL' : 'SIGTERM';
                    try {
                        process.kill(pid, entry.signal);
                        if (!escalate)
                            hist.termSentAt = nowMs;
                    }
                    catch {
                        // ESRCH — gone between evaluate and kill; nothing to do
                    }
                }
            }
            // Log kills, skips, and provenance-matched spares (near misses). Plain
            // spares (dev shells, our own live sessions) would just be noise.
            if (decision.action !== 'spare' || decision.matchedProvenance) {
                this.log(entry, candidate, nowMs);
            }
            entries.push(entry);
        }
        // Drop history for processes that no longer exist
        for (const key of this.history.keys()) {
            if (!seenKeys.has(key))
                this.history.delete(key);
        }
        return entries;
    }
    readSkipList() {
        try {
            return parseSkipList(fs.readFileSync(this.deps.skipFilePath, 'utf-8'));
        }
        catch {
            return []; // missing skip file is the normal case
        }
    }
    log(entry, c, nowMs) {
        const verb = entry.dryRun ? 'DRY-RUN would kill' : entry.signal ? `kill(${entry.signal})` : entry.action;
        const line = `${new Date(nowMs).toISOString()} [${verb}] pid=${entry.pid} comm=${c.comm} ` +
            `age=${formatDuration(nowMs - c.startTimeMs)} rss=${Math.round(c.rssKb / 1024)}MB ` +
            `reasons=[${entry.reasons.join('; ')}] cmdline="${c.cmdline.slice(0, 160)}"`;
        console.log(`[reaper] ${line}`);
        try {
            fs.mkdirSync(path.dirname(this.deps.logPath), { recursive: true });
            fs.appendFileSync(this.deps.logPath, line + '\n');
        }
        catch (err) {
            console.error('[reaper] could not write log:', err.message);
        }
    }
}
// ---------------------------------------------------------------------------
// Default path resolution (SLYCODE_HOME in deployed mode, bridge/ in dev)
// ---------------------------------------------------------------------------
export function resolveReaperPaths() {
    if (process.env.SLYCODE_HOME) {
        const home = path.resolve(process.env.SLYCODE_HOME);
        return {
            logPath: path.join(home, 'logs', 'reaper.log'),
            skipFilePath: path.join(home, 'reaper-skip.txt'),
        };
    }
    const bridgeDir = path.join(__dirname, '..');
    return {
        logPath: path.join(bridgeDir, 'reaper.log'),
        skipFilePath: path.join(bridgeDir, 'reaper-skip.txt'),
    };
}
//# sourceMappingURL=reaper.js.map