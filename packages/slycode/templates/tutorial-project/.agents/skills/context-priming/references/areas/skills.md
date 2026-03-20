# Skills & Infrastructure

Updated: 2026-02-09

## Overview

ClaudeMaster is the central hub for reusable Claude Code assets. Skills provide specialized capabilities, commands are user-invocable shortcuts, agents handle autonomous workflows, and hooks execute on events. Includes global CLI setup, service management scripts, and project scaffolding. This repo tests new skills before deploying to other projects.

## Key Files

### Skills
- `.claude/skills/context-priming/` - Dynamic codebase context loader
- `.claude/skills/interactive-explainer/` - Creates visual HTML explainers
- `.claude/skills/skill-creator/` - Guide for creating new skills
- `.claude/skills/messaging/` - Send text/voice responses to messaging channels (v2.2.0)
- `.claude/skills/claude-code-docs-maintainer/` - Maintains Claude Code documentation
- `.claude/skills/kanban/` - Kanban board management skill

### Agents
- `.claude/agents/doc-updater.md` - Autonomous documentation maintenance agent

### Commands
- `.claude/commands/checkpoint.md` - Git checkpoint creation
- `.claude/commands/feature.md` - Create feature specifications
- `.claude/commands/chore.md` - Create chore/maintenance plans
- `.claude/commands/implement.md` - Execute plans
- `.claude/commands/design.md` - Start iterative design document
- `.claude/commands/doc-discovery.md` - Documentation discovery
- `.claude/commands/doc-update.md` - Documentation updates
- `.claude/commands/reference-fetch.md` - Fetch external docs
- `.claude/commands/create-command.md` - Meta-command for new commands
- `.claude/commands/problem_summary.md` - Summarize debugging issues

### Scripts
- `scripts/setup.sh` - Guided setup: environment, services, global CLI, linger
- `scripts/sly-start.sh` - Start all services (web, bridge, messaging)
- `scripts/sly-stop.sh` - Stop all services
- `scripts/sly-restart.sh` - Restart all services
- `scripts/sly-dev.sh` - Development mode launcher
- `scripts/kanban.js` - Kanban CLI tool (installed globally as `sly-kanban`)
- `scripts/scaffold.js` - Project scaffolding CLI (installed globally as `sly-scaffold`)

### Scaffold Templates
- `data/scaffold-templates/` - Templates for project scaffolding
  - `claude-md.md`, `kanban.json`, `mcp.json`, `gitignore`, `archive-readme.md`, `seed-cards.json`

### Config
- `.claude/settings.local.json` - Local Claude settings
- `.mcp.json` - MCP server configuration (Context7, etc.)
- `.env` / `.env.example` - Environment config with service ports
- `CLAUDE.md` - Project instructions for Claude

### Documentation
- `documentation/kanban.json` - Kanban card data
- `documentation/events.json` - Activity event log (card moves, asset operations, sessions)
- `documentation/terminal-classes.json` - Terminal class definitions
- `documentation/features/` - Feature specs (001-020)
- `documentation/chores/` - Chore plans (active + completed/)
- `documentation/designs/` - Design documents
- `documentation/reference/` - Reference documentation

## Skill Structure

```
.claude/skills/{skill-name}/
├── SKILL.md           # Main skill definition, invocation rules
└── references/        # Supporting docs, templates, examples
```

## Command Structure

```markdown
---
version: X.Y.Z
updated: YYYY-MM-DD
allowed-tools: [Tool1, Tool2]
---
# Command Name
Instructions for Claude when command is invoked
```

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

- **Ports**: WEB_PORT=7591, BRIDGE_PORT=7592, MESSAGING_SERVICE_PORT=7593
- **Bridge**: BRIDGE_URL for bridge connection
- **Telegram**: TELEGRAM_BOT_TOKEN, TELEGRAM_AUTHORIZED_USER_ID
- **STT**: OPENAI_API_KEY (Whisper)
- **TTS**: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, ELEVENLABS_VOICE_SPEED

## Hooks

- `web/src/hooks/useKeyboardShortcuts.ts` - Number keys 1-9 for project navigation, Escape
- `web/src/hooks/useCommandsConfig.ts` - Polling-based commands config (30s)
- `web/src/hooks/useConnectionStatus.ts` - SSE connection state
- `web/src/hooks/usePolling.ts` - Generic polling hook

## Patterns & Invariants

- Skills use semantic versioning (MAJOR.MINOR.PATCH)
- Always update version and date when modifying skills/commands
- Commands invoked via `/command-name` shorthand
- CLAUDE.md applies to entire project, overrides defaults
- MCP servers configured in .mcp.json (Context7 for docs)
- Event log in documentation/events.json tracks card moves, asset ops, sessions (500 cap)

## Environment

- `CLAUDE_ENV` - 'home' or 'work' for environment detection
- Projects tracked in `projects/registry.json`

## When to Expand

- Creating new skill → skill-creator skill, .claude/skills/
- Creating new command → create-command, .claude/commands/
- Creating new agent → .claude/agents/
- Modifying Claude behavior → CLAUDE.md
- Adding MCP servers → .mcp.json
- Service management → scripts/sly-*.sh
- Setup/installation → scripts/setup.sh
- Project scaffolding → scripts/scaffold.js, data/scaffold-templates/
- Activity events → documentation/events.json, web/src/lib/event-log.ts
