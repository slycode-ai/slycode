import type { IPty } from 'node-pty';
import type { WebSocket } from 'ws';
import type { Response } from 'express';
import type { Terminal as HeadlessTerminal } from '@xterm/headless';
import type { SerializeAddon } from '@xterm/addon-serialize';

export type SessionStatus = 'running' | 'stopped' | 'detached' | 'creating';

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export interface Session {
  name: string;
  group: string;
  command: string;
  args: string[];
  cwd: string;
  provider: string;          // Provider id (e.g. "claude", "gemini", "codex")
  skipPermissions: boolean;  // Whether permission-skip flag was used
  status: SessionStatus;
  pid: number | null;
  connectedClients: number;
  claudeSessionId: string | null;
  createdAt: string;
  lastActive: string;
  lastOutputAt: string;  // Timestamp of last PTY output (for activity detection)
  activityStartedAt: string;  // When current activity burst started (for debouncing)
  idleTimeout: number | null;
  pty: IPty | null;
  clients: Set<WebSocket>;
  sseClients: Set<Response>;
  // Headless terminal for proper state management
  headlessTerminal: HeadlessTerminal | null;
  serializeAddon: SerializeAddon | null;
  terminalDimensions: TerminalDimensions;
  // For GUID detection - files that existed before this session started
  claudeBeforeFiles?: string[];
  claudeDir?: string;
  guidRetryAttempted?: boolean;
  // Cancel GUID detection when session stops/exits
  guidDetectionCancelled?: boolean;
  // For disconnect grace period (race condition fix)
  lastClientDisconnect?: string;
  // For event-driven stopSession
  exitResolver?: () => void;
  // Deferred prompt delivery (Windows: CLI args can't carry multi-line prompts through .cmd wrappers)
  pendingPrompt?: string;
  pendingPromptTimer?: ReturnType<typeof setTimeout>;
  // Exit info (populated by handlePtyExit, persists until session is deleted from map)
  exitCode?: number;
  exitedAt?: string;
  // Activity debug logging
  lastActivityState?: boolean;
  lastOutputSnippet?: string;   // Readable snippet of most recent output
  lastOutputRawHex?: string;    // Hex of most recent output (for invisible chars)
  lastOutputDataLength?: number;
  activityTransitions: ActivityTransition[];
}

export interface ActivityTransition {
  timestamp: string;
  became: 'active' | 'inactive';
  lastOutputAt: string;
  activityStartedAt: string;
  outputAgeMs: number;
  triggerSnippet: string;
  triggerRawHex: string;
  triggerDataLength: number;
}

export interface CreateSessionRequest {
  name: string;
  command?: string;
  provider?: string;       // Provider id from providers.json (e.g. "claude", "gemini", "codex")
  skipPermissions?: boolean; // Whether to add permission-skip flag
  cwd?: string;
  fresh?: boolean;
  idleTimeout?: number;
  prompt?: string; // Initial prompt passed as positional argument to CLI
  createInstructionFile?: boolean; // Whether to create missing instruction file before spawn
}

export interface SessionInfo {
  name: string;
  group: string;
  status: SessionStatus;
  pid: number | null;
  connectedClients: number;
  hasHistory: boolean;
  resumed: boolean;
  lastActive: string;
  lastOutputAt?: string;  // For activity detection
  claudeSessionId?: string | null;
  provider?: string;
  skipPermissions?: boolean;
  exitCode?: number;
  exitedAt?: string;
}

export interface PersistedSession {
  claudeSessionId: string | null;
  cwd: string;
  createdAt: string;
  lastActive: string;
  provider?: string;         // Provider id (absent on old sessions = "claude")
  skipPermissions?: boolean; // Whether permission-skip was used
  exitCode?: number;         // Last exit code (set by handlePtyExit)
  exitedAt?: string;         // When session last exited (ISO timestamp)
}

export interface PersistedState {
  sessions: Record<string, PersistedSession>;
}

export interface BridgeConfig {
  port: number;
  host: string;
  sessionFile: string;
  defaultIdleTimeout: number;
  maxSessions: number;
}

// Runtime config loaded from bridge-config.json
export interface BridgeRuntimeConfig {
  allowedCommands: string[];
  cors: {
    origins: string[];
  };
}

// WebSocket message types
export interface WsInputMessage {
  type: 'input';
  data: string;
}

export interface WsResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

export interface WsSignalMessage {
  type: 'signal';
  signal: string;
}

export type WsClientMessage = WsInputMessage | WsResizeMessage | WsSignalMessage | string;

export interface WsOutputMessage {
  type: 'output';
  data: string;
}

export interface WsExitMessage {
  type: 'exit';
  code: number;
}

export interface WsErrorMessage {
  type: 'error';
  message: string;
}

export type WsServerMessage = WsOutputMessage | WsExitMessage | WsErrorMessage;

// Bridge stats for health monitoring
export interface SessionActivity {
  name: string;
  status: SessionStatus;
  lastOutputAt: string | null;
  isActive: boolean;  // true if output within last 3 seconds
  activityStartedAt?: string;
  lastOutputSnippet?: string;
}

export interface BridgeStats {
  bridgeTerminals: number;      // Total PTY sessions (running or detached)
  connectedClients: number;     // Total SSE/WS connections
  activelyWorking: number;      // Sessions with output in last 2s (sustained 1s+)
  sessions: SessionActivity[];  // Per-session activity info
}
