# Web Frontend

Updated: 2026-02-14

## Overview

Next.js 16 command center for project management. Features project cards with health scoring, kanban boards with drag-drop, card modals, command configuration, system health monitoring, cross-project toolkit/asset management, global search, activity feed, project scaffolding, and graceful reconnection handling. Neon-minimalist theme (SlyCode Neon) with Tailwind CSS v4, featuring lane-colored gradients, SVG noise textures, and theme-aware terminal styling.

## Key Files

### Pages & Layout
- `web/src/app/page.tsx` - Home dashboard, lists projects from registry
- `web/src/app/project/[id]/page.tsx` - Project detail page with kanban
- `web/src/components/ProjectPageClient.tsx` - Client wrapper for project pages, global terminal activity polling
- `web/src/components/ProjectView.tsx` - Project view wrapper, manages archive toggle state

### Core Components
- `web/src/components/Dashboard.tsx` - Project card grid + Toolkit tab, global search, number-key shortcuts
- `web/src/components/ProjectKanban.tsx` - Kanban board container, drag-drop logic
- `web/src/components/KanbanColumn.tsx` - Stage columns (backlog, design, impl, testing, done)
- `web/src/components/KanbanCardItem.tsx` - Individual card, status indicators, active glow effect
- `web/src/components/CardModal.tsx` - Full card editor with dynamic tabs, edit session protection
- `web/src/components/ProjectHeader.tsx` - Header with Commands, Archive toggle, HealthMonitor

### Project Management
- `web/src/components/ProjectCard.tsx` - Enhanced project card with health dot, platform badges, edit/delete
- `web/src/components/AddProjectModal.tsx` - Multi-phase project creation wizard (details → analysis → scaffold → done)
- `web/src/components/HealthDot.tsx` - Health score indicator with tooltip (green/amber/red)
- `web/src/components/PlatformBadges.tsx` - Detected AI platform badges (Claude, Gemini, Codex)
- `web/src/components/SearchBar.tsx` - Global/contextual search across all kanban cards

### Terminal & Commands
- `web/src/components/ClaudeTerminalPanel.tsx` - Reusable terminal with provider selector, startupCommands/activeCommands, card area filtering
- `web/src/components/Terminal.tsx` - xterm.js terminal with ConnectionManager integration
- `web/src/components/CommandConfigModal.tsx` - Command configuration UI with Command Assistant terminal
- `web/src/components/GlobalClaudePanel.tsx` - Floating panel for project-wide session, supports session/CWD/class overrides

### Toolkit & Assets
- `web/src/components/ToolkitTab.tsx` - Asset management tab with matrix view and pending changes
- `web/src/components/AssetMatrix.tsx` - Cross-project asset deployment matrix with click-to-deploy/remove
- `web/src/components/AssetViewer.tsx` - Modal viewer for asset content with frontmatter display

### Activity & Content
- `web/src/components/ActivityFeed.tsx` - Collapsible event log with day grouping and stage indicators
- `web/src/components/MarkdownContent.tsx` - Markdown renderer using react-markdown with GFM support

### Health & Connection
- `web/src/components/HealthMonitor.tsx` - System stats widget (CPU, memory, terminals)
- `web/src/components/ConnectionStatusIndicator.tsx` - Reconnection toast indicator
- `web/src/lib/connection-manager.ts` - Centralized SSE reconnection with Page Visibility API

### Hooks
- `web/src/hooks/useConnectionStatus.ts` - Hook for connection state subscription
- `web/src/hooks/useKeyboardShortcuts.ts` - Keyboard navigation (1-9 project jump, Escape)
- `web/src/hooks/useCommandsConfig.ts` - Polling-based commands config loader (30s intervals)
- `web/src/hooks/usePolling.ts` - Generic polling hook

### Utilities
- `web/src/lib/types.ts` - All shared types (see Data Models)
- `web/src/lib/claude-actions.ts` - getStartupCommands(), getActiveCommands(), renderTemplate()
- `web/src/lib/registry.ts` - Project registry loader with kanban, health scoring, platform detection
- `web/src/lib/paths.ts` - Dynamic path resolution for SlyCode root and project directories
- `web/src/lib/kanban-paths.ts` - Project-aware kanban file path resolution with tiered backup
- `web/src/lib/asset-scanner.ts` - Asset scanning, frontmatter parsing, version comparison, platform detection
- `web/src/lib/event-log.ts` - Append-only activity log with filtering/querying (500 event cap)
- `web/src/lib/health-score.ts` - Health score calculator with configurable weights
- `web/src/lib/tab-sync.ts` - Cross-tab synchronization using BroadcastChannel API

### API Routes
- `web/src/app/api/kanban/route.ts` - Kanban CRUD
- `web/src/app/api/bridge/[...path]/route.ts` - Bridge proxy
- `web/src/app/api/commands/route.ts` - Commands CRUD
- `web/src/app/api/commands/stream/route.ts` - SSE for command file changes
- `web/src/app/api/system-stats/route.ts` - CPU/memory metrics
- `web/src/app/api/areas/route.ts` - Available areas list
- `web/src/app/api/terminal-classes/route.ts` - Terminal class definitions
- `web/src/app/api/claude-actions/route.ts` - Commands in ClaudeActionsConfig format
- `web/src/app/api/toolkit/route.ts` - Scan all project assets, build matrix
- `web/src/app/api/toolkit/sync/route.ts` - Batch deploy/remove assets
- `web/src/app/api/toolkit/import/route.ts` - Import asset from project to ClaudeMaster
- `web/src/app/api/events/route.ts` - Query activity log with filters
- `web/src/app/api/search/route.ts` - Cross-project card search
- `web/src/app/api/projects/route.ts` - List/create projects
- `web/src/app/api/projects/[id]/route.ts` - GET/PUT/DELETE individual project
- `web/src/app/api/projects/analyze/route.ts` - Analyze directory before scaffolding
- `web/src/app/api/providers/route.ts` - GET/PUT for providers.json (provider list + stage defaults)
- `web/src/app/api/file/route.ts` - Read files from approved directories
- `web/src/app/api/git-status/route.ts` - Git status for projects

## Key Functions

- `ProjectKanban.handleDragEnd()` - Reorders cards, handles cross-column moves
- `ConnectionManager.createManagedEventSource()` - Auto-reconnecting SSE with backoff
- `getStartupCommands(commands, terminalClass, hasHistory)` - Filter commands for session start
- `getActiveCommands(commands, terminalClass)` - Filter commands for running session toolbar
- `scanProjectAssets()` - Scan commands/skills/agents across projects, build matrix
- `calculateHealthScore()` - Score 0-100 based on configurable weighted factors

## CardModal Tabs

- **Details** - Edit fields, dropdowns for stage/priority, editable areas/tags chips, delete button
- **Design** - Shows if `design_ref` exists, renders markdown with copy path button
- **Feature** - Shows if `feature_ref` exists, renders markdown
- **Test** - Shows if `test_ref` exists, renders markdown
- **Checklist** - Interactive checkboxes with progress bar (uses ref-based state for rapid clicks)
- **Terminal** - AI session with provider selector, auto-connect, startupCommands/activeCommands

CardModal uses edit session protection: last-known-value tracking, 2000ms grace period for field editing, prevents overwriting active edits from external updates.

## Health Scoring

- **Factors**: outdated assets, stale cards, unresolved problems, missing CLAUDE.md, non-compliant frontmatter
- **Levels**: green (≥80), amber (≥50), red (<50)
- **Display**: HealthDot component with tooltip showing score breakdown
- Located on ProjectCard in Dashboard

## Toolkit (Asset Management)

- Scans commands/skills/agents across all projects
- Frontmatter validation: name, version, updated, description required
- Version comparison for detecting outdated assets
- Matrix view: rows=assets, columns=projects, cells=status
- Batch operations: deploy to / remove from projects
- Import from project back to ClaudeMaster

## Connection Management

- `ConnectionManager` - Singleton managing all SSE connections
- Page Visibility API detection for sleep/wake cycles
- Exponential backoff with jitter (1s initial, 30s max)
- `ConnectionStatusIndicator` - Toast showing "Reconnecting..." during recovery

## Data Models

- `KanbanCard` - id, title, description, type, priority, order, areas[], tags[], problems[], checklist[], archived?, design_ref?, feature_ref?, test_ref?, claude_session?
- `Command` - label, description, group, cardTypes[], prompt, visibleIn, scope, sessionState
- `BridgeStats` - bridgeTerminals, connectedClients, activelyWorking, sessions[]
- `SystemStats` - cpu (0-100), memory {used, total}, swap {used, total}
- `SessionActivity` - name, status, lastOutputAt, isActive
- `AssetInfo` - name, type, version, updated, description, filePath, frontmatter
- `AssetCell` - status (present|outdated|missing|extra), masterVersion?, projectVersion?
- `ToolkitData` - rows (AssetRow[]), projects (string[])
- `HealthScore` - score (0-100), level (green|amber|red), factors[]
- `ActivityEvent` - type, timestamp, project, detail, cardId?
- `SearchResult` - card, project, matchedFields[]
- `ProjectWithBacklog` - extends Project with assets, gitUncommitted, healthScore, platforms, lastActivity, activeSessions
- `ProvidersData` - providers (Record<id, ProviderConfig>), defaults (stages, global, projects)
- `ProviderConfig` - id, displayName, command, permissions, resume, prompt

## Design System — SlyCode Neon Theme

### Philosophy
Neon-minimalist aesthetic. Clean surfaces with subtle texture for life and depth. Never sterile/flat, never over-the-top. The theme should feel like a premium tool — atmospheric but professional. Light mode is clean with color; dark mode is moody with glow.

### Color Palette
- **Neon Blue** (`--neon-blue: #00bfff`) — Primary accent, design/implementation lanes, links, active states
- **Neon Orange** (`--neon-orange: #ff8c00`) — Global/project terminal headers, warnings
- **Red-Orange** (`#ff6a33`) — Testing lane (NOT standard orange, which looks brown in dark mode)
- **Green** — Done lane, success states, running indicators
- **Void** — Neutral grey scale for backgrounds, borders, muted text
- **Red** (`#ff3b5c`) — Critical/bug indicators, stop buttons

### Critical Color Lesson
Dark-end scale colors (e.g. `neon-orange-950 = #2b1700`) are inherently brown. For vibrant dark mode colors, use the BRIGHT color at LOW OPACITY (e.g. `neon-orange-400/15`) instead of dark scale values.

### Texture System (globals.css)
Three-layer texture approach for gradient surfaces:

1. **Fine grain** (`.grain`) — High-frequency SVG feTurbulence noise (`baseFrequency: 0.65`), overlay blend. Desaturate with `feColorMatrix type='saturate' values='0'` when color neutrality matters.
2. **Perlin noise** (`.depth-glow`) — Low-frequency organic texture (`baseFrequency: 0.015` light, `0.012` dark), large 400px tiles. Light mode uses `screen` blend (lightens), dark mode uses `soft-light`. Masked with left-to-right gradient fade.
3. **Terminal texture** (`.terminal-texture`) — CRT-like grain + vignette + lane-colored tint via `--terminal-tint` CSS variable. Box-shaped mask (edges visible, centre clear). Light: `soft-light` blend. Dark: `screen` blend (avoids warm/red cast from `soft-light` on dark backgrounds).

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
- Files: `slycode_light.png` / `slycode.png` (hero), `slycode_logo_light.png` / `slycode_logo.png` (nav)

### Lane-Colored Theming
Stage colors flow through multiple layers:
- **KanbanColumn headers** — `colorClasses` map with header gradient, text, count badge, border
- **CardModal header/tabs** — `stageModalStyles` map with gradients, borders per stage. Uses transparency (85% → 50%) for subtle glass quality
- **CardModal footer** — `stageTerminalColors` with colored top border
- **Terminal tint** — `stageTerminalTint` map provides rgba color → passed as `tintColor` prop → sets `--terminal-tint` CSS variable on terminal overlay

### Gradient Direction Convention
Left-to-right, vibrant-to-soft. The left/start side is always the stronger color, fading lighter toward the right. Never center-out fades (looks artificial).

### Button Aesthetic — Neon Glass
Terminal/action buttons use semi-transparent backgrounds with colored borders and hover glow:
```
border border-{color}-400/40 bg-{color}-400/15 text-{color}-400
hover:bg-{color}-400/25 hover:shadow-[0_0_12px_rgba(...,0.3)]
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

- Cards auto-save on changes via `/api/kanban` PUT
- Kanban data stored in `documentation/kanban.json` per project
- Stage order: backlog → design → implementation → testing → done
- Active glow: `active-glow-card` CSS class with pulse animation (2s activity threshold)
- Commands use `startupCommands` (session start) and `activeCommands` (running toolbar)
- SSE connections managed centrally via ConnectionManager for reconnection
- Dynamic path resolution via paths.ts (no hardcoded paths)
- Cross-tab sync via BroadcastChannel API
- Number keys 1-9 jump to projects, Escape closes modals
- Event log capped at 500 entries, append-only
- Session names include provider segment: `{projectId}:{provider}:card:{cardId}`
- Provider selector shown on no-session screen, pre-filled from stage defaults
- CardModal detects existing session's provider from session name for pre-selection
- ProjectKanban/ProjectPageClient use regex patterns to match both new and legacy session names

## When to Expand

- Editing card behavior → CardModal.tsx
- Kanban drag/drop issues → ProjectKanban.tsx, KanbanColumn.tsx
- Adding new card fields → types.ts, CardModal.tsx
- Command configuration → CommandConfigModal.tsx, data/commands.json
- Health monitoring → HealthMonitor.tsx, /api/system-stats
- Connection issues → connection-manager.ts, ConnectionStatusIndicator.tsx
- Terminal panel behavior → ClaudeTerminalPanel.tsx
- Provider selection → ClaudeTerminalPanel.tsx, /api/providers, data/providers.json
- Provider detection for existing sessions → CardModal.tsx (session name parsing)
- Asset management → asset-scanner.ts, ToolkitTab.tsx, AssetMatrix.tsx
- Health scoring → health-score.ts, HealthDot.tsx
- Activity feed → event-log.ts, ActivityFeed.tsx
- Project scaffolding → AddProjectModal.tsx, /api/projects
- Search → SearchBar.tsx, /api/search
- Path resolution → paths.ts, kanban-paths.ts
- Keyboard shortcuts → useKeyboardShortcuts.ts
- Theme/design system → globals.css (texture classes), CardModal.tsx (stageModalStyles), KanbanColumn.tsx (colorClasses), GlobalClaudePanel.tsx (terminal header), Terminal.tsx (tintColor, terminal-texture)
