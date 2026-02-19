# SlyCode

AI-powered development workspace — your command center for Claude Code projects.

## Tutorial Mode (First Install)

On a fresh SlyCode install, this workspace starts in tutorial mode:
- `documentation/kanban.json` is the tutorial board
- the initial project in `projects/registry.json` points to this workspace root
- users learn by opening cards and using Terminal action buttons

Behavior expectations in tutorial mode:
- prioritize AI-first guidance (click actions; AI performs operations)
- keep responses concise and stage-aware
- avoid requiring users to run `sly-kanban` directly for normal tutorial flow
- treat CLI tools (`sly-kanban`, `slycode`, `sly-messaging`, `sly-scaffold`) as AI-operated tools
- do not instruct users to run CLI commands; execute them as the agent and report results plainly
- avoid unrelated code edits while tutorial cards are in progress

After onboarding, users can add their real projects and continue using this
workspace as their command center.

## Workspace Structure

```
your-workspace/
├── CLAUDE.md                  # This file — project instructions for Claude
├── slycode.config.js          # Port and service configuration
├── .env                       # Environment variables (API keys, tokens)
├── .claude/
│   ├── skills/                # Claude skills (customizable)
│   └── commands/              # Slash commands
├── data/
│   ├── commands.json          # Command definitions
│   └── providers.json         # AI provider configuration
├── documentation/
│   └── kanban.json            # Kanban board data
├── projects/
│   └── registry.json          # Project registry
├── package.json               # Dependencies (includes slycode)
└── node_modules/
    └── slycode/               # Framework (do not edit)
```

## CLI Commands

### Main CLI

```bash
slycode start           # Start all services (web, bridge, messaging)
slycode stop            # Stop all services
slycode doctor          # Diagnose environment issues
slycode service install # Install as system service (auto-start on boot)
slycode service remove  # Remove system service
slycode service status  # Check service status
slycode skills list     # List installed and available skills
slycode skills check    # Check for new/updated skills
slycode skills add NAME # Add a skill from upstream templates
slycode skills reset NAME # Reset a skill to upstream version
slycode uninstall       # Remove services and CLI tools (preserves workspace)
```

### Global CLI Tools

After `slycode service install`, these are available globally:

```bash
sly-kanban              # Kanban board management
sly-messaging           # Send messages via Telegram/Slack
sly-scaffold            # Project scaffolding
```

## Configuration

### slycode.config.js

```js
module.exports = {
  ports: {
    web: 7591,       // Web UI
    bridge: 7592,    // Terminal bridge
    messaging: 7593, // Messaging service
  },
  services: {
    web: true,
    bridge: true,
    messaging: true,
  },
};
```

### Environment Variables (.env)

```
CLAUDE_ENV=home              # Environment: home, work
ANTHROPIC_API_KEY=sk-...     # Required for Claude sessions
TELEGRAM_BOT_TOKEN=...       # Optional: Telegram integration
WEB_PORT=7591
BRIDGE_PORT=7592
MESSAGING_SERVICE_PORT=7593
```

## Customizing Skills

Skills live in `.claude/skills/`. Each skill has a `SKILL.md` file with instructions and optional reference files.

- **Edit freely** — your customizations are yours. `slycode update` never overwrites skills.
- **Check for updates** — `slycode skills check` compares your versions with upstream.
- **Add new skills** — `slycode skills add <name>` installs from upstream templates.
- **Reset to upstream** — `slycode skills reset <name>` (asks for confirmation first).

## Updating SlyCode

```bash
npm update slycode       # Update the framework
slycode skills check     # Check for new/updated skills
slycode doctor           # Verify everything works
```

Updates only affect the framework code in `node_modules/slycode/`. Your workspace files (skills, commands, kanban data, configuration) are never modified.

## Kanban Board

Card management policy:
- AI may use `sly-kanban` internally to read/update cards
- Users should be guided via web UI/Terminal action buttons (not asked to run CLI commands directly)

```bash
sly-kanban search                 # List all cards
sly-kanban search --stage backlog # Filter by stage
sly-kanban create --title "..."   # Create a card
sly-kanban move CARD_ID design    # Move card between stages
sly-kanban show CARD_ID           # View card details
```

## Ports

Default ports spell SLY on a phone keypad:
- **7591** — Web UI (command center)
- **7592** — Bridge (terminal/PTY management)
- **7593** — Messaging (Telegram, Slack)

Override in `slycode.config.js` or `.env`.
