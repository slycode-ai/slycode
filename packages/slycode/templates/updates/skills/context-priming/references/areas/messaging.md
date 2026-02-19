# Messaging Service

Updated: 2026-03-13

## Overview

Multi-channel messaging service for remote AI interaction via Telegram (and future channels). Supports text, voice, and photo messages, target-based navigation (global/project/card), voice swapping, response mode/tone preferences, multi-provider support (Claude/Gemini/Codex), stop command for session interruption, cross-project card search with inline keyboards, permission mismatch detection, instruction file pre-flight checks, context-aware command filtering, and two-way communication with AI sessions through the terminal bridge. Runs as a standalone Node/Express service with a CLI for outbound messages.

## Key Files

### Service Core
- `messaging/src/index.ts` - Main entry, channel wiring, HTTP server, bot commands, callback handlers, stop interception
- `messaging/src/types.ts` - Channel interface, InlineButton, configs, bridge types, ResponseMode, TargetType, NavigationTarget, InstructionFileCheck, PendingInstructionFileConfirm, BridgeSessionInfo
- `messaging/src/state.ts` - StateManager: target navigation (global/project/card), voice state, response mode, voice tone, provider selection, persistence. Resolves paths via SLYCODE_HOME env var (messaging-state.json, registry.json).
- `messaging/src/bridge-client.ts` - BridgeClient: session management, provider-aware creation, permission mismatch detection, instruction file check, activity watching, soft stop, debug logging, background activity monitor, image upload

### Channels
- `messaging/src/channels/telegram.ts` - TelegramChannel: bot polling, inline buttons, persistent keyboards, callback handlers, chat actions

### Voice Pipeline
- `messaging/src/stt.ts` - Dual-backend STT: OpenAI Whisper API or local whisper.cpp CLI. SttConfig interface, validateSttConfig() validation. Local backend: ffmpeg OGA→WAV conversion + whisper-cli execution (2min timeout).
- `messaging/src/tts.ts` - ElevenLabs v3 TTS with audio tag support, optional voice override
- `messaging/src/voices.ts` - Voice search across personal + community library (v2 + v1 APIs)

### Command System
- `messaging/src/sly-action-filter.ts` - SlyActionFilter: context-aware action filtering by terminal class, placement, card type (v3 classAssignments-based). Resolves sly-actions.json via SLYCODE_HOME env var.
- `messaging/src/kanban-client.ts` - Direct access to project kanban boards for card metadata

### CLI & Skill
- `messaging/src/cli.ts` - CLI tool for sending text/voice from agent skills
- `.claude/skills/messaging/SKILL.md` - Skill definition (v2.2.0) with mode/tone system and audio tags

### Config
- `messaging/package.json` - Dependencies: node-telegram-bot-api, openai, express, dotenv
- `messaging/tsconfig.json` - TypeScript config (ESM, ES2022)
- `.env` - Runtime config (tokens, API keys, ports)

## Channel Interface

```typescript
Channel {
  name: string;
  start(): Promise<void>;
  stop(): void;
  onText(handler): void;
  onVoice(handler): void;
  onPhoto(handler): void;              // Photo messages (batched for albums)
  onCommand(command, handler): void;
  sendText(text): Promise<void>;        // With Markdown
  sendTextRaw(text): Promise<void>;     // Without Markdown (preserves [brackets])
  sendVoice(audio: Buffer): Promise<void>;
  sendInlineKeyboard(text, buttons: InlineButton[][]): Promise<void>;  // Inline buttons with breadcrumb
  setPersistentKeyboard(buttons: string[][]): Promise<void>;           // Bottom keyboard
  sendTyping(): Promise<void>;
  sendChatAction(action): Promise<void>;
  sendVoiceList?(voices): Promise<void>;     // Optional
  onVoiceSelect?(handler): void;             // Optional
  onCallback(prefix, handler): void;         // Inline button callback routing
  isReady(): boolean;
}

InlineButton { label: string; callbackData: string; }
```

## Navigation Model

Three-level target system replacing old project-selection model:

- **Global** - No project context, uses ClaudeMaster as CWD
- **Project** - Project-level terminal (`{projectId}:{provider}:global`)
- **Card** - Card-specific terminal (`{projectId}:{provider}:card:{cardId}`)

`StateManager.getTarget()` returns `NavigationTarget { type, projectId?, cardId?, stage? }`

## Bot Commands

- `/start` - Help text with available commands
- `/switch` - Primary navigation: drill-down inline keyboards (global → projects → cards)
- `/global` - Quick switch to global terminal
- `/project` - Quick switch from card to project terminal (stays in same project)
- `/search` - Quick-access: active sessions + recent cards as inline buttons. With args: text search across cards
- `/sly` - Context-aware sly actions as inline buttons (filtered by terminal class + placement)
- `/status` - Current target, project, voice, response mode, and tone
- `/provider` - Provider selection inline keyboard (Claude/Gemini/Codex)
- `/voice` - Search/swap TTS voices, reset to default
- `/voice <name>` - Search voices, auto-select on exact match, inline buttons for multiple
- `/mode` - Response mode selection (text/voice/both)
- `/tone` - Voice tone customization

## Callback Handlers

- `sw_` - Switch navigation (project/card selection from inline keyboards)
- `qc_` - Quick card actions (from /search results)
- `cfg_` - Configuration callbacks
- `ifc_` - Instruction file confirmation (yes/no for creating missing instruction file)
- `perm_` - Permission mismatch actions (restart session with correct perms)
- `mode_` - Response mode selection callbacks
- `tone_` - Voice tone selection callbacks

## Message Flow

### Inbound (user → agent session)
1. User sends text/voice on Telegram
2. **Stop interception**: "stop" text (case-insensitive) sends Escape to active session instead of forwarding
3. TelegramChannel routes to handler in index.ts
4. Voice: `record_voice` chat action → Whisper transcription → typing indicator
5. **Instruction file pre-flight**: if new session would be created, checks bridge for missing instruction file. If needed, shows inline buttons (yes/no). Pending state stored in `StateManager._pendingInstructionFileConfirm` (ephemeral, not persisted). `ifc_yes` callback creates file + delivers original message; `ifc_no` delivers without creating.
6. BridgeClient.ensureSession() creates/finds session (with selected provider, always skipPermissions, optional createInstructionFile)
7. If permission mismatch (existing session without skipPermissions), warns user and offers restart
8. BridgeClient.sendMessage() writes text + CR to PTY
9. BridgeClient.watchActivity() polls /stats, sends typing while active

### Outbound (agent → user)
1. Agent skill calls CLI: `tsx cli.ts send "message" [--tts]`
2. CLI POSTs to HTTP server `/send` or `/voice`
3. `/send` → channel.sendText()
4. `/voice` → `upload_voice` chat action → TTS generation → channel.sendVoice() + sendTextRaw()

### Photo Messages (user → agent session)
1. User sends photo(s) on Telegram (single or album)
2. TelegramChannel downloads largest resolution, batches album photos (2s window via media_group_id)
3. BridgeClient.sendImage() uploads each photo to bridge `POST /sessions/:name/image`
4. Bridge saves to `screenshots/` in session CWD, returns filename
5. Screenshot references (`[Screenshot: screenshots/<filename>]`) + optional caption built into message
6. Message sent to PTY, activity watched as normal

### Stop Command
1. User sends "stop" (exact, case-insensitive)
2. BridgeClient.stopSession() calls `POST /sessions/:name/stop` (sends Escape key)
3. Returns feedback: "Interrupted active session" or "Already stopped"
4. Message NOT forwarded as a prompt

## Response Mode System

- **Mode**: `text` | `voice` | `both` - determines response format
  - `text` - Text replies only (default)
  - `voice` - Voice messages with text companion
  - `both` - Both voice and text responses
- **Tone**: Free-text description of voice style and length
- Mode shown in message footer: `(Reply using /messaging | Mode: text)`
- Persisted in messaging-state.json

## Command Filtering

- `SlyActionFilter.loadActions()` - Hot-reloads sly-actions.json on each call
- `SlyActionFilter.filterActions(terminalClass, placement?, cardType?)` - Context-aware filtering via classAssignments lookup
- `SlyActionFilter.resolveTemplate(prompt, context)` - Template variable resolution
- `SlyActionFilter.getTerminalClass(target)` - Maps navigation target to terminal class
- Supports card context from KanbanClient for prompt templates

## Kanban Client

- `KanbanClient.getBoard(projectId)` - Load project's kanban board
- `KanbanClient.getCard(projectId, cardId)` - Find card with its stage
- `KanbanClient.getCardsByStage(projectId, stage)` - Cards in a stage sorted by `order` field (used by reorder command), automation cards excluded
- `KanbanClient.searchCards(projectIds, query, maxResults)` - Text search across cards (title +2, description +1, archived -1)
- `KanbanClient.getAllCards(projectIds)` - All non-archived, non-automation cards
- Resolves kanban.json paths per project

## Voice System

- **STT**: Dual-backend via `SttConfig.backend` ('openai' | 'local'). OpenAI Whisper (`whisper-1`) or local whisper.cpp CLI. Backend selected via `STT_BACKEND` env var. Local backend requires `WHISPER_CLI_PATH` and `WHISPER_MODEL_PATH`. `validateSttConfig()` checks env setup before transcription attempts.
- **TTS**: ElevenLabs v3 (`eleven_v3`), supports `[tag]` audio tags
- **Voice selection**: Persisted in messaging-state.json, overrides .env default
- **Voice search**: Queries both `/v2/voices` (personal) and `/v1/shared-voices` (community), deduplicates
- **Conversion**: ffmpeg MP3→OGG/Opus for Telegram compatibility

## Provider Support

- `StateManager.selectedProvider` - Persisted provider choice (default: 'claude')
- **Auto-resolution**: Provider auto-resolved on navigation. `resolveProviderFromBridge()` checks bridge for existing card sessions (picks most recently active). `resolveProjectProviderFromBridge()` does the same for project-level sessions. Resolution chain: bridge session → stage default (from providers.json) → global default.
- `getProviderDefault(stage?)` reads providers.json defaults (stage-specific → global fallback)
- `updateGlobalProviderDefault(provider)` writes to providers.json when changing provider on a target with no explicit bridge session
- `hasExplicitSession()` checks whether the current provider was derived from a bridge session vs default. Status/lifecycle messages show "(default)" suffix when no explicit session exists.
- Shared `PROVIDER_LABELS` constant and `ALL_PROVIDERS` list (no more inline duplicated maps)
- Session names include provider segment: `{projectId}:{provider}:global` or `{projectId}:{provider}:card:{cardId}`
- Global target uses `global:{provider}:global`
- `getLegacySessionName()` provides backward-compat format for existing session lookups
- Messaging always forces `skipPermissions: true` (remote interaction can't approve prompts)
- `BridgeClient.ensureSession()` returns `{ session, permissionMismatch? }` — detects sessions started from web UI without skip-permissions
- `BridgeClient.restartSession()` stops old session and creates fresh one with correct provider + skip-permissions
- `BridgeClient.startActivityMonitor()` runs persistent background polling (4s) sending typing indicators when session is active
- `BridgeClient.checkInstructionFile(provider, cwd)` checks bridge for missing instruction file, returns InstructionFileCheck
- `BridgeClient.ensureSession()` accepts optional `createInstructionFile` param, passed to bridge session creation
- `BridgeClient.sendMessage()` accepts optional `createInstructionFile` param, forwarded to ensureSession
- `BridgeClient.sendImage(name, filePath, cwd?)` uploads image to bridge screenshot endpoint, returns filename
- `BridgeClient.getActiveCardSessions(projectIds)` returns Set of card IDs with active bridge sessions (for /search quick-access)
- `BridgeClient.getCardSessionRecency(projectIds)` returns Map of card IDs to lastActive timestamps (for /search recent sorting)
- Debug logging via `debugLog()` writes to `messaging-debug.log` for session create/send troubleshooting
- Resume+prompt flow: detects resumed sessions and types prompt via sendInput after delay

## State Persistence

`messaging-state.json` stores:
- `targetType` - Navigation level: global/project/card
- `selectedProjectId` - Active project
- `selectedCardId` - Active card (only with project)
- `selectedCardStage` - Active card's stage
- `selectedProvider` - Active AI provider (claude/gemini/codex)
- `voiceId` / `voiceName` - Selected TTS voice (null = use .env default)
- `responseMode` - text/voice/both preference
- `voiceTone` - Free-text tone description

Projects loaded from `projects/registry.json` at startup.

## HTTP Endpoints

- `POST /send` - Send text message to active channel
- `POST /voice` - Generate TTS and send voice + text to channel
- `GET /health` - Service health check (channel name, ready state)

## Patterns & Invariants

- Path resolution: `SLYCODE_HOME` env var (set by `slycode start`) → `process.cwd()` fallback. All file paths (state, registry, sly-actions) resolve via `getWorkspaceRoot()` helper — no `__dirname`-relative paths (breaks in npm package installs).
- Chat actions for status: `record_voice` (transcribing), `typing` (processing), `upload_voice` (TTS)
- Session names include provider and target type: `{projectId}:{provider}:card:{cardId}` or `global:{provider}:global`
- Messages include channel header: `[Telegram] text (Reply using /messaging | Mode: text)`
- Voice messages: `[Telegram/Voice] transcription (Reply using /messaging | Mode: text)`
- sendTextRaw used for voice text companions (preserves [audio tags]) and voice IDs
- Authorization: single authorized user ID per Telegram bot
- Telegram message limit: 4096 chars, auto-split at newline boundaries
- "stop" text intercepted before forwarding to session (soft stop via Escape key)
- Card titles truncated to 35 chars in breadcrumb rendering
- /search quick-access shows active sessions (up to 5) + recent cards sorted by laterDate(session.lastActive, card.updated_at)
- /search text mode uses kanban-client.searchCards() with scoring (title +2, desc +1, archived -1)
- /search supports global (multi-project) and single-project scopes with cross-project card switching
- Persistent keyboard is unified single layout for all contexts: [['/switch', '/search'], ['/provider', '/status'], ['/voice', '/tone'], ['/mode', '/sly']]
- /provider shows provider inline keyboard (excludes current provider, dynamic from ALL_PROVIDERS). cfg_ callback also updates global default in providers.json when no explicit bridge session exists.
- Photo albums batched via media_group_id (2s flush window), single photos delivered immediately
- Photos: download largest resolution, save to temp dir, upload to bridge, inject `[Screenshot: screenshots/<filename>]` into message
- Instruction file pre-flight: before creating new sessions (text, voice, photo handlers), `checkInstructionFilePreFlight()` checks if provider instruction file is missing. If needed, shows inline buttons and stores pending state (PendingInstructionFileConfirm). `ifc_` callback delivers original message with `createInstructionFile` flag.
- Callback prefixes route inline button presses: sw_ (switch), qc_ (quick card), cfg_ (config), ifc_ (instruction file confirm), perm_ (permissions), mode_ (mode), tone_ (tone)

## When to Expand

- Adding new channel → implement Channel interface, add to createChannel() in index.ts
- Voice issues → tts.ts (generation), voices.ts (search), stt.ts (transcription)
- Bot command issues → index.ts setupChannel()
- Bridge routing → bridge-client.ts
- State persistence → state.ts
- Telegram-specific behavior → channels/telegram.ts
- Command filtering → sly-action-filter.ts, kanban-client.ts
- Stop command → bridge-client.ts stopSession(), index.ts stop interception
- Response modes → state.ts, SKILL.md mode/tone guidelines
- Provider selection → state.ts (selectedProvider), index.ts (resolveProviderFromBridge, getProviderDefault, updateGlobalProviderDefault), bridge-client.ts (ensureSession provider param)
- Permission mismatch → bridge-client.ts ensureSession/sendMessage permissionMismatch detection
- Photo messages → channels/telegram.ts (photo listener, album batching), index.ts (onPhoto handler), bridge-client.ts (sendImage)
- Card search → index.ts /search handler, kanban-client.ts searchCards/getAllCards, bridge-client.ts getActiveCardSessions/getCardSessionRecency
- Navigation → index.ts /switch handler, state.ts target methods, callback handlers (sw_)
- Instruction file flow → index.ts checkInstructionFilePreFlight(), ifc_ callback, bridge-client.ts checkInstructionFile(), state.ts pending confirm
- Inline buttons → channels/telegram.ts, types.ts InlineButton, channel.onCallback()
