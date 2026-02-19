# Web Frontend

Updated: 2026-03-14

## Overview

Next.js 16 command center for project management. Features project cards with health scoring, kanban boards with drag-drop, card modals with agent notes and automation config, command configuration, system health monitoring, cross-project toolkit/asset management, global search, activity feed, project scaffolding, server-side automation scheduler, voice-to-text input, image paste to terminal, responsive mobile layout, and graceful reconnection handling. Neon-minimalist theme (SlyCode Neon) with Tailwind CSS v4, featuring lane-colored gradients, SVG noise textures, shadow depth system, glassmorphism cards, priority-colored glows, and theme-aware terminal styling. JetBrains Mono font (`--font-jetbrains-mono`) for card numbers and checklist counts.

## Key Files

### Pages & Layout
- `web/src/app/page.tsx` - Home dashboard, lists projects from registry
- `web/src/app/project/[id]/page.tsx` - Project detail page with kanban
- `web/src/components/ProjectPageClient.tsx` - Client wrapper for project pages, global terminal activity polling
- `web/src/components/ProjectView.tsx` - Project view wrapper, manages archive toggle and active-automation-indicator state

### Core Components
- `web/src/components/Dashboard.tsx` - "Code Den" + CLI Assets tabs (with description subtitles), project card grid, global search, number-key shortcuts, footer with version display
- `web/src/components/ProjectKanban.tsx` - Kanban board container, drag-drop logic, context menu state, onActiveAutomationsChange callback to ProjectView
- `web/src/components/KanbanColumn.tsx` - Stage columns, flex-grow layout (min-w-72 max-w-96) for wide viewports
- `web/src/components/KanbanCardItem.tsx` - Individual card with glassmorphic style, priority-colored hover glow, card numbers, type emojis, compact mode for done stage, right-click onContextMenu trigger
- `web/src/components/CardModal.tsx` - Full card editor with dynamic tabs, agent notes, automation toggle (disabled for archived cards), archive toggle (disabled for automation cards), copy title button, edit session protection, suppressAutoTerminal prop
- `web/src/components/AutomationConfig.tsx` - Cron builder UI for card automation settings (schedule, provider, fresh session, report toggle, Run Now button with loading/success/error feedback). No prompt field — card description is the automation prompt. All nextRun calculation server-side: `refreshNextRun()` POSTs to /api/scheduler `nextRun` action on enable toggle, schedule type switch, builder changes, and raw cron input.
- `web/src/components/AutomationsScreen.tsx` - Full-screen automations view (max-w-5xl, 2-col grid), countdown timers, tag grouping, chevron texture cards with hazard stripe
- `web/src/components/ProjectHeader.tsx` - Header with Commands (badge for action updates), Archive toggle, Automations toggle (pulses when automations active), HealthMonitor. Polls /api/cli-assets/updates for actionEntries count. Invalidates actions cache on SlyActionConfigModal close.
- `web/src/components/ContextMenu.tsx` - Portal-based context menu with keyboard navigation (Arrow keys, Enter, Escape), submenus (150ms hover delay), viewport-aware positioning, lane-colored accent bar
- `web/src/components/ConfirmDialog.tsx` - Confirmation dialog for destructive actions (delete), z-60 overlay

### Project Management
- `web/src/components/ProjectCard.tsx` - Compact project card with drag handle, truncated title, health dot, platform badges, edit/delete
- `web/src/components/AddProjectModal.tsx` - Multi-phase project creation wizard (details → providers → review → creating → summary) with scaffold preview grouped by purpose
- `web/src/components/HealthDot.tsx` - Health score indicator with tooltip (green/amber/red)
- `web/src/components/PlatformBadges.tsx` - Detected AI platform badges (Claude, Gemini, Codex)
- `web/src/components/SearchBar.tsx` - Global search across cards, active session display when query empty

### Terminal & Commands
- `web/src/components/ClaudeTerminalPanel.tsx` - Reusable terminal with provider button group, single actions prop (splits by placement), card area filtering, image paste handling with screenshot toast, instruction file warning with opt-out checkbox
- `web/src/components/Terminal.tsx` - xterm.js terminal with ConnectionManager integration, Ctrl+V interception via `attachCustomKeyEventHandler` for image paste (falls back to text paste), resize broadcast with echo-loop suppression
- `web/src/components/SlyActionConfigModal.tsx` - Two-tab command config: Commands tab (edit definitions + placement) and Classes tab (assign + reorder per class), with Action Assistant terminal. Voice-integrated, Escape passes through to terminal when assistant is expanded. Shows "Updates" tab (with badge count) when action updates available.
- `web/src/components/ActionUpdatesModal.tsx` - Dedicated modal for action update delivery: accept/dismiss/preview with inline diff viewer (reuses SkillDiffViewer patterns)
- `web/src/components/GlobalClaudePanel.tsx` - Floating panel for project-wide session, handles terminal prompt events (auto-start/send), voice-aware click-outside (prevents collapse during recording)

### Voice Input
- `web/src/contexts/VoiceContext.tsx` - Centralized voice state via React Context (`useVoice()` hook). Voice claim system (claimant model), settings management, terminal registry, floating widget rendering. VoiceProvider wraps entire app in layout.tsx.
- `web/src/components/VoiceControlBar.tsx` - Voice recording UI in CardModal header (mic button, timer, controls, state machine)
- `web/src/components/VoiceSettingsPopover.tsx` - Settings gear popover (keyboard shortcuts, auto-submit toggle, max recording length)
- `web/src/components/VoiceErrorPopup.tsx` - Error popup with retry/clear when transcription fails
- `web/src/components/FloatingVoiceWidget.tsx` - Floating portal-based voice widget shown at bottom-right when no modal claims voice control (recording/paused/transcribing states)
- `web/src/components/ThemeToggle.tsx` - Light/dark theme toggle using localStorage (`slycode-theme`), imported by Dashboard

### CLI Assets
- `web/src/components/CliAssetsTab.tsx` - Asset management with Projects/Store/Updates views, provider sub-tabs, pending changes bar, 60s update polling, ImportDialog for skill imports (SKILL.md-only vs full folder)
- `web/src/components/AssetMatrix.tsx` - Cross-project asset deployment matrix with Fix/Ignore actions
- `web/src/components/AssetViewer.tsx` - Modal viewer for asset content with frontmatter display (version, updated, description — no provider field), project-aware loading
- `web/src/components/StoreView.tsx` - Store tab: flat canonical store (store/skills/, store/agents/), Delete/Fix/Modify actions
- `web/src/components/UpdatesView.tsx` - Update delivery: shows available updates from updates/ folder, accept/dismiss/preview workflow
- `web/src/components/SkillDiffViewer.tsx` - Side-by-side diff modal for comparing skill versions with line-level highlighting
- `web/src/components/AssetAssistant.tsx` - Modal for LLM-guided asset creation/modification via terminal prompts

### Version Updates
- `web/src/components/VersionUpdateToast.tsx` - Bottom-left toast for npm version updates (6-hour poll, daily dismiss)
- `web/src/app/api/version-check/route.ts` - npm version check endpoint

### Automation & Scheduling
- `web/src/lib/scheduler.ts` - Server-side cron engine (croner), 30s check interval, triggerAutomation() bridge integration, timezone-aware via TZ env var, buildRunHeader() for rich automation context, loadParentEnv() for .env loading (skips BRIDGE_URL/BRIDGE_PORT to avoid dev/prod port mismatch), updateCardAutomation() exported for manual trigger persistence. Split fresh/resume paths: fresh sessions use checkSessionAlive() (20s liveness check, no retry), resume sessions use waitForActivity() with retry. fetchWithTimeout() (10s) wraps all bridge calls. Soft failure handling: only sends Telegram notification on hard failures (crash, HTTP error), not detection uncertainty. Grace window (GRACE_WINDOW_MS = 60s): isDue() clamps lastRun reference to at most 60s ago, preventing stale ticks from long-disabled automations firing immediately on re-enable. New automations (no lastRun) always wait for first tick. HMR-safe: state + timer stored in `globalThis` via `__scheduler_state__`/`__scheduler_timer__` keys, `startScheduler()` clears stale intervals before creating new one. `getNextRun()` exported for use by kanban API and scheduler route.
- `web/src/lib/cron-utils.ts` - Shared cronToHumanReadable() utility (extracted from duplicate code in AutomationConfig + AutomationsScreen), timezone abbreviation suffix support. `getNextRunISO()` removed — all nextRun calculation now server-side via scheduler.ts `getNextRun()`.
- `web/src/instrumentation.ts` - Next.js instrumentation hook, auto-starts scheduler on server boot
- `web/src/app/api/scheduler/route.ts` - GET status + timezone info (auto-start), POST start/stop/trigger/nextRun. Manual trigger now persists lastRun/lastResult via updateCardAutomation(). `nextRun` action computes next cron run on demand (used by AutomationConfig `refreshNextRun()`).

### Activity & Content
- `web/src/components/ActivityFeed.tsx` - Collapsible event log with day grouping and stage indicators
- `web/src/components/MarkdownContent.tsx` - Markdown renderer using react-markdown with GFM support

### Health & Connection
- `web/src/components/HealthMonitor.tsx` - System stats widget (CPU, memory, terminals), click-to-toggle expand (mobile: compact dot + count, desktop: full bars)
- `web/src/components/ConnectionStatusIndicator.tsx` - Reconnection toast indicator with debounced disconnect and success timeout cleanup (unmount-safe refs)
- `web/src/lib/connection-manager.ts` - Centralized SSE reconnection with Page Visibility API

### Hooks
- `web/src/hooks/useConnectionStatus.ts` - Hook for connection state subscription
- `web/src/hooks/useKeyboardShortcuts.ts` - Keyboard navigation (1-9 project jump, Escape)
- `web/src/hooks/useSlyActionsConfig.ts` - Polling-based commands config loader (30s intervals, serves v3 format with classAssignments)
- `web/src/hooks/useVoiceRecorder.ts` - Core voice hook: MediaRecorder lifecycle, state machine, timer, pause/resume, max-length auto-pause, audio blob management
- `web/src/hooks/useVoiceShortcuts.ts` - Voice keyboard shortcuts (context-dependent: idle vs recording states), configurable via settings
- `web/src/hooks/useSettings.ts` - Generic settings hook for reading/writing data/settings.json via API (on-demand fetch, optimistic updates)
- `web/src/hooks/usePolling.ts` - Generic polling hook

### Utilities
- `web/src/lib/types.ts` - All shared types (see Data Models)
- `web/src/lib/sly-actions.ts` - getActionsForClass(), renderTemplate(), buildPrompt(), CONTEXT_TEMPLATES (hardcoded), types
- `web/src/lib/action-scanner.ts` - Action .md file scanner: parse YAML frontmatter, assemble SlyActionsConfig, 30s cache, write support, update scanning (content-hash based), accept with additive class merge
- `web/src/lib/registry.ts` - Project registry loader with kanban, health scoring, platform detection. Exports `getRepoRoot()` for workspace root resolution.
- `web/src/lib/paths.ts` - Dynamic path resolution: getSlycodeRoot() (workspace), getPackageDir() (package assets — dev: repo root, prod: node_modules/@slycode/slycode/dist/)
- `web/src/lib/kanban-paths.ts` - Project-aware kanban file path resolution with tiered backup. Workspace ID derived via `path.basename(getRepoRoot())` with underscore→hyphen normalization.
- `web/src/lib/asset-scanner.ts` - Asset scanning, frontmatter parsing, version comparison, store matrix building, update scanning (scanUpdatesFolder, acceptUpdate, getIgnoredUpdates). MASTER_PROJECT_ID derived via `path.basename()` — no hardcoded project name.
- `web/src/lib/store-scanner.ts` - Flat canonical store scanning (store/skills/ dirs, store/agents/ files)
- `web/src/lib/provider-paths.ts` - Provider-specific asset directory conventions (Claude/Codex/Gemini)
- `web/src/lib/mcp-common.ts` - Provider-neutral MCP config format with per-provider transformers
- `web/src/lib/terminal-events.ts` - Custom event system for pushing prompts to global terminal (pushToTerminal)
- `web/src/lib/event-log.ts` - Append-only activity log with filtering/querying (500 event cap)
- `web/src/lib/health-score.ts` - Health score calculator with configurable weights
- `web/src/lib/tab-sync.ts` - Cross-tab synchronization using BroadcastChannel API

### API Routes
- `web/src/app/api/kanban/route.ts` - Kanban CRUD. GET dynamically computes nextRun for all enabled recurring automation cards (server-side single source of truth for timezone via scheduler.ts getNextRun).
- `web/src/app/api/bridge/[...path]/route.ts` - Bridge proxy
- `web/src/app/api/sly-actions/route.ts` - GET assembled config from action-scanner / PUT writes back to .md files
- `web/src/app/api/sly-actions/stream/route.ts` - SSE watching store/actions/ directory for changes
- `web/src/app/api/sly-actions/invalidate/route.ts` - POST cache invalidation for actions
- `web/src/app/api/system-stats/route.ts` - CPU/memory metrics
- `web/src/app/api/areas/route.ts` - Available areas list
- `web/src/app/api/terminal-classes/route.ts` - Terminal class definitions
- `web/src/app/api/sly-actions/config/route.ts` - Actions in SlyActionsConfig format
- `web/src/app/api/cli-assets/route.ts` - Scan project assets, build matrix using flat canonical store as master
- `web/src/app/api/cli-assets/import/route.ts` - Import asset from project into workspace (uses getRepoRoot(), not registry lookup)
- `web/src/app/api/cli-assets/sync/route.ts` - Batch deploy/remove assets from canonical store to project provider dirs (uses getRepoRoot())
- `web/src/app/api/cli-assets/store/route.ts` - Flat store CRUD (GET scan, POST import with skillMainOnly option, DELETE remove)
- `web/src/app/api/cli-assets/store/preview/route.ts` - Import preview: lists files in project skill directory before importing
- `web/src/app/api/cli-assets/updates/route.ts` - Update delivery for skills + actions (GET scan both, POST accept with type routing, DELETE dismiss with contentHash for actions)
- `web/src/app/api/cli-assets/fix/route.ts` - Generate compliance fix prompts for non-compliant frontmatter
- `web/src/app/api/cli-assets/assistant/route.ts` - Generate asset creation/modification prompts
- `web/src/app/api/events/route.ts` - Query activity log with filters
- `web/src/app/api/search/route.ts` - Cross-project card search
- `web/src/app/api/projects/route.ts` - List/create projects
- `web/src/app/api/projects/[id]/route.ts` - GET/PUT/DELETE individual project
- `web/src/app/api/projects/analyze/route.ts` - Analyze directory before scaffolding (returns groups and detected providers)
- `web/src/app/api/projects/reorder/route.ts` - Persist project display order
- `web/src/app/api/version-check/route.ts` - npm version check for update toast
- `web/src/app/api/transcribe/route.ts` - POST audio upload → dual-backend STT. Checks `STT_BACKEND` env var (from process.env or parent .env). Local backend: writes temp file → ffmpeg WAV conversion → whisper-cli execution. OpenAI backend: Whisper API. Generic `loadEnv()` caches all env vars from parent .env.
- `web/src/app/api/settings/route.ts` - GET/PUT for data/settings.json (voice settings, keyboard shortcuts)
- `web/src/app/api/providers/route.ts` - GET/PUT for providers.json (provider list + stage defaults)
- `web/src/app/api/file/route.ts` - Read files from approved directories
- `web/src/app/api/git-status/route.ts` - Git status for projects
- `web/src/app/api/dashboard/route.ts` - Dashboard data: loads registry, enriches with bridge session counts

## Key Functions

- `ProjectKanban.handleDragEnd()` - Reorders cards, handles cross-column moves
- `ProjectKanban.handleCardContextMenu()` - Right-click context menu with stage/priority submenus, archive, delete
- `ProjectKanban.buildKanbanMenuGroups()` / `buildAutomationMenuGroups()` - Build context menu items per card type
- `ConnectionManager.createManagedEventSource()` - Auto-reconnecting SSE with backoff
- `getActionsForClass(commands, classAssignments, terminalClass, options?)` - Single getter: class → ordered IDs → filter by project/cardType
- `scanProjectAssets()` - Scan commands/skills/agents across projects, build matrix
- `scanStoreAssets()` - Scan store directory for cross-provider asset variants
- `pushToTerminal()` - Dispatch prompt to global terminal via custom events
- `calculateHealthScore()` - Score 0-100 based on configurable weighted factors
- `startScheduler()` / `stopScheduler()` - Automation scheduler lifecycle
- `triggerAutomation()` - Execute card automation: build prompt with run header, create/reuse bridge session. Fresh sessions: checkSessionAlive() after 20s (no retry, prompt delivered via CLI args). Resume sessions: waitForActivity() differential check + retry via bracketed paste if no activity. Accepts TriggerOptions (scheduled/manual). Returns KickoffResult with sessionName.
- `buildRunHeader()` - Formats === AUTOMATION RUN === block with timestamp, card info, trigger type, last run time
- `getConfiguredTimezone()` - Returns IANA timezone + abbreviation from TZ env var
- `loadParentEnv()` - Reads .env from workspace root (Next.js only loads from web/). Skips BRIDGE_URL/BRIDGE_PORT (port-dependent, differs dev vs prod) to avoid routing scheduler requests to wrong bridge.
- `next.config.ts` reads `DEV_HOSTNAME` from parent .env via inline `getParentEnv()` for `allowedDevOrigins` (Tailscale dev access). Dashboard footer shows slycode version fetched from `/api/version-check`.
- `cronToHumanReadable()` - Cron to human-readable text (shared utility in cron-utils.ts)
- `getNextRun()` - Calculate next cron run as Date (exported from scheduler.ts, server-side only). Used by GET /api/kanban (dynamic nextRun on all enabled recurring cards) and POST /api/scheduler `nextRun` action (on-demand for AutomationConfig UI). Client-side `getNextRunISO()` removed from cron-utils.ts — no croner dependency on client.

## CardModal Tabs

- **Details** - Edit fields, dropdowns for stage/priority, editable areas/tags chips, delete button. Automation cards show "Description / Automation Instructions" label and AutomationConfig panel (with Run Now button) instead of problems section.
- **Notes** - Agent notes (AgentNote[]) with scroll shadows, add/delete/clear, purple accent. Empty state shows CLI hint.
- **Design** - Shows if `design_ref` exists, renders markdown with copy path button
- **Feature** - Shows if `feature_ref` exists, renders markdown
- **Test** - Shows if `test_ref` exists, renders markdown
- **Checklist** - Interactive checkboxes with progress bar (uses ref-based state for rapid clicks)
- **Terminal** - AI session with provider selector, auto-connect, single actions prop split by placement

CardModal uses edit session protection: last-known-value tracking, 2000ms grace period for field editing, prevents overwriting active edits from external updates.

### Voice-to-Text
Voice is a **global system** using React Context (`VoiceContext.tsx`). VoiceProvider wraps the app in layout.tsx. Components use `useVoice()` hook instead of managing voice locally. Voice claim system: components register as claimants (CardModal, GlobalClaudePanel) via `claimVoice()`/`releaseVoice()`. When no modal claims voice, FloatingVoiceWidget appears at bottom-right for global voice control. Records audio via browser MediaRecorder, sends to /api/transcribe (Whisper STT), inserts transcription at claimant's target. Focus targets: input/textarea fields (via execCommand('insertText') for undo support) or terminal (via sendInput). VoiceSettingsPopover (gear icon) configures shortcuts, auto-submit, max recording length. Settings persisted in data/settings.json via /api/settings. VoicePopoverPortal renders popovers via createPortal to escape CardModal stacking context.

### Automation Cards
Cards with `card.automation` set get orange-themed header/tabs (instead of stage color). Automation toggle in card header enables/disables automation mode (disabled for archived cards). Archive toggle is disabled for automation cards ("Automation cards cannot be archived"). Automation cards are filtered from normal kanban columns and shown in AutomationsScreen instead.

## Health Scoring

- **Factors**: outdated assets, stale cards, unresolved problems, missing CLAUDE.md, non-compliant frontmatter
- **Levels**: green (≥80), amber (≥50), red (<50)
- **Display**: HealthDot component with tooltip showing score breakdown
- Located on ProjectCard in Dashboard

## CLI Assets (Asset Management)

Three views: **Projects**, **Store**, and **Updates**.

### Projects View
- Provider sub-tabs (Claude/Codex/Gemini) filter which provider's assets are shown
- Matrix view: rows=assets, columns=projects, cells=status (current/outdated/missing)
- Canonical store is master source of truth (store/skills/, store/agents/)
- Batch deploy/remove with pending changes bar
- "Not in Store" section for importing untracked project assets
- Fix action for non-compliant frontmatter (generates LLM prompt)
- Ignore/Unignore for assets that shouldn't be tracked

### Store View
- Flat canonical layout: skills and agents listed from store/
- Delete, Fix, and Modify actions per asset
- New Asset button → AssetAssistant modal → terminal prompt
- Modify action on existing assets → pre-filled AssetAssistant

### Updates View
- Scans updates/ folder against store/ for available updates
- Shows status per update: "new" (skill not in store) or "update" (newer version)
- Preview button opens SkillDiffViewer with side-by-side diff
- Accept: copies from updates/ → store/ with backup of old version
- Dismiss: records version in store/.ignored-updates.json (skipped on future scans)
- Post-accept: shows push-to-projects options
- 60s polling interval via usePolling hook

## Connection Management

- `ConnectionManager` - Singleton managing all SSE connections
- Page Visibility API detection for sleep/wake cycles
- Exponential backoff with jitter (1s initial, 30s max)
- `ConnectionStatusIndicator` - Toast showing "Reconnecting..." during recovery

## Data Models

- `KanbanCard` - id, number?, title, description, type, priority, order, areas[], tags[], problems[], checklist[], archived?, design_ref?, feature_ref?, test_ref?, claude_session?, agentNotes?, automation?, last_modified_by?
- `AgentNote` - id (sequential int), agent? (Claude/Codex/Gemini/User), text, timestamp, summary? (bool), summarizedCount?, dateRange?
- `AutomationConfig` - enabled, schedule, scheduleType (recurring|one-shot), provider, freshSession, workingDirectory?, reportViaMessaging, lastRun?, lastResult?, nextRun? (no prompt field — card description is the execution prompt). Manual triggers now persist lastRun/lastResult via scheduler API route.
- `KickoffResult` - cardId, projectId, success, error?, sessionName?
- `SlyAction` - label, description, group, cardTypes[], placement, prompt, scope, projects[]
- `BridgeStats` - bridgeTerminals, connectedClients, activelyWorking, sessions[]
- `SystemStats` - cpu (0-100), memory {used, total}, swap {used, total}
- `SessionActivity` - name, status, lastOutputAt, isActive, activityStartedAt?, lastOutputSnippet?
- `ProviderId` - 'claude' | 'agents' | 'codex' | 'gemini'
- `AssetType` - 'skill' | 'agent' | 'mcp' (no 'command' — all commands converted to skills)
- `AssetInfo` - name, type, version, updated, description, filePath, frontmatter, isValid
- `AssetCell` - status (current|outdated|missing), masterVersion?, projectVersion?
- `CliAssetsData` - skills (AssetRow[]), agents (AssetRow[]), nonImported (AssetRow[])
- `StoreData` - skills[], agents[], mcp[] (StoreAssetInfo arrays, flat canonical layout)
- `UpdateEntry` - name, assetType, status (update|new), currentVersion?, availableVersion, description?, updatesPath, storePath, filesAffected[], skillMdOnly
- `UpdatesData` - entries[], totalAvailable
- `IgnoredUpdates` - Record<string, string> (key: "skills/{name}", value: ignored version)
- `ProviderAssetPaths` - commands, skills, agents, mcpConfig paths per provider
- `PendingChange` - action, asset, project, provider, source for batch operations
- `HealthScore` - score (0-100), level (green|amber|red), factors[]
- `ActivityEvent` - type, timestamp, project, detail, cardId?
- `SearchResult` - cardId, cardTitle, projectId, projectName, stage, matchField, snippet, isArchived?
- `ProjectWithBacklog` - extends Project with backlog, designs, features, accessible, assets?, gitUncommitted?, healthScore?, platforms?, lastActivity?, activeSessions?
- `DashboardData` - projects (ProjectWithBacklog[]), totalBacklogItems, activeItems, totalOutdatedAssets?, totalUncommitted?, lastRefresh, slycodeRoot, projectsDir
- `VoiceClaimant` - id, onRecordStart?, onTranscriptionComplete, onRelease?
- `VoiceState` - 'disabled' | 'idle' | 'recording' | 'paused' | 'transcribing' | 'error'
- `VoiceSettings` - autoSubmitTerminal, maxRecordingSeconds, shortcuts (VoiceShortcuts)
- `VoiceShortcuts` - startRecording, pauseResume, submit, submitPasteOnly, clear (configurable key combos)
- `AppSettings` - voice (VoiceSettings); persisted server-side in data/settings.json

## Design System — SlyCode Neon Theme

### Philosophy
Neon-minimalist aesthetic. Clean surfaces with subtle texture for life and depth. Never sterile/flat, never over-the-top. The theme should feel like a premium tool — atmospheric but professional. Light mode is clean with solid colors (no gradients or grain textures on headers); dark mode is moody with glow and gradient textures.

### Color Palette
- **Neon Blue** (`--neon-blue: #00bfff`) — Primary accent, design/implementation lanes, links, active states
- **Neon Orange** (`--neon-orange: #ff8c00`) — Automation cards, warnings
- **Red-Orange** (`#ff6a33`) — Testing lane (NOT standard orange, which looks brown in dark mode)
- **Green** — Done lane, success states, running indicators
- **Void** — Neutral grey scale for backgrounds, borders, muted text
- **Red** (`#ff3b5c`) — Critical/bug indicators, stop buttons

### Critical Color Lesson
Dark-end scale colors (e.g. `neon-orange-950 = #2b1700`) are inherently brown. For vibrant dark mode colors, use the BRIGHT color at LOW OPACITY (e.g. `neon-orange-400/15`) instead of dark scale values.

### Shadow Depth System (globals.css)
Three CSS custom property tiers, defined on `:root` (light) and `.dark` (dark), providing consistent elevation across all components:

- `--shadow-surface` — Flat elements (column wrappers, panels). Light: subtle outward shadow. Dark: inset highlight + deep outward shadow + faint border ring.
- `--shadow-card` — Elevated cards, active elements. Light: medium spread. Dark: inset highlight + heavy spread + neon-blue edge ring.
- `--shadow-overlay` — Modals, overlays. Light: deep multi-layer. Dark: extreme depth + inset highlight + neon-blue ring.

Usage: `shadow-(--shadow-card)` in Tailwind classes, or `var(--shadow-card)` in keyframe animations. All neon-pulse keyframes layer glow effects ON TOP of the appropriate shadow var (e.g., `box-shadow: var(--shadow-card), 0 0 8px 2px rgba(...)`) to preserve depth while glowing.

### Texture System (globals.css)
Three-layer texture approach for gradient surfaces, plus lane and automation-specific textures:

1. **Fine grain** (`.grain`) — High-frequency SVG feTurbulence noise (`baseFrequency: 0.65`), overlay blend. Desaturate with `feColorMatrix type='saturate' values='0'` when color neutrality matters.
2. **Perlin noise** (`.depth-glow`) — Low-frequency organic texture (`baseFrequency: 0.015` light, `0.012` dark), large 400px tiles. Light mode uses `screen` blend (lightens), dark mode uses `soft-light`. Masked with left-to-right gradient fade.
3. **Terminal texture** (`.terminal-texture`) — CRT-like grain + vignette + lane-colored tint via `--terminal-tint` CSS variable. Box-shaped mask (edges visible, centre clear). Light: `soft-light` blend. Dark: `screen` blend (avoids warm/red cast from `soft-light` on dark backgrounds).
4. **Lane texture** (`.lane-texture`) — 18px grid-line background (subtle crosshatch). Light: rgba(40,80,200,0.12) blue-tinted, dark: rgba(255,255,255,0.015). Applied to KanbanColumn card scroll areas via `colorClasses.texture`.
5. **Light-clean suppression** (`.light-clean`) — Add to elements that use `.grain` and `.depth-glow` to suppress texture in light mode only. Hides `::after` (grain) and `::before` (depth-glow) via `display: none` in `:root:not(.dark)`. Used on column headers and global terminal header for clean light mode appearance.
6. **Automation chevron** (`.automation-chevron`) — Right-pointing filled SVG chevron arrows (3 copies per 50px tile for seamless wrap), fading left-to-right via mask. Orange fill in light mode, white fill at 0.08 opacity in dark mode. `.automation-chevron-muted` drops to 0.02 opacity for disabled cards.
7. **Hazard stripe** (`.hazard-stripe`) — Industrial diagonal amber/dark repeating stripe (8px bands at -45deg). Dark mode uses semi-transparent orange. `.hazard-stripe-muted` uses grey stripes at low opacity for disabled cards.

### Blend Mode Rules
- `soft-light` on dark backgrounds produces warm/red cast — avoid for dark mode textures
- `overlay` is neutral but can be invisible on very dark surfaces
- `screen` always adds light — use for dark mode when you need visible texture
- `mix-blend-multiply` makes white backgrounds transparent (light mode logos)
- `mix-blend-lighten` makes black backgrounds transparent (dark mode logos)
- `filter: drop-shadow()` traces the ALPHA boundary — creates rectangular glow on images with opaque backgrounds. Incompatible with blend-mode logo transparency.

### Logo Handling
Logos have opaque backgrounds (white for light, black for dark). Two `<img>` tags per location:
- Light: `mix-blend-multiply dark:hidden`
- Dark: `mix-blend-lighten hidden dark:block`
- All CSS drop-shadow/filter glow DISABLED (creates rectangular artifacts with blend modes). Logos have baked-in glow.
- Files: `slycode_light.webp` / `slycode.webp` (hero), `slycode_logo_light.webp` / `slycode_logo.webp` (nav)
- Favicon: `web/public/favicon.png` (64×64 rounded SlyCode logo, referenced via metadata in layout.tsx)

### Lane-Colored Theming
Stage colors flow through multiple layers:
- **KanbanColumn headers** — `colorClasses` map (includes `texture` key for lane-texture): light mode uses flat bg colors (e.g., `bg-neon-blue-100/80`), dark mode uses gradients. Inset shadows on headers (color-matched per lane). Thicker bottom borders (`border-b-[3px]`). Header text has drop-shadow for legibility. Text colors: light mode uses `text-void-500/600`, dark mode uses lane colors. Light mode column wrappers: `bg-[#d8e1f0]` blue-tinted background with complex inset shadows (top/left white highlights, bottom/right blue shadows) and blue-tinted borders. Dark mode column wrappers use standard `shadow-(--shadow-surface)` variant.
- **CardModal header/tabs** — `stageModalStyles` map with gradients, borders per stage. Uses transparency (85% → 50%) for subtle glass quality
- **CardModal footer** — `stageTerminalColors` with colored top border
- **Terminal tint** — `stageTerminalTint` map provides rgba color → passed as `tintColor` prop → sets `--terminal-tint` CSS variable on terminal overlay

### Gradient Direction Convention
Left-to-right, vibrant-to-soft. The left/start side is always the stronger color, fading lighter toward the right. Never center-out fades (looks artificial).

### Button Aesthetic — Neon Glass
Terminal/action buttons use neon-blue semi-transparent backgrounds with colored borders and hover glow:
```
border border-neon-blue-400/40 bg-neon-blue-400/15 text-neon-blue-400
hover:bg-neon-blue-400/25 hover:shadow-[0_0_12px_rgba(0,191,255,0.3)]
```

### Health Monitor
Uses inline gradient fills + glow shadows (not flat CSS classes):
- Normal: `linear-gradient(90deg, #00e676, #00bfff)` + blue glow
- Warning: `linear-gradient(90deg, #ff8c00, #ffaa00)` + orange glow
- Critical: `linear-gradient(90deg, #ff3b5c, #ff6b81)` + red glow

### Terminal Background
Theme-aware: `#222228` (light mode, slightly lighter) / `#1a1a1a` (dark mode). Detected at xterm mount via `document.documentElement.classList.contains('dark')`. Wrapper divs use `bg-[#222228] dark:bg-[#1a1a1a]`.

### Dark Mode Borders
Card modals get colored outer borders in dark mode (`dark:border dark:border-{color}/25-30`). Section dividers (header/tabs/terminal) use lane colors in both modes.

## Patterns & Invariants

- Cards auto-save on changes via `/api/kanban` POST with `changedCardIds` for surgical merge
- Surgical save: only changed cards sent in payload, server merges against disk state, preserves concurrent CLI/agent edits
- Kanban data stored in `documentation/kanban.json` per project
- Stage order: backlog → design → implementation → testing → done
- Active glow: `active-glow-card` CSS class with `neon-pulse-priority` animation uses `--glow-color` CSS var (from card's priority color, not hardcoded blue). Automation toggle button in header gets `active-glow-automation-btn` pulse when any automation card has an active session. All glow effects have light/dark mode variants.
- Commands use single `actions` prop split by placement (startup/toolbar/both) at the component level
- SSE connections managed centrally via ConnectionManager for reconnection
- Dynamic path resolution via paths.ts: getSlycodeRoot() (SLYCODE_HOME → cwd, no legacy root env var fallback), getPackageDir() for package assets (scripts/, scaffold-templates/). All API routes use centralized path functions — no local getRepoRoot() helpers. CLI assets import/sync use registry.ts getRepoRoot() instead of looking up project by ID.
- Cross-tab sync via BroadcastChannel API
- Number keys 1-9 jump to projects, Escape closes modals
- Event log capped at 500 entries, append-only
- Session names include provider segment: `{projectId}:{provider}:card:{cardId}`
- Provider button group (not dropdown) on no-session screen, pre-filled from stage defaults
- CardModal detects existing session's provider from session name for pre-selection
- ProjectKanban/ProjectPageClient use regex patterns to match both new and legacy session names
- Terminal prompt events: pushToTerminal() → GlobalClaudePanel handler → auto-start or send input
- 300ms delay before Enter on multi-line pastes (bracket paste mode handling)
- Store is master source of truth for assets (not SlyCode's .claude/)
- Dashboard tabs: "Code Den" (projects) and "CLI Assets" (assets) with description subtitles
- Dashboard projects support drag-and-drop reordering with drop indicators, persisted via displayOrder field
- Right-click context menu on kanban cards: move stage, set priority, copy title/ID/description, archive, delete (with ConfirmDialog)
- Context menu uses portal rendering (z-51, submenus z-52) with viewport-aware positioning and lane-colored accent bars
- Z-index layers: BackdropModal z-50, ContextMenu z-51, Submenu z-52, ConfirmDialog z-60
- suppressAutoTerminal: context menu "Open details" sets flag to prevent CardModal from auto-switching to terminal tab
- onActiveAutomationsChange: ProjectKanban reports to ProjectView whether any automation cards have active sessions (drives header pulse indicator)
- Instruction file check: ClaudeTerminalPanel fetches `/check-instruction-file` on provider/cwd change, shows amber warning with opt-out checkbox if instruction file is missing but a sibling exists. `createInstructionFile` state passed to session creation.
- Resize broadcast: Terminal.tsx guards resize POST to visible tabs only (document.visibilityState), uses `suppressResizePost` flag to prevent echo loop when handling SSE resize events from other tabs. Skips resize post on reconnect.
- Image paste: Ctrl+V in terminal intercepted at keydown level (before xterm.js), checks clipboard.read() for images, falls back to text paste via sendInput
- Screenshot toast: uploading/done/error states with thumbnail preview, auto-dismiss after 2s, double-fire guard
- Voice recording: state machine (disabled → idle → recording → paused → transcribing), configurable shortcuts, max-length auto-pause
- Voice focus tracking: captures last-focused field (input/textarea/terminal) before recording starts, inserts transcription there
- Voice-aware click-outside: GlobalClaudePanel and SlyActionConfigModal prevent closing while voice is busy (recording/transcribing) to ensure transcription lands in the correct terminal
- SlyActionConfigModal Escape handling: when assistant terminal is expanded, Escape passes through to terminal (not intercepted by modal)
- Settings persisted server-side: data/settings.json via GET/PUT /api/settings (voice section with VoiceSettings)
- Automation safeguards: automation cards cannot be archived (CLI rejects + web disables toggle), archived cards cannot enable automation (web disables toggle). Mutual exclusion enforced in CardModal header toggles.
- Automation cards filtered from normal kanban columns, shown in AutomationsScreen
- AutomationsScreen: max-w-5xl centered, 2-col grid (was 3-col), cards have chevron texture background + hazard stripe bottom bar + orange left border accent. Countdown timers are large (text-2xl), show "idle" label when disabled. Collapsible tag groups via `<details open>`.
- Scheduler auto-starts via instrumentation.ts on Next.js boot, checks every 30s, timezone-aware (TZ env var). Scheduler state and timer stored on globalThis to survive HMR reloads (prevents duplicate setInterval instances causing multiple schedulers to fight over kanban.json writes). loadParentEnv() reads .env from workspace root at module load (Next.js only loads .env from web/). nextRun computed dynamically by GET /api/kanban (server-side single source of truth for timezone) — no longer recalculated in checkAutomations loop. Grace window: isDue() clamps lastRun to max 60s ago so stale automations don't fire immediately on re-enable; new automations (no lastRun) wait for their first cron tick.
  - Fresh session path: prompt delivered via CLI args (OS-level guarantee), checkSessionAlive() after 20s confirms session didn't crash, no retry needed.
  - Resume session path: prompt pasted via bracketed paste (unreliable delivery), waitForActivity() takes baseline+5s differential, retries via re-paste on failure.
  - fetchWithTimeout(10s) wraps all bridge HTTP calls to prevent hung bridge from blocking activeKickoffs indefinitely.
  - Soft failure notifications: only Telegram-notifies on hard failures (Session create failed, Session stopped, Input failed, No automation config). Detection uncertainty logged but not notified.
- Automation run header: rich context block (=== AUTOMATION RUN ===) with time, card, trigger type (scheduled/manual with cron description), last run + relative time
- AutomationsScreen shows timezone abbreviation badge in header
- AutomationConfig shows timezone abbreviation next to one-shot date picker
- Notes tab shows amber "Summary" badge for summary notes (with summarizedCount/dateRange tooltip)
- last_modified_by tracks source of card changes: 'web', 'cli', or 'agent'
- KanbanColumn uses flex-grow (min-w-72 max-w-96) + justify-center for wide viewport scaling
- KanbanCardItem visual polish: glassmorphism (bg-white/55 + backdrop-blur-lg, dark: bg-[#20232a]/55 + backdrop-blur-xl), top hairline border (border-t-white/50), priority-colored left border with inset glow on hover (uses `--glow-color` CSS var set inline from priorityIndicators map), `::before` pseudo-element for hover highlight stripe on left edge
- Card numbers: sequential `number` field on KanbanCard (zero-padded #0001 format), displayed top-right in JetBrains Mono. Backfilled by CLI on first write (ensureCardNumbers/backfillCardNumbers in kanban.js), tracked via kanban.nextCardNumber
- Session status dots: running/activelyWorking show green ping dot, detached/resumable show orange dot, no-session shows grey dot. Type color dots replaced by type emojis (bug/feature/chore)
- Done column compact mode: `isCompact` when stage='done' hides tags/areas section to reduce visual clutter
- ChecklistProgress: smaller SVG ring (13px, 1.5 stroke), completed state uses void-400/void-500 (not green), count text in JetBrains Mono 10px
- Skill import preview: ImportDialog in CliAssetsTab shows file listing for skill directories, defaults to SKILL.md-only import (avoids overwriting store references/). Full folder option available. Non-skill assets import directly (single file).
- Activity ring: uses `isActive` (not `status=running`) to prevent flash on reconnect. Global terminal sessions included in activity counts (not just card sessions).

### Responsive Mobile Layout
- **Breakpoint strategy**: `sm:` (640px) is the mobile/desktop threshold. Mobile-first classes with `sm:` overrides for desktop.
- **CardModal**: fullscreen on mobile (`p-0 overflow-hidden h-full rounded-none`), windowed on desktop (`lg:p-4 lg:rounded-xl lg:h-auto lg:max-w-4xl`). Tabs scroll horizontally with `overflow-x-auto scrollbar-hide`. Smaller text/padding on mobile (`text-base sm:text-xl`, `p-3 sm:p-4`). Automation/Archive labels hidden on mobile (`hidden sm:inline`).
- **GlobalClaudePanel**: fullscreen on mobile when expanded (`inset-0 h-svh w-screen`), windowed on desktop (`sm:inset-auto sm:bottom-0 sm:right-4 sm:h-[500px] sm:w-[700px]`). Rounded corners removed on mobile when expanded.
- **HealthMonitor**: click-to-toggle (replaced hover-expand with 500ms delay). Click-outside dismiss. Mobile: compact status dot (worst-metric colored) + terminal count + activity ping. Desktop: full metric bars.
- **Terminal**: touch-to-scroll handler (manual `touchstart`/`touchmove`/`touchend` because xterm viewport is sibling not ancestor of canvas). Debounced resize (150ms timeout) prevents ResizeObserver feedback loop on mobile. Container has `touch-none` CSS.
- **ProjectHeader**: responsive layout — mobile hides project name/description, shows search icon button (opens full-width overlay), Actions button hidden on mobile (`hidden sm:flex`). All buttons use min-h/w-[44px] touch targets. Logo scales down on mobile (40px vs 52px).
- **KanbanColumn**: mobile snap-scroll columns (`min-w-[85vw] sm:min-w-72 max-w-[85vw] sm:max-w-96 snap-start`). Parent uses `snap-x snap-mandatory` for horizontal swiping.
- **globals.css**: `.scrollbar-hide` utility (hides scrollbars via `-ms-overflow-style: none`, `scrollbar-width: none`, `::-webkit-scrollbar display: none`)

## When to Expand

- Editing card behavior → CardModal.tsx
- Kanban drag/drop issues → ProjectKanban.tsx, KanbanColumn.tsx
- Context menu actions → ContextMenu.tsx, ProjectKanban.tsx (buildKanbanMenuGroups/buildAutomationMenuGroups)
- Confirmation dialogs → ConfirmDialog.tsx
- Adding new card fields → types.ts, CardModal.tsx
- Command configuration → SlyActionConfigModal.tsx (Commands tab + Classes tab), data/sly-actions.json (v3 format)
- Health monitoring → HealthMonitor.tsx, /api/system-stats
- Connection issues → connection-manager.ts, ConnectionStatusIndicator.tsx
- Terminal panel behavior → ClaudeTerminalPanel.tsx
- Provider selection → ClaudeTerminalPanel.tsx, /api/providers, data/providers.json
- Provider detection for existing sessions → CardModal.tsx (session name parsing)
- Asset management → asset-scanner.ts, CliAssetsTab.tsx, AssetMatrix.tsx, StoreView.tsx
- Store management → store-scanner.ts, StoreView.tsx, /api/cli-assets/store
- Update delivery → asset-scanner.ts (scanUpdatesFolder), UpdatesView.tsx, SkillDiffViewer.tsx, /api/cli-assets/updates
- Asset assistant → AssetAssistant.tsx, /api/cli-assets/assistant
- Version updates → VersionUpdateToast.tsx, /api/version-check
- Project reordering → Dashboard.tsx (drag-drop), /api/projects/reorder, registry.ts
- Terminal prompt flow → terminal-events.ts, GlobalClaudePanel.tsx
- Provider paths → provider-paths.ts, mcp-common.ts
- Health scoring → health-score.ts, HealthDot.tsx
- Activity feed → event-log.ts, ActivityFeed.tsx
- Project scaffolding → AddProjectModal.tsx, /api/projects
- Search → SearchBar.tsx, /api/search
- Agent notes → CardModal.tsx (notes tab), types.ts (AgentNote)
- Automation config → AutomationConfig.tsx, CardModal.tsx (automation toggle + panel)
- Automations screen → AutomationsScreen.tsx, ProjectKanban.tsx (showAutomations), ProjectView.tsx
- Scheduler → scheduler.ts, instrumentation.ts, /api/scheduler
- Surgical save → /api/kanban route.ts (changedCardIds merge), ProjectKanban.tsx (saveStages)
- Path resolution → paths.ts, kanban-paths.ts
- Keyboard shortcuts → useKeyboardShortcuts.ts
- Voice input → VoiceContext.tsx (global state), VoiceControlBar.tsx, FloatingVoiceWidget.tsx, useVoiceRecorder.ts, useVoiceShortcuts.ts, CardModal.tsx (voice claim)
- Voice settings → VoiceSettingsPopover.tsx, useSettings.ts, /api/settings
- Image paste → Terminal.tsx (Ctrl+V interception), ClaudeTerminalPanel.tsx (handleImagePaste, screenshot toast)
- App settings → useSettings.ts, /api/settings, data/settings.json
- Theme/design system → globals.css (texture classes), CardModal.tsx (stageModalStyles), KanbanColumn.tsx (colorClasses), GlobalClaudePanel.tsx (terminal header), Terminal.tsx (tintColor, terminal-texture)
- Responsive/mobile → CardModal.tsx (fullscreen), GlobalClaudePanel.tsx (fullscreen), HealthMonitor.tsx (click-toggle), Terminal.tsx (touch scroll), ProjectHeader.tsx (mobile search), KanbanColumn.tsx (snap-scroll)
- Skill import → CliAssetsTab.tsx (ImportDialog), /api/cli-assets/store/preview, /api/cli-assets/store (skillMainOnly)
- Instruction file warning → ClaudeTerminalPanel.tsx (instructionFileCheck state, createInstructionFile checkbox)
- Terminal resize sync → Terminal.tsx (sendResize visibility guard, suppressResizePost, SSE resize event)
