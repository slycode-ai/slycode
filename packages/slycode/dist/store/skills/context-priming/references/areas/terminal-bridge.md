# Terminal Bridge

Updated: 2026-07-07

## Overview

PTY bridge server manages AI coding sessions across multiple providers (Claude, Gemini, Codex). Express server spawns/manages PTY processes, streams output via SSE. Provider-agnostic command building via data-driven config (`providers.json`). Includes security hardening (command whitelist, CWD validation, localhost binding), activity tracking with transition logging for debugging, atomic state persistence, bulk session management, graceful idle timeout handling, and image delivery to PTY sessions. React components connect through Next.js API proxy.

## Key Files

### Bridge Server (Node/Express)
- `bridge/src/index.ts` - Express server entry, routes setup, localhost binding, SLYCODE_HOME-aware config path resolution, validateDataPaths() startup check
- `bridge/src/session-manager.ts` - Session lifecycle, PTY spawning, provider resolution, activity tracking, atomic state saving, deferred prompt delivery (Windows), `submitVerified()` (feature 070 verified submit flow + `submitMutexes` per-session mutex), `writeQueues` per-session FIFO write serialization (feature 071, shipped de11e0d), `getSnapshot()` ANSI-stripped terminal snapshot
- `bridge/src/submit-verify.ts` - **Feature 070 (shipped 2026-06-10):** dependency-free, pure classifier for the self-verifying prompt submit. Exports `normalizeForMatch` (strips ALL whitespace — stripped snapshots collapse spaces unpredictably), `extractInputRegion(provider, snapshot)`, `parsePastePlaceholder` (long pastes render as TUI placeholders: Claude `[Pasted text #1 +21 lines]` count=lines-1, Codex `[Pasted Content 3199 chars]` count=chars, Gemini `[Pasted Text: 22 lines]` count=lines; Claude ≥2.1.176 also renders long SINGLE-line pastes as a countless `[Pasted text #2]` — `count: number | null`, the null branch accepts as ours when the expected payload is ≥40 normalized chars since short payloads would have rendered literally — observed live 2026-06-13, shipped d5c3893), `classifyInputRegion` → `empty | queued_ours | queued_other | no_input_region | unrecognized`, `hasDialogMarkers` (trust/update/auth markers, checked ONLY when no input region found so transcript text can't false-positive), `decideNextAction` state machine → `wait | resend_enter | delivered | failed | blocked | ambiguous`. Codex empty-input hint ROTATES between runs → success keyed on DISAPPEARANCE of `queued_ours`, never a positive "empty" match. Must stay dependency-free (no session-manager imports) for table-testing.
- `bridge/src/submit-verify.test.ts` + `bridge/src/__fixtures__/submit-verify/` - Table tests over real spike-captured snapshots (startup, after-paste, post-Enter, stranded, merged-paste, long-paste placeholders, blocking dialogs) across all three providers
- `bridge/src/session-manager.write-queue.test.ts` - (shipped de11e0d, feature 071) proves concurrent `writeToSession` calls serialize without byte interleave
- `bridge/src/provider-utils.ts` - Provider config loading (SLYCODE_HOME-aware path), command building, session detection helpers, instruction file check/create
- `bridge/src/pty-handler.ts` - PTY process wrapper, output buffering, Windows .cmd extension resolution. Exports `writeChunkedToPty(pty, data)` — single shared utility for ConPTY-safe writes. On Windows splits writes >1024B into 1KB chunks with 200ms delay, surrogate-pair-safe boundaries. On Unix passes through directly (kernel handles backpressure). Constants `CHUNKED_WRITE_SIZE=1024`, `CHUNKED_WRITE_DELAY_MS=200`. **Convention: any code path writing potentially large text (>1KB) to a PTY must use `writeChunkedToPty()`; keystrokes and short control sequences may use `writeToPty()` directly.**
- `bridge/src/git-utils.ts` - `getGitStatus(cwd)` returns `{ branch, uncommitted, files }` where `files: ChangedFile[]` with `{ status, path, category }`. Categories: `'staged' | 'unstaged' | 'untracked'`. Parses `git status --porcelain v1` with XY prefix; `MM` produces two entries (one staged, one unstaged) but `uncommitted` counts unique paths. `trimEnd` only — leading spaces on X column are significant.
- `bridge/src/api.ts` - REST endpoints for session CRUD, /stats, stop-all, activity-log, image upload, instruction file check, prompt-response delivery. Structured 404 body on `GET /responses/:id` includes `reason / issuedAt / expiredAt` from `getExpiryHint()` so `sly-kanban respond` can render actionable typo / expired / unknown errors. `sanitiseInjectedPayload()` hex-escapes control bytes inside late-injection content before it reaches the calling session's PTY.
- `bridge/src/response-store.ts` - One-shot prompt response store. Re-delivery within TTL is allowed (latest payload wins) — the one-shot delivery gate was lifted so timed-out callers can recover. Maintains a `recentlyExpired` ring buffer (max 200) and exposes `getExpiryHint()` so 404s carry context instead of a generic "not found or expired" message.
- `bridge/src/screenshot-utils.ts` - Screenshot saving, retention (10-file cap), .gitignore management
- `bridge/src/websocket.ts` - WebSocket upgrade handling (legacy, SSE preferred)
- `bridge/src/claude-utils.ts` - Provider-agnostic session ID detection (Claude/Codex/Gemini) with unified dispatchers
- `bridge/src/types.ts` - Session (incl. pendingPrompt, pendingPromptTimer), BridgeConfig, BridgeStats, ActivityTransition, provider interfaces
- `bridge/src/reaper.ts` - **Orphan provider reaper (feature 078, shipped 2026-07-07):** periodic /proc sweep that kills SlyCode-spawned provider processes orphaned by dead bridge instances. See "Orphan Provider Reaper" section below.
- `bridge/src/reaper.test.ts` + `bridge/scripts/reaper-selftest.ts` - decision-core table tests + integration self-test with real synthetic processes (uses a fake provider name so it can never touch real sessions)

### Configuration
- `bridge/bridge-config.json` - Runtime config: allowedCommands (claude, codex, gemini, bash), CORS origins. Path resolved via SLYCODE_HOME in deployed mode, `__dirname/../` in dev.
- `bridge/src/index.ts` - express.json body limit raised to **1 MB** to match the `sly-kanban respond --stdin` cap; without this large heredoc-piped responses 413 before reaching the response store.
- `data/providers.json` - Provider registry: CLI commands, permission flags, resume types, prompt handling, model lists, per-project defaults with last-set global fallback (feature 073 + follow-up)
- `documentation/terminal-classes.json` - Terminal class definitions for command visibility
### Web Components
- `web/src/components/Terminal.tsx` - xterm.js terminal, SSE via ConnectionManager, resize broadcast with echo-loop suppression, paste interception via `attachCustomKeyEventHandler`. (feature 071, shipped de11e0d) ALL raw input (onData keystrokes, sendKey, pasteText, sendInput handle, image-reference insert) flows through one `InputQueue` per session (`web/src/lib/input-queue.ts`): single POST in flight, consecutive raw items coalesce into one body, bracketed-paste payloads never merge, bounded retry then silent drop, aborted via the fetchAbort signal on unmount
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
- `checkInstructionFile(providerId, cwd)` - Checks if provider's instruction file exists. Priority scan: primary file → no action; alt file → offer to copy; any sibling → offer to copy; nothing → no action
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
  hasHistory, resumed, lastActive, lastOutputAt?, createdAt?,
  claudeSessionId?, provider?, skipPermissions?, model?, exitCode?, exitedAt?
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
  instructionFile?: string,    // e.g. "CLAUDE.md" for Claude, "GEMINI.md" for Gemini
  altInstructionFile?: string  // e.g. "CODEX.md" for Codex (provider-specific alt — if exists, offered as copy source)
}

ProvidersData {
  providers: Record<string, ProviderConfig>;
  // Per-project defaults keyed by registry project id; `global` is the
  // last-set fallback. Legacy stages keys ignored.
  defaults: {
    global: { provider, skipPermissions, model? };
    projects?: Record<string, { provider, skipPermissions, model? }>;
  }
}
```

## Security Hardening

- **Localhost binding**: HOST defaults to `localhost` (not `0.0.0.0`)
- **Command whitelist**: Only commands in `bridge-config.json` allowedCommands can be spawned (claude, codex, gemini, bash — all four in both config and hardcoded defaults). Hardcoded defaults updated to include all four providers.
- **Provider validation**: Provider ID must exist in providers.json; resolved command must be in allowedCommands
- **CWD validation**: Requires absolute path, verifies exists and is accessible before spawning PTY
- **CORS origins**: Configured in bridge-config.json, not wide-open
- **Command shell-safety (feature 069, 2026-05-30)**: `isCommandShellSafe(command)` (exported from `pty-handler.ts`) is the boundary check before any command reaches the shell in `resolveCommand`. Allows absolute paths (node-pty spawns these directly, no shell) and bare `^[\w.-]+$` tokens (bash, powershell.exe, claude, codex, gemini); rejects anything carrying `/bin/sh` metacharacters (`;$\`()|&<>'"` + space). `resolveCommand` never builds a shell string from `command` — both the PATH strategy and the login-shell strategy run `execFileSync('/bin/sh'|loginShell, [..., '-c', 'command -v "$1"', '_', command])`, binding the input as `$1` (never interpolated); it also early-returns the bare name if `!isCommandShellSafe`. `session-manager.ts createSession` throws `Invalid command: …` on the provider-miss path when the raw client string isn't shell-safe (provider hits, bare tokens, and absolute paths still pass). Regression test: `pty-handler.test.ts` (node:test, run via bridge tsx).

## Activity Tracking

- `lastOutputAt` timestamp updated on every PTY output
- `isActive` = output within last 2 seconds (with 1s debounce)
- `activelyWorking` count in BridgeStats for health monitor
- Cards with active sessions show pulsing green glow in UI
- **Activity transitions**: Logged with trigger details (snippet, hex, data length) for debugging phantom blips
- `GET /activity-log/:name` endpoint exposes transition history per session

## State Persistence

- Session state saved to bridge-sessions.json via atomic writes (temp file + rename)
- State file uses `__dirname` resolution for reliable file location. In deployed mode, `SLYCODE_HOME` overrides workspace root for bridge-sessions.json.
- Missing file (ENOENT) handled gracefully; corrupt JSON throws fatal error
- Prevents silent data loss from corrupted state

## Race Condition Handling

- **Creation mutex**: `creating` status placeholder prevents concurrent createSession() for same name. API returns 202 for idempotent duplicate requests. Placeholder cleaned up on failure.
- **Stale PTY exit guard**: `handlePtyExit()` receives `exitingCreatedAt` timestamp, compares against current session's `createdAt`. If mismatch (old session replaced by fresh restart), ignores the exit to prevent stomping the new session. Resolves race where stopSession() timeout → new session created → old PTY finally exits and would delete the new session.
- **GUID detection cancellation**: `guidDetectionCancelled` flag on Session prevents detection from overwriting state after session stops/exits.
- **Disconnect grace period**: 5 seconds before session eligible for idle timeout
- **Status transitions**: Protected against reconnect during disconnect
- **SSE cleanup**: Proper client tracking on connection/disconnection
- **SSE heartbeat**: 15-second comment heartbeats (`: heartbeat\n\n`) keep connections alive through proxies (Tailscale, Next.js). Started per-client on SSE connect, cleared on disconnect.

## Orphan Provider Reaper (feature 078)

When a bridge dies without graceful teardown, its node-pty children (claude/codex/gemini) reparent to init and linger forever (30-340 MB each — the 2026-06-06 incident had a 35-day-old gemini and swap at 100%). The reaper (`bridge/src/reaper.ts`, wired in `index.ts` beside the response store) sweeps /proc every 10 min and kills a process ONLY when ALL hold:

1. **Provider command** — comm or argv[0] basename matches a `providers.*.command` from `data/providers.json` (config-driven, not hardcoded)
2. **Orphaned/untracked** — PPID 1, reparented to systemd/init, or no controlling TTY; AND not in the live bridge's session PID set
3. **SlyCode provenance** — `SLYCODE_SESSION` env tag in `/proc/<pid>/environ` (stamped on every spawn via `extraEnv` — primary signal), or a prompt-envelope argv fingerprint (`[Telegram] Project:`, `=== AUTOMATION RUN ===`, `Card: ...[card-`, `(Reply using /messaging | Mode:`) as fallback for pre-tag orphans. Persisted-session pid match (PersistedSession.pid, nulled on observed exit) is corroboration only — requires the env tag to match the recorded name (PID-reuse guard)
4. **Inactive ≥24h** — process age ≥ idleHours AND CPU ticks unchanged across ≥2 consecutive sweeps (in-memory history keyed pid+starttime)

Kill = SIGTERM, escalating to SIGKILL after 60s grace if still matching. Developer shell/tmux CLI sessions are never touched (live parent + TTY + no provenance). Zombie (Z) states skipped. Linux-only — no-op with a log line elsewhere.

- **Config**: optional `reaper` section in `bridge-config.json`: `{ "enabled": true, "intervalMinutes": 10, "idleHours": 24, "dryRun": false }` (all optional, those are defaults). **Disable with `"reaper": { "enabled": false }`.**
- **Evidence log**: every kill/skip/near-miss logged with reasons+age+RSS to `$SLYCODE_HOME/logs/reaper.log` (dev: `bridge/reaper.log`, gitignored)
- **Skip-list**: `$SLYCODE_HOME/reaper-skip.txt` (dev: `bridge/reaper-skip.txt`) — one PID or cmdline-substring per line, `#` comments
- **Decision logic is pure** (`evaluateCandidate`) — table-tested in `reaper.test.ts`; integration self-test: `cd bridge && ./node_modules/.bin/tsx scripts/reaper-selftest.ts`
- The existing 4h detached-session idle stop (`checkIdleSessions`) remains the primary lifecycle for tracked sessions; the reaper is the backstop for what that machinery can't see

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
- **Gemini CLI** (`gemini`) — Flag-based prompts (`-i`/`-p`), `--resume` (no GUID), `--yolo`, session detection via chat JSON files. Instruction file: `GEMINI.md` (no altInstructionFile).

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
  - **Claude**: Watches `~/.claude/projects/<cwd>/` for new `.jsonl` files, extracts GUID from filename. Path transform: Linux replaces `/` and `_` with `-`; Windows also replaces `\` and `:` with `-`.
  - **Codex**: Watches `~/.codex/sessions/YYYY/MM/DD/` for new rollout files, extracts UUID from filename
  - **Gemini**: Reads `~/.gemini/projects.json` registry for canonical slug, falls back to computed slugify (basename → lowercase, non-alphanumeric → hyphens). Watches `~/.gemini/tmp/<slug>/chats/` for new `session-*.json` files, extracts UUID from `sessionId` field inside JSON.
- `getClaimedGuids()` excludes GUIDs already used by other sessions
- Detection timeout: 60 seconds (Gemini CLI takes ~30s to create session files)

### Per-Project Defaults (feature 073 + 2026-07-07 follow-up)
- `providers.json` `defaults.projects[registryProjectId]` holds each project's default `{ provider, skipPermissions, model? }`; `defaults.global` is the LAST-SET default (every per-project save mirrors into it) and the fallback for projects that never set their own
- Resolution rule everywhere: `defaults.projects?.[projectId] ?? defaults.global`
- Edited only via the web top-bar `DefaultProviderConfig` control (per project); terminal-panel provider switches are ephemeral (never persisted)
- `model` may be a free-text custom id (not validated against `model.available`); passed to the provider CLI only when the session's provider equals the resolved default provider
- `defaults` survives `slycode update` — `refreshProviders()` replaces only the `providers` block (guarded invariant, see sync.ts)
- Legacy `defaults.stages` keys in old workspace files are ignored by all readers; PUT sheds them

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
- Bracketed paste mode (`\x1b[200~...\x1b[201~`) for all prompt/input paths, 600ms delay before Enter. `writeToSession()` is `async`, detects bracketed paste wrapping, sends markers atomically via `writeToPty` and chunks only the inner content via `writeChunkedToPty` (prevents ConPTY from splitting the escape sequences). API routes `/sessions/:name/input`, `/sessions/:name/action`, `/sessions/:name/stop` are async to await this. Callers that construct paste manually (session resume reuse path, deferred prompt delivery, session creation with bracketedPaste) also send markers atomically then chunked inner body.
- **Verified prompt submit (feature 070, SHIPPED 2026-06-10 — replaces every blind paste+600ms+Enter copy in the bridge):** `SessionManager.submitVerified(name, SubmitRequest)` runs paste → confirm `queued_ours` in input region → Enter → poll ladder until cleared → resend ENTER ONLY (never re-paste) when provably still queued → classify. Returns `VerifiedSubmitResult` with `delivery: { outcome: 'delivered'|'failed'|'ambiguous'|'blocked', reason?, warnings?, attempts?, resends?, mode? }`. Blocking dialogs (trust/update/auth) render pastes NOWHERE and a blind Enter can ACCEPT them — verified flow detects them pre-paste and returns `blocked`. Guarded by per-session `submitMutexes` (FIFO promise, tail-cleanup pattern). Internal callers routed through it: session-create reuse path (live session + prompt), deferred Windows prompt delivery, and `submitPrompt` (so POST `/sessions/:name/submit` verifies too). `CreateSessionRequest.verifyDelivery?: boolean` makes the create response carry the typed `delivery` result. The scheduler's old `waitForActivity`/`prePasteAt` heuristic is GONE — consumers call the bridge once and trust the typed outcome.
- **Per-session write queue (feature 071, shipped de11e0d):** `writeToSession` chains every call onto a per-session FIFO promise (`writeQueues` map, mirrors `submitMutexes` incl. tail cleanup) — concurrent callers (multiple tabs, scripts, legacy WS, image-reference inserts) can never interleave chunked large-paste bytes at the PTY. Session name resolved BEFORE queuing so aliases share one queue; a failed write never poisons the chain (stored tail swallows rejections; each caller still sees its own). Additionally POST `/sessions/:name/input` awaits `awaitSubmitIdle(name)` (the stored submit mutex, best-effort) before writing so raw keystrokes can't inject mid verified-submit.
- lastActive timestamp preserved on resume (not overwritten with current time)
- Image delivery: saves to `screenshots/` in session CWD, timestamped filenames, 10-file retention, auto-.gitignore
- Screenshot reference injected as `[Screenshot: screenshots/<filename>]` text into PTY (not auto-submitted)
- Instruction file fallback: `checkInstructionFile()` priority: primary exists → no action; altInstructionFile exists → offer copy to primary; any sibling instruction file → offer copy. `ensureInstructionFile()` copies when requested. Creation is opt-in only (`createInstructionFile: true` in CreateSessionRequest). Gemini uses `GEMINI.md` as primary (no altInstructionFile).
- Resize broadcast: PTY resize events broadcast via SSE to all connected tabs. Terminal.tsx guards resize POSTs (only visible tabs), uses `suppressResizePost` flag to prevent ResizeObserver echo loop when adapting to another tab's resize. Skips resize on reconnect.
- **Windows ConPTY support**: On Windows, CLI tools are installed as `.cmd` batch wrappers — `pty-handler.ts` auto-appends `.cmd` extension. cmd.exe mangles multi-line CLI args (newlines become command separators), so prompts are deferred: stripped from spawn args and delivered via bracketed paste after provider output settles (1.5s quiet, 30s max timeout). ConPTY silently truncates PTY writes >~4KB, so chunked writes go through `writeChunkedToPty()` (1024-byte chunks with 200ms delay, surrogate-pair-safe boundaries — deduplicated from session-manager.ts into pty-handler.ts so every write path uses the same utility). Session tracks `pendingPrompt` and `pendingPromptTimer` for debounced delivery. **Settle delay scales with chunk count** for long pastes — was a fixed 600ms which caused Codex TUI to drop the trailing Enter on multi-chunk pastes; longer payloads now wait proportionally longer for the TUI to consume all chunks before Enter fires.
- **Prompt submission accepts `detached` status alongside `running`**: PTY is still operational without UI clients connected, so `POST /sessions/:name/input` no longer rejects detached sessions.
- **Bridge GET /sessions/:name returns 200 with null body when session is missing** (NOT 404). Web/messaging callers that iterate alias candidates must treat 200/null as a miss and continue iterating, otherwise pre-migration sessions are invisible to the panel and Resume creates duplicates.

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
- `POST /sessions/:name/submit` - Semantic prompt submit (`submitPrompt`: lock/busy guards → 409, `callingSession`/`responseId` call-lock exclusion) — now internally delivers via `submitVerified`
- `POST /sessions/:name/submit-verified` - Feature 070 verified submit. 200 regardless of outcome once the flow ran — the `delivery` object is the verdict; guard rejections (missing/busy/locked) mirror /submit codes (404/409)
- `GET /sessions/:name/input-region` - Current input-region classification (lets the scheduler detect a spawned session blocked by a startup update/trust dialog while its argv prompt sits unprocessed)
- `GET /sessions/:name/snapshot?lines=N` - ANSI-stripped terminal snapshot for diagnostics (default 20 lines; used by the 070/071 repro methodology)
- `POST /responses/:id` - Deliver a `sly-kanban respond` payload to the originating session's PTY. Sanitises injected content (control bytes hex-escaped) before write. Re-delivery within TTL replaces the stored payload (latest wins).
- `GET /responses/:id` - Fetch a response payload (used internally by the originating session to inject the reply). Returns structured 404 body with `reason / issuedAt / expiredAt` from `getExpiryHint()` when the id is unknown or expired.

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
- Large prompt delivery / ConPTY truncation → pty-handler.ts writeChunkedToPty(), session-manager.ts writeToSession() bracketed-paste detection
- Git branch / changed files endpoint → git-utils.ts (gitChangedFiles parses porcelain), /api/git-status (web proxy)
- Cross-card prompt response delivery → response-store.ts (TTL re-delivery, expiry-hint ring buffer), api.ts (sanitiseInjectedPayload, structured 404 body), index.ts (1MB body limit). Companion CLI is `sly-kanban respond` — see Skills area.
- Long-paste settle delay (Codex Enter dropped) → session-manager.ts deferred-prompt settle calculation (scales with chunk count, not fixed 600ms)
- Prompt not submitting / merged prompts / blocked dialog → submit-verify.ts classifier + session-manager.ts submitVerified(); fixtures in bridge/src/__fixtures__/submit-verify/; spec documentation/features/070_self_verifying_prompt_submit.md. READ THE SPEC before touching paste paths — never reintroduce blind paste+delay+Enter or re-paste retries
- Raw input ordering / interleaved keystrokes → session-manager.ts writeQueues + awaitSubmitIdle, web/src/lib/input-queue.ts (client side); spec documentation/features/071_terminal_raw_input_ordering.md
