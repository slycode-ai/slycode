# Messaging Service

Updated: 2026-02-14

## Overview

Multi-channel messaging service for remote AI interaction via Telegram (and future channels). Supports text and voice messages, project selection, voice swapping, response mode/tone preferences, multi-provider support (Claude/Gemini/Codex), stop command for session interruption, permission mismatch detection, context-aware command filtering, and two-way communication with AI sessions through the terminal bridge. Runs as a standalone Node/Express service with a CLI for outbound messages.

## Key Files

### Service Core
- `messaging/src/index.ts` - Main entry, channel wiring, HTTP server, bot commands, stop interception
- `messaging/src/types.ts` - Channel interface, configs, bridge types, ResponseMode
- `messaging/src/state.ts` - StateManager: project selection, voice state, response mode, voice tone, provider selection, persistence
- `messaging/src/bridge-client.ts` - BridgeClient: session management, provider-aware creation, permission mismatch detection, activity watching, soft stop

### Channels
- `messaging/src/channels/telegram.ts` - TelegramChannel: bot polling, inline buttons, chat actions

### Voice Pipeline
- `messaging/src/stt.ts` - Whisper STT via OpenAI API
- `messaging/src/tts.ts` - ElevenLabs v3 TTS with audio tag support, optional voice override
- `messaging/src/voices.ts` - Voice search across personal + community library (v2 + v1 APIs)

### Command System
- `messaging/src/command-filter.ts` - Context-aware command filtering by terminal class, session state, card type
- `messaging/src/kanban-client.ts` - Direct access to project kanban boards for card metadata

### CLI & Skill
- `messaging/src/cli.ts` - CLI tool for sending text/voice from Claude skills
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
  onCommand(command, handler): void;
  onProjectSelect(handler): void;
  sendText(text): Promise<void>;        // With Markdown
  sendTextRaw(text): Promise<void>;     // Without Markdown (preserves [brackets])
  sendVoice(audio: Buffer): Promise<void>;
  sendProjectList(projects): Promise<void>;
  sendTyping(): Promise<void>;
  sendChatAction(action): Promise<void>;
  sendVoiceList?(voices): Promise<void>;     // Optional
  onVoiceSelect?(handler): void;              // Optional
  isReady(): boolean;
}
```

## Bot Commands

- `/start` - Help text with available commands
- `/projects` - Inline keyboard for project selection
- `/select N` - Select project by number
- `/status` - Current project, voice, response mode, and tone
- `/voice` - Search/swap TTS voices, reset to default
- `/voice <name>` - Search voices, auto-select on exact match, inline buttons for multiple

## Message Flow

### Inbound (user → Claude)
1. User sends text/voice on Telegram
2. **Stop interception**: "stop" text (case-insensitive) sends Escape to active session instead of forwarding
3. TelegramChannel routes to handler in index.ts
4. Voice: `record_voice` chat action → Whisper transcription → typing indicator
5. BridgeClient.ensureSession() creates/finds session (with selected provider, always skipPermissions)
6. If permission mismatch (existing session without skipPermissions), warns user and offers restart
7. BridgeClient.sendMessage() writes text + CR to PTY
8. BridgeClient.watchActivity() polls /stats, sends typing while active

### Outbound (Claude → user)
1. Claude skill calls CLI: `tsx cli.ts send "message" [--tts]`
2. CLI POSTs to HTTP server `/send` or `/voice`
3. `/send` → channel.sendText()
4. `/voice` → `upload_voice` chat action → TTS generation → channel.sendVoice() + sendTextRaw()

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

- `CommandFilter.loadCommands()` - Hot-reloads commands.json on each call
- `CommandFilter.filterCommands(terminalClass, sessionState, cardType?)` - Context-aware filtering
- `CommandFilter.resolveTemplate(prompt, context)` - Template variable resolution
- `CommandFilter.getTerminalClass(target)` - Maps navigation target to terminal class
- Supports card context from KanbanClient for prompt templates

## Kanban Client

- `KanbanClient.getBoard(projectId)` - Load project's kanban board
- `KanbanClient.getCard(projectId, cardId)` - Find card with its stage
- `KanbanClient.getCardsByStage(projectId, stage)` - Cards in a stage
- Resolves kanban.json paths per project

## Voice System

- **STT**: OpenAI Whisper (`whisper-1`), accepts OGG from Telegram
- **TTS**: ElevenLabs v3 (`eleven_v3`), supports `[tag]` audio tags
- **Voice selection**: Persisted in messaging-state.json, overrides .env default
- **Voice search**: Queries both `/v2/voices` (personal) and `/v1/shared-voices` (community), deduplicates
- **Conversion**: ffmpeg MP3→OGG/Opus for Telegram compatibility

## Provider Support

- `StateManager.selectedProvider` - Persisted provider choice (default: 'claude')
- Session names include provider segment: `{projectId}:{provider}:global`
- `getLegacySessionName()` provides backward-compat format for existing session lookups
- Messaging always forces `skipPermissions: true` (remote interaction can't approve prompts)
- `BridgeClient.ensureSession()` returns `{ session, permissionMismatch? }` — detects sessions started from web UI without skip-permissions
- `BridgeClient.restartSession()` stops old session and creates fresh one with correct provider + skip-permissions

## State Persistence

`messaging-state.json` stores:
- `selectedProjectId` - Active project
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

- Chat actions for status: `record_voice` (transcribing), `typing` (processing), `upload_voice` (TTS)
- Session names include provider: `{projectId}:{provider}:global` (with legacy fallback)
- Messages include channel header: `[Telegram] text (Reply using /messaging | Mode: text)`
- Voice messages: `[Telegram/Voice] transcription (Reply using /messaging | Mode: text)`
- sendTextRaw used for voice text companions (preserves [audio tags]) and voice IDs
- Authorization: single authorized user ID per Telegram bot
- Telegram message limit: 4096 chars, auto-split at newline boundaries
- "stop" text intercepted before forwarding to session (soft stop via Escape key)
- Card titles truncated to 35 chars in breadcrumb rendering

## When to Expand

- Adding new channel → implement Channel interface, add to createChannel() in index.ts
- Voice issues → tts.ts (generation), voices.ts (search), stt.ts (transcription)
- Bot command issues → index.ts setupChannel()
- Bridge routing → bridge-client.ts
- State persistence → state.ts
- Telegram-specific behavior → channels/telegram.ts
- Command filtering → command-filter.ts, kanban-client.ts
- Stop command → bridge-client.ts stopSession(), index.ts stop interception
- Response modes → state.ts, SKILL.md mode/tone guidelines
- Provider selection → state.ts (selectedProvider), bridge-client.ts (ensureSession provider param)
- Permission mismatch → bridge-client.ts ensureSession/sendMessage permissionMismatch detection
