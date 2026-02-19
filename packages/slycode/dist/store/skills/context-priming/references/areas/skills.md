# Skills & Infrastructure

Updated: 2026-03-14

## Overview

SlyCode is the central hub for reusable AI coding assets (skills, agents, configs). All commands have been converted to skills — everything is now a skill with SKILL.md. Agents handle autonomous workflows, and hooks execute on events. Includes global CLI setup, service management scripts, and project scaffolding. This repo tests new skills before deploying to other projects.

## Key Files

### Skills (17 total — all commands converted to skills)
- `.claude/skills/context-priming/` - Dynamic codebase context loader
- `.claude/skills/interactive-explainer/` - Creates visual HTML explainers
- `.claude/skills/skill-creator/` - Guide for creating new skills
- `.claude/skills/messaging/` - Send text/voice responses to messaging channels (v2.2.0)
- `.claude/skills/claude-code-docs-maintainer/` - Maintains Claude Code documentation
- `.claude/skills/kanban/` - Kanban board management (v1.4.0), notes + automation subcommands, multiline description support
- `.claude/skills/checkpoint/` - Git checkpoint creation
- `.claude/skills/feature/` - Create feature specifications
- `.claude/skills/chore/` - Create chore/maintenance plans
- `.claude/skills/implement/` - Execute plans
- `.claude/skills/design/` - Start iterative design document
- `.claude/skills/doc-discovery/` - Documentation discovery
- `.claude/skills/doc-update/` - Documentation updates
- `.claude/skills/reference-fetch/` - Fetch external docs
- `.claude/skills/create-command/` - Meta-command for new commands
- `.claude/skills/problem_summary/` - Summarize debugging issues
- `.claude/skills/convert-asset/` - Convert store asset between provider formats

### Agents
- `.claude/agents/doc-updater.md` - Autonomous documentation maintenance agent

### Commands (REMOVED)
- `.claude/commands/` directory no longer exists — all converted to `.claude/skills/*/SKILL.md`

### Scripts
- `scripts/setup.sh` - Guided setup: environment, services, global CLI, linger
- `scripts/sly-start.sh` - Start all services (web, bridge, messaging)
- `scripts/sly-stop.sh` - Stop all services
- `scripts/sly-restart.sh` - Restart all services
- `scripts/sly-dev.sh` - Development mode launcher
- `sly-kanban` - Kanban CLI tool (installed globally as `sly-kanban`), board/reorder/notes/automation subcommands, last_modified_by tracking. Sequential card numbers (auto-backfilled on first run, `nextCardNumber` on kanban root). Notes: summarize subcommand (oldest/summarize), 100 hard cap, 30 soft suggestion threshold. Archive safeguard: automation cards cannot be archived (bulk `archive done` skips them with count, individual archive rejects with error). `automation enable` no longer recalculates nextRun locally (moved server-side to web scheduler/kanban API).
- `scripts/scaffold.js` - Project scaffolding CLI (installed globally as `sly-scaffold`), multi-provider support (Claude/Codex/Gemini), provider overlay templates, purpose-grouped scaffold plan, overwrite protection, clean output (suppresses zero-count copied/created lines, reports new vs existing doc dirs)
- `scripts/migrate-store.sh` - Migrates store from provider-split to canonical flat layout
- `scripts/migrate-sly-actions.js` - One-time v2→v3 sly-actions.json migration (sessionState→placement, visibleIn.classes→classAssignments) [historical]
- `scripts/convert-actions-to-md.js` - One-time v3→v4 migration: converts sly-actions.json to individual .md files in store/actions/

### Store (Canonical Layout)
- `store/skills/` - 17 canonical skill definitions (single source of truth, includes dummy)
- `store/actions/` - Individual action .md files (v4.0 format: YAML frontmatter + prompt body)
- `store/agents/` - Agent definitions (doc-updater.md)
- `store/mcp/` - MCP module configs (context7.json)
- `store/.backups/` - Backup copies created when accepting updates
- `store/.ignored-updates.json` - Tracks dismissed update versions
- `.agents/skills/` - Codex-format copies deployed to SlyCode (7 skills: chore, context-priming, design, feature, implement, kanban, messaging)

### Update Delivery
- `updates/skills/` - Staged skill updates awaiting acceptance
- `updates/actions/` - Staged action updates (content-hash based comparison)
- `updates/agents/` - Staged agent updates
- `updates/claude/` - Provider-specific update overrides
- Workflow: updates/ → accept → store/ (with backup) → deploy to projects
- Actions use additive class merge on accept: keeps user's class customizations, adds new upstream classes

### NPM Distribution
- `packages/slycode/` - Main npm package (`@slycode/slycode` v0.1.11): `slycode` CLI with workspace, start, stop, service, doctor, skills, sync, update, config, uninstall subcommands
- `packages/create-slycode/` - Scaffold tool (`@slycode/create-slycode` v0.1.11): `create-slycode` for initializing new workspaces. Setup wizard prompts for timezone (auto-detects via `Intl.DateTimeFormat`, writes `TZ=` to .env for cron scheduling). System service prompt skipped on Windows. Tutorial content seeded into workspace root (not a separate `slycode_tutorial/` subdirectory). Kanban seed uses correct stage-based format (`project_id`, `stages`, `last_updated`). Registry seeds workspace root as default project (id: `slycode`).
- Both packages under `@slycode` npm scope. Template paths resolve via `node_modules/@slycode/slycode/templates/`.
- `slycode config [key] [value]` - View/modify slycode.config.js via CLI
- `slycode uninstall` - Remove services and CLI tools (preserves workspace)
- `slycode sync` - Refresh workspace updates/ from package templates
- `slycode update` - Platform-aware restart (systemd/launchd/Windows Task Scheduler/background)
- `slycode start` auto-refreshes updates on startup + npm version check (3s timeout)

### Build Pipeline
- `build/build-package.ts` - Full build script: builds services, syncs updates, copies templates to packages/slycode/. Copies `data/scaffold-templates/`, `store/`, `updates/actions/` to dist/ for runtime access. Also copies store/actions/ to packages/slycode/templates/store/actions/ for scaffold seeding. Removed sly-actions.json template (actions now individual .md files).
- `build/sync-updates.ts` - Sync manifest skills + actions from store/ to updates/ (enforces manifest as authority). Returns `{ skills: SyncResult, actions: SyncResult }`.
- `build/store-manifest.js` - Curated list of skills and actions included in npm package and updates

### Scaffold Templates
- `data/scaffold-templates/` - Blessed defaults for new workspaces. Sourced by build pipeline instead of `data/*.json` (working copies may have local changes).
  - `base-instructions.md` (provider-neutral, replaces claude-md.md), `kanban.json`, `mcp.json`, `gitignore`, `archive-readme.md`, `seed-cards.json`, `events.json`
  - `providers.json` — seeded into new workspaces by create-slycode (sly-actions.json removed — actions now in store/actions/*.md)
  - `overlays/` - Provider-specific instruction overlays (`claude.md`, `codex.md`, `gemini.md`)
  - To update templates: manually copy `data/*.json` → `data/scaffold-templates/*.json`

### Config
- `.claude/settings.local.json` - Local Claude settings
- `.mcp.json` - MCP server configuration (Context7, etc.)
- `.env` / `.env.example` - Environment config with service ports
- `CLAUDE.md` - Project instructions for Claude
- `AGENTS.md` - Project instructions for Codex provider (mirrors CLAUDE.md content)

### Licensing
- `LICENSE` - Business Source License 1.1 (BUSL-1.1)
- `LICENSING.md` - Human-readable licensing guide (open-core model)
- All package.json files set `"license": "BUSL-1.1"` (web, bridge, messaging, slycode, create-slycode)
- Design doc: `documentation/designs/open_core_licensing.md`

### Documentation
- `documentation/kanban.json` - Kanban card data
- `documentation/events.json` - Activity event log (card moves, asset operations, sessions)
- `documentation/terminal-classes.json` - Terminal class definitions
- `documentation/features/` - Feature specs (001-049)
- `documentation/chores/` - Chore plans (active + completed/)
- `documentation/designs/` - Design documents
- `documentation/reference/` - Reference documentation

## Skill Structure

```
.claude/skills/{skill-name}/
├── SKILL.md           # Main skill definition, invocation rules
└── references/        # Supporting docs, templates, examples
```

All user-invocable operations are now skills (no separate commands directory).

## Global CLI Commands

After `scripts/setup.sh`, these are available globally:
- `sly-kanban` - Kanban board management
- `sly-messaging` - Send messages via messaging channels
- `sly-scaffold` - Project scaffolding

## Service Management

- `scripts/sly-start.sh` - Start all services (web on 7591, bridge on 7592, messaging on 7593)
- `scripts/sly-stop.sh` - Stop all services
- `scripts/setup.sh --service` - Install as persistent system services
- `scripts/setup.sh --remove-service` - Remove persistent services

## Environment Variables (.env.example)

- **TZ**: IANA timezone for cron schedule evaluation (e.g., Australia/Melbourne). Defaults to UTC if unset.
- **Ports**: WEB_PORT=7591, BRIDGE_PORT=7592, MESSAGING_SERVICE_PORT=7593
- **Bridge**: BRIDGE_URL for bridge connection
- **Telegram**: TELEGRAM_BOT_TOKEN, TELEGRAM_AUTHORIZED_USER_ID
- **STT**: STT_BACKEND (openai|local), OPENAI_API_KEY (Whisper API), WHISPER_CLI_PATH + WHISPER_MODEL_PATH (local whisper.cpp)
- **TTS**: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_VOICE_SPEED

## Hooks

- `web/src/hooks/useKeyboardShortcuts.ts` - Number keys 1-9 for project navigation, Escape
- `web/src/hooks/useSlyActionsConfig.ts` - Polling-based commands config (30s)
- `web/src/hooks/useConnectionStatus.ts` - SSE connection state
- `web/src/hooks/usePolling.ts` - Generic polling hook

## Patterns & Invariants

- Skills use semantic versioning (MAJOR.MINOR.PATCH)
- Always update version and date when modifying skills
- Skills invoked via `/skill-name` shorthand (commands no longer exist as separate entity)
- CLAUDE.md applies to entire project, overrides defaults
- MCP servers configured in .mcp.json (Context7 for docs)
- Event log in documentation/events.json tracks card moves, asset ops, sessions (500 cap)
- Store uses canonical flat layout: `store/skills/`, `store/actions/`, `store/agents/`, `store/mcp/` (no provider subdirectories)
- Skill import defaults to SKILL.md-only (via `skillMainOnly` flag on store POST) to avoid overwriting references/. Full folder import available via ImportDialog.
- Assets deployed from store to projects (including SlyCode itself)
- Codex-format skills live in `.agents/skills/`, Claude in `.claude/skills/`
- Update delivery: `updates/` → accept → `store/` (with backup) → deploy to projects
- `store/.ignored-updates.json` tracks dismissed update versions per asset
- Scaffold uses overwrite protection: copyDirRecursive defaults to skip-existing, all template files check existence. Tutorial content seeded into workspace root via `seedTutorialWorkspaceContent()` (not separate subdirectory).
- CLAUDE.release.md + templates/CLAUDE.md: AI-operated CLI policy — treat CLI tools as AI-operated, don't instruct users to run CLI commands, execute and report results plainly
- Scaffold uses multi-provider overlays: base-instructions.md + overlays/{provider}.md for provider-specific setup
- Scaffold groups items by purpose: AI Config, Project Management, Documentation, Skills, Configuration
- Build pipeline: sync-updates.ts enforces store-manifest.js as authority for both skills and actions, removes non-manifest items from updates/. build-package.ts copies scaffold-templates/, store/, and updates/actions/ to dist/ for prod runtime access. Templates (skills, actions, tutorial-project) removed from packages/slycode/templates/ — build pipeline is the sole delivery mechanism.
- Scaffold seeds `providers.json` from `data/scaffold-templates/` into new workspaces (create-slycode). Actions delivered via updates/actions/ instead of scaffold template.
- kanban.js stamps `last_modified_by: 'cli'` on all write operations and `source: 'cli'` on events. Uses dynamic `PROJECT_NAME` (from workspace basename) for event project field and session names — no hardcoded 'claude-master'.
- kanban.js has `board` (--all/--stages/--inflight/--compact), `reorder` (positional card IDs or --top/--bottom/--position), `notes` (add/list/search/edit/delete/clear/oldest/summarize), and `automation` (configure/enable/disable/run/status/list) subcommands
- Card numbers: `backfillCardNumbers()` sorts all cards by created_at and assigns sequential numbers. `ensureCardNumbers()` auto-runs on first create. Verbose format shows `(#0001)`. Search includes automation cards when query is provided (only bare search excludes them).
- Notes summarization: `notes oldest [N]` shows oldest N notes, `notes summarize "text" --count N --agent "Name"` replaces oldest N with a summary note (marked `summary: true`, tracks `summarizedCount` and `dateRange`). Hard cap 100 notes, soft suggestion at 30.
- `kanban reorder` sets order 10,20,30... on listed cards; unlisted cards keep relative order but sort after prioritized ones
- Automation uses card description as prompt (no separate --prompt option). `automation run` sends card description to bridge session.

## Environment

- `CLAUDE_ENV` - 'home' or 'work' for environment detection
- Projects tracked in `projects/registry.json`

## When to Expand

- Creating new skill → skill-creator skill, .claude/skills/
- Creating new command → create-command skill, creates a new skill in .claude/skills/
- Creating new agent → .claude/agents/
- Cross-provider assets → store/, .agents/skills/, convert-asset skill
- Skill updates → updates/ directory, web UpdatesView, store/.ignored-updates.json
- NPM distribution → packages/slycode/, packages/create-slycode/
- Store migration → scripts/migrate-store.sh
- Modifying agent behavior → CLAUDE.md
- Adding MCP servers → .mcp.json
- Service management → scripts/sly-*.sh
- Setup/installation → scripts/setup.sh
- Project scaffolding → scripts/scaffold.js, data/scaffold-templates/, data/scaffold-templates/overlays/
- Build pipeline → build/build-package.ts, build/sync-updates.ts, build/store-manifest.js
- Activity events → documentation/events.json, web/src/lib/event-log.ts
