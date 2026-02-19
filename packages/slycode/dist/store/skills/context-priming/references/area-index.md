# Area Index

Updated: 2026-03-14

## Areas

### web-frontend
- path: areas/web-frontend.md
- updated: 2026-03-14
- load-when: dashboard, kanban, cards, modal, UI components, drag-drop, project page, checklist, action config, health monitor, reconnection, cli assets, assets, search, scaffolding, activity feed, keyboard shortcuts, health score, tab sync, theme, design system, colors, gradient, texture, grain, noise, logo, neon, glow, blend mode, terminal styling, dark mode, light mode, provider selector, provider button, store, updates, update delivery, diff, assistant, asset creation, terminal prompt, pushToTerminal, Code Den, StoreView, UpdatesView, SkillDiffViewer, AssetAssistant, mcp config, automation, automations, scheduler, cron, cron-utils, timezone, TZ, agent notes, notes, summary note, wide viewport, 4K, copyright, favicon, context menu, right-click, confirm dialog, CliAssetsTab, project reorder, displayOrder, version check, VersionUpdateToast, AddProjectModal, scaffold wizard, provider overlay, placement, classAssignments, voice, voice input, voice recording, transcribe, Whisper, STT, VoiceControlBar, VoiceSettings, VoiceContext, VoiceClaimant, FloatingVoiceWidget, ThemeToggle, settings, image paste, screenshot, clipboard, DashboardData, chevron, hazard stripe, loadParentEnv, shadow, shadow depth, elevation, shadow-surface, shadow-card, shadow-overlay, lane texture, lane-texture, inset shadow, card number, glow-color, type emoji, glassmorphic, compact card, JetBrains Mono, priority glow, responsive, mobile, touch, fullscreen, snap-scroll, scrollbar-hide, import preview, ImportDialog, SKILL.md-only, skillMainOnly, activity ring, DEV_HOSTNAME, allowedDevOrigins, version display, getRepoRoot, getParentEnv, MASTER_PROJECT_ID, workspace ID, basename, fetchWithTimeout, checkSessionAlive, liveness check, soft failure, hard failure, activity detection, fresh session, resume session, action-scanner, ActionUpdatesModal, action updates, action cache, invalidateActionsCache, instruction file, instruction file warning, resize broadcast, resize sync, grace window, nextRun, getNextRun, HMR, globalThis, per-card provider
- notes:
  - CardModal tabs: Details, Notes?, Design?, Feature?, Test?, Checklist?, Terminal. Edit session protection (2000ms grace). suppressAutoTerminal from context menu. Fullscreen on mobile (rounded-none, h-full), windowed on desktop (lg:rounded-xl, lg:max-w-4xl). Horizontal tab scroll with scrollbar-hide on mobile.
  - Automation uses card description as prompt. Run Now button with feedback. Orange theme. onActiveAutomationsChange drives header pulse. Timezone badge in AutomationsScreen header + AutomationConfig one-shot picker. Automation safeguards: cannot archive automation cards (CLI + web), cannot enable automation on archived cards.
  - Surgical save: changedCardIds in POST merges against disk. last_modified_by tracks source (web/cli/agent).
  - Right-click context menu on cards: move stage, set priority, copy title/ID/desc, archive, delete. Portal z-51/52, lane-colored accent bars.
  - Z-index layers: BackdropModal z-50, ContextMenu z-51, Submenu z-52, ConfirmDialog z-60
  - Provider button group pre-fills from stage defaults. Session name: {projectId}:{provider}:card:{cardId}
  - Store canonical flat layout (store/skills/, store/actions/, store/agents/). UpdatesView: accept/dismiss/preview workflow. CliAssetsTab (was ToolkitTab). ImportDialog for skill imports: SKILL.md-only default, full folder option. Preview API lists files before import.
  - Action updates: ActionUpdatesModal for accept/dismiss/preview with diff viewer. ProjectHeader polls for actionEntries count, shows badge on Actions button. SlyActionConfigModal shows "Updates" tab when available. Cache invalidated via /api/sly-actions/invalidate on modal close.
  - action-scanner.ts: scans store/actions/*.md, parses YAML frontmatter, assembles SlyActionsConfig with 30s cache, writes back from config (reverse-engineers classes from classAssignments), content-hash based update scanning, additive class merge on accept.
  - Dashboard project drag-and-drop reordering with displayOrder field. AddProjectModal wizard: details → providers → review → creating → summary.
  - VersionUpdateToast: npm version polling (6-hour interval, daily dismiss, bottom-left toast).
  - Scheduler auto-starts via instrumentation.ts (30s), 60s grace window prevents stale ticks on re-enable. HMR-safe via globalThis state/timer. pushToTerminal() dispatches to GlobalClaudePanel.
  - Single `actions` prop on ClaudeTerminalPanel, split by placement locally (startup/toolbar/both). CardModal and GlobalClaudePanel each call one getActionsForClass().
  - SlyActionConfigModal: two-tab layout — Commands tab (edit definitions + placement dropdown) and Classes tab (assign + reorder commands per terminal class). Voice-enabled assistant terminal, Escape passes through to terminal when expanded.
  - Voice: global VoiceContext (useVoice() hook). Claim system: CardModal/GlobalClaudePanel claim → release. FloatingVoiceWidget when unclaimed. VoiceControlBar, MediaRecorder → /api/transcribe → insert at claimant target. ThemeToggle for light/dark in Dashboard.
  - Image paste: Terminal.tsx intercepts Ctrl+V via xterm's `attachCustomKeyEventHandler` (not DOM keydown — reliable after crash/reconnect), clipboard.read() for images → bridge /sessions/:name/image → inject `[Screenshot: ...]` into PTY. Screenshot toast overlay on ClaudeTerminalPanel.
  - Path resolution centralized: getSlycodeRoot() (workspace) + getPackageDir() (dev: repo root, prod: node_modules/@slycode/slycode/dist/). All API routes use these — no local getRepoRoot(). CLI assets import/sync use registry.ts getRepoRoot() instead of claude-master project lookup.
  - next.config.ts: getParentEnv() reads DEV_HOSTNAME from parent .env for allowedDevOrigins (no hardcoded hostnames). Dashboard footer shows slycode version from /api/version-check with clickable slycode.ai link.
  - Scrubbed hardcoded project names: asset-scanner.ts uses MASTER_PROJECT_ID (path.basename), kanban-paths.ts derives workspace ID with underscore→hyphen normalization. paths.ts removed legacy root env var fallback (SLYCODE_HOME → cwd only).
  - NEVER use dark-end color scales for vibrant dark mode — use bright color at low opacity instead
  - Shadow depth system: 3 CSS custom property tiers (--shadow-surface, --shadow-card, --shadow-overlay) with light/dark variants. All neon-pulse keyframes layer glow on top of shadow vars. CardModal uses shadow-(--shadow-overlay). KanbanColumn wrappers use lightweight shadow.
  - Texture: three layers (grain + perlin + depth) + lane-texture (18px grid on column card areas) + `.light-clean` suppression (hides grain/depth on headers in light mode). soft-light → warm cast on dark — use screen. drop-shadow → rectangular glow with blend-mode logos.
  - Global terminal rebranded from neon-orange to neon-blue (steely blue #2490b5 in light mode). All glow effects have separate light-mode keyframes for visibility. ClaudeTerminalPanel buttons are neon-blue.
  - KanbanColumn: light mode flat solid bg (no gradients), thicker borders (3px), neutral text colors (void-500/void-600). Inset shadows on headers (color-matched per lane). Header text has drop-shadow for legibility.
  - KanbanCardItem: glassmorphism (bg-white/40 + backdrop-blur, dark: bg-[#20232a]/55), priority-colored left border + hover inset glow (--glow-color CSS var), card numbers (#0001 format, JetBrains Mono), type emojis replace color dots, compact mode for done column. Session status: green ping (running), orange (paused), grey (none).
  - Voice-aware click-outside: GlobalClaudePanel and SlyActionConfigModal won't close while voice is recording/transcribing.
  - Scheduler timezone-aware (TZ env var). loadParentEnv() reads .env from workspace root (Next.js only loads web/.env). Always recalculates nextRun for accurate countdowns. Automation run header: === AUTOMATION RUN === with time, card, trigger (scheduled with cron description / manual), last run + relative time.
  - cronToHumanReadable() in cron-utils.ts (shared by AutomationConfig, AutomationsScreen). getNextRunISO() removed — all nextRun calculation now server-side via scheduler.ts getNextRun(). Kanban GET API dynamically computes nextRun for all enabled recurring cards. Timezone abbreviation appended to time descriptions.
  - AutomationsScreen redesigned: max-w-5xl centered, 2-col grid (not 3), cards have chevron texture + hazard stripe + orange left border. Large countdown timers (text-2xl), "idle" label. Collapsible tag groups via `<details>`. New CSS: `.automation-chevron`, `.hazard-stripe` + muted variants.
  - AgentNote extended: summary?, summarizedCount?, dateRange? for note summarization. Amber "Summary" badge in CardModal notes tab.
  - Responsive mobile: CardModal fullscreen on mobile, GlobalClaudePanel fullscreen when expanded (h-svh w-screen on mobile), HealthMonitor click-to-toggle (was hover), Terminal touch-scroll + debounced resize (150ms), ProjectHeader mobile search overlay + hidden Actions, KanbanColumn snap-scroll (85vw on mobile). `.scrollbar-hide` CSS utility. All header buttons min-h/w-[44px] touch targets.
  - Activity ring: uses isActive (not status=running) for session detection. Global terminal sessions included in counts.
  - Scheduler split fresh/resume: fresh uses checkSessionAlive(20s), resume uses waitForActivity()+retry. fetchWithTimeout(10s) on all bridge calls. Soft failure notifications only on hard errors.
  - Instruction file warning: ClaudeTerminalPanel checks /check-instruction-file on provider/cwd change. Amber warning + opt-out checkbox if missing. createInstructionFile state passed to session creation.
  - Resize broadcast: Terminal.tsx guards resize POST (visible tabs only), suppressResizePost prevents echo loop from SSE resize events, skips resize on reconnect.

### terminal-bridge
- path: areas/terminal-bridge.md
- updated: 2026-03-14
- load-when: terminal, terminal panel, xterm, bridge, pty, session, websocket, SSE, spawn, terminal class, security, stats, activity log, stop-all, provider, providers.json, multi-provider, gemini, codex, claude, resume, skip-permissions, YOLO, session detection, session ID, screenshot, image, image upload, image delivery, group status, action endpoint, relink, race condition, creating, mutex, idempotent, session cleanup, stopped session, heartbeat, instruction file, instructionFile, altInstructionFile, check-instruction-file, ensureInstructionFile, resize broadcast, suppressResizePost, Windows, ConPTY, chunked write, deferred prompt, bracketed paste, .cmd, pendingPrompt, paste interception, attachCustomKeyEventHandler
- notes:
  - Pass prompts as positional args to Claude CLI, NOT -p flag (-p is print mode)
  - Bridge: localhost binding, command whitelist (bridge-config.json), CWD validation (absolute path)
  - Activity tracking: lastOutputAt, 2s threshold. Grace period (5s) prevents idle timeout race. activityStartedAt for debouncing.
  - Atomic state saves (temp + rename). bridge-sessions.json crash on corrupt, graceful on ENOENT.
  - Session names: {projectId}:{provider}:card:{cardId} with legacy fallback. POST stop = Escape, DELETE = kill.
  - provider-utils.ts builds command args from providers.json (flag vs subcommand resume)
  - Session detection ALL providers: Claude (.jsonl), Codex (rollout UUID), Gemini (chat JSON) — 60s timeout
  - Prompt works alongside resume: Claude positional, Codex positional after subcommand
  - claude-utils.ts: provider-agnostic dispatchers (getProviderSessionDir, detectNewProviderSessionId, getMostRecentProviderSessionId)
  - Image delivery: POST /sessions/:name/image (multer, 10MB), screenshot-utils.ts saves to screenshots/ in session CWD, 10-file retention, auto-.gitignore
  - ActivityTransition: became (active/inactive), outputAgeMs, triggerSnippet/RawHex/DataLength (flat, not nested)
  - New endpoints: GET /groups/:group/status, POST /sessions/:name/action (compact/clear/interrupt), POST /sessions/:name/relink
  - SessionInfo includes group, resumed, lastActive fields
  - Race condition fix: createSession() uses 'creating' placeholder as mutex. Concurrent requests for same session get 202 (idempotent). guidDetectionCancelled flag prevents stale detection overwrites.
  - Stopped sessions removed from in-memory map (frees slot), data preserved in persistedState for resume.
  - SSE heartbeat: 15s comment heartbeats keep connections alive through proxies (Tailscale, Next.js)
  - Instruction file fallback: checkInstructionFile() priority scan (primary → alt → sibling copy source). ensureInstructionFile() copies on demand. Opt-in via createInstructionFile in CreateSessionRequest. GET /check-instruction-file endpoint for pre-flight checks.
  - Resize broadcast: PTY resize events sent via SSE to all connected tabs. Terminal.tsx guards resize POST (visible tabs only, suppressResizePost echo-loop prevention, skip on reconnect).
  - Windows ConPTY: .cmd extension auto-appended for CLI commands. Deferred prompt delivery via bracketed paste after output settles (1.5s quiet / 30s max). Chunked writes (1024B, 500ms delay) avoid ConPTY truncation. Paste interception uses xterm `attachCustomKeyEventHandler` (not DOM keydown).

### terminal-actions
- path: areas/terminal-actions.md
- updated: 2026-03-10
- load-when: actions, prompts, templates, context injection, commands, visibility, action config, terminal commands, startup commands, active commands, test review, placement, classAssignments, deep design, deep-design, action scanner, action updates, action .md, store/actions, action frontmatter, action cache, action delivery
- notes:
  - Provider-agnostic: same commands across Claude, Codex, Gemini. Individual .md files in store/actions/ (v4.0)
  - Each action is a .md file with YAML frontmatter (name, version, label, group, placement, classes map) + prompt body
  - classAssignments assembled at runtime from per-action classes maps, sorted by priority (ascending)
  - Context templates hardcoded in sly-actions.ts (no longer in JSON config)
  - action-scanner.ts: parse, cache (30s), assemble config, write back, update scanning (content-hash), accept with additive class merge
  - messaging/sly-action-filter.ts has duplicated YAML parser + 30s cache (reads store/actions/ directly)
  - Action update delivery: updates/actions/ → content-hash diff → accept with class merge → store/actions/
  - ActionUpdatesModal.tsx for accept/dismiss/preview. ProjectHeader polls for update count badge.
  - SlyActionConfigModal shows "Updates" tab when action updates available
  - Groups: Card Actions (14), Session, Project, Utilities, Action Assistant (no Problems group)
  - Deep Design: 4-phase workflow (design doc → parallel analysis agents → synthesis → Q&A). 6 optional agent perspectives.
  - Test Review: interactive testing-lane with checklist assessment, area priming, max 3 questions/round
  - Organise Backlog: `kanban board` snapshot + `kanban reorder` for reprioritisation

### messaging
- path: areas/messaging.md
- updated: 2026-03-13
- load-when: telegram, messaging, voice, TTS, STT, speech, channel, bot, ElevenLabs, Whisper, whisper.cpp, local STT, STT_BACKEND, voice swap, stop command, response mode, tone, action filter, provider, provider resolution, bridge provider, explicit session, default provider, PROVIDER_LABELS, permission mismatch, /search, /provider, /sly, /switch, /global, /project, card search, photo, image, album, navigation, target, inline keyboard, callback, instruction file, ifc_, pre-flight, PendingInstructionFileConfirm
- notes:
  - Channel interface: onText/onVoice/onPhoto/onCommand + sendText/sendTextRaw/sendVoice/sendInlineKeyboard/setPersistentKeyboard/onCallback
  - Navigation model: three-level targets (global/project/card) via /switch command with inline keyboards
  - Bot commands: /start, /switch, /global, /project, /search, /sly, /status, /provider, /voice, /mode, /tone
  - Callback prefixes: sw_ (switch), qc_ (quick card), cfg_ (config), perm_ (permissions), mode_, tone_
  - State: messaging-state.json (targetType, projectId, cardId, cardStage, provider, voice, responseMode, voiceTone)
  - Voice: Dual-backend STT (OpenAI Whisper or local whisper.cpp via STT_BACKEND env var) → ElevenLabs v3 TTS with [audio tags]. "stop" intercepted → Escape to session.
  - skipPermissions always true. Permission mismatch detection for web-started sessions.
  - sly-action-filter.ts: v3 classAssignments-based filtering. kanban-client.ts: card data, searchCards
  - Photo albums batched via media_group_id (2s window). BridgeClient.sendImage() → bridge screenshot
  - Persistent keyboard: [['/switch', '/search'], ['/provider', '/status'], ['/voice', '/tone'], ['/mode', '/sly']]
  - Session names: global:{provider}:global, {projectId}:{provider}:global, {projectId}:{provider}:card:{cardId}
  - Provider auto-resolution: resolveProviderFromBridge() / resolveProjectProviderFromBridge() pick provider from most recent bridge session. hasExplicitSession() determines default vs explicit. Navigation commands (sw_, /global, /project) auto-resolve provider. cfg_ callback updates providers.json global default when no explicit session.
  - Instruction file pre-flight: checkInstructionFilePreFlight() checks before new session creation (text/voice/photo). Shows ifc_ inline buttons if needed. PendingInstructionFileConfirm stored in StateManager (ephemeral). BridgeClient.checkInstructionFile() + createInstructionFile param on ensureSession/sendMessage.

### skills
- path: areas/skills.md
- updated: 2026-03-14
- load-when: skills, commands, agents, hooks, slash commands, SKILL.md, scaffolding, store, cross-provider, convert-asset, notes, notes summarize, automation, kanban CLI, last_modified_by, updates, update delivery, npm, packages, slycode CLI, migrate, board, reorder, build pipeline, sync-updates, store-manifest, provider overlay, base-instructions, slycode config, slycode uninstall, tutorial project, card number, nextCardNumber, licensing, BUSL, open-core, skillMainOnly, STT_BACKEND, WHISPER_CLI_PATH, WHISPER_MODEL_PATH, timezone, TZ, create-slycode wizard, @slycode scope, @slycode/slycode, @slycode/create-slycode
- notes:
  - ALL commands converted to skills. 17 skills + 1 agent (doc-updater) + 1 dummy skill (inert test). .claude/commands/ removed. Licensed under BUSL-1.1 (open-core).
  - Store: 17 canonical skills (store/skills/) + actions (store/actions/*.md). Flat layout, no provider subdirectories.
  - Update delivery: updates/ → accept → store/ (with backup) → deploy to projects. Actions use content-hash comparison + additive class merge.
  - NPM: packages/slycode/ (CLI, 11 subcommands incl config + uninstall) + packages/create-slycode/ (scaffold). .agents/skills/ for Codex format.
  - kanban.js: board, reorder, notes (add/list/search/edit/delete/clear/oldest/summarize), automation subcommands. stamps last_modified_by/source on writes. Notes: 100 hard cap, 30 soft suggestion threshold, summarize replaces oldest N with summary note. Archive safeguard: automation cards cannot be archived. Sequential card numbers: ensureCardNumbers() auto-backfills on first write, nextCardNumber tracked on kanban root. Kanban skill v1.4.0: multiline description example in docs. `automation enable` recalculates nextRun via croner.
  - Scaffold: multi-provider, tutorial content seeded into workspace root (not separate slycode_tutorial/ subdirectory). Kanban seed uses stage-based format. Clean output: suppresses zero-count lines, reports new vs existing doc dirs. Setup wizard prompts for timezone (auto-detects, writes TZ= to .env). System service prompt skipped on Windows.
  - NPM packages under `@slycode` scope: `@slycode/slycode` (v0.1.11), `@slycode/create-slycode` (v0.1.11). Template paths: `node_modules/@slycode/slycode/templates/`.
  - Build pipeline: build-package.ts → sync-updates.ts (skills + actions) → copy scaffold-templates/ + store/ + updates/actions/ to dist/. Templates (skills, actions, tutorial-project) removed from packages/slycode/templates/ — build pipeline is sole delivery mechanism.
  - Hooks: useSlyActionsConfig.ts (not useCommandsConfig.ts)

### feature-guide
- path: areas/feature-guide.md
- updated: 2026-03-14

- load-when: feature guide, feature reference, full scope, system overview, product overview, comprehensive reference, all features, complete reference, deep dive features, product messaging, value proposition, USP, positioning, user story, what is slycode, why slycode, target audience, marketing, website copy, README copy, onboarding copy, pricing, teams tier, per-card provider selection
- notes:
  - Auto-maintained by automation card-1772101929502
  - Comprehensive reference of every SlyCode feature, function, and behavior
  - Use when needing full product scope for design docs, comparisons, or thorough analysis
  - PROTECTED: documentation/features/042_slycode_product_messaging.md is the canonical product messaging framework. It defines SlyCode's positioning, value proposition, messaging pillars, target audience, pricing framing, and proof points. Load this document whenever product identity, messaging, marketing copy, or user-facing language is relevant. Do NOT remove or overwrite this reference during context priming updates.

### scripts-deployment
- path: areas/scripts-deployment.md
- updated: 2026-03-14
- load-when: setup, scripts, deployment, start, stop, restart, dev, ports, service, systemd, launchd, linger, PID, zombie, sly-start, sly-stop, sly-dev, sly-restart, setup.sh, .env, environment, production, build, tmux, bridge-sessions, XDG_RUNTIME_DIR, build tools, gcc, npm, packages, slycode, create-slycode, migrate, build-package, sync-updates, store-manifest, SLYCODE_HOME, path resolution, getSlycodeRoot, getPackageDir, slycode.config.js, config, uninstall, DEV_HOSTNAME, legacy root env var, timezone, TZ
- notes:
  - Two port ranges: dev (3003/4/5) and prod (7591/2/3 = "sly" on keypad)
  - Stop by port, NOT PID files (npm spawns children, PIDs go stale)
  - bridge-sessions.json is critical — crash on read errors, never silently wipe
  - XDG_RUNTIME_DIR must be set for systemctl --user in code-server
  - slycode.config.js: workspace-level config for ports, services, host. Loaded by config/loader.ts.
  - Default host: 127.0.0.1. Only web binds to config.host; bridge+messaging always localhost.
  - slycode CLI: 11 subcommands (workspace, start, stop, service, doctor, skills, sync, update, config, uninstall)
  - sly-dev.sh tmux hook calls sly-stop.sh on session close to prevent zombies
  - Global CLIs: sly-kanban, sly-messaging, sly-scaffold (symlinked to ~/bin)
  - Build: build-package.ts preserves tutorial-project/ template during wipe/rebuild
  - NPM packages: packages/slycode/ (v0.1.0 CLI) and packages/create-slycode/ (v0.1.0 scaffold)
  - Tutorial v3: content seeded into workspace root (not slycode_tutorial/ subdir). Registry default project = workspace root.
  - Path resolution simplified: legacy root env var env var removed. Resolution is now SLYCODE_HOME → cwd fallback only.
