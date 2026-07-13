import os from 'os';
import { spawnPty, writeToPty, writeChunkedToPty, CHUNKED_WRITE_SIZE, resizePty, killPty, isCommandShellSafe } from './pty-handler.js';
import { getProviderSessionDir, listProviderSessionFiles, detectNewProviderSessionId, listProviderSessionCandidates, } from './claude-utils.js';
import { shouldArmDetection, filterRelinkCandidates, GUID_REARM_COOLDOWN_MS } from './session-detection.js';
import { getProvider, buildProviderCommand, supportsSessionDetection, ensureInstructionFile, } from './provider-utils.js';
import { classifyInputRegion, extractInputRegion, decideNextAction, } from './submit-verify.js';
import { constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Use createRequire for CJS packages
const require = createRequire(import.meta.url);
const { Terminal: HeadlessTerminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
// Default terminal size for HEADLESS sessions (no UI client attached).
// Was 80x24 — on a 24-row screen a medium-length pasted message overflows the
// TUI's input-box viewport, so delivery verification could only see a tail
// window of it (live incident 2026-07-09; opening the UI resizes the PTY and
// re-renders, which is why the problem was invisible to inspection). A UI
// client that connects later still resizes to its own viewport as before.
const DEFAULT_PTY_COLS = 200;
const DEFAULT_PTY_ROWS = 50;
const DEFAULT_CONFIG = {
    port: parseInt(process.env.BRIDGE_PORT || '7592', 10),
    host: 'localhost',
    sessionFile: process.env.SLYCODE_HOME
        ? path.join(process.env.SLYCODE_HOME, 'bridge-sessions.json')
        : path.join(__dirname, '..', 'bridge-sessions.json'),
    defaultIdleTimeout: 4 * 60 * 60 * 1000, // 4 hours
    maxSessions: 50,
};
const webPort = process.env.PORT || process.env.WEB_PORT || '7591';
const DEFAULT_RUNTIME_CONFIG = {
    allowedCommands: ['claude', 'codex', 'gemini', 'bash'],
    cors: { origins: [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`] },
};
// Allowed signals for sendSignal - restrict to safe subset
const ALLOWED_SIGNALS = new Set(['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGKILL']);
// Check for idle sessions every minute
const IDLE_CHECK_INTERVAL = 60 * 1000;
// SSE heartbeat interval — keeps connections alive through proxies (Tailscale, Next.js)
const SSE_HEARTBEAT_INTERVAL_MS = 15 * 1000; // 15 seconds
// Deferred prompt delivery (Windows): wait for PTY output to settle before pasting prompt.
// On Windows, .cmd batch wrappers run through cmd.exe which mangles multi-line CLI arguments.
// Instead, we start without the prompt and paste it after the provider finishes starting up.
const DEFERRED_PROMPT_SETTLE_MS = 1500; // 1.5s of quiet after last output = settled
const DEFERRED_PROMPT_MAX_TIMEOUT_MS = 30000; // Safety net: deliver after 30s regardless
// Chunked write constants (CHUNKED_WRITE_SIZE, CHUNKED_WRITE_DELAY_MS) are in pty-handler.ts.
// writeChunkedToPty handles Windows ConPTY truncation for all large write paths.
// Grace period before a detached session becomes eligible for idle timeout (prevents race condition)
const DETACH_GRACE_PERIOD = 5 * 1000; // 5 seconds
// Activity threshold for "actively working" detection (2 seconds to stop)
const ACTIVITY_THRESHOLD_MS = 2 * 1000;
// Debounce threshold - activity must be sustained for 1 second before showing as active
const ACTIVITY_DEBOUNCE_MS = 1000;
// Max activity transitions to keep per session
const ACTIVITY_TRANSITIONS_MAX = 50;
// Strip ANSI escape codes and control characters for readable log snippets
function stripAnsi(str) {
    return str
        .replace(/\x1b\[[?!>]?[0-9;]*[a-zA-Z]/g, '') // CSI sequences (including DEC private mode like [?2026h)
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences (both BEL and ST terminators)
        .replace(/\x1b[()][AB012]/g, '') // Character set selection
        .replace(/\x1b[#%&()*+\-.\/][^\x1b]?/g, '') // Other escape sequences
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') // Control chars (keep \n \r \t)
        .trim();
}
// Convert first N bytes to hex string for diagnosing invisible output
function toHex(str, maxBytes = 40) {
    return Array.from(str.slice(0, maxBytes))
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(' ');
}
export class SessionManager {
    sessions = new Map();
    config;
    runtimeConfig;
    persistedState = { sessions: {} };
    idleCheckTimer = null;
    sseHeartbeatTimer = null;
    constructor(config = {}, runtimeConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.runtimeConfig = runtimeConfig ?? DEFAULT_RUNTIME_CONFIG;
    }
    async init() {
        await this.loadPersistedState();
        this.startIdleChecker();
        this.startSSEHeartbeat();
    }
    /**
     * Gracefully shutdown all sessions
     */
    async shutdown() {
        console.log('Shutting down session manager...');
        // Stop timers
        if (this.idleCheckTimer) {
            clearInterval(this.idleCheckTimer);
            this.idleCheckTimer = null;
        }
        if (this.sseHeartbeatTimer) {
            clearInterval(this.sseHeartbeatTimer);
            this.sseHeartbeatTimer = null;
        }
        // Kill all running PTYs and dispose headless terminals
        for (const [name, session] of this.sessions) {
            if (session.pty) {
                console.log(`Stopping session: ${name}`);
                try {
                    killPty(session.pty);
                }
                catch (err) {
                    console.error(`Error stopping ${name}:`, err);
                }
            }
            if (session.headlessTerminal) {
                try {
                    session.headlessTerminal.dispose();
                }
                catch (err) {
                    console.error(`Error disposing headless terminal for ${name}:`, err);
                }
            }
        }
        // Save final state
        await this.savePersistedState();
        console.log('Session manager shutdown complete');
    }
    /**
     * Start periodic idle timeout checker
     */
    startIdleChecker() {
        this.idleCheckTimer = setInterval(() => {
            this.checkIdleSessions();
        }, IDLE_CHECK_INTERVAL);
    }
    /**
     * Start SSE heartbeat — sends named events to keep connections alive
     * through proxies (Tailscale Serve, Next.js API proxy) that drop idle streams.
     * Uses named events (not SSE comments) so the browser's EventSource API
     * dispatches them to JavaScript handlers, keeping lastConnected fresh.
     */
    startSSEHeartbeat() {
        this.sseHeartbeatTimer = setInterval(() => {
            for (const session of this.sessions.values()) {
                if (session.sseClients.size === 0)
                    continue;
                const deadClients = [];
                for (const client of session.sseClients) {
                    try {
                        client.write('event: heartbeat\ndata: {}\n\n');
                    }
                    catch {
                        deadClients.push(client);
                    }
                }
                for (const client of deadClients) {
                    session.sseClients.delete(client);
                }
                if (deadClients.length > 0) {
                    console.log(`[SSE] heartbeat found ${deadClients.length} dead client(s) for ${session.name} (remaining: ${session.sseClients.size})`);
                    this.updateClientCount(session);
                }
            }
        }, SSE_HEARTBEAT_INTERVAL_MS);
    }
    /**
     * Check for and terminate idle sessions
     */
    async checkIdleSessions() {
        const now = Date.now();
        for (const [name, session] of this.sessions) {
            // Only check detached sessions (no connected clients)
            if (session.status !== 'detached' || !session.idleTimeout) {
                continue;
            }
            // Respect grace period after disconnect (prevents race condition with reconnecting clients)
            if (session.lastClientDisconnect) {
                const disconnectTime = new Date(session.lastClientDisconnect).getTime();
                if (now - disconnectTime < DETACH_GRACE_PERIOD) {
                    continue; // Still within grace period
                }
            }
            const lastActive = new Date(session.lastActive).getTime();
            const idleTime = now - lastActive;
            if (idleTime > session.idleTimeout) {
                console.log(`Session ${name} idle for ${Math.round(idleTime / 1000 / 60)} minutes, stopping...`);
                await this.stopSession(name);
            }
        }
    }
    /**
     * PIDs of this bridge's currently-live sessions — the orphan reaper
     * (feature 078) must never touch these.
     */
    getLiveSessionPids() {
        const pids = new Set();
        for (const session of this.sessions.values()) {
            if (session.pid)
                pids.add(session.pid);
            if (session.pty?.pid)
                pids.add(session.pty.pid);
        }
        return pids;
    }
    /**
     * pid -> session name for persisted sessions that are NOT live in this
     * bridge but still have a recorded pid — i.e. sessions a previous bridge
     * incarnation spawned and never observed exiting. Corroboration source for
     * the orphan reaper (feature 078); the reaper still requires the process's
     * own SLYCODE_SESSION env tag to match before it counts (PID-reuse guard).
     */
    getStaleSessionPids() {
        const live = this.getLiveSessionPids();
        const stale = new Map();
        for (const [name, persisted] of Object.entries(this.persistedState.sessions)) {
            if (typeof persisted.pid === 'number' && persisted.pid > 0 && !live.has(persisted.pid)) {
                stale.set(persisted.pid, name);
            }
        }
        return stale;
    }
    async loadPersistedState() {
        try {
            const data = await fs.readFile(this.config.sessionFile, 'utf-8');
            this.persistedState = JSON.parse(data);
            console.log(`Loaded ${Object.keys(this.persistedState.sessions).length} persisted session references`);
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                // File doesn't exist yet — first run, start fresh
                this.persistedState = { sessions: {} };
                return;
            }
            // Any other error (corrupt JSON, permissions, disk) — refuse to start
            // rather than risk overwriting valid session data with empty state
            console.error('FATAL: Could not read bridge-sessions.json:', err);
            throw new Error(`Cannot load session state: ${err.message}. Fix or remove the file manually.`);
        }
    }
    async savePersistedState() {
        // Write to temp file first, then rename — atomic on POSIX.
        // Use unique suffix to avoid races when concurrent saves happen
        // (e.g. stopSession's handlePtyExit + createSession both saving).
        const suffix = `${process.pid}.${Date.now()}`;
        const tmpFile = `${this.config.sessionFile}.tmp.${suffix}`;
        try {
            await fs.writeFile(tmpFile, JSON.stringify(this.persistedState, null, 2));
            await fs.rename(tmpFile, this.config.sessionFile);
        }
        catch (err) {
            // Clean up orphaned temp file on failure
            try {
                await fs.unlink(tmpFile);
            }
            catch { /* ignore */ }
            throw err;
        }
    }
    extractGroup(name) {
        const parts = name.split(':');
        return parts[0] || name;
    }
    /**
     * Convert a new-format session name to old format by removing the provider segment.
     * New: {project}:{provider}:card:{cardId} → Old: {project}:card:{cardId}
     * New: {project}:{provider}:global → Old: {project}:global
     * Returns null if name is not in new format.
     */
    toLegacySessionName(name) {
        const parts = name.split(':');
        if (parts.length === 4 && parts[2] === 'card') {
            return `${parts[0]}:card:${parts[3]}`;
        }
        if (parts.length === 3 && parts[2] === 'global') {
            return `${parts[0]}:global`;
        }
        return null;
    }
    /**
     * Resolve a session name, falling back to legacy format (without provider segment)
     * for backward compatibility with sessions created before multi-provider support.
     */
    resolveSessionName(name) {
        if (this.sessions.has(name) || this.persistedState.sessions[name]) {
            return name;
        }
        const legacyName = this.toLegacySessionName(name);
        if (legacyName && (this.sessions.has(legacyName) || this.persistedState.sessions[legacyName])) {
            return legacyName;
        }
        return name;
    }
    async createSession(request) {
        const { name, fresh = false, idleTimeout, prompt } = request;
        const cwd = request.cwd;
        const model = request.model;
        if (!cwd || !path.isAbsolute(cwd)) {
            throw new Error(`CWD must be an absolute path (got '${cwd || ''}')`);
        }
        // Resolve provider: explicit provider field, or fall back to command field, or default to bash
        let providerConfig = null;
        let providerId = 'bash';
        let command = request.command || 'bash';
        const skipPermissions = request.skipPermissions ?? true; // Default true for backward compat
        if (request.provider) {
            providerConfig = await getProvider(request.provider);
            if (providerConfig) {
                providerId = providerConfig.id;
                command = providerConfig.command;
            }
            else {
                throw new Error(`Unknown provider: ${request.provider}`);
            }
        }
        else if (request.command && request.command !== 'bash') {
            // Legacy path: command field without provider (e.g. command: 'claude')
            // Try to find a matching provider
            providerConfig = await getProvider(request.command);
            if (providerConfig) {
                providerId = providerConfig.id;
                command = providerConfig.command;
            }
            else if (!isCommandShellSafe(request.command)) {
                // Provider miss + the raw client string would otherwise flow to the
                // shell in resolveCommand. Reject anything with shell metacharacters
                // before it can spawn. (Bare tokens / absolute paths still pass.)
                throw new Error(`Invalid command: ${request.command}`);
            }
        }
        // Create missing instruction file only when explicitly requested
        if (providerConfig && cwd && request.createInstructionFile === true) {
            await ensureInstructionFile(providerId, cwd);
        }
        // Validate command against whitelist
        if (!this.runtimeConfig.allowedCommands.includes(command)) {
            throw new Error(`Command '${command}' is not allowed. Allowed commands: ${this.runtimeConfig.allowedCommands.join(', ')}`);
        }
        // Validate CWD exists and is accessible
        try {
            await fs.access(cwd, fsConstants.R_OK | fsConstants.X_OK);
            const stat = await fs.stat(cwd);
            if (!stat.isDirectory()) {
                throw new Error(`CWD '${cwd}' is not a directory`);
            }
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                throw new Error(`CWD '${cwd}' does not exist`);
            }
            if (err.code === 'EACCES') {
                throw new Error(`CWD '${cwd}' is not accessible`);
            }
            throw err;
        }
        // Check if session already exists and is running/detached/creating (with legacy fallback)
        const resolvedRunning = this.resolveSessionName(name);
        const existing = this.sessions.get(resolvedRunning);
        if (existing && (existing.status === 'running' || existing.status === 'detached' || existing.status === 'creating')) {
            if (existing.status === 'creating') {
                // Session is being set up — return in-progress info (idempotent, caller gets 202)
                return this.getSessionInfo(name);
            }
            if (fresh) {
                // Fresh session requested — stop existing session before creating new one
                await this.stopSession(resolvedRunning);
                // Fall through to create new session
            }
            else {
                // Reuse existing session — deliver the prompt through the verified
                // submit primitive (feature 070 phase B): paste, confirm queued,
                // Enter, verify the input cleared, Enter-only resend. This retired
                // the last blind paste+600ms+Enter copy in the bridge. Callers using
                // the verifyDelivery API flag get the typed result from the route;
                // legacy callers still benefit from the verification — a failure is
                // logged loudly instead of silently stranding the prompt.
                if (prompt && existing.pty) {
                    const result = await this.submitVerified(name, { prompt, force: true });
                    const d = result.delivery;
                    if (d && d.outcome !== 'delivered') {
                        console.warn(`Reuse-path prompt delivery ${d.outcome} for ${name}${d.reason ? ` (${d.reason})` : ''}`);
                    }
                }
                // Reattach if was detached
                if (existing.status === 'detached' && existing.pty) {
                    existing.status = 'running';
                }
                return this.getSessionInfo(name);
            }
        }
        // Enforce max sessions limit
        if (this.sessions.size >= this.config.maxSessions) {
            throw new Error(`Maximum sessions limit (${this.config.maxSessions}) reached`);
        }
        // Reserve the session name with 'creating' status to prevent concurrent creation.
        // This synchronous Map insert acts as a mutex — any concurrent createSession() call
        // for the same name will hit the guard above and return 202.
        const creatingPlaceholder = {
            name,
            group: this.extractGroup(name),
            command: '',
            args: [],
            cwd,
            provider: providerId,
            skipPermissions,
            status: 'creating',
            pid: null,
            connectedClients: 0,
            claudeSessionId: null,
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString(),
            lastOutputAt: new Date().toISOString(),
            activityStartedAt: new Date().toISOString(),
            idleTimeout: null,
            pty: null,
            clients: new Set(),
            sseClients: new Set(),
            headlessTerminal: null,
            serializeAddon: null,
            terminalDimensions: { cols: DEFAULT_PTY_COLS, rows: DEFAULT_PTY_ROWS },
            activityTransitions: [],
        };
        this.sessions.set(name, creatingPlaceholder);
        try {
            // Check for persisted session (for resume) — also check legacy name
            const persisted = this.persistedState.sessions[name]
                || this.persistedState.sessions[this.toLegacySessionName(name) || ''];
            const hasHistory = !!persisted && !!persisted.claudeSessionId;
            const doResume = !fresh && hasHistory;
            const storedSessionId = doResume ? persisted.claudeSessionId : null;
            const isProviderSession = !!providerConfig;
            // On Windows, .cmd batch wrappers run through cmd.exe which mangles multi-line
            // CLI arguments (newlines become command separators). Strip the prompt from args
            // and deliver it via bracketed paste after the provider finishes starting up.
            const isWindows = os.platform() === 'win32';
            const promptForArgs = (isWindows && prompt) ? undefined : prompt;
            const deferredPrompt = (isWindows && prompt) ? prompt : undefined;
            // Build args using provider config or legacy path
            let args;
            if (providerConfig) {
                const built = buildProviderCommand({
                    provider: providerConfig,
                    skipPermissions,
                    resume: doResume,
                    sessionId: storedSessionId,
                    prompt: promptForArgs,
                    model: doResume ? undefined : model,
                });
                command = built.command;
                args = built.args;
            }
            else {
                // Plain bash or unknown command — no special args
                args = [];
            }
            // For providers that support session detection, capture existing session files before spawn
            let claudeDir = null;
            let beforeSessionFiles = [];
            if (providerConfig && supportsSessionDetection(providerConfig) && !doResume) {
                claudeDir = getProviderSessionDir(providerId, cwd);
                if (claudeDir) {
                    beforeSessionFiles = await listProviderSessionFiles(providerId, claudeDir);
                }
            }
            // Create headless terminal for state management
            const headlessTerminal = new HeadlessTerminal({
                cols: DEFAULT_PTY_COLS,
                rows: DEFAULT_PTY_ROWS,
                scrollback: 10000,
                allowProposedApi: true,
            });
            const serializeAddon = new SerializeAddon();
            headlessTerminal.loadAddon(serializeAddon);
            const now = new Date().toISOString();
            const session = {
                name,
                group: this.extractGroup(name),
                command,
                args,
                cwd,
                provider: providerId,
                skipPermissions,
                model: model || undefined,
                status: 'running',
                pid: null,
                connectedClients: 0,
                claudeSessionId: doResume ? storedSessionId : null,
                createdAt: doResume ? (persisted?.createdAt || now) : now,
                lastActive: persisted?.lastActive || now,
                lastOutputAt: now,
                activityStartedAt: now,
                idleTimeout: idleTimeout ?? this.config.defaultIdleTimeout,
                pty: null,
                clients: new Set(),
                sseClients: new Set(),
                headlessTerminal,
                serializeAddon,
                terminalDimensions: { cols: DEFAULT_PTY_COLS, rows: DEFAULT_PTY_ROWS },
                claudeDir: claudeDir || undefined,
                claudeBeforeFiles: (providerConfig && supportsSessionDetection(providerConfig)) ? beforeSessionFiles : undefined,
                activityTransitions: [],
                pendingPrompt: deferredPrompt,
            };
            // Persist BEFORE spawning the PTY to avoid a race condition:
            // If the PTY exits very quickly, handlePtyExit fires during our savePersistedState().
            // Both saves would be concurrent — and createSession's rename could finish last,
            // overwriting handlePtyExit's version (which has exitCode). By persisting first,
            // our save completes before the PTY can exit, giving handlePtyExit an uncontested save.
            this.persistedState.sessions[name] = {
                claudeSessionId: session.claudeSessionId,
                cwd: session.cwd,
                createdAt: session.createdAt,
                lastActive: session.lastActive,
                provider: providerId,
                skipPermissions,
                model: model || undefined,
            };
            await this.savePersistedState();
            // Spawn the PTY
            session.pty = spawnPty({
                command,
                args,
                cwd,
                cols: DEFAULT_PTY_COLS,
                rows: DEFAULT_PTY_ROWS,
                extraEnv: { SLYCODE_SESSION: name },
                onData: (data) => this.handlePtyOutput(name, data),
                onExit: (code) => this.handlePtyExit(name, code, session.createdAt),
            });
            session.pid = session.pty.pid;
            // Record the pid in persisted state in memory only — the next save
            // (GUID detection, exit, any state change) carries it. No immediate
            // save here: that would race handlePtyExit for fast-exiting PTYs
            // (see the persist-before-spawn comment above).
            if (this.persistedState.sessions[name]) {
                this.persistedState.sessions[name].pid = session.pid;
            }
            // Replace the 'creating' placeholder with the fully initialized session
            this.sessions.set(name, session);
            // Safety net for deferred prompt: deliver after max timeout even if output never settles
            if (deferredPrompt) {
                setTimeout(() => {
                    const s = this.sessions.get(name);
                    if (s?.pendingPrompt) {
                        this.deliverPendingPrompt(name);
                    }
                }, DEFERRED_PROMPT_MAX_TIMEOUT_MS);
            }
            // For providers with session detection, detect the session ID in background
            if (providerConfig && supportsSessionDetection(providerConfig) && !session.claudeSessionId && claudeDir) {
                this.detectProviderSessionId(name, providerId, claudeDir, beforeSessionFiles);
            }
            console.log(`Session created: ${name} [${providerConfig?.displayName || command}] (pid: ${session.pid})${doResume ? ' [resumed]' : ''}`);
            return {
                name,
                group: session.group,
                status: 'running',
                pid: session.pid,
                connectedClients: 0,
                hasHistory,
                resumed: doResume,
                lastActive: session.lastActive,
                provider: providerId,
                skipPermissions,
            };
        }
        catch (err) {
            // Clean up the 'creating' placeholder on failure
            this.sessions.delete(name);
            throw err;
        }
    }
    /**
     * Background task to detect provider session ID after spawn
     */
    async detectProviderSessionId(name, providerId, sessionDir, beforeFiles) {
        // Custom watch that uses live claimed-GUID checks (not a stale snapshot)
        // Gemini CLI takes ~30s to create session files; Claude is ~5s. Use 60s to be safe.
        const sessionId = await this.watchForUnclaimedSession(name, providerId, sessionDir, beforeFiles, 60000);
        if (sessionId) {
            await this.claimDetectedSessionId(name, sessionId);
        }
    }
    /**
     * Exit-time last-chance session-id detection (feature 080). Single-shot
     * before/after diff against the spawn-time snapshot — no polling watch.
     * Called from handlePtyExit AFTER guidDetectionCancelled is set, so it
     * claims via allowCancelled.
     */
    async detectSessionIdAtExit(name) {
        const session = this.sessions.get(name);
        if (!session || session.claudeSessionId)
            return;
        const providerId = session.provider || 'claude';
        const providerConfig = await getProvider(providerId);
        if (!providerConfig || !supportsSessionDetection(providerConfig))
            return;
        const sessionDir = session.claudeDir || getProviderSessionDir(providerId, session.cwd);
        if (!sessionDir)
            return;
        try {
            const sessionId = await detectNewProviderSessionId(providerId, sessionDir, session.claudeBeforeFiles || []);
            if (sessionId) {
                const claimed = await this.claimDetectedSessionId(name, sessionId, true);
                if (claimed) {
                    console.log(`[detection] Exit-time link: ${sessionId} → ${name}`);
                }
            }
        }
        catch (err) {
            console.warn(`[detection] Exit-time detection failed for ${name}:`, err);
        }
    }
    /**
     * Atomically claim a detected session id for a session (feature 080 —
     * shared by spawn-time watch, re-armed watches, and exit-time detection).
     * `allowCancelled` lets the exit-time check link a session whose watch
     * cancellation flag was just set by handlePtyExit.
     */
    async claimDetectedSessionId(name, sessionId, allowCancelled = false) {
        const session = this.sessions.get(name);
        if (session && (allowCancelled || !session.guidDetectionCancelled)) {
            // Atomic claim: check and assign in the same synchronous tick
            if (!this.getClaimedGuids().has(sessionId)) {
                session.claudeSessionId = sessionId;
                // Update persisted state
                if (this.persistedState.sessions[name]) {
                    this.persistedState.sessions[name].claudeSessionId = sessionId;
                    await this.savePersistedState();
                }
                return true;
            }
        }
        else if (!session && this.persistedState.sessions[name]) {
            // Session already exited and was removed from the map, but GUID detection
            // completed after exit. Still link the GUID in persisted state so the UI
            // shows the session attached to the card (resumable for manual inspection).
            if (!this.getClaimedGuids().has(sessionId)) {
                this.persistedState.sessions[name].claudeSessionId = sessionId;
                await this.savePersistedState();
                console.log(`[detection] Linked session ID ${sessionId} to exited session ${name}`);
                return true;
            }
        }
        return false;
    }
    handlePtyOutput(name, data) {
        const session = this.sessions.get(name);
        if (!session)
            return;
        // Feed data to headless terminal for proper state management
        if (session.headlessTerminal) {
            session.headlessTerminal.write(data);
        }
        // Broadcast to WebSocket clients
        for (const client of session.clients) {
            if (client.readyState === 1) { // WebSocket.OPEN
                try {
                    client.send(JSON.stringify({ type: 'output', data }));
                }
                catch {
                    // Client disconnected or errored — will be cleaned up on close
                }
            }
        }
        // Broadcast to SSE clients (collect dead clients to remove after iteration)
        const deadSseClients = [];
        for (const client of session.sseClients) {
            try {
                client.write(`event: output\ndata: ${JSON.stringify({ data })}\n\n`);
            }
            catch {
                deadSseClients.push(client);
            }
        }
        // Remove dead SSE clients
        for (const client of deadSseClients) {
            session.sseClients.delete(client);
        }
        if (deadSseClients.length > 0) {
            this.updateClientCount(session);
        }
        const now = new Date().toISOString();
        const nowMs = Date.now();
        // Strip ANSI to check for visible content
        const visibleContent = stripAnsi(data);
        // Always track last output info for transition logging (even invisible output)
        session.lastOutputSnippet = visibleContent.slice(0, 80);
        session.lastOutputRawHex = toHex(data);
        session.lastOutputDataLength = data.length;
        // Only update activity timestamps if output has visible content.
        // Invisible terminal control sequences (cursor moves, line clearing, synchronized
        // update markers) should not trigger the activity indicator.
        if (visibleContent.length > 0) {
            // Check if this is a new activity burst (gap > threshold since last output)
            const lastOutputMs = new Date(session.lastOutputAt).getTime();
            if (nowMs - lastOutputMs > ACTIVITY_THRESHOLD_MS) {
                // Gap in activity - start a new burst
                session.activityStartedAt = now;
            }
            session.lastOutputAt = now; // Track output timestamp for activity detection
            // Deferred prompt delivery (Windows): debounce until output settles.
            // Each new visible output resets the timer — once the provider finishes its
            // startup burst and goes quiet, the prompt is delivered via bracketed paste.
            if (session.pendingPrompt) {
                if (session.pendingPromptTimer) {
                    clearTimeout(session.pendingPromptTimer);
                }
                session.pendingPromptTimer = setTimeout(() => {
                    this.deliverPendingPrompt(name);
                }, DEFERRED_PROMPT_SETTLE_MS);
            }
        }
    }
    /**
     * Deliver a deferred prompt to the PTY.
     * Used on Windows where multi-line prompts can't be passed as CLI arguments
     * through .cmd batch wrappers (cmd.exe interprets newlines as command separators).
     *
     * On Windows, writes in chunks to avoid ConPTY truncation at ~4KB.
     * On all platforms, awaits write completion before sending Enter (fixes
     * intermittent issue where \r fires before large prompts finish writing).
     */
    async deliverPendingPrompt(name) {
        const session = this.sessions.get(name);
        if (!session?.pendingPrompt || !session.pty)
            return;
        const prompt = session.pendingPrompt;
        session.pendingPrompt = undefined;
        if (session.pendingPromptTimer) {
            clearTimeout(session.pendingPromptTimer);
            session.pendingPromptTimer = undefined;
        }
        try {
            // Verified delivery (feature 070 phase B): the deferred Windows path now
            // uses the same self-verifying primitive — it already carried the
            // chunk-scaled settle, and now also gets the pre-paste dialog check
            // (resume-time update/trust prompts) plus post-Enter verification.
            const result = await this.submitVerified(name, { prompt, force: true });
            const d = result.delivery;
            if (!result.success) {
                console.error(`Deferred prompt delivery ${d?.outcome ?? 'failed'} for ${name}${d?.reason ? ` (${d.reason})` : ''}`);
                return;
            }
            console.log(`Deferred prompt delivered to ${name} (${prompt.length} chars${d?.resends ? `, ${d.resends} Enter resend(s)` : ''})`);
        }
        catch (err) {
            console.error(`Failed to deliver prompt to ${name}:`, err);
        }
    }
    async handlePtyExit(name, code, exitingCreatedAt) {
        const session = this.sessions.get(name);
        if (!session)
            return;
        // Guard: if this exit is from a previous session that was replaced (fresh restart),
        // don't stomp on the replacement. This prevents a race where stopSession() times out,
        // the new session is created, then the old PTY finally exits and deletes the new session.
        //
        // Note on bridge restart scenario: when the bridge process itself dies, child PTY processes
        // are killed too (SIGHUP from parent death). So there are no orphaned exit handlers —
        // this guard only needs to cover the in-process race (stop timeout → new session → old exit).
        if (exitingCreatedAt && session.createdAt !== exitingCreatedAt) {
            console.log(`[PTY] Ignoring stale exit for ${name} (old session created ${exitingCreatedAt}, current created ${session.createdAt})`);
            // Still resolve the exit promise if pending (for stopSession's await)
            if (session.exitResolver) {
                session.exitResolver();
                session.exitResolver = undefined;
            }
            return;
        }
        const exitedAt = new Date().toISOString();
        const aliveMs = session.createdAt ? Date.now() - new Date(session.createdAt).getTime() : null;
        console.log(`Session exited: ${name} (code: ${code}, alive: ${aliveMs !== null ? `${(aliveMs / 1000).toFixed(1)}s` : 'unknown'})`);
        session.status = 'stopped';
        session.exitCode = code;
        session.exitedAt = exitedAt;
        session.pid = null;
        session.pty = null;
        // Clean up deferred prompt if session exited before delivery
        if (session.pendingPromptTimer) {
            clearTimeout(session.pendingPromptTimer);
            session.pendingPromptTimer = undefined;
        }
        session.pendingPrompt = undefined;
        // Cancel any in-flight GUID detection — prevent ghost claims on stopped sessions
        session.guidDetectionCancelled = true;
        // Last-chance session-id detection (feature 080): the provider file exists
        // by now or never will, so run ONE synchronous-ish check (no watch). Runs
        // despite the cancellation flag above — that flag exists to stop the
        // polling watch from stomping stopped sessions; this final check is the
        // authoritative closer that keeps stopped records resumable.
        if (!session.claudeSessionId) {
            void this.detectSessionIdAtExit(name);
        }
        // Resolve any pending stopSession promise (event-driven approach)
        if (session.exitResolver) {
            session.exitResolver();
            session.exitResolver = undefined;
        }
        // Capture last terminal output on exit (for cross-card snapshot diagnostics + error reporting)
        let exitOutput;
        if (!session.stoppedByUser && session.serializeAddon) {
            try {
                const raw = session.serializeAddon.serialize({ scrollback: 20 });
                const stripped = stripAnsi(raw);
                // Only keep non-empty output (filter blank lines, trim)
                const lines = stripped.split('\n').filter(l => l.trim().length > 0);
                if (lines.length > 0) {
                    exitOutput = lines.join('\n');
                    session.exitOutput = exitOutput;
                }
            }
            catch (err) {
                // Terminal may be in a corrupted state — don't let this break exit handling
                console.log(`[PTY] Failed to capture exit output for ${name}:`, err);
            }
        }
        // Dispose headless terminal
        if (session.headlessTerminal) {
            session.headlessTerminal.dispose();
            session.headlessTerminal = null;
            session.serializeAddon = null;
        }
        // Build exit event payload (include output if captured)
        const exitPayload = { code };
        if (exitOutput) {
            exitPayload.output = exitOutput;
        }
        // Notify WebSocket clients
        for (const client of session.clients) {
            if (client.readyState === 1) {
                client.send(JSON.stringify({ type: 'exit', ...exitPayload }));
            }
        }
        // Notify SSE clients
        for (const client of session.sseClients) {
            try {
                client.write(`event: exit\ndata: ${JSON.stringify(exitPayload)}\n\n`);
                client.end();
            }
            catch (err) {
                // Client might already be disconnected
            }
        }
        session.sseClients.clear();
        // Persist exit info and lastActive from in-memory session
        if (this.persistedState.sessions[name]) {
            this.persistedState.sessions[name].lastActive = session.lastActive;
            this.persistedState.sessions[name].exitCode = code;
            this.persistedState.sessions[name].exitedAt = exitedAt;
            this.persistedState.sessions[name].pid = null; // observed exit — not an orphan candidate
            if (session.exitOutput) {
                this.persistedState.sessions[name].exitOutput = session.exitOutput;
            }
            await this.savePersistedState();
        }
        // Remove stopped session from in-memory map to free the slot.
        // Session data is preserved in persistedState for future resume.
        // getSessionInfo() falls back to persistedState when not in the map.
        this.sessions.delete(name);
    }
    getSessionInfo(name) {
        // Resolve with legacy fallback for backward compat
        const resolvedName = this.resolveSessionName(name);
        const session = this.sessions.get(resolvedName);
        if (!session) {
            // Check persisted
            const persisted = this.persistedState.sessions[resolvedName];
            if (persisted) {
                return {
                    name,
                    group: this.extractGroup(name),
                    status: 'stopped',
                    pid: null,
                    connectedClients: 0,
                    hasHistory: !!persisted.claudeSessionId,
                    resumed: false,
                    lastActive: persisted.lastActive,
                    claudeSessionId: persisted.claudeSessionId,
                    provider: persisted.provider || 'claude', // Default old sessions to claude
                    skipPermissions: persisted.skipPermissions ?? true,
                    model: persisted.model,
                    exitCode: persisted.exitCode,
                    exitedAt: persisted.exitedAt,
                    createdAt: persisted.createdAt,
                };
            }
            return null;
        }
        return {
            name,
            group: session.group,
            status: session.status,
            pid: session.pid,
            connectedClients: session.connectedClients,
            hasHistory: !!this.persistedState.sessions[resolvedName]?.claudeSessionId,
            resumed: session.args.includes('--resume') || session.args[0] === 'resume',
            lastActive: session.lastActive,
            lastOutputAt: session.lastOutputAt,
            claudeSessionId: session.claudeSessionId,
            provider: session.provider,
            skipPermissions: session.skipPermissions,
            model: session.model,
            exitCode: session.exitCode,
            exitedAt: session.exitedAt,
            createdAt: session.createdAt,
        };
    }
    getSessionCwd(name) {
        const resolvedName = this.resolveSessionName(name);
        const session = this.sessions.get(resolvedName);
        if (session)
            return session.cwd;
        const persisted = this.persistedState.sessions[resolvedName];
        if (persisted)
            return persisted.cwd;
        return null;
    }
    getAllSessions() {
        const result = [];
        // Active sessions
        for (const [name] of this.sessions) {
            const info = this.getSessionInfo(name);
            if (info)
                result.push(info);
        }
        // Persisted but not active
        for (const name of Object.keys(this.persistedState.sessions)) {
            if (!this.sessions.has(name)) {
                const info = this.getSessionInfo(name);
                if (info)
                    result.push(info);
            }
        }
        return result;
    }
    getGroupStatus(group) {
        const result = {};
        for (const session of this.getAllSessions()) {
            if (session.group === group) {
                const shortName = session.name.replace(`${group}:`, '');
                result[shortName] = {
                    status: session.status,
                    connectedClients: session.connectedClients,
                    hasHistory: session.hasHistory,
                };
            }
        }
        return result;
    }
    /**
     * Get bridge statistics for health monitoring
     */
    getStats() {
        const now = Date.now();
        let bridgeTerminals = 0;
        let connectedClients = 0;
        let activelyWorking = 0;
        const sessions = [];
        for (const session of this.sessions.values()) {
            // Only count running or detached sessions (not stopped)
            if (session.status === 'running' || session.status === 'detached') {
                bridgeTerminals++;
                connectedClients += session.connectedClients;
                const lastOutputTime = new Date(session.lastOutputAt).getTime();
                const activityStartTime = new Date(session.activityStartedAt).getTime();
                // Active if: output within last 2s AND burst has spanned at least 1s of output
                // (a single output blip won't trigger - need sustained output over time)
                const hasRecentOutput = (now - lastOutputTime) < ACTIVITY_THRESHOLD_MS;
                const burstDuration = lastOutputTime - activityStartTime;
                const activitySustained = burstDuration >= ACTIVITY_DEBOUNCE_MS;
                const isActive = hasRecentOutput && activitySustained;
                // Log and record activity state transitions
                if (isActive !== session.lastActivityState) {
                    const transition = {
                        timestamp: new Date().toISOString(),
                        became: isActive ? 'active' : 'inactive',
                        lastOutputAt: session.lastOutputAt,
                        activityStartedAt: session.activityStartedAt,
                        outputAgeMs: now - lastOutputTime,
                        triggerSnippet: session.lastOutputSnippet || '',
                        triggerRawHex: session.lastOutputRawHex || '',
                        triggerDataLength: session.lastOutputDataLength || 0,
                    };
                    session.activityTransitions.push(transition);
                    if (session.activityTransitions.length > ACTIVITY_TRANSITIONS_MAX) {
                        session.activityTransitions.shift();
                    }
                    session.lastActivityState = isActive;
                }
                if (isActive) {
                    activelyWorking++;
                    // Update lastActive only during sustained activity (same bar as blue glow)
                    const now = new Date().toISOString();
                    session.lastActive = now;
                    if (this.persistedState.sessions[session.name]) {
                        this.persistedState.sessions[session.name].lastActive = now;
                    }
                }
                sessions.push({
                    name: session.name,
                    status: session.status,
                    lastOutputAt: session.lastOutputAt,
                    isActive,
                    activityStartedAt: session.activityStartedAt,
                    lastOutputSnippet: session.lastOutputSnippet,
                });
            }
        }
        return {
            bridgeTerminals,
            connectedClients,
            activelyWorking,
            sessions,
        };
    }
    /**
     * Check if a specific session is actively producing output.
     * Returns true (active), false (inactive), or null (session not found/not running).
     */
    isSessionActive(name) {
        const session = this.sessions.get(this.resolveSessionName(name));
        if (!session || (session.status !== 'running' && session.status !== 'detached')) {
            return null;
        }
        const now = Date.now();
        const lastOutputTime = new Date(session.lastOutputAt).getTime();
        const activityStartTime = new Date(session.activityStartedAt).getTime();
        const hasRecentOutput = (now - lastOutputTime) < ACTIVITY_THRESHOLD_MS;
        const burstDuration = lastOutputTime - activityStartTime;
        const activitySustained = burstDuration >= ACTIVITY_DEBOUNCE_MS;
        return hasRecentOutput && activitySustained;
    }
    /**
     * Get activity transitions for a session (for debugging phantom blips)
     */
    getActivityLog(name) {
        const session = this.sessions.get(this.resolveSessionName(name));
        if (!session)
            return null;
        return session.activityTransitions;
    }
    /**
     * Stop all running sessions (for bulk stop action)
     */
    async stopAllSessions() {
        let stoppedCount = 0;
        const sessionsToStop = [];
        // Collect sessions to stop
        for (const [name, session] of this.sessions) {
            if (session.status === 'running' || session.status === 'detached' || session.status === 'creating') {
                sessionsToStop.push(name);
            }
        }
        // Stop each session
        for (const name of sessionsToStop) {
            const result = await this.stopSession(name);
            if (result) {
                stoppedCount++;
            }
        }
        return stoppedCount;
    }
    async stopSession(name) {
        const resolvedName = this.resolveSessionName(name);
        const session = this.sessions.get(resolvedName);
        if (!session) {
            return null;
        }
        // Handle 'creating' sessions — no PTY yet, just clean up the placeholder
        if (session.status === 'creating') {
            session.status = 'stopped';
            session.guidDetectionCancelled = true;
            this.sessions.delete(resolvedName);
            return this.getSessionInfo(resolvedName);
        }
        if (!session.pty) {
            return null;
        }
        // Mark as user-initiated stop so handlePtyExit skips exit output capture
        session.stoppedByUser = true;
        // Create a promise that resolves when PTY exits (event-driven, not polling)
        const exitPromise = new Promise((resolve) => {
            if (session.status === 'stopped') {
                resolve();
                return;
            }
            session.exitResolver = resolve;
        });
        killPty(session.pty);
        // Wait for PTY to actually exit (with timeout)
        await Promise.race([
            exitPromise,
            new Promise(resolve => setTimeout(resolve, 2000)) // 2 second timeout
        ]);
        return this.getSessionInfo(resolvedName);
    }
    /**
     * Delete a session completely (stop if running, remove from persistence)
     */
    async deleteSession(name) {
        const resolvedName = this.resolveSessionName(name);
        // Stop if running
        const session = this.sessions.get(resolvedName);
        if (session?.pty) {
            killPty(session.pty);
        }
        // Dispose headless terminal
        if (session?.headlessTerminal) {
            session.headlessTerminal.dispose();
        }
        // Remove from active sessions
        this.sessions.delete(resolvedName);
        // Remove from persisted state
        if (this.persistedState.sessions[resolvedName]) {
            delete this.persistedState.sessions[resolvedName];
            await this.savePersistedState();
            return true;
        }
        return !!session;
    }
    /**
     * Re-detect the session ID from the provider's session directory.
     * Finds the most recently modified session file and updates persisted state.
     */
    async relinkSession(name) {
        const resolvedName = this.resolveSessionName(name);
        const session = this.sessions.get(resolvedName);
        const persisted = this.persistedState.sessions[resolvedName];
        if (!session && !persisted) {
            throw new Error('Session not found');
        }
        const provider = session?.provider || persisted?.provider || 'claude';
        const cwd = session?.cwd || persisted?.cwd;
        if (!cwd) {
            throw new Error('Session has no CWD');
        }
        const previous = session?.claudeSessionId || persisted?.claudeSessionId || null;
        // Walk candidates newest-first with two cheap guards (feature 080):
        // skip ids claimed by OTHER sessions, and skip files that predate this
        // session — Codex multi-agent runs drop sub-agent rollouts in the same
        // directory, so "newest file" alone can pick the wrong conversation.
        const createdAtIso = session?.createdAt || persisted?.createdAt || null;
        const createdAtMs = createdAtIso ? Date.parse(createdAtIso) : null;
        const candidates = await listProviderSessionCandidates(provider, cwd);
        const viable = filterRelinkCandidates(candidates, {
            claimed: this.getClaimedGuids(),
            ownPrevious: previous,
            createdAtMs: Number.isNaN(createdAtMs) ? null : createdAtMs,
        });
        const newId = viable[0]?.sessionId ?? null;
        if (!newId) {
            throw new Error('No session files found for this provider');
        }
        // Update in-memory session
        if (session) {
            session.claudeSessionId = newId;
        }
        // Update persisted state
        if (persisted) {
            persisted.claudeSessionId = newId;
        }
        else {
            this.persistedState.sessions[resolvedName] = {
                claudeSessionId: newId,
                cwd,
                createdAt: session?.createdAt || new Date().toISOString(),
                lastActive: session?.lastActive || new Date().toISOString(),
                provider,
                skipPermissions: session?.skipPermissions ?? true,
            };
        }
        await this.savePersistedState();
        return { sessionId: newId, previous };
    }
    // WebSocket client management
    addClient(name, ws) {
        const session = this.sessions.get(this.resolveSessionName(name));
        if (!session)
            return false;
        session.clients.add(ws);
        this.updateClientCount(session);
        // Client attach is a detection re-arm event (feature 080)
        if (!session.claudeSessionId) {
            void this.ensureSessionIdDetection(this.resolveSessionName(name));
        }
        // If session was detached, mark as running again
        if (session.status === 'detached' && session.pty) {
            session.status = 'running';
        }
        // Send dimensions event first
        try {
            ws.send(JSON.stringify({
                type: 'dimensions',
                cols: session.terminalDimensions.cols,
                rows: session.terminalDimensions.rows,
            }));
        }
        catch {
            // Client may have disconnected immediately
        }
        // Send serialized terminal state for proper restore (limit to last 500 lines for speed)
        if (session.serializeAddon) {
            try {
                const state = session.serializeAddon.serialize({ scrollback: 500 });
                ws.send(JSON.stringify({ type: 'restore', state }));
            }
            catch {
                // Client may have disconnected immediately
            }
        }
        return true;
    }
    removeClient(name, ws) {
        const session = this.sessions.get(this.resolveSessionName(name));
        if (!session)
            return;
        session.clients.delete(ws);
        this.updateClientCount(session);
        // If no clients and PTY still running, mark as detached with grace period timestamp
        if (session.connectedClients === 0 && session.status === 'running') {
            session.status = 'detached';
            session.lastClientDisconnect = new Date().toISOString();
        }
    }
    // SSE client management
    addSSEClient(name, res) {
        const session = this.sessions.get(this.resolveSessionName(name));
        if (!session)
            return false;
        session.sseClients.add(res);
        this.updateClientCount(session);
        console.log(`[SSE] +client ${name} (total: ${session.sseClients.size} SSE, ${session.clients.size} WS)`);
        // If session was detached, mark as running again
        if (session.status === 'detached' && session.pty) {
            session.status = 'running';
        }
        // Client attach is a detection re-arm event (feature 080)
        if (!session.claudeSessionId) {
            void this.ensureSessionIdDetection(this.resolveSessionName(name));
        }
        // Send dimensions event first
        try {
            res.write(`event: dimensions\ndata: ${JSON.stringify({
                cols: session.terminalDimensions.cols,
                rows: session.terminalDimensions.rows,
            })}\n\n`);
        }
        catch {
            // Client may have disconnected immediately
        }
        // Send serialized terminal state for proper restore (limit to last 500 lines for speed)
        if (session.serializeAddon) {
            try {
                const state = session.serializeAddon.serialize({ scrollback: 500 });
                res.write(`event: restore\ndata: ${JSON.stringify({ state })}\n\n`);
            }
            catch {
                // Client may have disconnected immediately
            }
        }
        return true;
    }
    removeSSEClient(name, res) {
        const session = this.sessions.get(this.resolveSessionName(name));
        if (!session)
            return;
        session.sseClients.delete(res);
        this.updateClientCount(session);
        console.log(`[SSE] -client ${name} (remaining: ${session.sseClients.size} SSE, ${session.clients.size} WS)`);
        // If no clients and PTY still running, mark as detached with grace period timestamp
        if (session.connectedClients === 0 && session.status === 'running') {
            session.status = 'detached';
            session.lastClientDisconnect = new Date().toISOString();
        }
    }
    updateClientCount(session) {
        session.connectedClients = session.clients.size + session.sseClients.size;
    }
    // PTY operations
    // Per-session FIFO write queue. Each /input POST (and the legacy WS input
    // path) runs in its own async handler; because chunked large-paste writes
    // await between chunks, two concurrent writeToSession calls could interleave
    // their bytes at the PTY even when requests arrive in order. Chaining every
    // write onto a per-session tail makes writes atomic relative to each other.
    // Mirrors the submitMutexes pattern (incl. tail cleanup).
    writeQueues = new Map();
    /**
     * Write data to a session's PTY.
     * Serialized per session via writeQueues — concurrent callers can never
     * interleave their bytes (see comment on writeQueues).
     * Uses writeChunkedToPty for ConPTY-safe chunked writes on Windows.
     * If data is wrapped in bracketed paste markers, sends markers atomically
     * and only chunks the inner content to avoid splitting escape sequences.
     */
    async writeToSession(name, data) {
        const resolvedName = this.resolveSessionName(name);
        const prior = this.writeQueues.get(resolvedName) ?? Promise.resolve();
        const run = prior.then(() => this.writeToSessionUnqueued(resolvedName, data));
        // The stored tail swallows rejections so one failed write never poisons
        // the chain for later writes; each caller still sees its own rejection.
        const tail = run.then(() => undefined, () => undefined);
        this.writeQueues.set(resolvedName, tail);
        try {
            return await run;
        }
        finally {
            if (this.writeQueues.get(resolvedName) === tail) {
                this.writeQueues.delete(resolvedName);
            }
        }
    }
    async writeToSessionUnqueued(resolvedName, data) {
        const session = this.sessions.get(resolvedName);
        if (!session || !session.pty)
            return false;
        // Detect bracketed paste wrapping — send markers atomically, chunk inner content
        const OPEN = '\x1b[200~';
        const CLOSE = '\x1b[201~';
        if (data.startsWith(OPEN) && data.endsWith(CLOSE)) {
            const inner = data.slice(OPEN.length, data.length - CLOSE.length);
            writeToPty(session.pty, OPEN);
            await writeChunkedToPty(session.pty, inner);
            writeToPty(session.pty, CLOSE);
        }
        else {
            await writeChunkedToPty(session.pty, data);
        }
        // If this session doesn't have a GUID yet, (re-)arm detection — input is
        // the event that makes lazily-created provider session files appear (080)
        if (!session.claudeSessionId) {
            void this.ensureSessionIdDetection(resolvedName);
        }
        return true;
    }
    /**
     * Watch for a new unclaimed session file.
     * Uses live getClaimedGuids() checks on each poll iteration to prevent
     * two concurrent watchers from claiming the same GUID.
     */
    watchForUnclaimedSession(sessionName, providerId, sessionDir, beforeFiles, timeoutMs) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const pollInterval = 200;
            let pollCount = 0;
            const check = async () => {
                // Check if detection was cancelled (session stopped/exited)
                const session = this.sessions.get(sessionName);
                if (session?.guidDetectionCancelled) {
                    resolve(null);
                    return;
                }
                pollCount++;
                const sessionId = await detectNewProviderSessionId(providerId, sessionDir, beforeFiles);
                // Live check against currently claimed GUIDs (not a stale snapshot)
                if (sessionId && !this.getClaimedGuids().has(sessionId)) {
                    resolve(sessionId);
                    return;
                }
                if (Date.now() - startTime > timeoutMs) {
                    resolve(null);
                    return;
                }
                setTimeout(check, pollInterval);
            };
            check();
        });
    }
    /**
     * Get all GUIDs that are already claimed by any session (active or persisted)
     */
    getClaimedGuids() {
        const claimed = new Set();
        // From active sessions
        for (const session of this.sessions.values()) {
            if (session.claudeSessionId) {
                claimed.add(session.claudeSessionId);
            }
        }
        // From persisted sessions
        for (const persisted of Object.values(this.persistedState.sessions)) {
            if (persisted.claudeSessionId) {
                claimed.add(persisted.claudeSessionId);
            }
        }
        return claimed;
    }
    /**
     * Event-anchored session-id detection (feature 080). Idempotent: no-ops when
     * the id is captured, detection was cancelled (session stopped), a watch is
     * already in flight, or one was armed within the cooldown. Otherwise starts
     * a fresh 60s watch with the spawn-time before-files snapshot — providers
     * like Codex create their session file lazily on FIRST PROMPT, so input
     * delivery (not spawn) is the event that makes detection succeed.
     */
    async ensureSessionIdDetection(name) {
        const session = this.sessions.get(name);
        if (!session)
            return;
        const arm = shouldArmDetection({
            hasId: !!session.claudeSessionId,
            cancelled: !!session.guidDetectionCancelled,
            inFlight: !!session.guidDetectionInFlight,
            lastArmedAt: session.guidDetectionLastArmedAt ?? null,
            now: Date.now(),
            cooldownMs: GUID_REARM_COOLDOWN_MS,
        });
        if (!arm)
            return;
        const providerId = session.provider || 'claude';
        const providerConfig = await getProvider(providerId);
        if (!providerConfig || !supportsSessionDetection(providerConfig))
            return;
        // Use the stored claudeDir and beforeFiles from session creation
        const sessionDir = session.claudeDir || getProviderSessionDir(providerId, session.cwd);
        if (!sessionDir)
            return;
        const beforeFiles = session.claudeBeforeFiles || [];
        session.guidDetectionInFlight = true;
        session.guidDetectionLastArmedAt = Date.now();
        try {
            const sessionId = await this.watchForUnclaimedSession(name, providerId, sessionDir, beforeFiles, 60000);
            if (sessionId) {
                await this.claimDetectedSessionId(name, sessionId);
            }
        }
        finally {
            const live = this.sessions.get(name);
            if (live)
                live.guidDetectionInFlight = false;
        }
    }
    resizeSession(name, cols, rows) {
        const session = this.sessions.get(this.resolveSessionName(name));
        if (!session || !session.pty)
            return false;
        resizePty(session.pty, cols, rows);
        // Also resize the headless terminal
        if (session.headlessTerminal) {
            session.headlessTerminal.resize(cols, rows);
        }
        session.terminalDimensions = { cols, rows };
        // Broadcast new dimensions to all connected SSE clients so other tabs can adapt
        const dimsPayload = `event: resize\ndata: ${JSON.stringify({ cols, rows })}\n\n`;
        const deadClients = [];
        for (const client of session.sseClients) {
            try {
                client.write(dimsPayload);
            }
            catch {
                deadClients.push(client);
            }
        }
        for (const client of deadClients) {
            session.sseClients.delete(client);
        }
        if (deadClients.length > 0) {
            this.updateClientCount(session);
        }
        return true;
    }
    sendSignal(name, signal) {
        const session = this.sessions.get(this.resolveSessionName(name));
        if (!session || !session.pty)
            return false;
        // Validate signal against allowed list
        if (!ALLOWED_SIGNALS.has(signal)) {
            console.warn(`Rejected invalid signal: ${signal}`);
            return false;
        }
        killPty(session.pty, signal);
        return true;
    }
    // --- Cross-card prompt execution ---
    responseStore = null;
    submitMutexes = new Map();
    // Prompt depth tracking: prevents runaway cross-card call chains
    static MAX_PROMPT_DEPTH = 4;
    static CHAIN_TTL_MS = 30 * 60 * 1000; // 30 minutes
    promptChains = new Map();
    setResponseStore(store) {
        this.responseStore = store;
    }
    /**
     * Await any in-flight verified submit on this session (best-effort — a new
     * submit starting afterwards is not blocked). Used by raw /input so
     * interactive keystrokes can't inject into the middle of a semantic
     * paste+Enter sequence.
     */
    async awaitSubmitIdle(name) {
        const mutex = this.submitMutexes.get(this.resolveSessionName(name));
        if (mutex)
            await mutex;
    }
    /**
     * Get the current prompt depth for a session by tracing the call chain.
     */
    getPromptDepth(sessionName) {
        const entry = this.promptChains.get(sessionName);
        if (!entry)
            return 0;
        // Expire stale entries
        if (Date.now() - entry.timestamp > SessionManager.CHAIN_TTL_MS) {
            this.promptChains.delete(sessionName);
            return 0;
        }
        return entry.depth;
    }
    /**
     * Record a prompt chain link (for depth tracking when session was created with CLI-arg prompt).
     * Returns the recorded depth or an error if max depth exceeded.
     */
    clearPromptChain(sessionName) {
        this.promptChains.delete(this.resolveSessionName(sessionName));
    }
    recordPromptChain(targetSession, callingSession) {
        const resolvedTarget = this.resolveSessionName(targetSession);
        const callerDepth = this.getPromptDepth(callingSession);
        const newDepth = callerDepth + 1;
        if (newDepth > SessionManager.MAX_PROMPT_DEPTH) {
            return { success: false, depth: newDepth, error: `Maximum prompt depth (${SessionManager.MAX_PROMPT_DEPTH}) reached.` };
        }
        this.promptChains.set(resolvedTarget, { calledBy: callingSession, depth: newDepth, timestamp: Date.now() });
        return { success: true, depth: newDepth };
    }
    /**
     * Atomically submit a prompt to a session: bracketed paste → delay → Enter.
     * Enforces three-state guard: call-locked, active/busy, idle/ready.
     * Per-session mutex prevents concurrent prompt interleaving.
     * Depth tracking prevents runaway cross-card call chains (max 4 levels).
     */
    async submitPrompt(name, request) {
        const resolvedName = this.resolveSessionName(name);
        const session = this.sessions.get(resolvedName);
        // Check session exists and is running
        if (!session) {
            const persisted = this.persistedState.sessions[resolvedName];
            const status = persisted ? 'stopped' : 'not_found';
            return { success: false, sessionStatus: status, isActive: false, error: status === 'stopped' ? 'Session is stopped. Use --create to start a new session.' : 'Session not found.' };
        }
        // Accept both 'running' and 'detached' — both have an active PTY ready to receive input.
        // 'detached' just means no UI clients are connected, but the PTY is still operational.
        if (session.status !== 'running' && session.status !== 'detached') {
            return { success: false, sessionStatus: session.status, isActive: false, error: `Session is ${session.status}. Cannot submit prompt.` };
        }
        if (!session.pty) {
            return { success: false, sessionStatus: session.status, isActive: false, error: 'Session has no active PTY.' };
        }
        // Depth check — prevent runaway cross-card call chains (not bypassable with --force)
        if (request.callingSession) {
            const callerDepth = this.getPromptDepth(request.callingSession);
            const newDepth = callerDepth + 1;
            if (newDepth > SessionManager.MAX_PROMPT_DEPTH) {
                return {
                    success: false, sessionStatus: session.status, isActive: false,
                    error: `Maximum prompt depth (${SessionManager.MAX_PROMPT_DEPTH}) reached. Call chain too deep — cannot call another card. This prevents runaway cross-card loops.`,
                };
            }
            // Record this link in the chain
            this.promptChains.set(resolvedName, { calledBy: request.callingSession, depth: newDepth, timestamp: Date.now() });
        }
        // Acquire per-session mutex BEFORE guard checks (prevents two callers both passing idle check)
        const existingMutex = this.submitMutexes.get(resolvedName);
        let releaseMutex;
        const mutexPromise = new Promise(resolve => { releaseMutex = resolve; });
        this.submitMutexes.set(resolvedName, mutexPromise);
        if (existingMutex)
            await existingMutex;
        try {
            if (!request.force) {
                // Check call lock (inside mutex to prevent race)
                if (this.responseStore?.isSessionLocked(resolvedName, request.responseId)) {
                    const lock = this.responseStore.getActiveLock(resolvedName, request.responseId);
                    const lockAge = lock ? Math.round((Date.now() - lock.lockedAt) / 1000) : 0;
                    return {
                        success: false, sessionStatus: session.status, isActive: false, locked: true,
                        error: `Session is currently responding to a prompt from ${lock?.callingSession || 'another caller'} (locked ${lockAge}s ago). Try again later.`,
                    };
                }
                // Check if session is actively generating output
                const active = this.isSessionActive(resolvedName);
                if (active) {
                    const outputAge = Date.now() - new Date(session.lastOutputAt).getTime();
                    return {
                        success: false, sessionStatus: session.status, isActive: true, busy: true,
                        error: `Session is currently active (output ${Math.round(outputAge / 1000)}s ago). The AI may be mid-response. Use --force to send anyway.`,
                    };
                }
            }
            const prompt = request.prompt;
            if (!prompt || prompt.trim().length === 0) {
                return { success: false, sessionStatus: session.status, isActive: false, error: 'Prompt cannot be empty.' };
            }
            if (request.bracketedPaste === false) {
                // Raw (non-bracketed) write — rare compat path. Without paste markers
                // framing the content there is nothing to verify against; legacy
                // fixed-delay behavior is preserved.
                if (!session.claudeSessionId) {
                    void this.ensureSessionIdDetection(resolvedName);
                }
                await writeChunkedToPty(session.pty, prompt);
                const submitDelay = parseInt(process.env.PROMPT_SUBMIT_DELAY_MS || '600', 10);
                await new Promise(r => setTimeout(r, submitDelay));
                writeToPty(session.pty, '\r');
                const isActive = this.isSessionActive(resolvedName) || false;
                return { success: true, sessionStatus: session.status, isActive };
            }
            // Verified delivery (feature 070 phase B): cross-card prompts use the
            // same self-verifying primitive as automations and questionnaire
            // submits — paste, confirm queued, Enter, verify the input cleared
            // (Enter-only resend). The call-lock/busy/depth guards above are
            // cross-card-specific and stay here, layered on top.
            const delivery = await this.performVerifiedDelivery(resolvedName, prompt);
            const isActive = this.isSessionActive(resolvedName) || false;
            if (delivery.outcome !== 'delivered') {
                return {
                    success: false, sessionStatus: session.status, isActive, delivery,
                    error: `Prompt delivery ${delivery.outcome}${delivery.reason ? ` (${delivery.reason})` : ''}.`,
                };
            }
            return { success: true, sessionStatus: session.status, isActive, delivery };
        }
        finally {
            releaseMutex();
            // Clean up mutex if it's still ours
            if (this.submitMutexes.get(resolvedName) === mutexPromise) {
                this.submitMutexes.delete(resolvedName);
            }
        }
    }
    /** Post-Enter poll ladder (cumulative ~1s/3s/6s) — spike observed legitimate submits clearing as late as ~5s. */
    static VERIFY_POLL_DELAYS_MS = [1000, 2000, 3000];
    static VERIFY_MAX_RESENDS = 2;
    /**
     * Post-paste confirm settle-retry (extra re-check delays beyond the paste's
     * own settle). The paste render can lag, and a transient screen state (agent
     * output still repainting, a redraw) can momentarily read as queued_other/
     * empty even though our paste landed — a single glance here was the cause of
     * spurious `paste_not_observed` failures. The common case matches on the
     * first check and pays none of this; only an unsettled screen re-checks.
     */
    static POST_PASTE_CONFIRM_DELAYS_MS = [600, 900, 1200];
    /** Snapshot depth for input-region classification — enough rows for chrome + a wrapped paste. */
    static VERIFY_SNAPSHOT_LINES = 60;
    verifySnapshotClassify(name, expected) {
        const session = this.sessions.get(name);
        const provider = session?.provider;
        if (provider !== 'claude' && provider !== 'codex' && provider !== 'gemini')
            return null;
        const snap = this.getSnapshot(name, SessionManager.VERIFY_SNAPSHOT_LINES);
        if (!snap)
            return null;
        return classifyInputRegion(provider, snap.content, expected);
    }
    /**
     * Self-verifying prompt submit (feature 070).
     *
     * Physically observes the terminal's input region before and after Enter:
     *  - pre-paste: a blocking dialog (no input region) aborts BEFORE pasting —
     *    the spike proved a paste into a dialog renders nowhere and a blind
     *    Enter can ACCEPT the dialog; non-empty input warns and proceeds
     *    (user decision: visibility over suppression, never hard-block).
     *  - post-paste: confirms our payload is queued (placeholder or normalized
     *    prefix). A vanished paste over an empty box is re-pasted once.
     *  - post-Enter: polls the input region (1s/3s/6s); success = our queued
     *    content DISAPPEARED. If a full ladder still shows it queued, re-sends
     *    Enter ONLY (never re-pastes — re-pasting is what caused the historical
     *    duplicate-fire bug), capped at 2 resends, then fails loudly.
     *
     * Returns a four-state DeliveryResult: delivered | failed | ambiguous | blocked.
     * All non-delivered outcomes are meant to be surfaced loudly by callers.
     */
    async submitVerified(name, request) {
        const resolvedName = this.resolveSessionName(name);
        const session = this.sessions.get(resolvedName);
        if (!session) {
            const persisted = this.persistedState.sessions[resolvedName];
            const status = persisted ? 'stopped' : 'not_found';
            return { success: false, sessionStatus: status, error: status === 'stopped' ? 'Session is stopped.' : 'Session not found.' };
        }
        if (session.status !== 'running' && session.status !== 'detached') {
            return { success: false, sessionStatus: session.status, error: `Session is ${session.status}. Cannot submit prompt.` };
        }
        if (!session.pty) {
            return { success: false, sessionStatus: session.status, error: 'Session has no active PTY.' };
        }
        const prompt = request.prompt;
        if (!prompt || prompt.trim().length === 0) {
            return { success: false, sessionStatus: session.status, error: 'Prompt cannot be empty.' };
        }
        // Per-session mutex — serializes the whole paste→confirm cycle so two
        // near-simultaneous submits cannot interleave their verification windows.
        const existingMutex = this.submitMutexes.get(resolvedName);
        let releaseMutex;
        const mutexPromise = new Promise(resolve => { releaseMutex = resolve; });
        this.submitMutexes.set(resolvedName, mutexPromise);
        if (existingMutex)
            await existingMutex;
        try {
            if (!request.force) {
                if (this.responseStore?.isSessionLocked(resolvedName, request.responseId)) {
                    const lock = this.responseStore.getActiveLock(resolvedName, request.responseId);
                    const lockAge = lock ? Math.round((Date.now() - lock.lockedAt) / 1000) : 0;
                    return {
                        success: false, sessionStatus: session.status, locked: true,
                        error: `Session is currently responding to a prompt from ${lock?.callingSession || 'another caller'} (locked ${lockAge}s ago). Try again later.`,
                    };
                }
                if (this.isSessionActive(resolvedName)) {
                    const outputAge = Date.now() - new Date(session.lastOutputAt).getTime();
                    return {
                        success: false, sessionStatus: session.status, busy: true,
                        error: `Session is currently active (output ${Math.round(outputAge / 1000)}s ago). The AI may be mid-response. Use force to send anyway.`,
                    };
                }
            }
            // Prompt delivery is a detection re-arm event (feature 080) — verified
            // submits write straight to the PTY, bypassing writeToSession's hook
            if (!session.claudeSessionId) {
                void this.ensureSessionIdDetection(resolvedName);
            }
            const delivery = await this.performVerifiedDelivery(resolvedName, prompt);
            return { success: delivery.outcome === 'delivered', sessionStatus: session.status, delivery };
        }
        finally {
            releaseMutex();
            if (this.submitMutexes.get(resolvedName) === mutexPromise) {
                this.submitMutexes.delete(resolvedName);
            }
        }
    }
    /**
     * Core verified-delivery flow (feature 070). Caller MUST hold the session's
     * submit mutex and have validated the session is running/detached with a
     * live PTY. Performs: pre-paste classify → paste (balanced markers, chunked,
     * chunk-scaled settle) → confirm queued → Enter → poll ladder → Enter-only
     * resend (bounded) → typed DeliveryResult. Never re-pastes except over a
     * provably empty input box.
     */
    async performVerifiedDelivery(resolvedName, prompt) {
        const session = this.sessions.get(resolvedName);
        const startedAt = Date.now();
        const warnings = [];
        const pollsLog = [];
        const mk = (outcome, extra = {}, attempts = 0, resends = 0) => ({
            outcome,
            verified: extra.verified ?? true,
            mode: extra.mode ?? 'verified_paste',
            attempts,
            resends,
            warnings,
            reason: extra.reason,
            polls: pollsLog.length ? pollsLog : undefined,
            elapsedMs: Date.now() - startedAt,
        });
        {
            const classifiable = session.provider === 'claude' || session.provider === 'codex' || session.provider === 'gemini';
            const chunkCount = Math.ceil(prompt.length / CHUNKED_WRITE_SIZE);
            // Chunk-scaled settle (generalized from the Windows deferred path):
            // Codex's TUI drops a fixed-600ms Enter on multi-chunk pastes.
            const settleMs = 600 + Math.max(0, chunkCount - 1) * 500;
            const paste = async () => {
                writeToPty(session.pty, '\x1b[200~');
                await writeChunkedToPty(session.pty, prompt);
                writeToPty(session.pty, '\x1b[201~');
                await new Promise(r => setTimeout(r, settleMs));
            };
            if (!classifiable) {
                // Provider TUI we cannot classify (e.g. bash): legacy unverified
                // paste + single Enter — same behavior as before, flagged in result.
                warnings.push('verification_unsupported_provider');
                await paste();
                writeToPty(session.pty, '\r');
                return mk('delivered', { verified: false, mode: 'unverified_paste' }, 1, 0);
            }
            // --- Pre-paste check ---
            const pre = this.verifySnapshotClassify(resolvedName, prompt);
            if (pre === 'no_input_region') {
                // Blocking dialog (trust / update / auth). Pasting would vanish into
                // it and Enter could ACCEPT it (observed live in the spike). Abort.
                return mk('blocked', { reason: 'blocked_dialog_before_paste' });
            }
            if (pre === null)
                warnings.push('pre_paste_snapshot_unavailable');
            if (pre === 'unrecognized')
                warnings.push('pre_paste_unrecognized');
            if (pre === 'queued_ours' || pre === 'queued_other') {
                const region = extractInputRegion(session.provider, this.getSnapshot(resolvedName, SessionManager.VERIFY_SNAPSHOT_LINES)?.content || '');
                const snippet = region.text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
                warnings.push(`non_empty_input_before_paste: "${snippet}"`);
            }
            const preWasEmptyish = pre === 'empty' || pre === null || pre === 'unrecognized';
            // --- Paste + confirm queued (with settle-retry) ---
            // A single post-paste glance was too fragile: the paste render can lag,
            // or a transient screen (agent output still on screen / a redraw) reads
            // as queued_other|empty for a moment even though our paste landed. Re-
            // check across a short window — mirrors the post-Enter ladder — and only
            // conclude failure if it never settles to a good state. Breaks
            // immediately in the common case (matches on the first look).
            await paste();
            let post = this.verifySnapshotClassify(resolvedName, prompt);
            let repasted = false;
            for (const extraDelay of SessionManager.POST_PASTE_CONFIRM_DELAYS_MS) {
                if (post === 'queued_ours')
                    break; // settled + matched
                if (post === 'no_input_region') {
                    // A dialog swallowed the paste. Do NOT send Enter — it could accept it.
                    return mk('blocked', { reason: 'blocked_dialog_swallowed_paste' });
                }
                if (post === 'empty' && preWasEmptyish && !repasted) {
                    // Paste provably absent over an empty box — the one case where a
                    // re-paste is safe (cannot duplicate or merge). Once only.
                    warnings.push('paste_retried');
                    repasted = true;
                    await paste();
                    post = this.verifySnapshotClassify(resolvedName, prompt);
                    continue;
                }
                // queued_other | empty | unrecognized | null → let the screen settle, re-check.
                await new Promise(r => setTimeout(r, extraDelay));
                post = this.verifySnapshotClassify(resolvedName, prompt);
            }
            if (post === 'no_input_region') {
                return mk('blocked', { reason: 'blocked_dialog_swallowed_paste' });
            }
            if (post === 'empty') {
                return mk('failed', { reason: 'paste_lost' });
            }
            if (post === 'queued_other') {
                // Persisted across the whole confirm window — genuinely can't attribute
                // the box to our paste. Capture a BOUNDED region snippet (~200 chars)
                // so the next occurrence is diagnosable; it rides the already-rotating
                // messaging/automation logs via the delivery reason.
                const regTxt = extractInputRegion(session.provider, this.getSnapshot(resolvedName, SessionManager.VERIFY_SNAPSHOT_LINES)?.content || '').text;
                const seen = regTxt.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
                return mk('failed', { reason: `paste_not_observed_over_existing_input; box="${seen}"` });
            }
            // post === 'queued_ours' | 'unrecognized' | null → proceed. For
            // unrecognized/null we still send Enter: the paste DID land (or we
            // can't tell), and stranding a landed paste recreates the exact
            // merged-prompt bug this feature exists to kill. The ladder below
            // surfaces lingering uncertainty as 'ambiguous'.
            // --- Enter + verify ladder ---
            let attempts = 0;
            let resends = 0;
            const dropFirstEnter = process.env.SLYCODE_TEST_DROP_ENTER === '1';
            if (dropFirstEnter) {
                warnings.push('test_drop_enter_active');
                attempts++; // simulate an OS-dropped Enter: attempted, never written
            }
            else {
                writeToPty(session.pty, '\r');
                attempts++;
            }
            // Bounded outer loop: initial Enter + up to VERIFY_MAX_RESENDS resends.
            for (;;) {
                const ladder = [];
                let action = 'wait';
                for (const delay of SessionManager.VERIFY_POLL_DELAYS_MS) {
                    await new Promise(r => setTimeout(r, delay));
                    const live = this.sessions.get(resolvedName);
                    if (!live || live.status === 'stopped' || !live.pty) {
                        return mk('failed', { reason: 'session_stopped' }, attempts, resends);
                    }
                    let c = this.verifySnapshotClassify(resolvedName, prompt);
                    if (c === null) {
                        await new Promise(r => setTimeout(r, 1000));
                        c = this.verifySnapshotClassify(resolvedName, prompt);
                        if (c === null) {
                            return mk('ambiguous', { reason: 'snapshot_unavailable' }, attempts, resends);
                        }
                    }
                    ladder.push(c);
                    pollsLog.push(c);
                    action = decideNextAction({
                        polls: ladder,
                        maxPolls: SessionManager.VERIFY_POLL_DELAYS_MS.length,
                        resends,
                        maxResends: SessionManager.VERIFY_MAX_RESENDS,
                    });
                    if (action !== 'wait')
                        break;
                }
                if (action === 'delivered') {
                    return mk('delivered', {}, attempts, resends);
                }
                if (action === 'ambiguous') {
                    return mk('ambiguous', { reason: 'input_region_unrecognized' }, attempts, resends);
                }
                if (action === 'resend_enter') {
                    const live = this.sessions.get(resolvedName);
                    if (!live?.pty) {
                        return mk('failed', { reason: 'session_stopped' }, attempts, resends);
                    }
                    writeToPty(live.pty, '\r');
                    attempts++;
                    resends++;
                    continue;
                }
                // 'failed' (or an unexpected residual 'wait' after a full ladder)
                return mk('failed', { reason: 'enter_not_accepted' }, attempts, resends);
            }
        }
    }
    /**
     * Current input-region classification for a session (no expected payload).
     * Used by the scheduler's fresh-path startup-dialog check (feature 070
     * phase B). Returns null when the session/provider cannot be classified.
     */
    getInputRegionState(name) {
        const resolvedName = this.resolveSessionName(name);
        if (!this.sessions.get(resolvedName))
            return null;
        return this.verifySnapshotClassify(resolvedName, null);
    }
    /**
     * Get a terminal content snapshot for diagnostics.
     * Uses serializeAddon to dump last N lines, strips ANSI codes.
     */
    getSnapshot(name, lines) {
        const resolvedName = this.resolveSessionName(name);
        const session = this.sessions.get(resolvedName);
        // Fall back to exitOutput for stopped/exited sessions (in-memory or persisted)
        if (!session || !session.serializeAddon) {
            const exitOutput = session?.exitOutput
                || this.persistedState.sessions[resolvedName]?.exitOutput;
            if (exitOutput) {
                const outputLines = exitOutput.split('\n');
                const scrollback = lines || 20;
                const lastLines = outputLines.slice(-scrollback).join('\n');
                const lastOutputAt = session?.lastOutputAt
                    || session?.exitedAt
                    || this.persistedState.sessions[resolvedName]?.exitedAt
                    || '';
                return {
                    content: lastLines,
                    lines: Math.min(outputLines.length, scrollback),
                    lastOutputAt,
                };
            }
            return null;
        }
        try {
            const scrollback = lines || 20;
            const raw = session.serializeAddon.serialize({ scrollback });
            // Strip ANSI escape codes
            const stripped = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                .replace(/\x1b\][^\x07]*\x07/g, '') // OSC sequences
                .replace(/\x1b[()][A-Z0-9]/g, '') // Character set
                .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ''); // Control chars (keep \n \r \t)
            // Take last N lines
            const allLines = stripped.split('\n');
            const lastLines = allLines.slice(-scrollback).join('\n').trim();
            const lineCount = lastLines.split('\n').length;
            return {
                content: lastLines,
                lines: lineCount,
                lastOutputAt: session.lastOutputAt,
            };
        }
        catch (err) {
            console.warn(`[snapshot] Failed to serialize session ${name}:`, err);
            return null;
        }
    }
}
//# sourceMappingURL=session-manager.js.map