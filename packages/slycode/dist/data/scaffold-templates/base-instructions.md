# {{PROJECT_NAME}}

{{PROVIDER_HEADER}}

## Purpose

<!-- Describe what this project does and why it exists -->

## Directory Structure

```
{{PROJECT_NAME}}/
├── {{INSTRUCTION_FILENAME}}            # This file
├── .claude/
│   ├── commands/                # Slash commands
│   └── skills/                  # Managed skills
└── documentation/
    ├── kanban.json              # Kanban card data - DON'T EDIT DIRECTLY
    ├── events.json              # Event log
    ├── chores/                  # Chore plans
    │   └── completed/           # Completed chores
    ├── features/                # Feature specifications
    ├── designs/                 # Design documents
    ├── interactive/             # Interactive HTML explainers
    ├── reference/               # Reference documentation
    ├── archive/                 # Kanban backups
    └── temp/                    # Temporary working files
```

## Key Files

<!-- List the most important files and entry points -->

## Workflow

<!-- Describe how work gets done in this project -->

{{PROVIDER_NOTES}}

## Session Continuity

After a context compaction or session continuation, reload context-priming (`/context-priming`) with the relevant areas for your current work. The summary preserves decisions and file paths but loses operational knowledge from skills and area references.

## Kanban Board

**IMPORTANT:** Always use the `sly-kanban` CLI to manage cards. Keep the kanban board up-to-date as work progresses — move cards between stages, add problems, and check off items as they are completed.

### Commands

```bash
sly-kanban search                      # List all cards
sly-kanban search --stage backlog      # Filter by stage
sly-kanban show <card-id>              # Full card details
sly-kanban create --title "Title" --description "..." --type feature --stage backlog
sly-kanban update <card-id> --title "New title"
sly-kanban move <card-id> design       # Stages: backlog, design, implementation, testing, done
sly-kanban checklist <card-id> add "Task to complete"
sly-kanban checklist <card-id> toggle <item-id>
sly-kanban problem <card-id> add "Issue description"
sly-kanban notes <card-id> add "Context for next session" --agent "Claude"

# Automation cards (scheduled prompt execution)
sly-kanban create --title "Nightly tests" --type chore --automation
sly-kanban automation configure <card-id> --schedule "0 6 * * *" --provider claude
sly-kanban automation enable <card-id>
sly-kanban automation run <card-id>    # Manual trigger
sly-kanban automation list             # List all automation cards
# Card description = automation prompt. Automation cards live outside kanban lanes.
```

### Linking Documents to Cards

**IMPORTANT:** When you create a design document, feature spec, or test plan for a card, you MUST link it using the CLI ref flags — not just mention the path in the description. The web UI uses these fields to render document tabs on the card modal.

```bash
sly-kanban update <card-id> --design-ref "documentation/designs/my_design.md"
sly-kanban update <card-id> --feature-ref "documentation/features/NNN_my_feature.md"
sly-kanban update <card-id> --test-ref "documentation/tests/my_test_plan.md"
```

Without these refs, documents won't appear as tabs on the card and will be disconnected from the workflow.

## Messaging

Use `sly-messaging` to send responses back to the user via their messaging channel (Telegram, Slack, etc.):

```bash
sly-messaging send "Your message here"        # Text message
sly-messaging send "Your message here" --tts   # Voice message
```

## Versioning Convention

All skills and commands use **semantic versioning** with dates in their YAML frontmatter:

```yaml
---
version: 1.0.0
updated: YYYY-MM-DD
# ... other frontmatter
---
```

**Version Format:** `MAJOR.MINOR.PATCH`
- **MAJOR**: Breaking changes or significant rewrites
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, minor tweaks

**Update Rules:**
1. Always update `version` when making changes
2. Always update `updated` date to current date
3. Use `date` command in bash to get accurate date
4. Increment appropriately based on change scope

## Git Commit Rules

- Do NOT include AI attribution
- Keep messages concise and descriptive
- Explain WHAT and WHY
