import os from 'os';
import type { WebSocket } from 'ws';
import type { Response } from 'express';
import { spawnPty, writeToPty, writeChunkedToPty, CHUNKED_WRITE_SIZE, resizePty, killPty } from './pty-handler.js';
import {
  getProviderSessionDir,
  listProviderSessionFiles,
  detectNewProviderSessionId,
  getMostRecentProviderSessionId,
} from './claude-utils.js';
import {
  loadProviders,
  getProvider,
  buildProviderCommand,
  supportsSessionDetection,
  ensureInstructionFile,
} from './provider-utils.js';
import type { ProviderConfig } from './provider-utils.js';
import type {
  Session,
  SessionInfo,
  CreateSessionRequest,
  BridgeConfig,
  BridgeRuntimeConfig,
  PersistedState,
  PersistedSession,
  BridgeStats,
  SessionActivity,
  ActivityTransition,
  SubmitRequest,
  SubmitResult,
  SnapshotResult,
} from './types.js';
import type { ResponseStore } from './response-store.js';
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

const DEFAULT_CONFIG: BridgeConfig = {
  port: parseInt(process.env.BRIDGE_PORT || '7592', 10),
  host: 'localhost',
  sessionFile: process.env.SLYCODE_HOME
    ? path.join(process.env.SLYCODE_HOME, 'bridge-sessions.json')
    : path.join(__dirname, '..', 'bridge-sessions.json'),
  defaultIdleTimeout: 4 * 60 * 60 * 1000, // 4 hours
  maxSessions: 50,
};

const webPort = process.env.PORT || process.env.WEB_PORT || '7591';
const DEFAULT_RUNTIME_CONFIG: BridgeRuntimeConfig = {
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
const DEFERRED_PROMPT_SETTLE_MS = 1500;       // 1.5s of quiet after last output = settled
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
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[?!>]?[0-9;]*[a-zA-Z]/g, '') // CSI sequences (including DEC private mode like [?2026h)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences (both BEL and ST terminators)
    .replace(/\x1b[()][AB012]/g, '')           // Character set selection
    .replace(/\x1b[#%&()*+\-.\/][^\x1b]?/g, '') // Other escape sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') // Control chars (keep \n \r \t)
    .trim();
}

// Convert first N bytes to hex string for diagnosing invisible output
function toHex(str: string, maxBytes: number = 40): string {
  return Array.from(str.slice(0, maxBytes))
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join(' ');
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private config: BridgeConfig;
  private runtimeConfig: BridgeRuntimeConfig;
  private persistedState: PersistedState = { sessions: {} };
  private idleCheckTimer: NodeJS.Timeout | null = null;
  private sseHeartbeatTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<BridgeConfig> = {}, runtimeConfig?: BridgeRuntimeConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.runtimeConfig = runtimeConfig ?? DEFAULT_RUNTIME_CONFIG;
  }

  async init(): Promise<void> {
    await this.loadPersistedState();
    this.startIdleChecker();
    this.startSSEHeartbeat();
  }

  /**
   * Gracefully shutdown all sessions
   */
  async shutdown(): Promise<void> {
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
        } catch (err) {
          console.error(`Error stopping ${name}:`, err);
        }
      }
      if (session.headlessTerminal) {
        try {
          session.headlessTerminal.dispose();
        } catch (err) {
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
  private startIdleChecker(): void {
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
  private startSSEHeartbeat(): void {
    this.sseHeartbeatTimer = setInterval(() => {
      for (const session of this.sessions.values()) {
        if (session.sseClients.size === 0) continue;

        const deadClients: Response[] = [];
        for (const client of session.sseClients) {
          try {
            client.write('event: heartbeat\ndata: {}\n\n');
          } catch {
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
  private async checkIdleSessions(): Promise<void> {
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

  private async loadPersistedState(): Promise<void> {
    try {
      const data = await fs.readFile(this.config.sessionFile, 'utf-8');
      this.persistedState = JSON.parse(data);
      console.log(`Loaded ${Object.keys(this.persistedState.sessions).length} persisted session references`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet — first run, start fresh
        this.persistedState = { sessions: {} };
        return;
      }
      // Any other error (corrupt JSON, permissions, disk) — refuse to start
      // rather than risk overwriting valid session data with empty state
      console.error('FATAL: Could not read bridge-sessions.json:', err);
      throw new Error(`Cannot load session state: ${(err as Error).message}. Fix or remove the file manually.`);
    }
  }

  private async savePersistedState(): Promise<void> {
    // Write to temp file first, then rename — atomic on POSIX.
    // Use unique suffix to avoid races when concurrent saves happen
    // (e.g. stopSession's handlePtyExit + createSession both saving).
    const suffix = `${process.pid}.${Date.now()}`;
    const tmpFile = `${this.config.sessionFile}.tmp.${suffix}`;
    try {
      await fs.writeFile(tmpFile, JSON.stringify(this.persistedState, null, 2));
      await fs.rename(tmpFile, this.config.sessionFile);
    } catch (err) {
      // Clean up orphaned temp file on failure
      try { await fs.unlink(tmpFile); } catch { /* ignore */ }
      throw err;
    }
  }

  private extractGroup(name: string): string {
    const parts = name.split(':');
    return parts[0] || name;
  }

  /**
   * Convert a new-format session name to old format by removing the provider segment.
   * New: {project}:{provider}:card:{cardId} → Old: {project}:card:{cardId}
   * New: {project}:{provider}:global → Old: {project}:global
   * Returns null if name is not in new format.
   */
  private toLegacySessionName(name: string): string | null {
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
  resolveSessionName(name: string): string {
    if (this.sessions.has(name) || this.persistedState.sessions[name]) {
      return name;
    }
    const legacyName = this.toLegacySessionName(name);
    if (legacyName && (this.sessions.has(legacyName) || this.persistedState.sessions[legacyName])) {
      return legacyName;
    }
    return name;
  }

  async createSession(request: CreateSessionRequest): Promise<SessionInfo> {
    const { name, fresh = false, idleTimeout, prompt } = request;
    const cwd = request.cwd;
    const model = request.model;

    if (!cwd || !path.isAbsolute(cwd)) {
      throw new Error(`CWD must be an absolute path (got '${cwd || ''}')`);
    }

    // Resolve provider: explicit provider field, or fall back to command field, or default to bash
    let providerConfig: ProviderConfig | null = null;
    let providerId = 'bash';
    let command = request.command || 'bash';
    const skipPermissions = request.skipPermissions ?? true; // Default true for backward compat

    if (request.provider) {
      providerConfig = await getProvider(request.provider);
      if (providerConfig) {
        providerId = providerConfig.id;
        command = providerConfig.command;
      } else {
        throw new Error(`Unknown provider: ${request.provider}`);
      }
    } else if (request.command && request.command !== 'bash') {
      // Legacy path: command field without provider (e.g. command: 'claude')
      // Try to find a matching provider
      providerConfig = await getProvider(request.command);
      if (providerConfig) {
        providerId = providerConfig.id;
        command = providerConfig.command;
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
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`CWD '${cwd}' does not exist`);
      }
      if ((err as NodeJS.ErrnoException).code === 'EACCES') {
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
        return this.getSessionInfo(name)!;
      }
      if (fresh) {
        // Fresh session requested — stop existing session before creating new one
        await this.stopSession(resolvedRunning);
        // Fall through to create new session
      } else {
        // Reuse existing session — paste prompt into it using bracketed paste mode.
        // Claude Code's TUI expects paste brackets for multi-line input; without them,
        // \n characters in the prompt may not be handled correctly and \r may not submit.
        // Markers are sent atomically; inner content uses writeChunkedToPty to avoid
        // ConPTY truncation on Windows (>4KB payloads silently dropped).
        if (prompt && existing.pty) {
          writeToPty(existing.pty, '\x1b[200~');
          await writeChunkedToPty(existing.pty, prompt);
          writeToPty(existing.pty, '\x1b[201~');
          // Delay before Enter to let the provider process the paste
          await new Promise(r => setTimeout(r, 600));
          writeToPty(existing.pty, '\r');
        }
        // Reattach if was detached
        if (existing.status === 'detached' && existing.pty) {
          existing.status = 'running';
        }
        return this.getSessionInfo(name)!;
      }
    }

    // Enforce max sessions limit
    if (this.sessions.size >= this.config.maxSessions) {
      throw new Error(`Maximum sessions limit (${this.config.maxSessions}) reached`);
    }

    // Reserve the session name with 'creating' status to prevent concurrent creation.
    // This synchronous Map insert acts as a mutex — any concurrent createSession() call
    // for the same name will hit the guard above and return 202.
    const creatingPlaceholder: Session = {
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
      terminalDimensions: { cols: 80, rows: 24 },
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
      let args: string[];
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
      } else {
        // Plain bash or unknown command — no special args
        args = [];
      }

      // For providers that support session detection, capture existing session files before spawn
      let claudeDir: string | null = null;
      let beforeSessionFiles: string[] = [];
      if (providerConfig && supportsSessionDetection(providerConfig) && !doResume) {
        claudeDir = getProviderSessionDir(providerId, cwd);
        if (claudeDir) {
          beforeSessionFiles = await listProviderSessionFiles(providerId, claudeDir);
        }
      }

      // Create headless terminal for state management
      const headlessTerminal = new HeadlessTerminal({
        cols: 80,
        rows: 24,
        scrollback: 10000,
        allowProposedApi: true,
      });
      const serializeAddon = new SerializeAddon();
      headlessTerminal.loadAddon(serializeAddon);

      const now = new Date().toISOString();
      const session: Session = {
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
        terminalDimensions: { cols: 80, rows: 24 },
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
        extraEnv: { SLYCODE_SESSION: name },
        onData: (data) => this.handlePtyOutput(name, data),
        onExit: (code) => this.handlePtyExit(name, code, session.createdAt),
      });

      session.pid = session.pty.pid;
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
    } catch (err) {
      // Clean up the 'creating' placeholder on failure
      this.sessions.delete(name);
      throw err;
    }
  }

  /**
   * Background task to detect provider session ID after spawn
   */
  private async detectProviderSessionId(
    name: string,
    providerId: string,
    sessionDir: string,
    beforeFiles: string[]
  ): Promise<void> {
    // Custom watch that uses live claimed-GUID checks (not a stale snapshot)
    // Gemini CLI takes ~30s to create session files; Claude is ~5s. Use 60s to be safe.
    const sessionId = await this.watchForUnclaimedSession(name, providerId, sessionDir, beforeFiles, 60000);

    if (sessionId) {
      const session = this.sessions.get(name);
      if (session && !session.guidDetectionCancelled) {
        // Atomic claim: check and assign in the same synchronous tick
        if (!this.getClaimedGuids().has(sessionId)) {
          session.claudeSessionId = sessionId;

          // Update persisted state
          if (this.persistedState.sessions[name]) {
            this.persistedState.sessions[name].claudeSessionId = sessionId;
            await this.savePersistedState();
          }
        }
      } else if (!session && this.persistedState.sessions[name]) {
        // Session already exited and was removed from the map, but GUID detection
        // completed after exit. Still link the GUID in persisted state so the UI
        // shows the session attached to the card (resumable for manual inspection).
        if (!this.getClaimedGuids().has(sessionId)) {
          this.persistedState.sessions[name].claudeSessionId = sessionId;
          await this.savePersistedState();
          console.log(`[detection] Linked session ID ${sessionId} to exited session ${name}`);
        }
      }
    }
  }

  private handlePtyOutput(name: string, data: string): void {
    const session = this.sessions.get(name);
    if (!session) return;

    // Feed data to headless terminal for proper state management
    if (session.headlessTerminal) {
      session.headlessTerminal.write(data);
    }

    // Broadcast to WebSocket clients
    for (const client of session.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(JSON.stringify({ type: 'output', data }));
        } catch {
          // Client disconnected or errored — will be cleaned up on close
        }
      }
    }

    // Broadcast to SSE clients (collect dead clients to remove after iteration)
    const deadSseClients: Response[] = [];
    for (const client of session.sseClients) {
      try {
        client.write(`event: output\ndata: ${JSON.stringify({ data })}\n\n`);
      } catch {
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

      session.lastOutputAt = now;  // Track output timestamp for activity detection

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
  private async deliverPendingPrompt(name: string): Promise<void> {
    const session = this.sessions.get(name);
    if (!session?.pendingPrompt || !session.pty) return;

    const prompt = session.pendingPrompt;
    session.pendingPrompt = undefined;
    if (session.pendingPromptTimer) {
      clearTimeout(session.pendingPromptTimer);
      session.pendingPromptTimer = undefined;
    }

    try {
      // Use bracketed paste with chunked content via shared utility.
      // Markers sent atomically; writeChunkedToPty handles ConPTY chunking on Windows,
      // passes through directly on Linux/Mac.
      if (session.pty) {
        writeToPty(session.pty, '\x1b[200~');
        await writeChunkedToPty(session.pty, prompt);
        writeToPty(session.pty, '\x1b[201~');
      }

      // Wait for write to settle, then send Enter
      await new Promise(r => setTimeout(r, 600));
      if (session.pty) {
        writeToPty(session.pty, '\r');
      }
    } catch (err) {
      console.error(`Failed to deliver prompt to ${name}:`, err);
      return;
    }

    if (prompt.length > CHUNKED_WRITE_SIZE && os.platform() === 'win32') {
      const totalChunks = Math.ceil(prompt.length / CHUNKED_WRITE_SIZE);
      console.log(`Deferred prompt: chunked ${prompt.length} chars → ${totalChunks} × ${CHUNKED_WRITE_SIZE}`);
    }
    console.log(`Deferred prompt delivered to ${name} (${prompt.length} chars)`);
  }

  private async handlePtyExit(name: string, code: number, exitingCreatedAt?: string): Promise<void> {
    const session = this.sessions.get(name);
    if (!session) return;

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

    // Resolve any pending stopSession promise (event-driven approach)
    if (session.exitResolver) {
      session.exitResolver();
      session.exitResolver = undefined;
    }

    // Capture last terminal output on exit (for cross-card snapshot diagnostics + error reporting)
    let exitOutput: string | undefined;
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
      } catch (err) {
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
    const exitPayload: { code: number; output?: string } = { code };
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
      } catch (err) {
        // Client might already be disconnected
      }
    }
    session.sseClients.clear();

    // Persist exit info and lastActive from in-memory session
    if (this.persistedState.sessions[name]) {
      this.persistedState.sessions[name].lastActive = session.lastActive;
      this.persistedState.sessions[name].exitCode = code;
      this.persistedState.sessions[name].exitedAt = exitedAt;
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

  getSessionInfo(name: string): SessionInfo | null {
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

  getSessionCwd(name: string): string | null {
    const resolvedName = this.resolveSessionName(name);
    const session = this.sessions.get(resolvedName);
    if (session) return session.cwd;
    const persisted = this.persistedState.sessions[resolvedName];
    if (persisted) return persisted.cwd;
    return null;
  }

  getAllSessions(): SessionInfo[] {
    const result: SessionInfo[] = [];

    // Active sessions
    for (const [name] of this.sessions) {
      const info = this.getSessionInfo(name);
      if (info) result.push(info);
    }

    // Persisted but not active
    for (const name of Object.keys(this.persistedState.sessions)) {
      if (!this.sessions.has(name)) {
        const info = this.getSessionInfo(name);
        if (info) result.push(info);
      }
    }

    return result;
  }

  getGroupStatus(group: string): Record<string, { status: string; connectedClients: number; hasHistory: boolean }> {
    const result: Record<string, { status: string; connectedClients: number; hasHistory: boolean }> = {};

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
  getStats(): BridgeStats {
    const now = Date.now();
    let bridgeTerminals = 0;
    let connectedClients = 0;
    let activelyWorking = 0;
    const sessions: SessionActivity[] = [];

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
          const transition: ActivityTransition = {
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
  isSessionActive(name: string): boolean | null {
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
  getActivityLog(name: string): ActivityTransition[] | null {
    const session = this.sessions.get(this.resolveSessionName(name));
    if (!session) return null;
    return session.activityTransitions;
  }

  /**
   * Stop all running sessions (for bulk stop action)
   */
  async stopAllSessions(): Promise<number> {
    let stoppedCount = 0;
    const sessionsToStop: string[] = [];

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

  async stopSession(name: string): Promise<SessionInfo | null> {
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
    const exitPromise = new Promise<void>((resolve) => {
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
      new Promise<void>(resolve => setTimeout(resolve, 2000)) // 2 second timeout
    ]);

    return this.getSessionInfo(resolvedName);
  }

  /**
   * Delete a session completely (stop if running, remove from persistence)
   */
  async deleteSession(name: string): Promise<boolean> {
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
  async relinkSession(name: string): Promise<{ sessionId: string | null; previous: string | null }> {
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
    const newId = await getMostRecentProviderSessionId(provider, cwd);

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
    } else {
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
  addClient(name: string, ws: WebSocket): boolean {
    const session = this.sessions.get(this.resolveSessionName(name));
    if (!session) return false;

    session.clients.add(ws);
    this.updateClientCount(session);

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
    } catch {
      // Client may have disconnected immediately
    }

    // Send serialized terminal state for proper restore (limit to last 500 lines for speed)
    if (session.serializeAddon) {
      try {
        const state = session.serializeAddon.serialize({ scrollback: 500 });
        ws.send(JSON.stringify({ type: 'restore', state }));
      } catch {
        // Client may have disconnected immediately
      }
    }
    return true;
  }

  removeClient(name: string, ws: WebSocket): void {
    const session = this.sessions.get(this.resolveSessionName(name));
    if (!session) return;

    session.clients.delete(ws);
    this.updateClientCount(session);

    // If no clients and PTY still running, mark as detached with grace period timestamp
    if (session.connectedClients === 0 && session.status === 'running') {
      session.status = 'detached';
      session.lastClientDisconnect = new Date().toISOString();
    }
  }

  // SSE client management
  addSSEClient(name: string, res: Response): boolean {
    const session = this.sessions.get(this.resolveSessionName(name));
    if (!session) return false;

    session.sseClients.add(res);
    this.updateClientCount(session);
    console.log(`[SSE] +client ${name} (total: ${session.sseClients.size} SSE, ${session.clients.size} WS)`);

    // If session was detached, mark as running again
    if (session.status === 'detached' && session.pty) {
      session.status = 'running';
    }

    // Send dimensions event first
    try {
      res.write(`event: dimensions\ndata: ${JSON.stringify({
        cols: session.terminalDimensions.cols,
        rows: session.terminalDimensions.rows,
      })}\n\n`);
    } catch {
      // Client may have disconnected immediately
    }

    // Send serialized terminal state for proper restore (limit to last 500 lines for speed)
    if (session.serializeAddon) {
      try {
        const state = session.serializeAddon.serialize({ scrollback: 500 });
        res.write(`event: restore\ndata: ${JSON.stringify({ state })}\n\n`);
      } catch {
        // Client may have disconnected immediately
      }
    }
    return true;
  }

  removeSSEClient(name: string, res: Response): void {
    const session = this.sessions.get(this.resolveSessionName(name));
    if (!session) return;

    session.sseClients.delete(res);
    this.updateClientCount(session);
    console.log(`[SSE] -client ${name} (remaining: ${session.sseClients.size} SSE, ${session.clients.size} WS)`);

    // If no clients and PTY still running, mark as detached with grace period timestamp
    if (session.connectedClients === 0 && session.status === 'running') {
      session.status = 'detached';
      session.lastClientDisconnect = new Date().toISOString();
    }
  }

  private updateClientCount(session: Session): void {
    session.connectedClients = session.clients.size + session.sseClients.size;
  }

  // PTY operations
  /**
   * Write data to a session's PTY.
   * Uses writeChunkedToPty for ConPTY-safe chunked writes on Windows.
   * Small writes (keystrokes, short control sequences) pass through instantly.
   */
  async writeToSession(name: string, data: string): Promise<boolean> {
    const session = this.sessions.get(this.resolveSessionName(name));
    if (!session || !session.pty) return false;

    await writeChunkedToPty(session.pty, data);

    // If this session doesn't have a GUID yet, try to detect it (any provider)
    if (!session.claudeSessionId) {
      this.retryGuidDetection(name);
    }

    return true;
  }

  /**
   * Watch for a new unclaimed session file.
   * Uses live getClaimedGuids() checks on each poll iteration to prevent
   * two concurrent watchers from claiming the same GUID.
   */
  private watchForUnclaimedSession(
    sessionName: string,
    providerId: string,
    sessionDir: string,
    beforeFiles: string[],
    timeoutMs: number
  ): Promise<string | null> {
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
  private getClaimedGuids(): Set<string> {
    const claimed = new Set<string>();

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
   * Retry GUID detection for sessions that didn't capture it initially.
   * Uses the before-files list AND excludes GUIDs already claimed by other sessions.
   */
  private async retryGuidDetection(name: string): Promise<void> {
    const session = this.sessions.get(name);
    if (!session || session.claudeSessionId || session.guidDetectionCancelled) return;

    // Debounce - only retry once per session
    if (session.guidRetryAttempted) return;
    session.guidRetryAttempted = true;

    const providerId = session.provider || 'claude';

    // Use the stored claudeDir and beforeFiles from session creation
    const sessionDir = session.claudeDir || getProviderSessionDir(providerId, session.cwd);
    if (!sessionDir) return;
    const beforeFiles = session.claudeBeforeFiles || [];

    // Detect new session ID using provider-specific logic
    const sessionId = await detectNewProviderSessionId(providerId, sessionDir, beforeFiles);

    // Live check against claimed GUIDs (not a stale snapshot) — atomic check-then-claim
    if (sessionId && !this.getClaimedGuids().has(sessionId) && !session.guidDetectionCancelled) {
      session.claudeSessionId = sessionId;

      // Update persisted state
      if (this.persistedState.sessions[name]) {
        this.persistedState.sessions[name].claudeSessionId = sessionId;
        await this.savePersistedState();
      }
    }
  }

  resizeSession(name: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(this.resolveSessionName(name));
    if (!session || !session.pty) return false;

    resizePty(session.pty, cols, rows);

    // Also resize the headless terminal
    if (session.headlessTerminal) {
      session.headlessTerminal.resize(cols, rows);
    }
    session.terminalDimensions = { cols, rows };

    // Broadcast new dimensions to all connected SSE clients so other tabs can adapt
    const dimsPayload = `event: resize\ndata: ${JSON.stringify({ cols, rows })}\n\n`;
    const deadClients: Response[] = [];
    for (const client of session.sseClients) {
      try {
        client.write(dimsPayload);
      } catch {
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

  sendSignal(name: string, signal: string): boolean {
    const session = this.sessions.get(this.resolveSessionName(name));
    if (!session || !session.pty) return false;

    // Validate signal against allowed list
    if (!ALLOWED_SIGNALS.has(signal)) {
      console.warn(`Rejected invalid signal: ${signal}`);
      return false;
    }

    killPty(session.pty, signal);
    return true;
  }

  // --- Cross-card prompt execution ---

  private responseStore: ResponseStore | null = null;
  private submitMutexes = new Map<string, Promise<void>>();

  // Prompt depth tracking: prevents runaway cross-card call chains
  private static MAX_PROMPT_DEPTH = 4;
  private static CHAIN_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private promptChains = new Map<string, { calledBy: string; depth: number; timestamp: number }>();

  setResponseStore(store: ResponseStore): void {
    this.responseStore = store;
  }

  /**
   * Get the current prompt depth for a session by tracing the call chain.
   */
  private getPromptDepth(sessionName: string): number {
    const entry = this.promptChains.get(sessionName);
    if (!entry) return 0;
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
  clearPromptChain(sessionName: string): void {
    this.promptChains.delete(this.resolveSessionName(sessionName));
  }

  recordPromptChain(targetSession: string, callingSession: string): { success: boolean; depth: number; error?: string } {
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
  async submitPrompt(name: string, request: SubmitRequest): Promise<SubmitResult> {
    const resolvedName = this.resolveSessionName(name);
    const session = this.sessions.get(resolvedName);

    // Check session exists and is running
    if (!session) {
      const persisted = this.persistedState.sessions[resolvedName];
      const status = persisted ? 'stopped' : 'not_found';
      return { success: false, sessionStatus: status as any, isActive: false, error: status === 'stopped' ? 'Session is stopped. Use --create to start a new session.' : 'Session not found.' };
    }
    if (session.status !== 'running') {
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
    let releaseMutex: () => void;
    const mutexPromise = new Promise<void>(resolve => { releaseMutex = resolve; });
    this.submitMutexes.set(resolvedName, mutexPromise);
    if (existingMutex) await existingMutex;

    try {
      if (!request.force) {
        // Check call lock (inside mutex to prevent race)
        if (this.responseStore?.isSessionLocked(resolvedName)) {
          const lock = this.responseStore.getActiveLock(resolvedName);
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

      const useBracketedPaste = request.bracketedPaste !== false;

      // Write prompt to PTY — markers atomic, inner content chunked for ConPTY safety
      if (useBracketedPaste) {
        writeToPty(session.pty, '\x1b[200~');
        await writeChunkedToPty(session.pty, prompt);
        writeToPty(session.pty, '\x1b[201~');
      } else {
        await writeChunkedToPty(session.pty, prompt);
      }

      // Delay before first Enter
      const submitDelay = parseInt(process.env.PROMPT_SUBMIT_DELAY_MS || '600', 10);
      await new Promise(r => setTimeout(r, submitDelay));

      // First Enter
      writeToPty(session.pty, '\r');

      // Optional double-submit for reliability
      if (process.env.PROMPT_DOUBLE_SUBMIT === 'true') {
        const doubleDelay = parseInt(process.env.PROMPT_DOUBLE_SUBMIT_DELAY_MS || '300', 10);
        await new Promise(r => setTimeout(r, doubleDelay));
        writeToPty(session.pty, '\r');
      }

      const isActive = this.isSessionActive(resolvedName) || false;
      return { success: true, sessionStatus: session.status, isActive };
    } finally {
      releaseMutex!();
      // Clean up mutex if it's still ours
      if (this.submitMutexes.get(resolvedName) === mutexPromise) {
        this.submitMutexes.delete(resolvedName);
      }
    }
  }

  /**
   * Get a terminal content snapshot for diagnostics.
   * Uses serializeAddon to dump last N lines, strips ANSI codes.
   */
  getSnapshot(name: string, lines?: number): SnapshotResult | null {
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
                         .replace(/\x1b\][^\x07]*\x07/g, '')  // OSC sequences
                         .replace(/\x1b[()][A-Z0-9]/g, '')    // Character set
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
    } catch (err) {
      console.warn(`[snapshot] Failed to serialize session ${name}:`, err);
      return null;
    }
  }
}
