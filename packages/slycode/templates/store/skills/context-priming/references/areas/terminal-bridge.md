# Terminal Bridge

Updated: 2026-03-14

## Overview

PTY bridge server manages AI coding sessions across multiple providers (Claude, Gemini, Codex). Express server spawns/manages PTY processes, streams output via SSE. Provider-agnostic command building via data-driven config (`providers.json`). Includes security hardening (command whitelist, CWD validation, localhost binding), activity tracking with transition logging for debugging, atomic state persistence, bulk session management, graceful idle timeout handling, and image delivery to PTY sessions. React components connect through Next.js API proxy.

## Key Files

### Bridge Server (Node/Express)
- `bridge/src/index.ts` - Express server entry, routes setup, localhost binding
- `bridge/src/session-manager.ts` - Session lifecycle, PTY spawning, provider resolution, activity tracking, atomic state saving, deferred prompt delivery (Windows)
- `bridge/src/provider-utils.ts` - Provider config loading, command building, session detection helpers, instruction file check/create
- `bridge/src/pty-handler.ts` - PTY process wrapper, output buffering, Windows .cmd extension resolution
- `bridge/src/api.ts` - REST endpoints for session CRUD, /stats, stop-all, activity-log, image upload, instruction file check
- `bridge/src/screenshot-utils.ts` - Screenshot saving, retention (10-file cap), .gitignore management
- `bridge/src/websocket.ts` - WebSocket upgrade handling (legacy, SSE preferred)
- `bridge/src/claude-utils.ts` - Provider-agnostic session ID detection (Claude/Codex/Gemini) with unified dispatchers
- `bridge/src/types.ts` - Session (incl. pendingPrompt, pendingPromptTimer), BridgeConfig, BridgeStats, ActivityTransition, provider interfaces

### Configuration
- `bridge/bridge-config.json` - Runtime config: allowedCommands (claude, codex, gemini, bash), CORS origins
- `data/providers.json` - Provider registry: CLI commands, permission flags, resume types, prompt handling, stage defaults
- `documentation/terminal-classes.json` - Terminal class definitions for command visibility
### Web Components
- `web/src/components/Terminal.tsx` - xterm.js terminal, SSE via ConnectionManager, resize broadcast with echo-loop suppression, paste interception via `attachCustomKeyEventHandler`
- `web/src/components/ClaudeTerminalPanel.tsx` - Terminal panel with startupActions/activeActions
- `web/src/components/GlobalClaudePanel.tsx` - Floating panel for project-wide session
- `web/src/app/api/bridge/[...path]/route.ts` - Next.js proxy to bridge server

## Key Functions

- `SessionManager.getSessionCwd()` - Returns CWD for a session (running or persisted), used by image upload endpoint
- `SessionManager.createSession()` - Resolves provider, builds command via `buildProviderCommand()`, validates CWD, spawns PTY. Uses `creating` placeholder as mutex to prevent concurrent creation (returns 202 for duplicate requests).
- `SessionManager.resolveSessionName()` - Checks both new (with provider) and legacy session name formats
- `SessionManager.stopSession()` - Graceful SIGINT, waits for exit, removes session from in-memory map (frees slot; data preserved in persistedState for resume)
- `SessionManager.stopAllSessions()` - Bulk stop all running/detached sessions, returns count
- `SessionManager.getStats()` - Returns BridgeStats with activity info
- `SessionManager.getGroupStatus(group)` - Returns status of all sessions in a group
- `SessionManager.relinkSession(name)` - Re-detect session ID from most recent provider session file
- `SessionManager.checkIdleSessions()` - Idle timeout with grace period after disconnect
- `buildProviderCommand()` - Assembles { command, args } from provider config, handles flag vs subcommand resume
- `getProvider()` - Loads provider config by ID from providers.json (30s cache)
- `checkInstructionFile(providerId, cwd)` - Checks if provider's instruction file exists. Priority scan: primary file → alt file → sibling copy source → no action needed
- `ensureInstructionFile(providerId, cwd)` - Creates missing instruction file by copying from sibling (never throws, logs warnings)
- `supportsSessionDetection()` - Check if provider supports session detection (all three now do)
- `getProviderSessionDir()` - Provider-agnostic session directory resolver
- `listProviderSessionFiles()` - Provider-agnostic session file listing
- `detectNewProviderSessionId()` - Provider-agnostic new session detection dispatcher
- `getMostRecentProviderSessionId()` - Find most recent session file (used by relink)
- `Terminal.connectSSE()` - Via ConnectionManager for auto-reconnection

## Data Models

```typescript
SessionInfo {
  name, group, status (running|stopped|detached|creating), pid, connectedClients,
  hasHistory, resumed, lastActive, lastOutputAt?,
  claudeSessionId?, provider?, skipPermissions?
}

BridgeStats {
  bridgeTerminals: number;      // Total PTY sessions
  connectedClients: number;     // Total SSE/WS connections
  activelyWorking: number;      // Sessions with output in last 2s
  sessions: SessionActivity[];  // Per-session activity
}

SessionActivity {
  name, status, lastOutputAt, isActive,
  activityStartedAt?, lastOutputSnippet?
}

ActivityTransition {
  timestamp: string;
  became: 'active' | 'inactive';
  lastOutputAt: string;
  activityStartedAt: string;
  outputAgeMs: number;
  triggerSnippet: string;
  triggerRawHex: string;
  triggerDataLength: number;
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
  cwd?: string;
  fresh?: boolean;
  idleTimeout?: number;
  prompt?: string;
  createInstructionFile?: boolean; // Opt-in: copy sibling instruction file if missing
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
  prompt: { type ('positional'|'flag'), interactive?, nonInteractive? },
  instructionFile?: string,    // e.g. "CLAUDE.md" for Claude, "AGENTS.md" for Codex
  altInstructionFile?: string  // e.g. "CODEX.md" for Codex (provider-specific alt)
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
- **Command whitelist**: Only commands in `bridge-config.json` allowedCommands can be spawned (claude, codex, gemini, bash — all four in both config and hardcoded defaults)
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

- **Creation mutex**: `creating` status placeholder prevents concurrent createSession() for same name. API returns 202 for idempotent duplicate requests. Placeholder cleaned up on failure.
- **GUID detection cancellation**: `guidDetectionCancelled` flag on Session prevents detection from overwriting state after session stops/exits.
- **Disconnect grace period**: 5 seconds before session eligible for idle timeout
- **Status transitions**: Protected against reconnect during disconnect
- **SSE cleanup**: Proper client tracking on connection/disconnection
- **SSE heartbeat**: 15-second comment heartbeats (`: heartbeat\n\n`) keep connections alive through proxies (Tailscale, Next.js). Started per-client on SSE connect, cleared on disconnect.

## Terminal Classes

Controls which commands appear in each context:
- `global-terminal` - Dashboard terminal (future)
- `project-terminal` - Project-level panel at bottom
- `backlog`, `design`, `implementation`, `testing`, `done` - Card terminals by stage
- `action-assistant` - Terminal in SlyActionConfigModal

## Multi-Provider System

### Supported Providers
- **Claude Code** (`claude`) — Positional prompts, `--resume <GUID>` with auto-detection, `--dangerously-skip-permissions`
- **Codex CLI** (`codex`) — Positional prompts, `codex resume --last [PROMPT]` (subcommand-style), `--yolo`, session detection via rollout files
- **Gemini CLI** (`gemini`) — Flag-based prompts (`-i`/`-p`), `--resume` (no GUID), `--yolo`, session detection via chat JSON files

### Command Building (`buildProviderCommand`)
- Returns `{ command, args }` tuple (command can change for Codex resume: `codex resume`)
- Permission flag added if `skipPermissions: true`
- Resume: flag-type appends `--resume [GUID]`; subcommand-type prepends `resume [GUID|--last]`
- Prompt: positional appends as final arg; flag-type uses `-i <prompt>` (interactive)
- Prompt works alongside resume: Claude accepts positional after `--resume`, Codex accepts positional after `resume --last`

### Session Name Format
- **New format**: `{projectId}:{provider}:card:{cardId}` or `{projectId}:{provider}:global`
- **Legacy format**: `{projectId}:card:{cardId}` or `{projectId}:global`
- `resolveSessionName()` checks new format first, falls back to legacy via `toLegacySessionName()`
- Old sessions without provider field default to `provider: "claude"`

### Session Detection (All Providers)
- `supportsSessionDetection()` checks `provider.resume.detectSession` — all three providers have `detectSession: true`
- Provider-agnostic dispatchers route to provider-specific logic:
  - **Claude**: Watches `~/.claude/projects/<cwd>/` for new `.jsonl` files, extracts GUID from filename
  - **Codex**: Watches `~/.codex/sessions/YYYY/MM/DD/` for new rollout files, extracts UUID from filename
  - **Gemini**: Watches `~/.gemini/tmp/<SHA256(cwd)>/chats/` for new session JSON files
- `getClaimedGuids()` excludes GUIDs already used by other sessions
- Detection timeout: 60 seconds (Gemini CLI takes ~30s to create session files)

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
- Bridge port from BRIDGE_PORT env var (default 7592 prod, 3004 dev), localhost binding, proxied through Next.js
- Stopped sessions removed from in-memory `sessions` map (frees slot); session data preserved in `persistedState` for future resume. `getSessionInfo()` falls back to persistedState when session not in map.
- Idle timeout: 4 hours default, checked every 60 seconds
- Atomic state saves with unique temp file names (`.tmp.${pid}.${Date.now()}`) prevent race conditions
- Provider config cached 30s in provider-utils.ts
- Bracketed paste mode (`\x1b[200~...\x1b[201~`) for multi-line prompt input, 150ms delay before Enter
- lastActive timestamp preserved on resume (not overwritten with current time)
- Image delivery: saves to `screenshots/` in session CWD, timestamped filenames, 10-file retention, auto-.gitignore
- Screenshot reference injected as `[Screenshot: screenshots/<filename>]` text into PTY (not auto-submitted)
- Instruction file fallback: `checkInstructionFile()` scans for sibling instruction files (CLAUDE.md, AGENTS.md, CODEX.md, GEMINI.md) in priority order. `ensureInstructionFile()` copies when requested. Creation is opt-in only (`createInstructionFile: true` in CreateSessionRequest).
- Resize broadcast: PTY resize events broadcast via SSE to all connected tabs. Terminal.tsx guards resize POSTs (only visible tabs), uses `suppressResizePost` flag to prevent ResizeObserver echo loop when adapting to another tab's resize. Skips resize on reconnect.
- **Windows ConPTY support**: On Windows, CLI tools are installed as `.cmd` batch wrappers — `pty-handler.ts` auto-appends `.cmd` extension. cmd.exe mangles multi-line CLI args (newlines become command separators), so prompts are deferred: stripped from spawn args and delivered via bracketed paste after provider output settles (1.5s quiet, 30s max timeout). ConPTY silently truncates PTY writes >~4KB, so large prompts are chunked (1024-byte chunks with 500ms delay, surrogate-pair-safe boundaries). Session tracks `pendingPrompt` and `pendingPromptTimer` for debounced delivery.

## API Endpoints

- `GET /sessions` - List all sessions
- `GET /sessions/:name` - Get session info
- `POST /sessions` - Create session (validates command + CWD, returns 202 if already creating)
- `DELETE /sessions/:name` - Stop or delete session
- `POST /sessions/:name/input` - Send input to PTY
- `POST /sessions/:name/resize` - Resize terminal
- `POST /sessions/:name/image` - Upload image to session's screenshots/ dir (multipart, 10MB limit), returns filename
- `POST /sessions/:name/action` - Structured actions: compact, clear, interrupt
- `POST /sessions/:name/relink` - Re-detect session ID from most recent provider session file
- `POST /sessions/:name/stop` - Send Escape key to active session (soft stop)
- `GET /sessions/:name/stream` - SSE output stream
- `GET /groups/:group/status` - Group-level session status aggregation
- `POST /sessions/stop-all` - Bulk stop all running sessions
- `GET /stats` - BridgeStats with activity info
- `GET /activity-log/:name` - Activity transition history for debugging
- `GET /check-instruction-file?provider=X&cwd=Y` - Check if instruction file exists, returns { needed, targetFile?, copySource? }

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
- Image delivery → screenshot-utils.ts (saving/retention), api.ts (image endpoint), ClaudeTerminalPanel.tsx (paste handling)
- State corruption → session-manager.ts loadState/saveState
- Session name resolution → session-manager.ts resolveSessionName(), toLegacySessionName()
- Instruction file issues → provider-utils.ts checkInstructionFile/ensureInstructionFile, api.ts check-instruction-file endpoint
- Terminal resize sync → Terminal.tsx sendResize(), SSE resize event handling
