# Changelog

All notable changes to SlyCode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.36] - 2026-04-27

### Fixed
- Resume button now reuses existing alias-form sessions instead of creating duplicates — uses resolved alias name when posting session-create
- Alias-aware session resolution across messaging, scheduler, and web — image upload, stop, restart, and direct input now find sessions stored under legacy alias names
- Scheduler automation re-attaches to whichever existing session ranks highest (running > detached > creating > stopped) instead of blindly creating canonical duplicates
- GlobalClaudePanel tries candidate session names (canonical + aliases) before creating new sessions
- Clear stale pill state in CardModal when switching to a card with no visible sessions — prevents ghost Resume button and selected provider

### Changed
- Messaging now uses canonical projectKey for new session creation, keeping naming in lockstep with web/CLI

## [0.2.35] - 2026-04-27

### Added
- Per-card AI-set status string — short progress label visible on the card, auto-cleared on stage move
- HTML card attachments — render mockups, POCs, and interactive previews in sandboxed iframe via `--html-ref`
- `sly-kanban status` command — get/set/clear card progress status from CLI
- Cross-card fire-and-forget prompts now register a response callback — late replies are PTY-injected into the calling session instead of lost

### Fixed
- Fix terminal panel not detecting existing sessions for projects with id/sessionKey mismatch — bridge 200/null response was treated as found, never tried alias names
- Fix legacy session lookup masked by bridge 200/null response — accept both running and detached session states
- Auto-clear card status on cross-stage moves so optimistic UI updates do not get reverted from disk

### Changed
- Scale settle delay between paste and Enter based on chunk count — fixes Codex TUI dropping Enter on long pastes

## [0.2.34] - 2026-04-26

### Fixed
- Fix activity indicators showing zero for projects after the session-key migration — aggregate counts across canonical sessionKey and legacy id aliases
- Fix card session detection when project id contains regex-special characters (e.g. dots)

## [0.2.33] - 2026-04-25

### Added
- Harden sly-kanban respond against shell-quoting corruption — `--stdin` mode with heredoc support for safe multi-line responses with backticks and quotes
- Late response injection — recover responses delivered after polling timeout via PTY injection into the original calling session

### Changed
- Canonical session-key derivation from project folder path — keeps web UI, messaging, and CLI session names in lockstep regardless of project ID shape
- Better expiry diagnostics on cross-card responses — distinguish expired/consumed/unknown when delivery fails
- Sanitize injected response payloads to escape control bytes that could mangle the terminal
- Rewrite `slycode update` CLI for clearer service detection and restart behavior
- Deep design action v1.2.0 — clearer self-contained message guidance

### Fixed
- Dismiss kanban card hover tooltip when drag starts (prevented tooltip lingering during drag)

## [0.2.32] - 2026-04-21

### Fixed
- Wrap all remaining input paths in bracketed paste markers — messaging bridge client, quick commands, and scheduler automation

## [0.2.31] - 2026-04-21

### Fixed
- Fix bracketed paste handling — send markers atomically and only chunk inner content to prevent split escape sequences
- Wrap terminal action commands and prompt input in bracketed paste markers for reliable delivery

## [0.2.30] - 2026-04-20

### Added
- Per-provider terminal tabs — open secondary terminals with different AI providers on the same card
- Branch tab shows changed files list on hover with staged/unstaged/untracked breakdown
- Selection-aware Ctrl+C copy in terminal — copies selected text instead of sending SIGINT
- Sticky per-target provider overrides in messaging — provider choice persists per card/project
- Dynamic sly action overflow in terminal footer — actions adapt to available space

### Fixed
- Fix double paste on Ctrl+V in terminal
- Fix messaging provider resolution to prefer earliest session, not most recent
- Fix paste bracketing and chunked PTY writes for reliable multi-line paste on Windows

### Changed
- Provider-specific color theming for terminal tabs and UI elements

## [0.2.29] - 2026-04-13

### Fixed
- Fix Claude session path transform to replace all non-alphanumeric characters (fixes session resume with dotted project names)

### Changed
- Simplified challenge and challenge-implementation actions (v1.1.0)

## [0.2.28] - 2026-04-13

### Fixed
- Add windowsHide to all spawn/exec calls to prevent console window flashing on Windows
- Fix project names with dots causing bridge errors — sanitize to valid session name characters

### Changed
- Clearer update notification with explicit slycode update command

## [0.2.27] - 2026-04-11

### Fixed
- Fix static assets (JS/CSS) not loading in standalone web server build

## [0.2.26] - 2026-04-11

### Changed
- Hardened export pipeline and safety checks for more thorough file validation

## [0.2.25] - 2026-04-11

### Fixed
- Fix terminal classes not appearing in installed workspaces — seed from package template on sync/update
- Fix action updates not syncing to existing workspaces on slycode sync/update
- Fix package path mismatch in terminal-classes API fallback

## [0.2.24] - 2026-04-11

### Added
- Seed terminal-classes.json on sync and update for existing workspaces
- Cross-agent challenge actions: send designs or implementations to another AI provider for adversarial review

### Changed
- Scaffold includes terminal-classes.json in new projects
- Terminal classes API hardening and error handling

### Fixed
- Minor action priority and metadata fixes across store actions

## [0.2.23] - 2026-04-09

### Added
- Show current git branch in the web dashboard and messaging responses
- Changelog modal in the dashboard — view version history and what shipped in each release

### Fixed
- Preserve card fields when merging cards via drag-and-drop
- Fix automation run notifications not being delivered via messaging

### Changed
- Clarify voice shortcut formatting in the tutorial template

## [0.2.22] - 2026-03-31

### Changed
- Bridge provider-utils, session manager, and types updates
- Messaging bridge-client, state, and types improvements
- Projects and providers API route updates
- Paths utility updates
- Claude terminal panel updates

## [0.2.21] - 2026-03-29

### Changed
- PTY handler updates
- Messaging service improvements (STT, core)
- Scaffold updates
- Projects API route and card modal updates

## [0.2.20] - 2026-03-25

### Changed
- Bridge claude-utils and PTY handler updates
- CLI update command improvements
- Terminal component updates

## [0.2.19] - 2026-03-25

### Added
- Asset viewer component
- MCP common utilities
- Provider paths utility

### Changed
- CLI assets routes (assistant, store, sync)
- Store scanner and asset scanner updates
- Store view and CLI assets tab improvements
- Kanban CLI updates

## [0.2.18] - 2026-03-23

### Changed
- Web app layout updates

## [0.2.17] - 2026-03-23

### Changed
- PTY handler updates

## [0.2.16] - 2026-03-22

### Changed
- Bridge session manager updates
- Messaging service improvements (bridge-client, telegram, state, types)
- Scheduler updates
- Claude terminal panel updates

## [0.2.15] - 2026-03-22

### Added
- Service detection module

### Changed
- Service management updates for Linux/macOS
- Bridge claude-utils and PTY handler updates
- CLI restart, start, and update command improvements
- Claude terminal panel updates

### Fixed
- Remove stale node_modules from public repo

## [0.2.14] - 2026-03-22

### Changed
- Bridge session manager and types updates
- Terminal and Claude terminal panel improvements
- Kanban CLI script updates

## [0.2.13] - 2026-03-21

### Fixed
- Stop CLI command improvements

### Changed
- Messaging state handling updates

## [0.2.12] - 2026-03-20

### Fixed
- Build pipeline: handle symlinks in Next.js standalone output

### Changed
- Messaging STT and types updates
- Scaffold and transcribe route updates
- Dependency updates

## [0.2.11] - 2026-03-20

### Changed
- Transcribe API route updates
- Voice control bar improvements
- Dependency updates (messaging, web)

## [0.2.10] - 2026-03-20

### Added
- Restart CLI command

### Changed
- Service management updates for Linux/macOS
- Build pipeline: dist/store filtered to manifest skills/actions only

### Fixed
- Voice recorder hook

## [0.1.0] - 2026-02-19

### Added
- slycode CLI: start/stop services, doctor diagnostics, system service install/remove, skills management
- create-slycode scaffolding: npx create-slycode to bootstrap a new workspace
- Web command center: kanban board with drag-and-drop, card modals with document tabs, project views, real-time SSE updates
- Terminal bridge: PTY session management, WebSocket streaming, session persistence
- Messaging service: Telegram channel with voice (TTS/STT), command routing, kanban integration
- Skills system: 7 built-in skills — checkpoint, context-priming, design, feature, implement, kanban, messaging
- Build toolchain: build-package, manifest-driven export, 7-point safety checks
- Platform support: Linux systemd, macOS launchd, Windows service installers
