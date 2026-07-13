# Changelog

All notable changes to SlyCode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.1] - 2026-07-13

### Added
- Codebase Atlas catch-up digest — a nightly summary of what changed in each area, surfaced as a drawer tab with debt-ordered items and mark-read tracking. New unseen items pulse a dot on the tab.
- Guided tours in Code Mode — docked step player with segmented progress, keyboard paging, a stale banner when the code has drifted, an ask-the-Atlas escalation, and a "+ new tour" card users can author from the UI.
- Tour Refresh — one-click regeneration of a tour against the current code, with an optional prompt anchor field that lets tour steps trigger a session prompt when opened.
- Database schema introspection in Code Mode — table cards with foreign-key chips that jump-and-flash between related tables, surfaced as a new rail tab.
- Atlas rollup on the dashboard — new Atlas tab that aggregates per-project Atlas summaries in one place.
- Gitignored files are visible in the Code Mode tree again — files like `.env` show dimmed/italic with a "gitignored (editable)" tooltip. `node_modules` and `dist` stay hidden.
- Atlas skill v1.4.3 — covers tours, digests, DB introspection, view-state, and the ask/deck workflow.

### Fixed
- Sessions no longer silently vanish when the provider writes its session file late — detection now re-arms on every input event and takes a final shot at PTY exit, so late-typed prompts still get linked to their transcript.
- Ended sessions surface as a distinct "ended — not resumable" panel with Retry and Dismiss actions instead of quietly disappearing.
- Retention warning — a toast appears when the AI provider's transcript retention setting would age transcripts out from under Resume.
- Closed a path traversal issue in the CLI-assets store routes; asset names are now validated as single-segment identifiers and every resolved path is verified inside its intended base.
- Editor first-open no longer scrolls to the wrong anchor — reveal/highlight now waits for the editor and file model to be fully attached before positioning.
- Telegram voice/photo downloads retry on network timeouts so an intermittent metadata-call ETIMEDOUT no longer drops your message.
- Bridge submit-verify accepts viewport-window matches, so medium pastes whose prefix scrolls out of view still verify and submit reliably.
- `slycode start` now self-heals CLI symlinks on every start, so new tools added by an update (like `sly-atlas`) land even when the update itself ran under old code.

### Changed
- Atlas prompts (tour create/refresh, ask-about-step, Explain) all route through a start-or-resume endpoint so they no longer 404 when the Atlas session is stopped.
- Code Mode light-mode polish — CLI-body chrome stops reading as an unthemed iframe; digest headline reflows cleanly; atlas drawer grown to a comfortable 340px collapsed with clearer tabs.
- "Explain" in the editor works from selection or word-under-cursor with surrounding line context; tab strip scrolls independently so Explain/Blame/Save stay pinned.
- Web lint runs cleanly again — generated worker bundles are ignored, sensible allowances for scripts, and unused imports/vars swept across the codebase.

## [0.4.0] - 2026-07-09

### Added
- Code Mode — a new dashboard mode alongside Kanban for exploring, editing, and understanding your codebase. Includes an integrated code editor, symbol-aware search, git tools, a diff viewer, and an embedded terminal so you can hand off to an AI without leaving the panel.
- Codebase Atlas — an AI-maintained map of your project (areas, key files, connections) that powers Code Mode navigation. Refreshes on a schedule so the map stays current as the code evolves.
- `sly-atlas` CLI — companion command that lets an AI session propose, validate, and apply Atlas updates without hand-editing JSON.
- Multiple design, feature, and test refs per card — attach as many documents as you need per category, with an index list and one-click Unlink.
- Store-import diff viewer — see per-file diffs of every skill and reference file before importing changes into your store, so nothing is applied blind.
- Orphan process reaper — the bridge now sweeps up AI provider processes that were spawned by SlyCode but got orphaned by a dead session, keeping memory and swap use in check on long-running installs.
- Board cold storage — archived cards are moved to a separate file so the live Kanban stays fast and small. Existing archives are migrated automatically on first open.
- `sly-dev.sh --fresh` and repo-anchored stale-instance sweep — cleaner developer workflow when jumping between branches or workspaces.
- Voice/photo downloads over Telegram now retry with a timeout on transient network errors, so intermittent CDN blips no longer drop your message.
- Terminal hyperlinks now prompt for confirmation before opening — guards against spoofed OSC-8 links pasted into the terminal.
- Atlas skill (v1.3.0) — the new AI-driven Atlas maintenance skill, shipped in the store manifest.
- Kanban skill v1.13.1 — updated coverage for cold storage and multi-ref cards.
- Messaging skill v2.5.0 — updated coverage for the newer voice and file-send workflows.

### Changed
- Kanban and provider config writes now use an atomic write-then-rename pattern across the CLI, web, and messaging services so a crash mid-write can no longer leave a truncated file.
- Cross-writer advisory lock on the Kanban file means the CLI and web UI can never step on each other's writes.
- Per-project provider defaults are back in Providers config — set a workspace-wide default and per-project overrides side by side.
- `configure-commands` action v2.0.0 — a self-contained briefing on how command visibility, groups, and prompts work in SlyCode.

### Fixed
- Refreshed all third-party dependencies to clear high-severity advisories carried through the previous release.

## [0.3.1] - 2026-06-13

### Fixed
- **IMPORTANT — if you are still on 0.2.40 and `slycode update` says everything is up to date even though the dashboard shows v0.3.x available**, npm is refusing to cross the `0.2 → 0.3` boundary because of how it interprets caret ranges on pre-1.0 versions. **One-time unstick:** from inside your workspace directory, run:
  ```
  npm install @slycode/slycode@latest
  slycode update
  ```
  After that, future `slycode update` runs (including `0.3 → 0.4` etc.) will work normally.
- `slycode update` now uses `npm install @latest` instead of `npm update`, so it correctly upgrades across `0.x` minor boundaries and any future major-version bumps.
- `slycode update` now checks the installed version before and after install and warns clearly if npm reported success but the version did not actually change — so a silent upgrade failure can never go unnoticed again.

### Changed
- `create-slycode` now recommends `slycode update` (instead of the broken `npm update`) when offering to upgrade an existing workspace.

## [0.3.0] - 2026-06-13

### Added
- Web UI auth layer (feature 068) — single-password gate for the SlyCode dashboard with first-run setup, session cookies signed with HMAC-SHA256, and credential stored in `~/.slycode/auth.json` (mode 600). Bridge and messaging remain localhost-only and untouched
- `slycode reset-password` CLI (feature 068) — clears the web dashboard password and bumps the cookie secret so old sessions are invalidated
- Cleartext warning banner — persistent banner when the dashboard is served over plain HTTP to a non-loopback host; silent on loopback and HTTPS
- Self-verifying prompt submit (feature 070) — bridge classifies the terminal snapshot to confirm the pasted prompt actually went into the input box before sending Enter; retries with bracketed-paste fallback if it sees the prompt stranded outside the input region
- In-order single-flight terminal input queue (feature 071) — fixes terminal input getting reordered on slow connections; coalesces consecutive raw keystrokes so latency stays bounded at ~2×RTT regardless of typing speed
- Multi HTML attachments on cards (feature 072) — cards can hold multiple HTML attachments instead of one; new HTML Attachments tab shows an index list with auto-select-when-one and back-to-list affordance
- HTML attachment Print view (feature 072) — open any attachment via `?print=1` in a dedicated tab for clean printing without app chrome
- Global provider/model default (feature 073) — set a workspace-wide default provider and per-provider model from the dashboard; new sessions inherit unless explicitly overridden
- Per-project TTS voice — voice selection persists per project alongside the existing voice/mode/tone overrides
- Messaging voice search endpoint — `sly-messaging voice search <query>` proxies ElevenLabs voice search for picking voices from the CLI
- Timestamp prefix on forwarded voice messages and Sly Actions — surfaces when a forwarded item was originally sent

### Fixed
- Card modal no longer loses its terminal session link when an external action renames or moves the open card — session pill stays attached to the right card
- Light-mode design for card status boxes — no more washed-out unreadable text in light theme
- Closed two command-injection sinks and cleared all dependency high-severity advisories (feature 069 — security remediation)
- Hardened send-file path resolution against directory traversal
- Diagnose and fix automation silent non-submit — duplicate-fire follow-up to the earlier scheduler isDue work; merged-prompt firings no longer get dropped

### Changed
- Secure-by-default bind hardening — bridge and messaging bind to 127.0.0.1 by default; web binds to 0.0.0.0 only when explicitly configured (no longer the default)
- Kanban skill v1.12.0 — covers global provider default, multi HTML attachments, and the self-verifying submit semantics
- Deployed-install model data fix — installed packages now pick up the latest provider model lists instead of shipping a stale snapshot

## [0.2.40] - 2026-05-23

### Added
- Drag-to-pan on the kanban board — desktop users can click and drag empty board background to scroll horizontally; cards, headers, and interactive elements pass through untouched
- Per-project voice, response-mode, and tone overrides in messaging — settings can be project-specific while still falling back to the top-level default

### Fixed
- Telegram `sw_proj_` and `sw_card_` callback handlers resolve canonical project.id, sessionKey, or alias — backward compatible with old buttons in Telegram history from before dashboard path renames
- CliAssetsTab row focus from SkillUpdateToast deep-link now retries every 200ms up to 3s — handles async data loads so the target row reliably scrolls into view

### Changed
- Scheduler `isDue()` refactored — uses stored `config.nextRun` as primary firing decision (shared source of truth with dashboard NOW badge), 24h first-fire window for never-run automations, 60s re-fire guard against self-perpetuating loops, max 1 kickoff per tick
- Shortcuts config modal tracks dirty state — surfaces unsaved changes prominently; inferred project tag is a suggestion ("Use" button) instead of silently pre-filling the input
- Dashboard tab routing — `?tab=updates|cli-assets` deep links handled in a proper effect instead of an initializer hack
- Questionnaire schema simplification — all questions are optional (`required:true` is no longer supported); removes `requiredMissing` counts and the scroll-to-first-missing UX
- Kanban skill v1.11.1 — questionnaire docs updated to match the optional-only schema

## [0.2.39] - 2026-05-15

### Added
- Eager card creation — new cards persist to disk synchronously before user interaction, fixing the silent-drop bug when dragging a freshly-created card during the save debounce window
- Telegram `send-file` — new `sly-messaging send-file` CLI command and `POST /send/file` HTTP endpoint deliver existing audio, video, and document files through Telegram (auto-detect by extension or force document delivery)
- TTS generate — new `sly-messaging generate` CLI command and `POST /tts/generate` endpoint render text-to-speech audio to disk for reuse without sending
- Skill update toast in the dashboard — per-project notification when watched skills (kanban, messaging) have a newer version available; click-through deep-links to CLI Assets with a 1-hour dismiss cool-off
- Questionnaire-submit auto-status — submitting a questionnaire fires a medium-tier auto-status "Questionnaire submitted" on the card
- Kanban skill v1.11.0 — adds auto-status documentation, `--html-ref` support, eager card-create coverage
- Messaging skill v2.4.0 — adds `send-file` and `generate` command documentation

### Changed
- Questionnaire SingleChoice questions now let users add an "Other" entry per-instance even when the questionnaire definition did not opt in to `allow_other`
- CardModal exposes pending/error state for the eager-create round-trip with retry/cancel UI
- Web auto-status helpers (`tryAutoStatus`) mirror the CLI behavior so write paths from both produce consistent status updates

## [0.2.38] - 2026-05-04

### Added
- Card numbering — every card now gets a sequential number (#0001, #0002, ...) on creation; assignments survive deletion via monotonic `nextCardNumber` tracking, with web and CLI sharing the same idempotent allocator
- Activity feed event types: `card_reordered` and `card_prompt` — visible in the dashboard activity panel

### Changed
- Kanban skill v1.10.0 — adds questionnaire workflow, status line (manual + tiered auto-status), HTML attachment ref docs
- Web kanban API preserves root-level metadata (e.g. `nextCardNumber`) on save instead of silently overwriting
- Activity feed gracefully renders unknown event types with a fallback label and color instead of crashing
- Event log validates entries on read and caps individual entry size at 4KB to prevent corruption from large payloads

## [0.2.37] - 2026-05-04

### Added
- Card questionnaires — author multi-question forms (free-text, single/multi-choice, boolean, scale, exposition) and attach to cards via `--questionnaire-ref`; user submits and answers stream back to the AI session as a Q&A block
- Quick-launch shortcuts — per-project `shortcuts.json` maps short tokens to cards, prompts, and provider; URL form `/project/<id>/<token>` auto-opens the card and injects the prompt
- Project tag shortcuts — assign a 1-6 char tag to projects so messaging `/<tag>` jumps straight there; reserved `global` token routes to dashboard with auto-expanded global terminal
- Card status v2 — manual vs auto status with tier-based overwrite (manual is sacred; auto writes from notes/checklist/refs/problems honor priority); LED-marquee animation scales by text length
- TTS audio archive — voice replies persist to `data/tts-archive/` with ring-buffer rotation (defaults: 10 files, override via `TTS_ARCHIVE_MAX` and `TTS_ARCHIVE_DIR`)
- `slycode doctor` build-tools check — flags missing C/C++ toolchain, make, and python on platforms without prebuilt node-pty binaries

### Changed
- Card actions (challenge, challenge-implementation, chore, debug, deep-design, design-requirements, test-review) now author questionnaires when 3+ user decisions are needed; ask inline for fewer or when responding via messaging
- Voice settings gear stays interactive even when the rest of the voice control bar is disabled
- Status displayed in messaging session-switch confirmations and `/status` command — no need to query separately

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
