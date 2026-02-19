<!-- Last reviewed: 2026-03-14 -->

# SlyCode Feature Reference

> Auto-generated comprehensive reference. Last updated: 2026-03-14
> Single source of truth for all SlyCode features, functions, and behaviors.
> NOT a user guide. Maximally information-dense AI reference document.

## 1. System Overview

### Architecture
SlyCode is a multi-service AI development platform that orchestrates CLI-based AI agents (Claude, Codex, Gemini) through a web command center, terminal bridge, and messaging system.

### Component Relationship
```
Web Command Center (Next.js)  <-->  Terminal Bridge (Express+WS)  <-->  PTY Sessions (Claude/Codex/Gemini)
     port 7591 (prod) / 3003 (dev)    port 7592 (prod) / 3004 (dev)     spawned per card/global

Messaging Service (Express)   <-->  Terminal Bridge (same)        <-->  PTY Sessions
     port 7593 (prod) / 3005 (dev)

SlyCode CLI (npm package)     <-->  All services (start/stop/update/sync)
```

### Data Flow
- Card lifecycle: CLI/Web UI --> kanban.json --> SSE broadcast --> all clients
- Terminal I/O: Web/Messaging --> Bridge REST --> PTY stdin; PTY stdout --> WS/SSE --> clients
- Session persistence: Bridge --> bridge-sessions.json (atomic); provider session IDs detected async
- Events: Card mutations --> events.json (max 500) --> Activity Feed
- State: messaging-state.json (nav/voice/mode), settings.json (voice input), providers.json (AI config)

### Port Mappings
| Service | Dev | Prod | Env Var |
|---------|-----|------|---------|
| Web | 3003 | 7591 | WEB_PORT |
| Bridge | 3004 | 7592 | BRIDGE_PORT |
| Messaging | 3005 | 7593 | MESSAGING_SERVICE_PORT |

### Key Shared State Files
| File | Purpose | Written By |
|------|---------|------------|
| documentation/kanban.json | Card data (5 stages) | CLI, Web API |
| documentation/events.json | Audit log (max 500) | CLI, Web API |
| bridge-sessions.json | PTY session persistence | Bridge |
| messaging-state.json | Navigation, voice, mode | Messaging |
| data/providers.json | AI provider configs | Web API, manual |
| store/actions/*.md | Terminal commands (individual MD) | Web API, manual |
| data/settings.json | Voice input settings | Web API |
| projects/registry.json | Project metadata | CLI, Web API |

---


## 2. Dashboard & Web UI

### Pages & Routes
- **Home** (`/`) -- Projects grid, CLI assets tab, activity feed, global terminal
  - Stats bar: project count, backlog items, outdated assets, uncommitted files
  - Footer: copyright with clickable slycode.ai link (`<a>` tag, `hover:text-neon-blue-500`) + SlyCode version fetched from `/api/version-check` on mount, displayed as `v{version}` in muted `text-void-400`
  - Keyboard: 1-9 jump to projects, 0 for 10th; Escape closes modals
  - SSE from /api/kanban/stream; bridge stats poll every 1s
- **Project** (`/project/[id]`) -- Kanban board with 5 columns
  - URL param `?card=CARD_ID` auto-opens card modal
  - SSE updates (500ms debounce); drag-drop between stages
  - Context menu (right-click): move, clone, archive, delete
  - Automations screen (separate view for automation cards)
  - Refresh button in ProjectHeader: reloads board data from disk (bypasses dirty/saving guards)

### Responsive Mobile Layout
- **Breakpoint**: `sm:` (640px) is the primary mobile/desktop breakpoint across all project views
- **Project page viewport**: `h-svh` (was `h-screen`) on `ProjectPageClient` -- uses CSS `svh` unit for correct height on mobile browsers with dynamic toolbars; `overflow-hidden` with body scroll lock via `useEffect`
- **Kanban horizontal scroll**: kanban board container uses `snap-x snap-mandatory sm:snap-none`; columns are `min-w-[85vw] sm:min-w-72 max-w-[85vw] sm:max-w-96` with `snap-start` -- single-column swipe on mobile, free multi-column scroll on desktop
- **Project header**:
  - Logo shrinks: `h-[40px] w-[40px] sm:h-[52px] sm:w-[52px]`
  - Project name/description hidden on mobile (`hidden sm:block`)
  - Gap reduced: `gap-2 sm:gap-4`; button gap: `gap-1 sm:gap-2`
  - All header buttons get `min-h-[44px] min-w-[44px]` touch targets with `flex items-center justify-center`
  - Sly Actions button hidden on mobile: `hidden sm:flex`
  - Search: desktop inline (`hidden sm:block w-64`); mobile shows magnifying glass icon button that opens a fixed full-width search overlay (`fixed inset-x-0 top-0 z-50 sm:hidden`) with close button
- **Card modal**: full-screen on mobile (`p-0 rounded-none h-full max-w-full overflow-hidden`), windowed on desktop (`lg:p-4 lg:pt-16 lg:pb-16 lg:rounded-xl lg:max-w-4xl lg:overflow-y-auto`)
  - Title font: `text-base sm:text-xl`
  - Automation/Archive toggle labels: `hidden sm:inline` (icon-only on mobile)
  - Toggle gaps: `gap-1 sm:gap-2`
  - Header padding: `p-3 sm:p-4`
  - Tabs: `overflow-x-auto scrollbar-hide` with all tab buttons `shrink-0` for horizontal scroll
  - Content area: `min-h-0 flex-1 lg:flex-initial` (fills remaining space on mobile; fixed `h-[60vh]`/`max-h-[60vh]` on desktop)
  - Scroll containment: `overscroll-contain` on scrollable tab content prevents pull-to-refresh interference
- **Global Claude Panel**: expanded state goes full-screen on mobile (`inset-0 h-svh w-screen`), windowed on desktop (`sm:inset-auto sm:bottom-0 sm:right-4 sm:h-[500px] sm:w-[700px]`); header bar: `rounded-none sm:rounded-t-md` when expanded; panel body: `rounded-none sm:rounded-b-md`
- **Health Monitor**: two display modes
  - Mobile (`sm:hidden`): single colored dot (worst-metric gradient) + terminal count in `text-[10px] font-mono` + optional green ping for actively working; entire compact bar is click-to-expand (was hover-with-delay)
  - Desktop (`hidden sm:flex`): full MiniBar components for CPU/MEM/SWP + terminal count + active indicator
  - Expand trigger changed from hover-with-500ms-delay to click toggle with click-outside dismiss
- **Terminal touch scroll**: custom touch event handlers on the terminal container (`touch-none` CSS class) since xterm's `.xterm-viewport` is a sibling of `.xterm-screen` (browser can't find scrollable ancestor from canvas touch target)
  - `touchstart`: records initial Y and resets accumulator
  - `touchmove`: calculates delta, accumulates sub-line-height movement, calls `terminal.scrollLines()` when threshold reached; `e.preventDefault()` blocks page scroll
  - `touchend`: resets state
  - LINE_HEIGHT computed from `terminal.options.fontSize * lineHeight`
- **Terminal resize debounce**: replaced `window.addEventListener('resize', handleResize)` with `ResizeObserver`-only approach; handler debounced with 150ms `setTimeout` to prevent feedback loop where `fitAddon.fit()` triggers layout changes that re-fire the observer on mobile

### Theme & Design Tokens
- Dark/light toggle, localStorage + `<head>` script prevents flash
- Colors: Neon Blue #00bfff, Neon Orange #ff8c00, Void neutral (50-950 scales)
- **Fonts**: Geist Sans (body), Geist Mono (code), JetBrains Mono (`--font-jetbrains-mono` CSS variable, loaded in `layout.tsx` via `next/font/google`; used for card numbers, tag/area chips, checklist progress text)
- **Light mode textures**: `.light-clean` class suppresses `grain`/`depth-glow` pseudo-elements via `display: none` in `:root:not(.dark)` -- applied to column headers and global panel header
- **Light mode accents**: steely blue palette (rgba(36,144,181) / rgba(20,100,135)) replaces raw neon for contrast on light backgrounds
- **Priority-based session glow**: `.active-glow-card` uses inline `--glow-color` CSS variable (RGB triplet) set per card from `priorityIndicators[priority].glowRgb`; fallback `0, 191, 255` (blue)
  - Keyframes: `neon-pulse-priority` (dark), `neon-pulse-priority-light` (light) -- replaced old `neon-pulse-blue`/`neon-pulse-blue-light`
  - Glow color matches card priority stripe: critical=`255,23,68` red, high=`255,145,0` orange, medium=`0,191,255` blue, low=`0,200,83` green
- **Light mode glow variants** (other element glows unchanged):
  - Global terminal: `neon-pulse-global-blue-light` (deeper blue, no white highlight)
  - Automation card: `neon-pulse-card-orange-light` (darker orange rgba(179,98,0))
  - Automation button: `neon-pulse-automation-btn-light`
  - Border glow: `neon-border-left-light` (steely blue inset)
- **Column headers (light)**: flat solid bg tints (e.g. `bg-neon-blue-100/80`), no gradients; dark mode retains `bg-gradient-to-r` via `dark:` prefix; neutral header text (`text-void-600`/`text-void-700`); border-bottom 3px (was 2px)
- Stage-colored card modal headers (backlog=gray, design=blue, testing=orange, done=green)
- CSS var `--focus-rgb` per stage; neon scrollbars; fractal noise texture overlay (dark mode only on headers)
- **Lane texture**: `.lane-texture` grid lines changed from neutral `rgba(0,0,0,0.04)` to blue-tinted `rgba(40,80,200,0.12)` in light mode; dark mode unchanged (`rgba(255,255,255,0.015)`)
- **Automation card textures** (globals.css): `automation-chevron`, `automation-chevron-muted`, `hazard-stripe`, `hazard-stripe-muted` (see AutomationsScreen below for details)

### Dashboard (`Dashboard.tsx`)
- SSE stream + bridge stats poll (1s); optimistic drag-reorder with +/-10px row detection
- Global Claude Panel: session `global:global`, cwd=slycode root
- **Version display**: `slycodeVersion` state fetched from `/api/version-check` on mount; shown in footer next to copyright as `v{version}`
- **Activity ring session counting**: counts ALL active sessions per project group (includes global terminals and card terminals); previous behavior excluded global terminals (`s.name.endsWith(':global')`) and non-card sessions, now uses `s.isActive` only; same logic in `registry.ts` server-side and `Dashboard.tsx` client-side bridge stats poll; project cards show combined activity ring reflecting total project terminal activity

### Project Header (`ProjectHeader.tsx`)
- Refresh button: calls `forceRefresh()` from ProjectKanban via callback ref; spinning icon with 400ms minimum spin duration
- Props: `onRefresh?: () => Promise<void>` wired through ProjectView -> ProjectKanban.onRefreshReady
- Buttons: refresh, theme toggle, health monitor, command config (desktop only), automations toggle, archived toggle
- **Mobile search**: magnifying glass icon button (`sm:hidden`) opens `showMobileSearch` overlay; overlay is fixed top-0 with full-width SearchBar + close button; desktop search bar is `hidden sm:block`
- **Action update badge**: polls `/api/cli-assets/updates` every 60s; `actionUpdateCount` state tracks pending action updates; badge rendered on Sly Actions button when count > 0; passed to `SlyActionConfigModal` as `actionUpdateCount` prop
- **Action Updates Modal**: `showActionUpdates` state; opened from SlyActionConfigModal via `onShowActionUpdates` callback or directly; renders `ActionUpdatesModal` component

### Kanban Board (`ProjectKanban.tsx`)
- Dirty flag pattern: isDirtyRef, isSavingRef, lastSaveTimestampRef (2s ignore window)
- Card sessions: poll /bridge/sessions every 5s; /bridge/stats every 2s
- Session pattern: `{projectId}:(?:{provider}:)?card:{cardId}`
- SSE: ignores own saves, waits for in-flight; `loadKanban()` returns `Promise<boolean>` (true if data changed); SSE handler uses check-for-changes mode, only shows externalUpdate banner if data actually changed (deduplicates reconnect noise); banner auto-clears after 3s via `setTimeout`
- `forceRefresh()`: fetches fresh board from `/api/kanban`, resets `lastKnownUpdateRef`, `cleanBaselineRef`, `isDirtyRef`; clears externalUpdate banner; exposed to parent via `onRefreshReady` callback prop
- `ProjectView` stores forceRefresh in a ref, passes `handleRefresh` to `ProjectHeader.onRefresh`
- **Mobile snap scroll**: board container `snap-x snap-mandatory sm:snap-none` enables single-column swipe on mobile
- **Automation enable/disable**: context menu toggle simplified; no longer computes `nextRun` client-side (server computes it on next kanban GET); removed `getNextRunISO` import from cron-utils

### Card Modal (`CardModal.tsx`)
- **Tabs**: details | design | feature | test | notes | checklist | terminal
- Edit protection: editingFieldsRef with 2000ms grace blocks SSE sync
- Stage-aware styling: gradient headers, tint colors, focus ring per stage
- Create mode: auto-focus title, defaults priority=medium type=feature
- Automation: orange theme, AutomationConfig embedded
- Voice: VoiceControlBar + VoiceSettingsPopover on terminal tab
- **Notes tab -- summary badge**: summary notes (from `notes summarize`) display an amber "Summary" pill badge (`bg-amber-100 text-amber-700 / dark:bg-amber-900/40 dark:text-amber-300`) next to the agent badge; title tooltip shows `Summary of {summarizedCount} notes ({dateRange})`; uses `note.summary`, `note.summarizedCount`, `note.dateRange` fields from extended AgentNote type
- **Mobile full-screen mode**: modal is `h-full max-w-full rounded-none p-0 overflow-hidden` below `lg:` breakpoint; tabs horizontally scroll (`overflow-x-auto scrollbar-hide`); content fills remaining height via `min-h-0 flex-1`; toggle labels hidden on mobile
- **Actions config**: uses `useSlyActionsConfig()` hook (polling-based, 30s interval) instead of SSE stream; replaces previous SSE-based `useEffect` for sly-actions config

### Kanban Column (`KanbanColumn.tsx`)
- Auto-scroll: SCROLL_THRESHOLD=60px, SCROLL_SPEED=8px/frame, requestAnimationFrame
- Drop indicators: before/after at Y midpoint
- Passes `stage={stage.id}` to each `KanbanCardItem` (enables compact mode in done column)
- **Light mode beveled columns**: `border-2` with directional tinted borders (top/left `rgba(140,170,220,0.55)`, bottom/right `rgba(80,110,180,0.45)`); bg `#d8e1f0`; inset box-shadows for 3D bevel effect (white highlights top/left, blue shadows bottom/right); dark mode unchanged (`border-void-700 bg-void-850`)
- Headers use `.light-clean` class to suppress grain/depth-glow textures
- Light mode header text: neutral `text-void-600`/`text-void-700`; count badges `text-void-500`/`text-void-600`; border-bottom 3px
- **Mobile sizing**: `min-w-[85vw] sm:min-w-72 max-w-[85vw] sm:max-w-96` with `snap-start` for horizontal snap scrolling

### Card Item (`KanbanCardItem.tsx`)
- **Priority-based glow system**: each priority gets its own color for left border, hover glow, and active session glow via CSS `--glow-color` inline variable
  - critical: red (#ff1744), high: orange (#ff9100), medium: blue (#00bfff), low: green (#00c853)
  - `active-glow-card` animation uses `rgba(var(--glow-color), opacity)` pattern (replaces hardcoded neon-blue)
- **Glassmorphism styling**: `bg-white/55 backdrop-blur-lg` (light; was `bg-white/40`), `bg-[#20232a]/55 backdrop-blur-xl` (dark); `border-t-white/50` frost line
- **Priority stripe inner glow**: `before:` pseudo-element creates a thin white line on hover next to the left border
- **Card numbers**: optional `number` field (`number?: number` in KanbanCard type); displayed top-right as `#0001` format using JetBrains Mono at 10px; `formatCardNumber()` zero-pads to 4 digits (no padding if >9999)
- **Card layout**: header = title left + card number right; footer = tags left + checklist/emoji right
- **Type indicators**: emoji-based (was colored dots) -- bug=🪳, feature=✨, chore=🔧; displayed bottom-right of card
- **Session status dots**: running = green ping, detached/resumable = orange; "no session" = small gray dot (simplified from previous multi-state design)
- **Tag/area pills redesign**: transparent bg with border-only styling (fills on `group`-hover); JetBrains Mono at 10px; shows first area + overflow count (was first 2), same for tags; uses `group` class on card for coordinated hover effects
- **Checklist progress ring**: size reduced from 16px to 13px, stroke from 2 to 1.5; completed state uses void-400/500 colors (was green); counter uses JetBrains Mono at 10px
- **Compact mode**: `isCompact = stage === 'done'` hides tags/areas row for done-stage cards
- **Stage prop**: `stage?: KanbanStage` now passed to KanbanCardItem from KanbanColumn

### Terminal (`Terminal.tsx`)
- xterm.js + FitAddon + WebLinksAddon; dark #1a1a1a, neon-blue cursor, Menlo 14px
- SSE via ConnectionManager; restore: resize to original dims, write state, fit to current
- Image paste: intercepts Ctrl+V for clipboard images
- **Touch scroll**: manual touch event handling (`touchstart`/`touchmove`/`touchend`) with sub-line accumulator; `touch-none` CSS class on container; `touchmove` calls `e.preventDefault()` to block page scroll
- **Resize debounce**: ResizeObserver-only (removed `window.addEventListener('resize')`); 150ms debounce via `setTimeout` prevents mobile layout feedback loops
- **Cross-tab resize broadcast**: listens for `resize` SSE events from bridge (dimension broadcast when another tab resizes the PTY); adapts local xterm to match new cols/rows; uses `suppressResizePost` flag to prevent ResizeObserver from echoing the resize back to the server; only sends resize POST when tab is visible (`document.visibilityState === 'visible'`)
- **Reconnection UI**: `isReconnecting` state distinct from `isRestoring`; shows amber "Reconnecting..." badge (bottom-right) during reconnection; writes colored status messages to terminal (`Connection lost`, `Reconnected`)

### Claude Terminal Panel (`ClaudeTerminalPanel.tsx`)
- Provider selection updates session name; skipPermissions checkbox
- Actions: MAX_VISIBLE_ACTIONS=6, overflow dropdown; buildPrompt() = context + action
- Controls: Start, Stop, Resume, Relink
- **Neon-blue accent** (was neon-orange): action buttons (`border-neon-blue-400/25`, `bg-neon-blue-400/10`, shadow `rgba(0,191,255,...)`), custom prompt focus border (`focus:border-neon-blue-400`), quick-start buttons
- **Instruction file check**: on provider/cwd change, fetches `GET /bridge/check-instruction-file?provider=...&cwd=...`; if `needed: true`, shows amber warning with checkbox to auto-create the instruction file (e.g. CLAUDE.md) from a fallback source on session start; `createInstructionFile` boolean passed to session creation body
- **Manual detach prevention**: `manuallyDetached` state prevents auto-reconnect after explicit detach; reset when session stops

### Global Claude Panel (`GlobalClaudePanel.tsx`)
- **Neon-blue accent** (was neon-orange gradient): header bg `bg-[#2490b5]` with `.light-clean` suppressing textures; label `font-semibold text-black/80 dark:text-white`
- Global terminal glow: `neon-pulse-global-blue` (neon-blue + white highlight) / `neon-pulse-global-blue-light` (deep steely blue)
- Border glow: `neon-border-left` / `neon-border-left-light` (neon-blue, was neon-orange)
- Tint color: `rgba(0, 191, 255, 0.1)` (was `rgba(255, 140, 0, 0.1)`)
- Status dot: `bg-neon-blue-300` idle (was `bg-neon-orange-300`); status badge uses `text-neon-blue-950 dark:text-white`
- Expanded shadow: `rgba(0,136,179,0.25)` light / `rgba(0,191,255,0.4)` dark
- Voice-aware collapse: checks `voiceState` from `useVoice()` context; won't close on outside-click while recording/transcribing (prevents losing text destination)
- **Mobile full-screen**: expanded panel goes `inset-0 h-svh w-screen` on mobile, `sm:bottom-0 sm:right-4 sm:h-[500px] sm:w-[700px]` on desktop; header/body border-radius removed on mobile (`rounded-none sm:rounded-t-md` / `rounded-none sm:rounded-b-md`)
- **Actions config**: uses `useSlyActionsConfig()` hook (polling) instead of previous SSE stream for config changes

### Automations Screen (`AutomationsScreen.tsx`)
- **Redesigned layout**: max-w-5xl centered container; 2-column grid (was 3-column `md:grid-cols-2 lg:grid-cols-3`)
- **Header**: title + card count + timezone abbreviation badge (fetched from `/api/scheduler` on mount); "New Automation" button with orange accent
- **Card redesign**: horizontal layout with 3 zones -- left (title + schedule), middle (badges + last result), right (countdown + previous run)
  - Left border accent: `border-l-[3px] border-l-orange-500/70` (light) / `dark:border-l-orange-400/60`
  - `automation-chevron` CSS class: repeating filled-polygon SVG chevron arrows fading left-to-right via mask gradient; orange fill light mode (opacity 0.15), white fill dark mode (opacity 0.08)
  - `automation-chevron-muted` variant: opacity 0.02 for disabled cards (CSS-only; not yet applied in components)
  - `hazard-stripe` bottom bar (5px): repeating -45deg diagonal stripes (amber + dark); dark mode uses rgba blends
  - `hazard-stripe-muted` variant: gray stripes at opacity 0.3 (light) / 0.4 (dark) for disabled cards (CSS-only; not yet applied in components)
  - Right zone separated by `border-l border-void-200 dark:border-void-700/50`
- **CountdownTimer redesign**: larger font `text-2xl` (was `text-lg`); idle state shows `--:--` with "idle" label beneath; "NOW" state same size; `tracking-[0.2em]` (was `tracking-widest` on labels)
- **Disabled badge**: red bg (`bg-red-100 text-red-700 / dark:bg-red-900/30 dark:text-red-400`) instead of neutral void; was `bg-void-100 text-void-500`
- **Previous run**: shown below countdown as `text-[10px]` using toLocaleString month/day/hour/minute
- **Tag grouping**: cards grouped by first tag; `<details>` collapsible per group; alphabetical sort with "Ungrouped" last
- **Empty state**: larger icon (h-14 w-14, was h-12); softer colors (`text-void-300 dark:text-void-600`); more vertical padding (py-16, was py-12)
- **Context menu**: `onCardContextMenu` prop wired to right-click on card items
- Imports `cronToHumanReadable` from `@/lib/cron-utils` (extracted utility)

### Sly Action Config Modal (`SlyActionConfigModal.tsx`)
- Voice integration: registers assistant terminal with VoiceContext (`voiceTerminalId="action-assistant"`); `onTerminalReady` wires `registerTerminal`/`unregisterTerminal`
- Terminal context project name: `'SlyCode'` (was `'ClaudeMaster'`)
- Voice-aware dismiss: checks `voice.voiceState` from `useVoice()` context; won't close on outside-click while voice is busy
- Escape key: passes through to terminal uninterrupted when assistant panel is expanded (no longer closes assistant); only navigates back/closes when assistant is collapsed
- **Action updates integration**: accepts `actionUpdateCount` and `onShowActionUpdates` props; renders badge with pending count in header when > 0; clicking badge invokes `onShowActionUpdates` callback to open `ActionUpdatesModal`

### Action Updates Modal (`ActionUpdatesModal.tsx`)
- **New component**: modal for reviewing and accepting action updates from `updates/actions/` into `store/actions/`
- Fetches available updates from `/api/cli-assets/updates` (reads `actionEntries` from response)
- **Per-action operations**: preview (diff viewer), accept (POST to `/api/cli-assets/updates`), dismiss (DELETE with content hash to `.ignored-updates.json`)
- **Accept All**: bulk accept button for multiple pending updates; processes sequentially
- **Diff viewer** (`ActionDiffViewer` subcomponent): inline unified diff generated via `createTwoFilesPatch()` from `diff` library; supports diff/full view toggle; shows `+additions`/`-deletions` stats; metadata chips for changed fields and new classes
- After accepting, invalidates actions cache via `POST /api/sly-actions/invalidate`
- Escape closes diff viewer first (if open), then the modal itself

### Connection Manager (`connection-manager.ts`)
- EventSource pool, exponential backoff (1s-30s, +/-20% jitter)
- Skip HTTP health if EventSource recently active; page visibility reconnect
- **Heartbeat event**: listens for `heartbeat` SSE events to keep `lastConnected` fresh on idle connections; prevents false health check failures on streams with infrequent data
- **Status downgrade grace period**: `STATUS_DOWNGRADE_GRACE_MS` (3s) delays transition from `connected` to `reconnecting`/`disconnected`; absorbs transient blips (page navigation, single connection drop); `scheduleDowngrade()` sets a timeout, cancels if status recovers within window
- **Diagnostic logging**: `cmLog()` enabled via `localStorage.setItem('cm-debug', '1')`; logs connection state transitions, health checks, reconnections with timestamps
- **Selective reconnect**: `reconnectBroken()` only reconnects connections with `readyState !== OPEN`; avoids disrupting healthy streams after health check recovery

### Connection Status Indicator (`ConnectionStatusIndicator.tsx`)
- **New component**: fixed-position toast for global connection status
- **Debounced disconnect**: `TOAST_DEBOUNCE_MS` (2s) suppresses transient blips shorter than threshold; only shows disconnect toast after sustained non-connected state
- **Three visual states**: reconnecting (spinner + "Reconnecting..." + Retry button), disconnected (X icon + "Connection Lost" + Reconnect button), success flash (checkmark + "Connected", auto-dismiss after `minDisplayMs`)
- Uses `useConnectionStatus()` hook (subscribes to `connectionManager.subscribe()`)
- Configurable position: `top-right` | `top-left` | `bottom-right` | `bottom-left`

### Connection Status Hook (`useConnectionStatus.ts`)
- **New hook**: wraps `connectionManager.subscribe()` in React state; returns `{ status, isConnected, isReconnecting, isDisconnected, reconnectAll }`

### Sly Actions Config Hook (`useSlyActionsConfig.ts`)
- **New hook**: replaces SSE-based sly-actions stream with polling (30s interval via `usePolling`)
- Conserves browser HTTP/1.1 connection slots (6 per origin limit); SSE stream was occupying a persistent slot
- Returns normalized `SlyActionsConfig`; initial fetch on mount + periodic poll
- Used by `CardModal`, `GlobalClaudePanel` (replacing previous inline SSE `useEffect`)

### Voice Components
- VoiceControlBar: idle/recording/paused/transcribing/error; timer, controls
- Light mode: recording timer `text-red-600` (was `text-red-400` both modes); transcribing spinner `text-[#2490b5]` (steely blue) in light, `text-neon-blue-400` in dark; transcribing label matches
- VoiceSettingsPopover: configurable shortcuts (Ctrl+., Space, Enter, Shift+Enter, Escape)
- FloatingVoiceWidget: always-visible mic button

### Transcribe API (`api/transcribe/route.ts`)
- **Dual STT backend**: `STT_BACKEND` env var selects backend; `'local'` uses local whisper.cpp, default `'openai'` uses OpenAI Whisper API
- **Local backend**: requires `WHISPER_CLI_PATH` (path to whisper-cli binary) and `WHISPER_MODEL_PATH` (path to .ggml model file); returns 401 if not configured
- **Local pipeline**: writes uploaded audio to temp file, converts to 16kHz mono WAV via `ffmpeg` (30s timeout), runs `whisper-cli` with `--no-timestamps --output-txt` (120s timeout), cleans up temp files in `finally` block
- **Env loading**: `loadEnv()` reads all `[A-Z_]+=` lines from root `.env` file (was `loadEnvKey()` reading only `OPENAI_API_KEY`); caches parsed values; sets `process.env` for keys not already present
- **Audio format detection**: determines extension from MIME type (`mp4`/`ogg`/`webm`); used for both backends

### Health Monitor (`HealthMonitor.tsx`)
- CPU%, Memory, Swap from /api/system-stats; terminal counts from /bridge/stats
- Green (<70%), Amber (70-90%), Critical (>=90%); "Stop All" with confirmation
- **Expand trigger**: click toggle (was hover-with-500ms-delay); click-outside dismiss via `useEffect` + `mousedown` listener
- **Mobile compact view** (`sm:hidden`): single colored status dot (gradient from worst metric via `getThresholdStyles`) + terminal count (`text-[10px] font-mono`) + optional green ping for actively working sessions
- **Desktop full view** (`hidden sm:flex`): full MiniBar components (CPU, MEM, SWP) + terminal icon + count + active indicator with count label

### Search, Feed, Assets
- SearchBar: 2+ chars (300ms debounce) or empty=active sessions; grouped by project/stage
- ActivityFeed: 10 event types (card_created/updated/moved/reordered, problem_added/resolved, skill_deployed/removed/imported, session_started/stopped), 30s poll, grouped by day
- CliAssetsTab: asset matrix, store, updates, assistant; provider tabs; sync queue
- **Updates view** (in CliAssetsTab): third tab alongside "Project Assignment" and "Asset Store"; shows combined skill + action updates from `/api/cli-assets/updates`; per-entry accept, dismiss, and push-to-projects (bulk deploy accepted asset to all projects where it's installed, across all providers)
- **Skill import preview dialog** (`ImportDialog` in CliAssetsTab.tsx): shown when importing a skill to the store; fetches file listing from `/api/cli-assets/store/preview` (new endpoint); displays files with SKILL.md highlighted; offers two import modes:
  - "SKILL.md only" (`skillMainOnly: true`): imports just the skill definition file, leaves supporting files unchanged
  - "Full folder" (`skillMainOnly: false`): imports all files, overwrites existing store copies
  - Non-skill asset types (agents) skip the dialog and import directly (single file, no ambiguity)
  - Dialog shows file count, warns about supporting files being potentially project-specific (e.g. context-priming area references)
- **Store import API** (`/api/cli-assets/store` POST): accepts `skillMainOnly` boolean parameter; passed through to `importAssetToStore()` as `{ skillMainOnly }` options
- **Store preview API** (`/api/cli-assets/store/preview` GET): new endpoint; params: `provider`, `assetType`, `assetName`, `sourceProjectId`; returns `{ files: string[], isDirectory: boolean }` with recursive file listing for skills or single filename for agents

### Automation Config (`AutomationConfig.tsx`)
- Frequencies: hourly, daily, weekly, monthly, interval (wrap-around overnight), one-shot
- Bidirectional cron parsing; enumerateIntervalHours for overnight wrap
- Imports `cronToHumanReadable` from `@/lib/cron-utils` (extracted, was inline)
- Fetches timezone abbreviation from `/api/scheduler` on mount; displays after one-shot time picker and in human-readable preview
- **Server-side nextRun**: `refreshNextRun()` calls `/api/scheduler` POST with `action: 'nextRun'` to compute next run server-side (was client-side `getNextRunISO` from cron-utils); triggered on schedule change, schedule type toggle, advanced cron edit, and enable toggle; clears `nextRun` optimistically then sets from server response
- Run Now button: POST to `/api/scheduler` with `action: 'trigger'`, `cardId`, `projectId`; visual feedback (success=green, error=red, 3s auto-clear)

### Scheduler (`scheduler.ts`)
- Web-side scheduler module; see Section 3 "Automation Cards" and "Timezone Handling" for full behavioral details
- 30s check interval; dual-path detection (fresh: 20s liveness check; resume: 10s startup + 5s activity check + 3s retry); refire guard
- **HMR-safe state**: scheduler state and timer stored on `globalThis` via `GLOBAL_KEY`/`TIMER_KEY` to survive hot module reloads; prevents duplicate intervals from old HMR versions running concurrently; `startScheduler()` always clears existing interval before creating new one
- **No per-tick nextRun writes**: removed periodic `nextRun` recalculation from `checkAutomations()` loop; nextRun is now computed dynamically by the kanban GET API and on-demand via `getNextRun()` export (eliminates unnecessary kanban.json writes every 30s)
- `fetchWithTimeout()`: wraps all bridge HTTP calls with 10s AbortController timeout (prevents hung bridge from blocking indefinitely)
- **Parent env loading**: `loadParentEnv()` reads `.env` from slycode root (via `getSlycodeRoot()`) at module init; Next.js only auto-loads `web/.env`, but TZ and BRIDGE_URL live in parent
- Key exports: `getConfiguredTimezone()`, `getNextRun()`, `buildRunHeader()`, `formatDateTime()`, `formatRelativeTime()`, `checkSessionAlive()`, `waitForActivity()`

### Cron Utils (`cron-utils.ts`)
- Extracted shared utility; consumed by AutomationsScreen, AutomationConfig (display only; nextRun moved server-side)
- No longer exports `getNextRunISO()` (removed; `croner` dependency removed from client-side cron-utils)
- See Section 3 "Cron Utils" for full pattern details

### Action Scanner (`action-scanner.ts`)
- **Server-side action file parser**: reads `.md` files from `store/actions/` with YAML frontmatter; fields: name, version, label, description, group, placement, scope, projects, cardTypes, classes (priority map)
- **Config assembly**: `buildActionsConfig()` builds `SlyActionsConfig` from parsed actions; `assembleClassAssignments()` groups actions by class, sorted by priority (ascending), ties alphabetical
- **Caching**: `CACHE_MAX_AGE_MS` = 30s; `invalidateActionsCache()` called after writes, update accepts, and via `/api/sly-actions/invalidate` endpoint
- **Write support**: `serializeActionFile()` produces frontmatter+body; `writeActionsFromConfig()` syncs individual files, removes orphaned files, reconstructs classes from classAssignments
- **Update scanning**: `scanActionUpdates()` compares `updates/actions/` vs `store/actions/` using SHA-256 content hashing; detects field-level changes (prompt, label, description, placement, group) and new classes; auto-records identical hashes to `.ignored-updates.json`
- **Update acceptance**: `acceptActionUpdate()` performs additive class merge (keeps user's classes/priorities, adds new upstream classes); creates backup in `store/.backups/actions/`; records upstream hash to prevent resurface

### API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/kanban?projectId= | GET | Fetch board (computes nextRun server-side for enabled automation cards) |
| /api/kanban | POST | Save (tiered backups) |
| /api/kanban/stream | SSE | Watch changes |
| /api/bridge/[...path] | * | Proxy bridge |
| /api/bridge/stats | GET | Session counts |
| /api/dashboard | GET | Projects + counts (includes all active sessions) |
| /api/search | GET | Card search / active |
| /api/events | GET | Activity log |
| /api/system-stats | GET | CPU/memory/swap |
| /api/cli-assets | GET | Asset matrix |
| /api/cli-assets/import | POST | Import asset from project to workspace |
| /api/cli-assets/sync | POST | Deploy/remove (with fullSkillFolder option) |
| /api/cli-assets/store | GET/POST | Store contents / import (with skillMainOnly option) |
| /api/cli-assets/store/preview | GET | Preview skill files before import |
| /api/cli-assets/updates | GET/POST/DELETE | Scan updates (skills+actions) / accept / dismiss |
| /api/sly-actions | GET | Commands config (assembled from action files) |
| /api/sly-actions/invalidate | POST | Invalidate server-side actions config cache |
| /api/sly-actions/stream | SSE | Watch changes (retained but consumers moved to polling) |
| /api/providers | GET/PUT | Provider configs |
| /api/projects | GET/POST | List/add |
| /api/projects/[id] | GET/PUT/DELETE | CRUD |
| /api/projects/reorder | POST | Reorder |
| /api/file | POST/GET | Upload (images) / read file content |
| /api/transcribe | POST | Whisper STT (OpenAI API or local whisper.cpp backend via STT_BACKEND env) |
| /api/settings | GET/PUT | Preferences |
| /api/areas | GET | Context-priming areas |
| /api/terminal-classes | GET | Terminal classes |
| /api/git-status | GET | Uncommitted counts per project |
| /api/scheduler | GET | Scheduler status + timezone (auto-starts if stopped) |
| /api/scheduler | POST | Actions: trigger, start, stop, nextRun (compute next run for a schedule) |
| /api/version-check | GET | Installed vs latest version |

### Non-Obvious Logic
1. Drop indicator suppression when source=target
2. Row detection +/-10px tolerance in grid
3. requestAnimationFrame auto-scroll with intensity
4. Terminal restore: resize ORIGINAL -> write state -> fit CURRENT
5. Health check skip if EventSource active
6. Cron wrap: enumerateIntervalHours(18,8,2) -> [18,20,22,0,2,4,6,8] (shared in AutomationConfig; cron-utils handles display)
7. Scheduler parent env: loadParentEnv() reads TZ from root .env so timezone works even when Next.js only sees web/.env
8. Scheduler nextRun: computed server-side in kanban GET API (dynamic, not persisted on every tick); AutomationConfig fetches via `/api/scheduler` POST `action: 'nextRun'` on schedule changes; eliminates 30s write churn to kanban.json
9. Card move detection: searches all stages
10. Trigger cards: "launching" auto-cleared on active
11. Scheduler HMR resilience: state + timer on `globalThis` survives module reloads; `startScheduler()` clears prior interval; writes lastRun before kickoff to survive restarts
12. Voice-aware panel collapse: GlobalClaudePanel and SlyActionConfigModal refuse outside-click dismiss while voice is recording/transcribing
13. SlyActionConfigModal Escape passthrough: Escape goes to terminal when assistant is expanded, navigates back otherwise
14. Terminal touch scroll: xterm's `.xterm-viewport` (scrollable) is a sibling of `.xterm-screen` (canvas), not an ancestor; browser can't find scrollable ancestor from canvas touch target, so touch-to-scroll requires manual `terminal.scrollLines()` via touch events
15. Terminal resize debounce: 150ms timeout in ResizeObserver callback prevents feedback loop where `fitAddon.fit()` triggers layout changes that re-fire the observer on mobile
16. Skill import preview: non-skill types bypass the dialog entirely (single file); skills show file listing so user can choose SKILL.md-only vs full folder import
17. Activity ring includes global terminals: dashboard/route.ts and registry.ts count ALL `isActive` sessions per project group (removed prior `:global` and `:card:` filters) so project cards reflect total terminal activity
18. next.config.ts reads DEV_HOSTNAME from parent `.env` via `getParentEnv()` for `allowedDevOrigins`; dev-only (skipped in production builds to avoid leaking infra); removed hardcoded Tailscale hostname
19. Workspace-agnostic project ID: `asset-scanner.ts`, `kanban-paths.ts`, `cli-assets/*` routes derive workspace project ID from `path.basename(getSlycodeRoot()|getRepoRoot())` instead of hardcoding `'claude-master'`; `kanban-paths.ts` normalizes underscores to hyphens (`replace(/_/g, '-')`) because directory names use `_` but project IDs use `-`
20. Path resolution hardening: `getSlycodeRoot()` in `paths.ts` removed legacy `legacy root env var` env var fallback (now only `SLYCODE_HOME` or cwd-derive); `registry.ts` `getRepoRoot()` mirrors the same simplified resolution; both warn in production if `SLYCODE_HOME` is unset
21. Cross-tab resize broadcast: Terminal.tsx listens for `resize` SSE events; uses `suppressResizePost` flag to prevent echo loop where receiving a broadcast triggers ResizeObserver which would POST resize back to bridge; visibility guard ensures only the active tab sends resize POST
22. Connection status downgrade grace: ConnectionManager delays 3s before transitioning from `connected` to lower states; absorbs transient connection drops (single SSE reconnect, page navigation) that resolve before the user notices
23. SSE-to-polling migration: sly-actions config consumers switched from SSE stream to 30s polling via `useSlyActionsConfig()` hook to conserve scarce HTTP/1.1 connection slots (6 per origin browser limit); SSE stream endpoint retained for backward compatibility
24. Action update acceptance: additive class merge preserves user customizations -- only adds new upstream classes to the store copy; records upstream content hash (not store hash) so class-merged store files don't trigger false future updates
25. Instruction file fallback: ClaudeTerminalPanel checks bridge for missing provider instruction files before session start; offers to auto-create from fallback source (e.g. copy provider template when project lacks CLAUDE.md)
26. Transcribe API env loading: `loadEnv()` reads parent `.env` (via `getSlycodeRoot()`) since Next.js only auto-loads `web/.env`; caches parsed values; STT_BACKEND, WHISPER_CLI_PATH, WHISPER_MODEL_PATH, OPENAI_API_KEY all resolved from this file

### Key Files
| File | Purpose |
|------|---------|
| web/src/components/Dashboard.tsx | Projects, assets, feed, activity ring (all sessions), version display |
| web/src/components/ProjectView.tsx | Layout, refresh wiring |
| web/src/components/ProjectHeader.tsx | Header, refresh, mobile search overlay, action update polling + badge |
| web/src/components/ProjectKanban.tsx | Board, SSE, sessions, forceRefresh, mobile snap scroll |
| web/src/components/ProjectPageClient.tsx | Viewport (h-svh), body scroll lock, global panel |
| web/src/components/CardModal.tsx | 7 tabs, automation, voice, summary badge, mobile full-screen |
| web/src/components/Terminal.tsx | xterm.js, SSE, paste, touch scroll, resize debounce, cross-tab resize broadcast |
| web/src/components/ClaudeTerminalPanel.tsx | Actions (neon-blue), provider, instruction file check |
| web/src/components/GlobalClaudePanel.tsx | Global terminal (neon-blue), voice-aware, mobile full-screen |
| web/src/components/KanbanColumn.tsx | Drag-drop, scroll, light-clean headers, stage prop, beveled columns, mobile snap-start |
| web/src/components/KanbanCardItem.tsx | Priority glow, glassmorphism, card numbers, emoji type, compact mode |
| web/src/components/AutomationsScreen.tsx | Automation cards, tag grouping, chevron/hazard textures |
| web/src/components/SlyActionConfigModal.tsx | Action config, voice integration, action update badge |
| web/src/components/ActionUpdatesModal.tsx | Action update review, diff viewer, accept/dismiss/bulk-accept |
| web/src/components/ConnectionStatusIndicator.tsx | Global connection status toast, debounced disconnect, retry button |
| web/src/components/VoiceControlBar.tsx | Voice UI, light mode steely colors |
| web/src/components/HealthMonitor.tsx | Stats, stop-all, mobile compact dot, click-to-expand |
| web/src/components/CliAssetsTab.tsx | Asset matrix, store, updates view, skill import preview dialog |
| web/src/components/AutomationConfig.tsx | Cron builder |
| web/src/hooks/useSlyActionsConfig.ts | Polling-based actions config hook (replaces SSE stream) |
| web/src/hooks/useConnectionStatus.ts | React hook wrapping ConnectionManager subscription |
| web/src/lib/scheduler.ts | Automation scheduler, refire guard, parent env loading, timezone, rich run headers |
| web/src/lib/cron-utils.ts | Shared cron-to-human-readable (UI + scheduler) |
| web/src/lib/registry.ts | Dashboard data loader, activity ring counting (all active sessions), workspace-agnostic root |
| web/src/lib/paths.ts | `getSlycodeRoot()`, `getPackageDir()`, `getProjectsDir()` path resolution |
| web/src/lib/kanban-paths.ts | Kanban file resolution, workspace ID normalization (underscore-to-hyphen) |
| web/src/lib/asset-scanner.ts | Asset scanning, version comparison, deploy/import, workspace-agnostic project ID |
| web/src/lib/action-scanner.ts | Action file parser, config assembly, cache, update scanning, additive class merge |
| web/src/lib/connection-manager.ts | EventSource pool, heartbeat tracking, downgrade grace, diagnostic logging |
| web/src/lib/sly-actions.ts | Actions, templates |
| web/src/lib/types.ts | TypeScript interfaces (KanbanCard.number) |
| web/src/app/api/dashboard/route.ts | Dashboard API, bridge session counting (all active sessions) |
| web/src/app/api/scheduler/route.ts | Scheduler API: status + timezone + manual trigger |
| web/src/app/api/cli-assets/store/route.ts | Store import with skillMainOnly option |
| web/src/app/api/cli-assets/store/preview/route.ts | Skill file listing preview for import dialog |
| web/src/app/api/cli-assets/updates/route.ts | Unified updates API: skills + actions scan, accept, dismiss |
| web/src/app/api/transcribe/route.ts | Whisper STT: dual backend (OpenAI API / local whisper.cpp), env loading |
| web/src/app/api/sly-actions/invalidate/route.ts | Actions config cache invalidation |
| web/src/app/globals.css | Tokens, colors, priority-based glow keyframes, lane texture, automation textures |
| web/src/app/layout.tsx | Font loading (Geist Sans, Geist Mono, JetBrains Mono) |
| web/next.config.ts | Standalone output, Turbopack config, DEV_HOSTNAME from parent .env for allowedDevOrigins, webpack watch exclusions |

---

## 3. Kanban System & Automation

### Card Lifecycle
- Stages: backlog -> design -> implementation -> testing -> done
- Move: updates order (maxOrder + 10 in target)
- Archive: soft-delete; `search --archived` or `--include-archived`
- Batch: `kanban archive --all [--before <days>]`
- Archive does NOT bump updated_at (status change, not content change)
- **Archive guard**: automation cards cannot be archived (CLI rejects + web UI prevents)
- **Automation guard**: automation cannot be enabled on archived cards

### Card Numbers
- Sequential `number` field (integer) assigned on creation, starting from 1; never reused
- `nextCardNumber` counter stored at kanban.json root level
- **Backfill** (`backfillCardNumbers(kanban)`): sorts all cards (including archived) by `created_at` ascending
  - First pass: finds highest existing `number` among all cards
  - If no cards have numbers: assigns 1, 2, 3... to all cards sorted by `created_at`
  - If some cards already have numbers: only unnumbered cards get numbers starting from `maxNumber + 1`
  - Sets `kanban.nextCardNumber` on the kanban object after assignment
- **Auto-migration**: `ensureCardNumbers(kanban)` calls `backfillCardNumbers` if `kanban.nextCardNumber == null`; runs transparently on first use
- **Creation flow**: `cmdCreate()` calls `ensureCardNumbers(kanban)` before creating, assigns `kanban.nextCardNumber` to new card, increments counter
- Numbers are stable -- once assigned, they never change
- **CLI display**: verbose `formatCard()` shows `(#0001)` after card ID; zero-padded to 4 digits, no padding if >9999
- **Web UI display**: `#0001` in JetBrains Mono, top-right of card header next to session dot

### Card Metadata
- Types: feature, chore, bug
- Priorities: critical, high, medium, low
- Areas: from context-priming; Tags: freeform
- Order: gaps of 10; last_modified_by: cli|web|agent
- Operations that don't bump updated_at: reorder, archive, automation bookkeeping (lastRun/nextRun/lastResult)
- Document refs: design_ref, feature_ref, test_ref (shown as CardModal tabs)

### Checklists
- ChecklistItem: {id: "check-{ts}", text, done}; actions: add, toggle, remove, list

### Problems
- Problem: {id: "prob-{ts}", description, severity: minor|major|critical, created_at, resolved_at?, promoted_to?}
- Promote: severity->priority (critical->high, major->medium, minor->low); inherits areas

### Agent Notes (Scalable)
- AgentNote: {id: sequential, agent?, text (max 3000), timestamp, summary?, summarizedCount?, dateRange?}
- **Thresholds**: soft suggestion at 30 notes (`NOTES_SUGGEST_THRESHOLD`), hard cap at 100 notes (`MAX_NOTES_PER_CARD`)
  - `add` succeeds up to 100; prints summarization suggestion to stdout when count >= 30; fails at 100 with error + remediation instructions
  - Suggestion message includes: count, hard cap, `oldest` command, `summarize` command, tips for good summaries (preserve decisions, compress routine updates)
- **Actions**: add, list, oldest, summarize, search, edit, delete, clear
- **`oldest [N]`**: outputs oldest N notes (default 20); designed for agent consumption before summarizing
- **`summarize "text" [--count N]`**: replaces oldest N notes (default 20) with a single summary note
  - Summary note: `{summary: true, summarizedCount, dateRange: "YYYY-MM-DD to YYYY-MM-DD"}`
  - Summary prepended to remaining notes; original summarized notes removed
  - Accepts `--agent` flag for attribution
- **Recursive summarization**: summary notes can be consumed by later `summarize` calls; LLM naturally incorporates prior summaries
- **Agent workflow**: (1) add note -> suggestion printed if count >= 30, (2) `oldest 20` to read old notes, (3) `summarize "..." --count 20` to compact
- **`list` footer**: shows `{count} notes (summarize suggested at 30, hard cap 100)` for passive agent awareness
- **`list` and `oldest` display**: `[Summary]` tag on summary notes
- Web UI: summary notes display a "Summary" badge on the Notes tab

### Reordering
- Full: `reorder <stage> <ids>` -> 10, 20, 30...; Positional: --top, --bottom, --position
- Does NOT bump updated_at

### Search
- Full-text (title|description), --stage, --type, --area, --limit (100)
- **Automation visibility**: bare search (no query) excludes automation cards; search with a text query includes them
- Automation cards display `automation` in the Stage column instead of their actual stage (backlog etc.)
- Design ref: `documentation/designs/kanban_search_include_automations.md`

### Events
- events.json: max 500, auto-purge; types: card_created/updated/moved/reordered, problem_added/resolved, skill_deployed/removed/imported, session_started/stopped
- Non-blocking (try-catch)
- **Dynamic project name**: `PROJECT_NAME = path.basename(PROJECT_ROOT)` replaces hardcoded `'claude-master'` in all `emitEvent()` calls and automation session names; workspace-agnostic

### Backups
- Tiered: hourly (3), daily (3), weekly (3) in documentation/archive/
- Empty board protection: refuses to save if would delete all cards

### Merge Logic
- POST with changedCardIds[]: merge (only listed); without: full replace

### Automation Cards
- Card with .automation config; description = prompt
- Scheduler: 30s check interval; all bridge HTTP calls wrapped in `fetchWithTimeout()` (10s AbortController timeout)
- Create: `--automation` flag; configure: `--schedule --provider --fresh-session --working-dir --report-messaging`
- Schedule: cron (recurring) or ISO (one-shot, auto-disables)
- **Dual-path activity detection** (fresh vs resume):
  - **Fresh session** (`freshSession: true`): prompt delivered via CLI args (OS-level guarantee). Uses `checkSessionAlive()` — waits 20s then checks session status. Returns success if running/unknown, fails only if stopped (crash/auth error). No retry needed.
  - **Resume session** (`freshSession: false`): prompt pasted into existing terminal via bracketed paste (unreliable delivery). Uses `waitForActivity()` — waits 10s startup, takes 2 readings 5s apart checking for new output. If no activity, retries via bracketed paste (paste + 200ms + Enter).
- reportViaMessaging: appends sly-messaging instruction
- State: lastRun, lastResult, nextRun (don't bump updated_at)
- Refire guard: lastRun written to kanban.json BEFORE kickoff (not after), so HMR/server restarts during the kickoff window cannot re-fire; in-memory activeKickoffs set provides secondary guard within a single process lifetime
- isDue: recurring uses croner nextRun(lastRun || now-24h) with configured timezone; one-shot compares ISO target <= now
- Auto-start: getSchedulerStatus() auto-starts scheduler if not running (handles dev HMR)
- **HMR dedup**: scheduler state (`running`, `lastCheck`, `activeKickoffs`) and timer stored on `globalThis` keys (`__scheduler_state__`, `__scheduler_timer__`) to survive HMR reloads; `startScheduler()` clears any existing interval before creating a new one — prevents duplicate schedulers fighting over kanban.json writes
- **nextRun calculated server-side**: `getNextRun()` exported from scheduler.ts; `GET /api/kanban` computes nextRun dynamically for all enabled recurring cards before returning the board; scheduler API `POST {action:'nextRun'}` endpoint for on-demand calculation; CLI `enable` and scheduler `checkAutomations()` no longer write nextRun themselves (single source of truth for timezone)
- Error notification: filtered by severity — hard failures (session crashed, bridge HTTP error, input failed, no config) send sly-messaging alert; soft failures (detection uncertainty) log only, no notification
- 409 handling: only attempts input-endpoint fallback for resume sessions (not fresh)

### Automation Prompt Context
- Prompt includes a structured `=== AUTOMATION RUN ===` header block before card metadata
- Header fields: Time (human-friendly with TZ), Card (title + id), Trigger (scheduled/manual), Last run (absolute + relative or "never")
- `buildRunHeader()`: assembles the header block using `formatDateTime()`, `cronToHumanReadable()`, `formatRelativeTime()`
- Trigger source: `triggerAutomation()` accepts `TriggerOptions { trigger: 'scheduled' | 'manual' }`
  - `checkAutomations()` passes `trigger: 'scheduled'`; scheduler API route passes `trigger: 'manual'` for "Run Now"
- Scheduled trigger line includes human-readable schedule (e.g. "daily at 6:00") via `cronToHumanReadable()`
- Last run: absolute datetime with TZ + relative duration (e.g. "20h 30m ago"); "never" if first run
- `formatRelativeTime()`: days/hours/minutes/just now format
- Full prompt structure: run header -> areas -> tags -> pending checklist -> `---` -> card description -> optional messaging instruction

### Timezone Handling
- **Config**: `process.env.TZ` read at module load via `loadParentEnv()`; falls back to `'UTC'` if unset
- **Croner integration**: all `new Cron(schedule, { timezone: CONFIGURED_TIMEZONE })` calls use configured TZ explicitly
- **`getConfiguredTimezone()`**: returns `{ timezone: string, abbreviation: string }` using `Intl.DateTimeFormat` to derive abbreviation; exported for scheduler API
- **Scheduler API GET**: returns timezone + abbreviation alongside scheduler status
- **`formatDateTime()`**: formats dates in configured TZ using `toLocaleDateString`/`toLocaleTimeString` with explicit `timeZone` option; appends abbreviation
- **UI labels**: AutomationsScreen and AutomationConfig fetch timezone abbreviation from `/api/scheduler` and display it next to schedule descriptions
- **`cronToHumanReadable()`** accepts optional `timezoneAbbr` param; appends e.g. `(AEST)` to time-based descriptions
- **.env**: `TZ=Australia/Melbourne` (or any IANA string); Next.js loads parent .env via `loadParentEnv()` in scheduler

### Cron Utils (`cron-utils.ts`)
- **Extracted** from duplicated code in AutomationsScreen.tsx and AutomationConfig.tsx into shared `web/src/lib/cron-utils.ts`
- **`cronToHumanReadable(cron, scheduleType, fallback?, timezoneAbbr?)`**: converts cron or ISO to human text
- Consumers: AutomationsScreen, AutomationConfig, scheduler.ts (`buildRunHeader`)
- Patterns detected:
  - One-shot: ISO date -> `Once on {date} at {time} (TZ)`
  - Interval range/step: `0 9-20/2 * * *` -> `Every 2h from 09:00 to 20:00 (TZ)`
  - Interval comma (overnight wrap): `0 18,20,22,0,2,4,6,8 * * *` -> `Every 2h from 18:00 to 08:00 (TZ)`
  - Hourly: `* * *` -> `Every hour at :MM (TZ)`
  - Daily: `M H * * *` -> `Daily at H:MM (TZ)`
  - Weekly: `M H * * D` -> `Weekly on {days} at H:MM (TZ)`
  - Monthly: `M H D * *` -> `Monthly on day D at H:MM (TZ)`
  - Fallback: raw cron string if no pattern matches

### CLI Commands
| Command | Flags |
|---------|-------|
| search | [query] --stage --type --area --limit --archived |
| show | <id> |
| create | --title --description --type --priority --stage --areas --automation |
| update | <id> --title --description --priority --areas --tags --design-ref --feature-ref --test-ref |
| move | <id> <stage> |
| reorder | <stage> [ids] --top --bottom --position |
| archive | <id> or --all [--before] |
| board | --all --stages --inflight --compact |
| checklist | <id> list|add|toggle|remove |
| problem | <id> list|add|resolve|promote --severity |
| notes | <id> list|add|oldest|summarize|search|edit|delete|clear --agent --count |
| automation configure | <id> --schedule --provider --fresh-session --working-dir --report-messaging |
| automation enable/disable | <id> |
| automation run | <id> |
| automation list | [--tag] |

### Card Visual Polish (Web UI)
- **Priority colors**: critical `#ff1744`, high `#ff9100`, medium `#00bfff`, low `#00c853`; left border + inset glow on hover (inner shadow + outer spill via `hoverGlow` class)
- **Priority-matched active glow**: `--glow-color` CSS var set inline per card from priority; `active-glow-card` keyframes use `rgba(var(--glow-color), ...)` instead of hardcoded blue
- **Glassmorphism**: `backdrop-blur-lg bg-white/55 dark:bg-[#20232a]/55`; top glass border (`border-t-white/50 dark:border-t-white/10`); `before:` pseudo-element for light-catch on priority edge
- **Session dot consolidation**: single dot -- green ping (running/activelyWorking), orange (detached/resumable), gray (none); dark mode `drop-shadow` neon glow; type indicator dot removed
- **Type emoji badge**: bottom-right per card -- bug, feature, chore; visible in all columns including done
- **Ghost tags**: JetBrains Mono `text-[10px]`, transparent bg at rest, fill on `group-hover`; area chips limited to 1 visible + overflow count (was 2)
- **Done-column compact mode**: `stage` prop threaded from KanbanColumn; `isCompact = stage === 'done'` hides area/tag chips, keeps title + number + dot + checklist + emoji
- Feature ref: `documentation/features/044_kanban_card_visual_polish.md`

### Per-Card Provider Selection (Messaging)
- **Status**: implemented in messaging; design doc + feature spec available
- **Problem**: `/provider` in Telegram sets a global `selectedProvider` — switching provider on Card A carries over to Card B
- **Solution**: on card switch, derive provider from bridge sessions (most recently active session for that card), fall back to `providers.json` stage default, then global default — matches web UI resolution order
- **Provider resolution order**: (1) bridge session for card (by `lastActive`), (2) `defaults.stages[stage]` from providers.json, (3) `defaults.global` from providers.json
- **`/provider` command**: single message showing current provider + 2 non-selected provider buttons stacked vertically
- **Default inheritance**: changing provider on a card using an inherited default also updates the global default in providers.json; card with explicit session only updates card-scoped selection
- **Card info display**: provider shown on its own line in card switch info box — `Provider: Codex` or `Provider: Claude (default)` when inherited
- **Automation cards**: bypass per-card provider lookup — use their own `card.automation.provider` from automation config
- **All switch paths**: `sw_card_`, `sw_proj_`, `sw_global`, `/global`, `/project`, `/search` quick-card — all restore provider
- **Shared config**: `data/providers.json` stores stage/global defaults, shared between web UI and messaging (messaging reads, may update global default)
- Design ref: `documentation/designs/per_card_provider_selection.md`
- Feature ref: `documentation/features/049_per_card_provider_selection.md`

### Schema
```
KanbanBoard root {
  stages: { [stage]: KanbanCard[] },
  nextCardNumber: number  // sequential counter, auto-backfilled on first load
}
KanbanCard {
  id, number?, title, description, type, priority, order, areas[], tags[],
  problems[], checklist[], agentNotes[] (hard cap 100, suggest summarize at 30),
  design_ref?, feature_ref?, test_ref?, automation?,
  archived?, created_at, updated_at, last_modified_by?
}
AgentNote {
  id (sequential), agent?, text (max 3000), timestamp,
  summary?, summarizedCount?, dateRange?
}
AutomationConfig {
  enabled, schedule, scheduleType: recurring|one-shot, provider,
  freshSession, reportViaMessaging, workingDirectory?,
  lastRun?, lastResult?, nextRun?
}
```

### Key Files
| File | Purpose |
|------|---------|
| scripts/kanban.js | CLI: all operations, card numbering (backfill + assign) |
| documentation/kanban.json | Board state (includes nextCardNumber counter) |
| documentation/events.json | Activity log |
| web/src/lib/scheduler.ts | Scheduler: dual-path detection, timezone, prompt context, refire guard, HMR-safe globalThis state, exported getNextRun() |
| documentation/designs/automation_activity_detection.md | Design doc: fresh vs resume activity detection |
| documentation/features/046_fix_automation_activity_detection.md | Feature spec: 4-phase implementation plan |
| web/src/lib/cron-utils.ts | Shared cron-to-human-readable (UI + scheduler) |
| web/src/lib/types.ts | KanbanCard interface (number? field) |
| web/src/components/KanbanCardItem.tsx | Card rendering: visual polish, numbers, compact mode |
| web/src/app/api/kanban/route.ts | API: backups, merge, dynamic nextRun computation on GET |
| web/src/app/api/scheduler/route.ts | Scheduler API: status + timezone + manual trigger + nextRun calculation |
| data/providers.json | Provider definitions + stage/global defaults (shared web UI + messaging) |
| documentation/designs/kanban_search_include_automations.md | Search automation inclusion design |
| documentation/designs/per_card_provider_selection.md | Design: per-card provider scoping in messaging |
| documentation/features/049_per_card_provider_selection.md | Feature spec: per-card provider selection implementation plan |

---


## 4. Terminal Bridge

### Overview
- Express + WebSocket server for PTY sessions
- Provider-agnostic: Claude, Codex, Gemini
- Localhost-only, command whitelist, CWD validation
- Logging: verbose session detection, client connect/disconnect (SSE +/- logs with counts), and heartbeat timeout logs removed; error catch blocks use empty catch (no logging) for routine client disconnects

### Session States
- creating (being set up, no PTY yet), running (clients connected), detached (no clients), stopped (exited/killed)
- `creating` acts as a per-name mutex: synchronous Map insert before any async work blocks concurrent `createSession()` calls

### Creation
- Validates: CWD, command whitelist, max 50 sessions
- Resolves provider; checks existing (reuse or fresh=true or creating=return 202)
- Inserts `creating` placeholder into sessions Map synchronously (mutex)
  - Placeholder fields: `command: ''`, `args: []`, `pid: null`, `headlessTerminal: null`, `serializeAddon: null`, `idleTimeout: null`, `claudeSessionId: null`, `status: 'creating'`
- All async work (provider resolution, PTY spawn, detection) runs inside try/catch
- On failure: `creating` placeholder removed from Map (`sessions.delete(name)`, no orphan entries)
- **Instruction file fallback**: if `createInstructionFile: true` in request, calls `ensureInstructionFile()` before spawn (opt-in only, not auto-create)
- buildProviderCommand(): permission, resume, prompt per provider
- Spawns PTY: SLYCODE_SESSION env, xterm-256color, 80x24
- Replaces `creating` placeholder with fully initialized `running` session (atomic swap)
- Headless terminal + serialize addon for state
- Async session ID detection (fire-and-forget, cancellable via `guidDetectionCancelled`)
- Name: `{group}:{provider}:{context}:{id}` (legacy fallback strips provider); group derived from `PROJECT_NAME` (dynamic, not hardcoded)
- Idempotent: duplicate POST for same name returns HTTP 202 (Accepted) with in-progress info; new creation returns 200

### Instruction File Fallback
- Each provider in `providers.json` declares `instructionFile` (primary) and optional `altInstructionFile` (provider-specific alternate)
  - Claude: `CLAUDE.md`
  - Codex: `AGENTS.md` (primary), `CODEX.md` (alt)
  - Gemini: `AGENTS.md` (primary), `GEMINI.md` (alt)
- `checkInstructionFile(providerId, cwd)`: detection order:
  1. Primary file exists -> no action
  2. Alt file exists -> no action (provider has its own)
  3. Any other instruction file found (priority: CLAUDE.md, AGENTS.md, CODEX.md, GEMINI.md) -> return `{ needed: true, targetFile, copySource }`
  4. No instruction files at all -> no action (nothing to copy from)
- `ensureInstructionFile()`: copies sibling instruction file to target; never throws (logs warnings); returns `{ created, targetFile?, copiedFrom? }`
- API check endpoint: `GET /api/check-instruction-file?provider=X&cwd=Y` -- frontend can query before session creation to prompt user
- Bridge-side: only creates when `createInstructionFile: true` in `CreateSessionRequest`

### Output & Activity
- Routes to: headless terminal, WS clients, SSE clients
- Activity: strips ANSI; visible content triggers burst (gap <= 2s)
- Active if: output in 2s AND burst >= 1s
- Transitions: max 50/session with hex dump

### Resumption
- Claude/Gemini: --resume [guid] (flag)
- Codex: codex resume [guid] [--last] (subcommand)
- Bracketed paste for prompt into running session

### Idle Timeout
- 4h default, checked every 60s, detached only
- 5s grace after client disconnect

### Stopping Sessions
- `stopSession()` handles `creating` status separately: sets status to `stopped`, marks `guidDetectionCancelled = true`, deletes from sessions Map
- No PTY kill needed for `creating` sessions (no PTY exists yet)
- `stopAllSessions()` includes `creating` in its status filter alongside `running`/`detached`
- On stop: session deleted from in-memory `sessions` Map to free the slot; session data preserved in `persistedState` for future resume; `getSessionInfo()` falls back to `persistedState` when not in the Map
- `hasHistory` in session info: true only when `claudeSessionId` exists (not just persisted state presence) — sessions that never detected a GUID show `hasHistory: false`

### Provider Session Detection
| Provider | Dir | Resume |
|----------|-----|--------|
| Claude | ~/.claude/projects/-{cwd}/ (path chars `/ _ \ :` → `-`) | --resume {guid} |
| Codex | ~/.codex/sessions/YYYY/MM/DD/ | codex resume {guid} |
| Gemini | ~/.gemini/tmp/{SHA256}/chats/ | --resume |
- Before/after file list; poll 200ms; live `getClaimedGuids()` check per iteration
- `watchForUnclaimedSession(sessionName, ...)` receives session name (not a stale Set snapshot)
- `guidDetectionCancelled` flag on Session: checked each poll iteration; if true, watcher exits early and resolves null
- `detectProviderSessionId()` and `retryGuidDetection()` also check the flag before claiming
- See Race Condition Mitigations table below for full concurrent detection/cancellation guarantees

### Streaming
- WebSocket: /sessions/{name}/terminal; ping 30s, pong timeout 60s
- SSE: /sessions/{name}/stream; 500-line scrollback restore; heartbeat every 15s as named `event: heartbeat` with `data: {}` (was SSE comment; now dispatched to JavaScript EventSource handlers to keep lastConnected fresh); dead clients pruned on write error (with count logging)
- Resize broadcast: `resizeSession()` sends `event: resize` with `{ cols, rows }` to all SSE clients so other tabs can adapt their terminal dimensions
- Messages: input, resize (10-500 cols, 5-200 rows), signal (INT/TERM/HUP/KILL)

### Image Delivery
- POST /sessions/{name}/image (multipart, 10MB)
- screenshots/screenshot_{ts}.{ext}; max 10 retained; auto .gitignore

### Security
- Localhost binding; command whitelist (bridge-config.json)
- CWD: absolute, exists, readable+executable
- Session name: ^[a-zA-Z0-9:_-]+$; CORS origins: `localhost:${webPort}` + `127.0.0.1:${webPort}` (both fully dynamic from `WEB_PORT` env); signal whitelist

### Persistence
- bridge-sessions.json: atomic (temp+rename); claudeSessionId, cwd, createdAt, lastActive, provider, skipPermissions

### API
| Endpoint | Method | Purpose |
|----------|--------|---------|
| /health | GET | Uptime |
| /api/sessions | POST/GET | Create (200 or 202)/list |
| /api/sessions/{name} | GET/DELETE | Info (returns null if not found)/stop |
| /api/sessions/{name}/stream | GET | SSE (heartbeat + resize events) |
| /api/sessions/{name}/input | POST | Input |
| /api/sessions/{name}/resize | POST | Resize (broadcasts to SSE clients) |
| /api/sessions/{name}/image | POST | Screenshot |
| /api/sessions/{name}/action | POST | compact/clear/interrupt |
| /api/sessions/{name}/stop | POST | Escape key |
| /api/sessions/{name}/relink | POST | Re-detect ID |
| /api/groups/{group}/status | GET | Group |
| /api/stats | GET | Stats |
| /api/activity-log/{name} | GET | Transitions |
| /api/sessions/stop-all | POST | Stop all |
| /api/check-instruction-file | GET | Check if provider instruction file needed |

- POST /api/sessions returns 200 for new sessions, 202 for idempotent duplicate (session already `creating`)
- GET /api/sessions/{name} returns `null` (not 404) when session not found

### Race Condition Mitigations
| Race | Mitigation |
|------|------------|
| Concurrent createSession() for same name | `creating` status as synchronous Map mutex; second call returns 202 |
| Two GUID watchers claim same session file | Live `getClaimedGuids()` per poll iteration; synchronous check-then-claim |
| Session stops before GUID detection completes | `guidDetectionCancelled` flag; watcher exits early, discards late GUIDs |
| Start-then-immediate-Stop | `creating` session in Map; `stopSession()` finds and cleans it up |
| Multi-tab/multi-client duplicate POST | 202 idempotency; bridge-side, no frontend changes needed |
| `retryGuidDetection()` stale snapshot | Same live check + cancellation guard as primary detection |

- Design doc: `documentation/designs/terminal_session_race_conditions.md`

### Provider Configuration (providers.json)
| Field | Purpose |
|-------|---------|
| `instructionFile` | Primary instruction file name (e.g. `CLAUDE.md`, `AGENTS.md`) |
| `altInstructionFile` | Provider-specific alternate (e.g. `CODEX.md`, `GEMINI.md`) |
| `permissions.flag` | CLI flag for skip-permissions mode |
| `resume.type` | `flag` (Claude/Gemini) or `subcommand` (Codex) |
| `prompt.type` | `positional` (Claude/Codex) or `flag` with `-i`/`-p` (Gemini) |
- Cached in memory with 30s TTL; loaded from `data/providers.json`
- Defaults: per-stage provider assignment (backlog/design/done -> claude; implementation/testing -> codex)

### Constants
| Constant | Value |
|----------|-------|
| IDLE_CHECK_INTERVAL | 60s |
| SSE_HEARTBEAT_INTERVAL_MS | 15s |
| DETACH_GRACE_PERIOD | 5s |
| ACTIVITY_THRESHOLD_MS | 2s |
| ACTIVITY_DEBOUNCE_MS | 1s |
| PING_INTERVAL | 30s |
| PONG_TIMEOUT | 60s |
| DEFAULT_IDLE_TIMEOUT | 4h |
| MAX_SESSIONS | 50 |
| MAX_SCREENSHOTS | 10 |
| PROVIDER_CACHE_TTL | 30s |

### Key Files
| File | Purpose |
|------|---------|
| bridge/src/session-manager.ts | Lifecycle, activity, resize broadcast, race condition guards |
| bridge/src/api.ts | Routes, 202 idempotency, instruction file check endpoint |
| bridge/src/types.ts | Session type, `creating` status, `guidDetectionCancelled` flag, `createInstructionFile` request field |
| bridge/src/websocket.ts | WS heartbeat |
| bridge/src/pty-handler.ts | PTY ops |
| bridge/src/provider-utils.ts | Command building, instruction file check/ensure, provider config cache |
| bridge/src/claude-utils.ts | Session detection, Claude project dir path transformation (cross-platform) |
| bridge/src/screenshot-utils.ts | Image handling |
| data/providers.json | Provider definitions (commands, flags, instruction files, defaults) |

---

## 5. Messaging System

### Channel Abstraction
- Interface: onText/onVoice/onPhoto/onCommand/onCallback
- sendText (Markdown), sendTextRaw, sendVoice, sendInlineKeyboard, setPersistentKeyboard
- TelegramChannel: long polling, single authorized user (TELEGRAM_USER_ID)

### Message Flow
- Text: authorize -> route -> format -> instructionFilePreFlight -> bridge.sendMessage -> watchActivity
- Voice: OGG -> STT (OpenAI Whisper API or local whisper.cpp) -> text with [Telegram/Voice] header -> instructionFilePreFlight -> bridge
- Photo: batch by media_group_id (2s) -> bridge.sendImage -> [Screenshot: ...] -> instructionFilePreFlight -> bridge
- Outbound: cli.ts send -> POST /send or /voice -> channel

### Instruction File Pre-Flight
- All message paths (text, voice, photo, quick commands) run `checkInstructionFilePreFlight()` before creating a new session
- Checks: only triggers when session doesn't exist or is stopped (existing running/detached sessions pass through)
- Flow: bridge.checkInstructionFile(provider, cwd) -> if needed, show inline keyboard (ifc_yes / ifc_no) -> store pending state -> on confirm, create session with `createInstructionFile` flag
- Types: `InstructionFileCheck { needed, targetFile?, copySource? }`, `PendingInstructionFileConfirm { provider, cwd, sessionName, targetFile, copySource, originalMessage }`
- State: `StateManager._pendingInstructionFileConfirm` (get/set/clear)

### Commands
| Command | Behavior |
|---------|----------|
| /start | Help |
| /switch | Navigate projects -> stages -> cards (8/page) |
| /search | Text: search. Empty: active + recent (5 max) |
| /provider | Claude/Gemini/Codex (sets global default + current session) |
| /status | Full state |
| /voice | ElevenLabs search/swap |
| /mode | text/voice/both |
| /tone | Presets or free-text |
| /global /project | Quick nav |
| /sly | Context-aware actions |

### Per-Card Provider Selection
- Provider is scoped per navigation target, not global
- **Card switch** (`sw_card_`): `resolveProviderFromBridge()` checks bridge sessions matching `{projectId}:{provider}:card:{cardId}`, picks most recently active; falls back to `getProviderDefault(cardStage)` (stage-based default from `providers.json`)
- **Project switch** (`sw_proj_`): `resolveProjectProviderFromBridge()` checks `{projectId}:{provider}:global` sessions; falls back to `getProviderDefault()`
- **Global switch** (`sw_global`): resets to `getProviderDefault()` (no stage)
- **`/provider` command**: sets `selectedProvider` on current target AND writes to `providers.json` global default via `updateGlobalProviderDefault()`
- **Info box**: provider line shows label + `(default)` suffix when no explicit bridge session exists; `hasExplicitSession()` checks bridge for matching session name
- **Provider labels**: `PROVIDER_LABELS` map (claude -> "Claude Code", gemini -> "Gemini CLI", codex -> "Codex CLI")
- **`/status`**: shows provider with `(default)` suffix when inherited
- Feature ref: `documentation/features/049_per_card_provider_selection.md`

### Sly Actions from Messaging
- `/sly` command: reads actions from `store/actions/*.md` via `SlyActionFilter`
- `SlyActionFilter` (messaging/src/sly-action-filter.ts): scans `store/actions/*.md`, parses YAML frontmatter (lightweight parser, no YAML lib), assembles `SlyActionsFile { commands, classAssignments }`
- 30s in-memory cache (`CACHE_MAX_AGE_MS`)
- `filterActions(terminalClass, placement?, cardType?)`: filters by class assignment, placement, card type
- `buildFullPrompt()`: resolves opt-in context blocks (`{{cardContext}}`, `{{projectContext}}`, `{{globalContext}}`) + field-level `{{card.*}}`, `{{project.*}}`, `{{stage}}`, `{{projectPath}}` variables
- `buildCardContextHeader()`: renders enriched card header (project, card fields, checklist summary N/M, notes count, problems with IDs/severity, max 10 displayed)
- `buildProjectContext()`: project name + path + role primer for project-scoped terminals
- `buildGlobalContext()`: SlyCode management terminal primer
- `getTerminalClass()`: global -> `global-terminal`, project -> `project-terminal`, card -> stage name (default `implementation`)
- Quick command callback (`qc_` prefix): inline button -> `executeQuickCommand()` -> resolves prompt -> sends to bridge

### Voice
- **STT backend selection**: `STT_BACKEND` env var — `openai` (default) or `local`
- **OpenAI path**: OGG -> OpenAI Whisper v1 API -> text (requires `OPENAI_API_KEY`)
- **Local whisper.cpp path**: OGG -> ffmpeg (16kHz mono WAV) -> whisper-cli -> text (requires `WHISPER_CLI_PATH`, `WHISPER_MODEL_PATH`; 120s timeout)
- `stt.ts` exports: `transcribeAudio(filePath, SttConfig)`, `validateSttConfig(SttConfig)` — routes to `transcribeOpenAI()` or `transcribeLocal()` internally
- `SttConfig { backend, openaiApiKey, whisperCliPath, whisperModelPath }` — validated before transcription; errors surfaced to user
- `VoiceConfig` (types.ts): added `sttBackend`, `whisperCliPath`, `whisperModelPath` fields
- Startup log shows backend-specific STT status (local: validates CLI/model paths; openai: checks API key)
- TTS: ElevenLabs v3 (eleven_v3, stability=0.5, similarity=0.75) -> MP3 -> ffmpeg libopus -> OGG
- Search: /v2/voices + /v1/shared-voices parallel

### State (messaging-state.json)
- Navigation: selectedProjectId, targetType, selectedCardId, selectedCardStage
- Voice: voiceId, voiceName, responseMode (text|voice|both), voiceTone
- Provider: selectedProvider (per-target, resolved from bridge sessions on navigation; `/provider` also writes global default to `providers.json`)
- Session cwd: global terminal uses `getWorkspaceRoot()` (SLYCODE_HOME or relative resolve)
- Pending instruction file confirm: stored in-memory (not persisted)

### Response Modes
- text (default), voice, both; tone: presets or free-text
- Footer: [Channel] text (Reply using /messaging | Mode: {mode} [| Tone: {tone}])

### Bridge Integration
- Session naming: {projectId}:{provider}:global | :card:{cardId} | global:{provider}:global
- Permission mismatch: messaging=skipPermissions; detect false -> restart
- Activity: one-shot watchActivity (2s+3s) + persistent monitor (4s loop)
- ensureSession: creates with `skipPermissions: true`, `createInstructionFile` (from pre-flight)
- sendMessage: checks session active -> if not, creates/resumes with message as initial prompt

### Callbacks
| Prefix | Purpose |
|--------|---------|
| sw_* | Navigation |
| qc_* | Quick commands (sly actions) |
| mode_* | Response mode |
| tone_* | Tone |
| cfg_* | Provider |
| perm_* | Permission |
| voice_* | Voice |
| ifc_* | Instruction file confirm (yes/no) |

### Key Files
| File | Purpose |
|------|---------|
| messaging/src/index.ts | Routing, commands, HTTP, instruction file pre-flight, per-card provider resolution |
| messaging/src/state.ts | Navigation, voice, mode, pending instruction file state |
| messaging/src/bridge-client.ts | Sessions, activity, checkInstructionFile, ensureSession, getProjectSessions |
| messaging/src/channels/telegram.ts | Polling, keyboards |
| messaging/src/stt.ts | Dual-backend STT: OpenAI Whisper API or local whisper.cpp, SttConfig, validateSttConfig |
| messaging/src/tts.ts | ElevenLabs TTS |
| messaging/src/voices.ts | Voice search (personal + shared) |
| messaging/src/sly-action-filter.ts | Action scanning from store/actions/*.md, filtering, template resolution |
| messaging/src/kanban-client.ts | Board loading |
| messaging/src/cli.ts | Send messages |
| messaging/src/types.ts | All shared types (Channel, VoiceConfig, SlyActionConfig, InstructionFileCheck, PendingInstructionFileConfirm, BridgeCreateSessionRequest, BridgeSessionInfo) |
| documentation/features/049_per_card_provider_selection.md | Per-card provider selection feature spec |

---

## 6. SlyCode CLI & Scaffolding

### CLI (packages/slycode/)
- Entry: bin/slycode.js (Node v20+); 9 lazy-loaded subcommands
- Package metadata: author `Greg Atkins <support@slycode.ai>`, license BUSL-1.1, repo `slycode-ai/slycode`; both packages publish author, repository, homepage, bugs fields

### Commands
| Command | Key Logic |
|---------|-----------|
| start | Port check, detached spawn, health 15s, state.json PID; sets SLYCODE_HOME env |
| stop | PID file or port-based (ss/lsof); SIGTERM->5s->SIGKILL |
| update | npm update + skill refresh + service restart |
| sync | YAML version compare; full-replace on mismatch |
| doctor | 8 checks: Node, workspace, config, .env, ports, CLIs, agents, dirs |
| skills | list/check/add/reset with version tracking |
| config | View/modify slycode.config.js; nested keys; type coercion (ports=int, services=bool) |
| service | install/remove/status; systemd/launchd/Task Scheduler |
| uninstall | Remove services and CLI tools (preserves workspace files) |

### Workspace Configuration (slycode.config.js)
- Created by scaffold; loaded by workspace.ts resolveConfig()
- Keys: host (default 127.0.0.1), ports.web/bridge/messaging (7591/2/3), services.web/bridge/messaging (bool)
- Only web binds to config.host; bridge+messaging always localhost
- CLI: `slycode config [key] [value]` to view/modify

### Workspace Resolution
1. SLYCODE_HOME env
2. ~/.slycode/config.json
3. Walk up cwd for slycode.config.js or package.json

### Create-SlyCode
- `npx create-slycode [dir] [--yes]`
- Setup wizard: timezone (auto-detects via `Intl.DateTimeFormat`, writes `TZ=` to .env for cron scheduling), network binding (localhost vs 0.0.0.0), ports, Telegram token/userId, voice keys (OpenAI/ElevenLabs), system service
- Existing workspace detection: warns if ~/.slycode/config.json points elsewhere; offers continue or cancel
- Creates: package.json, slycode.config.js, .env (sections: Timezone `TZ=`, Ports, Telegram, Voice STT/TTS), .gitignore
- `--yes` auto-accepts defaults: detected system timezone, host 0.0.0.0, ports 7591/2/3, no integrations, no service
- Seeds: commands.json (empty), registry.json (single tutorial project), providers.json from package templates
- **Actions now individual MD files**: `deployStoreActions()` copies `store/actions/*.md` from package templates (replaces old sly-actions.json seeding); each action is a standalone markdown file with YAML frontmatter + prompt body
- Kanban seed: `{project_id: 'slycode', stages: {backlog:[], design:[], ...}, last_updated}` (overwritten by tutorial seed if template available)
- Registry seed: single project `id: 'slycode'`, `path: dir` (workspace root), tagged `['tutorial']`
- Tutorial: `seedTutorialWorkspaceContent()` selectively copies from `templates/tutorial-project/` into workspace root (not a subdirectory):
  - Copies `documentation/designs/` and `documentation/features/` via `copyIfExists()`
  - Overwrites kanban.json with tutorial board (replaces `{{TIMESTAMP}}` placeholders)
  - Copies `documentation/events.json` if present
- Deploys store skills to store/skills/, .claude/skills/, .agents/skills/; deploys store actions to store/actions/; deploys updates/ folder
- Copies CLAUDE.md template (includes tutorial mode section); npm install; CLI symlinks (platform/symlinks.js); optional service install
- Saves workspace path to ~/.slycode/config.json

### Tutorial Project Template
- Source: `packages/slycode/templates/tutorial-project/`
- Contents seeded into workspace root (not a standalone subdirectory) by `seedTutorialWorkspaceContent()`
- Selective copy: only `documentation/designs/`, `documentation/features/`, `documentation/kanban.json`, `documentation/events.json` -- not a bulk directory copy
- Kanban.json: overwrites the generic seed with pre-populated tutorial board; `{{TIMESTAMP}}` replaced at scaffold time
- Events.json: copied directly if present in template
- Graceful degradation: if template dir not found, skips silently (no crash)
- Tutorial board: 15 cards total -- 3 intro orientation (backlog) + 1 companion card ("Ship a Tiny Tutorial Output", backlog) + 3 stage guide cards (design, implementation, testing) + 1 graduation card (done) + 6 topic/reference cards in done (automations, customization, dashboard, providers, visibility, archiving) + 1 automation card (HTTPS Setup Wizard, backlog)
- Tutorial cards teach the full kanban lifecycle (backlog -> done) via Terminal action buttons in the web UI
- Build pipeline preserves tutorial-project/ template during wipe/rebuild

### CLAUDE.md Template (Tutorial Mode)
- Template at `packages/slycode/templates/CLAUDE.md`
- Includes "Tutorial Mode (First Install)" section with behavioral expectations:
  - Workspace starts in tutorial mode on fresh install
  - Registry project points to workspace root (not a subdirectory)
  - AI-first guidance: agents execute CLI tools, users interact via web UI action buttons
  - Agents should not instruct users to run CLI commands; execute and report results
  - Concise, stage-aware responses; avoid unrelated code edits during tutorial
  - After onboarding, workspace becomes the user's permanent command center

### Global CLIs
- slycode, sly-kanban, sly-messaging, sly-scaffold
- Unix: symlinks ~/.local/bin; Windows: .cmd shims

### Key Files
| File | Purpose |
|------|---------|
| packages/slycode/src/cli/index.ts | Dispatcher |
| packages/slycode/src/cli/start.ts | Service spawn |
| packages/slycode/src/cli/stop.ts | Process kill |
| packages/slycode/src/cli/doctor.ts | Env checks |
| packages/slycode/src/cli/skills.ts | Skill mgmt |
| packages/slycode/src/cli/config.ts | Config view/modify |
| packages/slycode/src/cli/workspace.ts | Workspace resolution, config loading |
| packages/slycode/src/cli/service.ts | Platform services |
| packages/slycode/src/cli/uninstall.ts | Clean removal |
| packages/create-slycode/src/index.ts | Scaffold wizard; timezone prompt, deploys store actions as individual MD files |
| packages/create-slycode/package.json | Package metadata: author, repository (directory: packages/create-slycode), homepage, bugs |
| packages/slycode/package.json | Package metadata: author, repository, homepage, bugs |
| packages/slycode/templates/CLAUDE.md | Workspace CLAUDE.md (tutorial mode section) |
| packages/slycode/templates/store/actions/*.md | Action prompt templates (individual MD files with YAML frontmatter) |
| packages/slycode/templates/tutorial-project/ | Tutorial content template |
| packages/slycode/templates/store/skills/context-priming/SKILL.md | Store seed: context-priming v1.1.8 (provider: claude) |
| packages/slycode/templates/store/skills/kanban/SKILL.md | Store seed: kanban v1.4.0 (provider: claude, +multiline description) |
| packages/slycode/templates/store/skills/chore/SKILL.md | Store seed: chore v1.1.1 (provider: claude) |
| packages/slycode/templates/updates/skills/context-priming/SKILL.md | Update delivery: context-priming v1.1.8 |
| packages/slycode/templates/updates/skills/kanban/SKILL.md | Update delivery: kanban v1.4.0 |
| packages/slycode/templates/updates/skills/chore/SKILL.md | Update delivery: chore v1.1.1 |
| packages/slycode/templates/updates/actions/*.md | Update delivery: 21 action files (manifest-controlled subset) |

---

## 7. Skills, Commands & Store

### Skills (17)
| Skill | Ver | Purpose |
|-------|-----|---------|
| context-priming | 1.1.8 | Dynamic context; area-index + areas/*.md; cross-provider resolution |
| checkpoint | 1.3.1 | Git checkpoint |
| kanban | 1.4.0 | Card CLI; all refs now `sly-kanban` global; notes + automation subcommands |
| messaging | 2.3.1 | Channel delivery; voice |
| design | 1.1.1 | Requirements gathering; adds design summary note on card |
| feature | 1.1.1 | Feature specs; adds planning summary note on card |
| chore | 1.1.1 | Maintenance plans |
| implement | 1.1.1 | Plan execution; structured checklist + impl summary note |
| interactive-explainer | 1.0.1 | Visual HTML docs |
| skill-creator | 1.0.1 | Skill dev guide |
| reference-fetch | 1.1.1 | Doc retrieval |
| doc-discovery | 1.0.1 | Doc gap analysis |
| doc-update | 1.0.1 | Doc maintenance |
| claude-code-docs-maintainer | 1.0.1 | Claude Code docs; references SlyCode repository (was ClaudeMaster); relative doc paths |
| convert-asset | 1.0.0 | Cross-provider conversion; scope now global (was project-specific) |
| create-command | 1.0.1 | Slash commands |
| problem_summary | 1.0.1 | Issue summary |

### Skill CLI Migration
- All skills now reference `sly-kanban` global CLI instead of `node scripts/kanban.js`
- Affected: kanban, design, feature, implement, messaging (5 skills)
- Implement skill checks `command -v sly-kanban` instead of `test -f scripts/kanban.js`

### Skill Behavior Changes
- **design**: workflow adds design summary note to card after creating design doc (`sly-kanban notes`)
- **feature**: workflow adds planning summary note to card after creating feature spec
- **implement**: post-implementation phase is structured: (1) add testing checklist items via `sly-kanban checklist`, (2) toggle verified items, (3) add implementation summary note with `--agent`, (4) log issues as problems, (5) move to testing
- **messaging**: TTS speech guidelines updated (`sly-kanban` -> "the kanban CLI")

### Context Priming (v1.1.8)
- Areas (7): web-frontend, terminal-bridge, terminal-actions, messaging, skills, scripts-deployment, feature-guide
- Load: area-index.md first, then relevant areas by task
- Update: minor drift=skip; contradiction=fix; multiple=consult user
- Protected refs: feature-guide area protects `documentation/features/042_slycode_product_messaging.md` (canonical product messaging framework -- positioning, value proposition, messaging pillars, pricing framing)
- Cross-provider resolution: SKILL.md deployed to `.agents/skills/` (Codex) and `.gemini/skills/` (Gemini) for discovery; area files live in `.claude/skills/context-priming/references/` as primary
  - Resolution order: (1) `<project-root>/.claude/skills/context-priming/` (primary, most up-to-date), (2) directory containing SKILL.md (fallback for pure Codex/Gemini projects with no `.claude/`)
  - Resolved paths: area-index at `references/area-index.md`, areas at `references/areas/<name>.md`, maintenance at `references/maintenance.md`
- Permission model: areas/*.md and area-index.md updated in stride; add/remove/split areas need light confirmation; SKILL.md and maintenance.md require user approval
- Self-improvement: up to 10 notes per area in area-index.md; actionable guidance format ("when X, do Y"); remove stale notes
- Callouts: prefix operational updates with `Priming:` (one-liner); callout on load, staleness concern, multi-area load; skip callout for routine file reads
- "You should have known" response protocol: identify cause (bad triggers, missing info, stale ref, missing area, bad heuristic) -> propose fix -> surface immediately
- Git usage: sparingly (before major refactors, when accuracy questioned, staleness check)

### Terminal Actions (Markdown Format, 26 Commands)
- **Migration from JSON to markdown**: `data/sly-actions.json` archived to `data/archive/sly-actions.json.archived`; conversion script `scripts/convert-actions-to-md.js` (one-time)
- **Format**: individual `store/actions/<name>.md` files with YAML frontmatter + prompt body (see action-assistant-context.md for full spec)
- **Frontmatter fields**: name, version, label, description, group, placement, scope (global or specific), projects, cardTypes, classes (map of terminal-class -> sort priority)
- **Scanning**: both web (`action-scanner.ts`) and messaging (`sly-action-filter.ts`) scan `store/actions/*.md` independently; both parse YAML frontmatter with lightweight parsers (no YAML lib); both use 30s in-memory cache
- **Class assignments**: derived from per-action `classes` map (reverse of old top-level `classAssignments` array); priority numbers with gaps of 10 for insertion; ties broken alphabetically
- Placement: startup, toolbar, both
- Groups (5): Card Actions (14), Session (2), Project (4), Utilities (5), Action Assistant (1)
- Classes (9): global-terminal, project-terminal, backlog, design, implementation, testing, done, automation, action-assistant
- Templates: `{{var}}` mustache-style (cardContext, projectContext, globalContext context blocks + field-level card/project/stage/projectPath)
- Context injection is opt-in: actions must include `{{cardContext}}` etc. in prompt body
- MAX_VISIBLE_ACTIONS=6; Shift+click inserts without submit
- All command prompts use `sly-kanban` CLI (not `node scripts/kanban.js`)
- `data/action-assistant-context.md`: comprehensive reference for the action assistant (format spec, template variables, workflow diagram, common mistakes, learned patterns)
- **convert-asset**: scope changed from `specific` (claude-master only) to `global` — available in all workspaces

### Terminal Action Commands
- **Card Actions** (14): onboard, design-requirements, deep-design, make-feature, implement, quick-fix, debug, complete, review, approve, archive, chore, analyse-implementation, test-review
- **Session** (2): summarize, continue
- **Project** (4): explore, create-card, update-priming, organise-backlog
- **Utilities** (5): clear, checkpoint, context, show-card, convert-asset
- **Action Assistant** (1): configure-commands
- Notable: design-requirements assesses complexity + adds design summary note; deep-design: 4-phase workflow (design doc, parallel analysis agents, synthesis, Q&A) with 6 optional agent perspectives; implement moves card to implementation stage first, then adds structured checklist (via `sly-kanban checklist`) + implementation summary note; make-feature adds planning summary note (scope/milestones/risks); test-review: interactive testing-lane with checklist assessment, area context priming, max 3 questions/round; organise-backlog uses `kanban board` snapshot + `kanban reorder`; context action includes both `{{cardContext}}` and `{{projectContext}}` for dual-scope flexibility

### Action Update Delivery
- **Source**: `updates/actions/*.md` (upstream from slycode package, 21 actions); `store/actions/*.md` (workspace-installed, 26 actions including 5 store-only: analyse-implementation, archive, clear, complete, continue)
- **Detection**: content-hash comparison (not version); `store/.ignored-updates.json` tracks dismissed updates by `actions/<name>` key with content hash
- **Accept flow**: upstream content replaces store content; user's class assignments are preserved via additive merge (new classes from upstream added, existing user classes kept)
- **Web UI**: `ActionUpdatesModal` (accept/dismiss/preview with diff viewer); `ProjectHeader` polls for actionEntries count, shows badge on Actions button; `SlyActionConfigModal` shows "Updates" tab when available
- **Cache invalidation**: `/api/sly-actions/invalidate` endpoint; called on modal close to force re-scan

### Store (Canonical Flat)
- store/skills/ (17 dirs, includes dummy), store/actions/ (26 .md files), store/agents/, store/mcp/, store/.backups/
- **Renaming**: all store assets updated from "ClaudeMaster" to "SlyCode" references (skills, backups, area refs); doc paths normalized to relative (was Windows absolute in claude-code-docs-maintainer)
- Store skills include full reference subdirectories: `store/skills/context-priming/references/references/areas/{skills,scripts-deployment}.md` (distributed to new workspaces); `updates/skills/` mirrors same structure
- Update flow: updates/ -> accept -> backup -> overwrite store/ -> deploy
- Template skill versions (in updates/): context-priming v1.1.8, kanban v1.4.0, chore v1.1.1 (all include `provider: claude` frontmatter)
- Manifest: 8 skills (context-priming, checkpoint, chore, feature, implement, design, kanban, messaging)
- Ignored: store/.ignored-updates.json (tracks both skills and actions by content hash)
- Hook: useSlyActionsConfig.ts (renamed from useCommandsConfig.ts)
- **Import preview**: `GET /api/cli-assets/store/preview` lists all files in a skill directory before import (params: provider, assetType, assetName, sourceProjectId); returns `{ files: string[], isDirectory: boolean }`
- **Import dialog**: `ImportDialog` component in `CliAssetsTab.tsx` shows file listing from preview API, offers two choices: "SKILL.md only" (default) or "Full folder" (when extra files exist beyond SKILL.md)
- **SKILL.md-only import**: `skillMainOnly` param (default true for skills) on store POST and sync POST; copies only SKILL.md, preserving project-specific references/ and other supporting files in the store
- **Import flow**: non-skill assets (agents) import directly (single file, no dialog); skills trigger ImportDialog -> preview API -> user chooses -> `doImportToStore()` with `skillMainOnly` flag
- `importAssetToStore()` in `asset-scanner.ts`: `skillMainOnly` defaults true; only copies SKILL.md from source project into `store/skills/<name>/`
- `copyAsset()` / `copyStoreAssetToProject()`: both support `skillMainOnly` option for deploy operations

### SKILL.md Format
```
---
provider (claude|codex|gemini), name, version (semver), updated (YYYY-MM-DD), description, allowed-tools, argument-hint
---
# Content
```
- Bundled: references/, assets/, scripts/

### Key Files
| File | Purpose |
|------|---------|
| .claude/skills/context-priming/SKILL.md | Context priming skill (v1.1.8), cross-provider resolution |
| .claude/skills/context-priming/references/area-index.md | Area index (7 areas, load-when triggers, notes) |
| .claude/skills/context-priming/references/areas/*.md | Deep reference per area |
| .claude/skills/context-priming/references/maintenance.md | Defrag, pruning, area separation doctrine |
| store/skills/claude-code-docs-maintainer/SKILL.md | Claude Code docs skill (SlyCode refs, relative paths) |
| store/skills/context-priming/references/ | Store copy of context-priming area refs (SlyCode-renamed) |
| store/actions/*.md | Individual action files (26), YAML frontmatter + prompt body |
| data/action-assistant-context.md | Action assistant reference (format spec, template variables, workflow, learned patterns) |
| data/archive/sly-actions.json.archived | Archived legacy JSON format (migrated to store/actions/*.md) |
| scripts/convert-actions-to-md.js | One-time JSON-to-markdown migration script |
| web/src/lib/action-scanner.ts | Web-side action scanning, frontmatter parsing, update detection, content hashing |
| web/src/lib/sly-actions.ts | Getter, templates |
| web/src/hooks/useSlyActionsConfig.ts | Polling config (30s) |
| web/src/lib/asset-scanner.ts | Asset scanning, frontmatter parsing, version comparison, import/copy with skillMainOnly |
| web/src/components/CliAssetsTab.tsx | CLI assets UI: project matrix, store view, updates view, ImportDialog |
| web/src/components/ActionUpdatesModal.tsx | Action update accept/dismiss/preview with diff viewer |
| web/src/app/api/cli-assets/store/route.ts | Store GET/POST/DELETE; POST accepts skillMainOnly param |
| web/src/app/api/cli-assets/store/preview/route.ts | Preview API: lists skill directory files before import |
| web/src/app/api/sly-actions/route.ts | Sly actions API (reads from action-scanner) |
| web/src/app/api/sly-actions/invalidate/route.ts | Cache invalidation endpoint |
| build/store-manifest.js | Npm skill list |
| build/sync-updates.ts | Store -> updates |
| messaging/src/sly-action-filter.ts | Messaging-side action scanning from store/actions/*.md |

---

## 8. Scripts & Deployment

### Production: SlyCode CLI (supersedes shell scripts)

Production service management is now handled by the `slycode` CLI package (see Section 6):
- `slycode start` / `slycode stop` -- replaces sly-start.sh / sly-stop.sh
- `slycode service install/remove/status` -- replaces setup.sh service phase
- `slycode doctor` -- replaces manual health checks

### Legacy Shell Scripts (claude_master dev environment only)

These scripts remain in `scripts/` for the claude_master dev environment but are **not shipped** to production workspaces:

| Script | Status | Purpose |
|--------|--------|---------|
| setup.sh | Legacy (dev) | Interactive setup; --yes, --service, --remove-service; validates Node/gcc/make |
| sly-start.sh | Legacy (dev) | Platform services or nohup; log rotation >10MB |
| sly-stop.sh | Legacy (dev) | Port-based kill; SIGTERM->5s->SIGKILL |
| sly-restart.sh | Legacy (dev) | Convenience wrapper: sly-stop.sh + sly-start.sh |
| sly-dev.sh | **Active (dev)** | tmux 3-pane (web\|bridge\|messaging); zombie prevention hooks (pane-died->kill-pane, session-closed->sly-stop) |

- `sly-dev.sh` is the only script actively used -- starts all 3 services in tmux for development
- Production workspaces use `slycode start/stop` which handles platform-aware service management (systemd/launchd/Task Scheduler/background PIDs)

### Dev-Only Scripts
| Script | Purpose |
|--------|---------|
| convert-actions-to-md.js | One-time migration: reads `data/sly-actions.json`, generates `store/actions/<name>.md` per command; builds class->priority map from classAssignments; outputs YAML frontmatter (name, version, label, description, group, placement, scope, classes) + prompt body |

### Scaffolding (scaffold.js) -- Active
- **Used by web UI** (POST /api/projects) to set up new project folders within a workspace
- analyze: audit SlyCode compliance of an existing directory
- create: scaffold a project folder (CLAUDE.md, kanban.json, skills, docs, git init) using template assembly (base + overlay); selective --config
- `create-slycode` sets up the **workspace**; `scaffold.js` sets up individual **projects** within it
- Also available as global CLI: `sly-scaffold`

### Path Resolution
- getSlycodeRoot(): SLYCODE_HOME -> cwd (legacy root env var removed)
- getPackageDir(): dev=root, prod=node_modules/slycode/dist/

### Environment
| Variable | Default | Purpose |
|----------|---------|---------|
| SLYCODE_HOME | derived | Workspace root |
| CLAUDE_ENV | home | Context |
| WEB_PORT | 7591 | Web |
| BRIDGE_PORT | 7592 | Bridge |
| MESSAGING_SERVICE_PORT | 7593 | Messaging |
| BRIDGE_URL | localhost:7592 | Web->bridge |
| DEV_HOSTNAME | (none) | Additional hostname for Next.js `allowedDevOrigins` (e.g. Tailscale machine name) |

### Migrations
| Script | Purpose |
|--------|---------|
| migrate-store.sh | Flatten provider-split |
| migrate-sly-actions.js | v2->v3 |
| convert-actions-to-md.js | JSON->individual MD (one-time, sly-actions.json->store/actions/*.md) |

---

## 9. Data, Configuration & Build

### Licensing (BUSL-1.1 Open-Core)
- All packages licensed under **Business Source License 1.1** (BUSL-1.1)
- BUSL-1.1 applied to: web, bridge (pty-bridge), messaging-service, slycode, create-slycode (all `package.json` `"license": "BUSL-1.1"`)
- **Free use**: personal, non-commercial, educational, evaluation, open-source contributions, academic research
- **Commercial use** (company/org with paid employees): requires commercial license -- visit https://slycode.ai
- **Change Date**: 2029-03-03 -- each version auto-converts to **Apache License 2.0** on this date (or 4 years after first public release of that version, whichever is earlier)
- Licensor: SlyCode; Licensed Work: SlyCode (c) 2026
- Forks permitted but BUSL terms (including commercial restriction) carry forward

| File | Purpose |
|------|---------|
| LICENSE | Full BUSL-1.1 legal text with SlyCode parameters |
| LICENSING.md | Human-readable summary, FAQ, contact info |

### Providers (data/providers.json)
| Provider | Command | Permissions | Resume | Prompt | instructionFile | altInstructionFile |
|----------|---------|------------|--------|--------|-----------------|-------------------|
| claude | claude | --dangerously-skip-permissions | --resume [guid] | positional | CLAUDE.md | -- |
| codex | codex | --yolo | codex resume [guid] | positional | AGENTS.md | CODEX.md |
| gemini | gemini | --yolo | --resume | flag (-i/-p) | AGENTS.md | GEMINI.md |
- `altInstructionFile`: fallback checked when `instructionFile` not found in project directory (e.g., Codex checks AGENTS.md first, falls back to CODEX.md); bridge `provider-utils.ts` exposes `ProviderConfig.altInstructionFile`
- Defaults: most stages -> claude, implementation+testing -> codex, skipPermissions=true

### Actions (store/actions/*.md -- individual MD files)
- **Format migration**: actions moved from monolithic `data/sly-actions.json` to individual `store/actions/<name>.md` files (26 files, ~1017 lines total)
- Old JSON format archived to `data/archive/sly-actions.json.archived` and `data/archive/sly-actions-scaffold-template.json.archived`
- Conversion script: `scripts/convert-actions-to-md.js` (one-time dev migration)
- Each file: YAML frontmatter (name, version, label, description, group, placement, scope, classes map, optional projects/cardTypes) + prompt body (Handlebars templates)
- Classes map inlined per action (replaces centralized classAssignments): `classes: { backlog: 10, design: 20 }` with priority numbers (ascending sort, gaps of 10)
- 9 terminal classes: global-terminal, project-terminal, backlog, design, implementation, testing, done, automation, action-assistant
- Context injection: opt-in via `{{cardContext}}`, `{{projectContext}}`, `{{globalContext}}` template variables in prompt body (not automatic)
- All action prompts use `sly-kanban` CLI (global binary)
- Card workflow actions include `sly-kanban notes` steps for agent traceability
- Implement action uses explicit `sly-kanban checklist` commands for test items
- Store manifest controls which actions ship in npm package (21 actions in manifest; 5 removed from updates: analyse-implementation, archive, clear, complete, continue)

### Other Data
| File | Purpose |
|------|---------|
| data/settings.json | Voice: max 300s, shortcuts |
| documentation/terminal-classes.json | 9 classes (8 in classAssignments + automation) |
| documentation/events.json | Audit log (rolling, periodically purged; ~200 oldest entries trimmed per purge) |
| projects/registry.json | Projects (v2.0.0); workspace project ID derived dynamically via `path.basename(getRepoRoot())` (no longer hardcoded as `claude-master`) |
| data/action-assistant-context.md | Context for action-assistant AI; documents MD file format (frontmatter fields, classes map, template variables, placement, groups); includes learned patterns, common mistakes, workflow diagrams; self-improving (AI appends patterns during sessions) |
| data/archive/sly-actions.json.archived | Archived monolithic JSON format (pre-migration) |
| data/archive/sly-actions-scaffold-template.json.archived | Archived scaffold JSON template (pre-migration) |

### Scaffold Templates (data/scaffold-templates/)
- Blessed defaults; base-instructions.md + overlays/
- seed-cards.json (3 cards), kanban.json (empty)
- providers.json: separate scaffold copy (not data/providers.json); build sources from here
- Build sources from here, not data/

### Build Pipeline
| File | Purpose |
|------|---------|
| build/build-package.ts | Clean -> build services (CLI, create-slycode, bridge, messaging, web) -> sync store->updates -> copy templates |
| build/sync-updates.ts | Store -> updates (manifest-enforced); syncs both skills and actions; removes non-manifest items from updates/; callable standalone or as library (`syncStoreToUpdates()`) |
| build/store-manifest.js | 8 skills shipped (checkpoint, chore, context-priming, design, feature, implement, kanban, messaging); 21 actions shipped (see manifest for full list) |
| build/export.js | Dev -> public (MD5 diff, excludes) |
| build/export.config.js | Mappings, excludes, preserves |
| build/check.js | 7 checks: no .env, personal data, size <100MB |
| build/publish.sh | build -> export -> check -> [npm publish] |

### Build Pipeline Details
- `sync-updates.ts`: copies manifest skills from `store/skills/` to `updates/skills/` and manifest actions from `store/actions/` to `updates/actions/`; removes stale non-manifest entries; integrated into build-package.ts main flow (runs before template copy)
- Template copy: store skills (curated via manifest), updates/skills/, updates/actions/, providers.json (from scaffold-templates/), kanban-seed.json (generated), CLAUDE.release.md, scripts (kanban.js, scaffold.js), scaffold-templates/, store/ (full copy to dist/)
- Build preserves tutorial-project/ template: copies to temp dir before clean, restores after
