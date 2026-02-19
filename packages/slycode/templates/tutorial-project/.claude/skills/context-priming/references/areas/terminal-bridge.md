# Terminal Bridge

Updated: 2026-02-14

## Overview

PTY bridge server manages AI coding sessions across multiple providers (Claude, Gemini, Codex). Express server spawns/manages PTY processes, streams output via SSE. Provider-agnostic command building via data-driven config (`providers.json`). Includes security hardening (command whitelist, CWD validation, localhost binding), activity tracking with transition logging for debugging, atomic state persistence, bulk session management, and graceful idle timeout handling. React components connect through Next.js API proxy.

## Key Files

### Bridge Server (Node/Express)
- `bridge/src/index.ts` - Express server entry, routes setup, localhost binding
- `bridge/src/session-manager.ts` - Session lifecycle, PTY spawning, provider resolution, activity tracking, atomic state saving
- `bridge/src/provider-utils.ts` - Provider config loading, command building, session detection helpers
- `bridge/src/pty-handler.ts` - PTY process wrapper, output buffering
- `bridge/src/api.ts` - REST endpoints for session CRUD, /stats, stop-all, activity-log
- `bridge/src/websocket.ts` - WebSocket upgrade handling (legacy, SSE preferred)
- `bridge/src/claude-utils.ts` - Claude session ID detection from ~/.claude/projects/
- `bridge/src/types.ts` - Session, BridgeConfig, BridgeStats, ActivityTransition, provider interfaces

### Configuration
- `bridge/bridge-config.json` - Runtime config: allowedCommands (claude, codex, gemini, bash), CORS origins
- `data/providers.json` - Provider registry: CLI commands, permission flags, resume types, prompt handling, stage defaults
- `documentation/terminal-classes.json` - Terminal class definitions for command visibility
- `data/commands.json` - Unified command configuration with visibility per class

### Web Components
- `web/src/components/Terminal.tsx` - xterm.js terminal, SSE via ConnectionManager
- `web/src/components/ClaudeTerminalPanel.tsx` - Terminal panel with startupCommands/activeCommands
- `web/src/components/GlobalClaudePanel.tsx` - Floating panel for project-wide session
- `web/src/app/api/bridge/[...path]/route.ts` - Next.js proxy to bridge server

## Key Functions

- `SessionManager.createSession()` - Resolves provider, builds command via `buildProviderCommand()`, validates CWD, spawns PTY
- `SessionManager.resolveSessionName()` - Checks both new (with provider) and legacy session name formats
- `SessionManager.stopSession()` - Graceful SIGINT, waits for exit
- `SessionManager.stopAllSessions()` - Bulk stop all running/detached sessions, returns count
- `SessionManager.getStats()` - Returns BridgeStats with activity info
- `SessionManager.checkIdleSessions()` - Idle timeout with grace period after disconnect
- `buildProviderCommand()` - Assembles { command, args } from provider config, handles flag vs subcommand resume
- `getProvider()` - Loads provider config by ID from providers.json (30s cache)
- `supportsSessionDetection()` - Check if provider supports GUID-based session detection
- `Terminal.connectSSE()` - Via ConnectionManager for auto-reconnection

## Data Models

```typescript
SessionInfo {
  name, status (running|stopped|detached), pid, connectedClients,
  hasHistory, claudeSessionId, lastOutputAt,
  provider?, skipPermissions?,
  lastOutputSnippet?, lastOutputRawHex?, lastOutputDataLength?
}

BridgeStats {
  bridgeTerminals: number;      // Total PTY sessions
  connectedClients: number;     // Total SSE/WS connections
  activelyWorking: number;      // Sessions with output in last 2s
  sessions: SessionActivity[];  // Per-session activity
}

SessionActivity {
  name, status, lastOutputAt, isActive
}

ActivityTransition {
  timestamp: string;
  from: string;                 // Previous state
  to: string;                   // New state
  lastOutputAt: string;
  outputAge: number;
  trigger?: {                   // Debug info for phantom blips
    snippet: string;
    hex: string;
    dataLength: number;
  }
}

BridgeConfig {
  host, port, sessionFile, defaultIdleTimeout, maxSessions
}

BridgeRuntimeConfig {
  allowedCommands: string[];    // e.g., ['claude', 'codex', 'gemini', 'bash']
  cors: { origins: string[] }
}

CreateSessionRequest {
  name: string;
  provider?: string;            // Provider id from providers.json
  skipPermissions?: boolean;    // Whether to add permission-skip flag
  command?: string;             // Legacy: direct command (backward compat)
  cwd: string;
  prompt?: string;
  fresh?: boolean;
}

PersistedSession {
  claudeSessionId?, cwd, createdAt, lastActive,
  provider?: string;            // Defaults to 'claude' for old sessions
  skipPermissions?: boolean;    // Defaults to true for old sessions
}

// Provider config types (provider-utils.ts)
ProviderConfig {
  id, displayName, command, install,
  permissions: { flag, label, default },
  resume: { supported, type ('flag'|'subcommand'), flag?, subcommand?, lastFlag?, detectSession, sessionDir? },
  prompt: { type ('positional'|'flag'), interactive?, nonInteractive? }
}

ProvidersData {
  providers: Record<string, ProviderConfig>;
  defaults: {
    stages: Record<string, { provider, skipPermissions }>;
    global: { provider, skipPermissions };
    projects: Record<string, { provider, skipPermissions }>;
  }
}
```

## Security Hardening

- **Localhost binding**: HOST defaults to `localhost` (not `0.0.0.0`)
- **Command whitelist**: Only commands in `bridge-config.json` allowedCommands can be spawned (claude, codex, gemini, bash)
- **Provider validation**: Provider ID must exist in providers.json; resolved command must be in allowedCommands
- **CWD validation**: Requires absolute path, verifies exists and is accessible before spawning PTY
- **CORS origins**: Configured in bridge-config.json, not wide-open

## Activity Tracking

- `lastOutputAt` timestamp updated on every PTY output
- `isActive` = output within last 2 seconds (with 1s debounce)
- `activelyWorking` count in BridgeStats for health monitor
- Cards with active sessions show pulsing green glow in UI
- **Activity transitions**: Logged with trigger details (snippet, hex, data length) for debugging phantom blips
- `GET /activity-log/:name` endpoint exposes transition history per session

## State Persistence

- Session state saved to bridge-sessions.json via atomic writes (temp file + rename)
- State file uses `__dirname` resolution for reliable file location
- Missing file (ENOENT) handled gracefully; corrupt JSON throws fatal error
- Prevents silent data loss from corrupted state

## Race Condition Handling

- **Disconnect grace period**: 5 seconds before session eligible for idle timeout
- **Status transitions**: Protected against reconnect during disconnect
- **SSE cleanup**: Proper client tracking on connection/disconnection

## Terminal Classes

Controls which commands appear in each context:
- `global-terminal` - Dashboard terminal (future)
- `project-terminal` - Project-level panel at bottom
- `backlog`, `design`, `implementation`, `testing`, `done` - Card terminals by stage
- `action-assistant` - Terminal in SlyActionConfigModal

## Multi-Provider System

### Supported Providers
- **Claude Code** (`claude`) — Positional prompts, `--resume <GUID>` with auto-detection, `--dangerously-skip-permissions`
- **Codex CLI** (`codex`) — Positional prompts, `codex resume --last` (subcommand-style), `--yolo`
- **Gemini CLI** (`gemini`) — Flag-based prompts (`-i`/`-p`), `--resume` (no GUID), `--yolo`

### Command Building (`buildProviderCommand`)
- Returns `{ command, args }` tuple (command can change for Codex resume: `codex resume`)
- Permission flag added if `skipPermissions: true`
- Resume: flag-type appends `--resume [GUID]`; subcommand-type prepends `resume [GUID|--last]`
- Prompt: positional appends as final arg; flag-type uses `-i <prompt>` (interactive)
- No prompt on resume (user types into running session instead)

### Session Name Format
- **New format**: `{projectId}:{provider}:card:{cardId}` or `{projectId}:{provider}:global`
- **Legacy format**: `{projectId}:card:{cardId}` or `{projectId}:global`
- `resolveSessionName()` checks new format first, falls back to legacy via `toLegacySessionName()`
- Old sessions without provider field default to `provider: "claude"`

### GUID Detection (Claude only)
- `supportsSessionDetection()` checks `provider.resume.detectSession`
- Watches `~/.claude/projects/` for new `.jsonl` files after spawn
- `getClaimedGuids()` excludes GUIDs already used by other sessions
- Gemini/Codex use `--resume --last` (no GUID tracking)

### Stage-Based Defaults
- `providers.json` `defaults.stages` maps each kanban stage → `{ provider, skipPermissions }`
- UI pre-fills provider dropdown from stage default
- `defaults.global` for project-level terminals
- `defaults.projects` reserved for per-project overrides (future)

## Patterns & Invariants

- Session names include provider segment: `{projectId}:{provider}:card:{cardId}` (new) or legacy `{projectId}:card:{cardId}`
- Claude prompts passed as positional arg, NOT `-p` flag (that's print mode)
- Resume behavior is provider-specific: flag vs subcommand, GUID vs latest
- SSE streams through `/api/bridge/sessions/{name}/stream` proxy
- Bridge runs on port 3456 (localhost), proxied through Next.js
- Idle timeout: 4 hours default, checked every 60 seconds
- Atomic state saves prevent data corruption
- Provider config cached 30s in provider-utils.ts

## API Endpoints

- `GET /sessions` - List all sessions
- `GET /sessions/:name` - Get session info
- `POST /sessions` - Create session (validates command + CWD)
- `DELETE /sessions/:name` - Stop or delete session
- `POST /sessions/:name/input` - Send input to PTY
- `POST /sessions/:name/resize` - Resize terminal
- `POST /sessions/:name/stop` - Send Escape key to active session (soft stop)
- `GET /sessions/:name/stream` - SSE output stream
- `POST /sessions/stop-all` - Bulk stop all running sessions
- `GET /stats` - BridgeStats with activity info
- `GET /activity-log/:name` - Activity transition history for debugging

## When to Expand

- Session not starting → session-manager.ts createSession(), check command whitelist + provider validation
- Adding new provider → data/providers.json, bridge-config.json allowedCommands
- Provider command issues → provider-utils.ts buildProviderCommand()
- Resume not working → provider-utils.ts (flag vs subcommand), claude-utils.ts (GUID detection)
- Security concerns → bridge-config.json, session-manager.ts validation
- Activity tracking issues → session-manager.ts handlePtyOutput(), getStats(), ActivityTransition
- Phantom activity blips → activity-log endpoint, transition trigger data
- Terminal display issues → Terminal.tsx, xterm setup
- Connection problems → api/bridge proxy, connection-manager.ts
- Idle timeout issues → session-manager.ts checkIdleSessions()
- Bulk operations → stopAllSessions(), /sessions/stop-all
- State corruption → session-manager.ts loadState/saveState
- Session name resolution → session-manager.ts resolveSessionName(), toLegacySessionName()
