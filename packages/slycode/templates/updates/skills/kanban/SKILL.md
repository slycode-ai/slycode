---
name: kanban
version: 1.4.0
updated: 2026-03-11
description: "Manage kanban cards via CLI with commands for search, create, update, move, reorder, problem tracking, cross-agent notes, and scheduled automations"
provider: claude
---

# Kanban CLI Skill

Manage kanban cards via CLI: `sly-kanban <command>`

## Commands

| Command | Description |
|---------|-------------|
| `search` | Find cards by query, stage, type, area |
| `show` | Display full card details (NOT `view`) |
| `create` | Create a new card |
| `update` | Modify card fields |
| `move` | Move card between stages |
| `reorder` | Reorder cards within a stage |
| `archive` | Soft delete a card (not allowed on automation cards) |
| `board` | Show full board snapshot grouped by stage |
| `checklist` | Manage checklist items |
| `problem` | Track issues on cards |
| `notes` | Manage cross-agent notes |
| `automation` | Configure and manage scheduled automations |
| `areas` | List available areas |

## Quick Reference

```bash
# Always start with --help if unsure
sly-kanban --help
sly-kanban <command> --help

# Search cards
sly-kanban search "query"
sly-kanban search --stage backlog
sly-kanban search --type feature

# Show card details (use 'show', NOT 'view')
sly-kanban show card-123

# Create card
sly-kanban create --title "Add feature X" --type feature --priority medium

# Create card with multiline description (use real newlines inside double quotes)
sly-kanban create --title "Add auth" --description "Users need login support.

Acceptance criteria:
- OAuth2 support
- Session timeout warning" --type feature

# Update card
sly-kanban update card-123 --title "New title" --areas "web-frontend,terminal-bridge"

# Link documentation to card
sly-kanban update card-123 --design-ref "documentation/designs/foo.md"
sly-kanban update card-123 --feature-ref "documentation/features/bar.md"

# Move card
sly-kanban move card-123 design

# Reorder cards within a stage
sly-kanban reorder backlog card-1 card-2 card-3   # Full reorder (listed first, rest after)
sly-kanban reorder backlog --top card-2            # Move card to top
sly-kanban reorder backlog --bottom card-5         # Move card to bottom
sly-kanban reorder implementation --position 2 card-7  # Move to position N

# Board snapshot
sly-kanban board                    # Full board (backlog → testing)
sly-kanban board --compact          # One line per card
sly-kanban board --inflight         # Design + implementation + testing only

# Archive card (not allowed on automation cards)
sly-kanban archive card-123

# Checklist management
sly-kanban checklist card-123 list
sly-kanban checklist card-123 add "Write tests"
sly-kanban checklist card-123 toggle check-123

# Problem tracking
sly-kanban problem card-123 list
sly-kanban problem card-123 add "Bug description" --severity major
sly-kanban problem card-123 resolve prob-123
sly-kanban problem card-123 promote prob-123 --type chore

# Agent notes
sly-kanban notes card-123 list
sly-kanban notes card-123 add "Context for next agent" --agent "Claude"
sly-kanban notes card-123 search "blocker"
sly-kanban notes card-123 edit 2 "Updated note text"
sly-kanban notes card-123 delete 3
sly-kanban notes card-123 clear

# List available areas
sly-kanban areas
```

## Best Practices

1. **Always `show` first**: Before any action, run `show <card-id>` to see current state including existing problems
2. **Check existing problems**: The card may already have problems logged - review before adding duplicates
3. **Confirm with user**: When making significant changes, show the user what you plan to do
4. **Use areas**: When creating/updating cards, set appropriate areas for context-priming
5. **Track progress**: Use checklists for multi-step work items
6. **Document problems**: When issues are found during testing, add them with `problem <card-id> add "description"`

## Cross-Agent Notes

Agent notes are a shared scratchpad on each card for passing context between agents and sessions.

**When to use notes:**
- Before starting work: `notes <card-id> list` — read what previous agents left
- After completing a session: leave context about decisions, progress, or blockers
- When hitting a blocker: document the issue so the next agent knows

**Always identify yourself with `--agent`:**
- Claude: `--agent "Claude"`
- Codex: `--agent "Codex"`
- Gemini: `--agent "Gemini"`
- Notes added from the web UI are automatically tagged as `User`

**Limits:** Max 30 notes per card, max 3000 characters per note.

```bash
# Read notes before starting
sly-kanban notes card-123 list

# Leave context after your session
sly-kanban notes card-123 add "Completed API routes, tests passing. Frontend still needs the Notes tab wired up." --agent "Claude"

# Flag a blocker
sly-kanban notes card-123 add "Build fails on node 18 — needs --experimental flag for crypto" --agent "Codex"
```

## Integration with Onboard Action

When using the Onboard action on a backlog card:
1. Analyze and refine the card details through conversation
2. Once the user confirms the refined version, use the CLI to apply changes:
   ```bash
   sly-kanban update <card-id> \
     --title "Refined title" \
     --description "Structured description" \
     --areas "area1,area2" \
     --priority high
   ```

## Linking Documentation

Cards support dedicated reference fields for documentation:

| Field | Flag | Purpose |
|-------|------|---------|
| Design Doc | `--design-ref` | Link to design document |
| Feature Spec | `--feature-ref` | Link to feature specification |
| Test Doc | `--test-ref` | Link to test documentation |

```bash
# Link design doc when moving to design stage
sly-kanban update card-123 --design-ref "documentation/designs/my-feature.md"

# Link feature spec when feature is fully specified
sly-kanban update card-123 --feature-ref "documentation/features/001_my_feature.md"

# Link test doc when test plan exists
sly-kanban update card-123 --test-ref "documentation/tests/my-feature-tests.md"
```

These appear as dedicated fields on the card (not in description).

## Workflow Examples

### Refining a backlog item
```bash
# 1. View current state
sly-kanban show card-123

# 2. Update with refined details
sly-kanban update card-123 \
  --title "Implement user authentication with OAuth" \
  --description "Add Google and GitHub OAuth providers..." \
  --areas "backend,auth" \
  --priority high

# 3. Move to design when ready
sly-kanban move card-123 design
```

### Creating a new task from user request
```bash
# User says: "I need to fix the login button being too small"
sly-kanban create \
  --title "Fix login button size" \
  --type bug \
  --priority medium \
  --areas "web-frontend"
```

### Tracking testing progress
```bash
# Add checklist items
sly-kanban checklist card-123 add "Unit tests pass"
sly-kanban checklist card-123 add "Integration tests pass"
sly-kanban checklist card-123 add "Manual testing complete"

# Mark as done
sly-kanban checklist card-123 toggle check-xxx

# If issues found
sly-kanban problem card-123 add "Login fails after timeout" --severity major
```

### Promoting problems to backlog
When a problem is too big for a quick fix and needs its own design/implementation cycle:
```bash
# Review problems
sly-kanban problem card-123 list

# Promote a problem to a new backlog card
sly-kanban problem card-123 promote prob-xxx --type chore

# The original problem is marked resolved, new card created in backlog
# Card inherits areas from source card, references original in description
```

## Scheduled Automations

Cards can be toggled into automation mode — a scheduled task that fires a prompt into a terminal session at a specified time. One card = one automation.

```bash
# Create an automation card directly
sly-kanban create --title "Nightly test run" --type chore --automation

# Toggle existing card to automation mode
sly-kanban update card-123 --automation true
sly-kanban update card-123 --automation false

# Configure automation (partial updates — only specified fields change)
sly-kanban automation card-123 configure --schedule "0 6 * * *" --prompt "Run all tests" --provider claude
sly-kanban automation card-123 configure --schedule "0 9 * * 1"    # just the schedule
sly-kanban automation card-123 configure --prompt "New prompt"      # just the prompt
sly-kanban automation card-123 configure --fresh-session true
sly-kanban automation card-123 configure --report-messaging true

# Enable / disable
sly-kanban automation card-123 enable
sly-kanban automation card-123 disable

# Manual trigger (calls bridge API directly)
sly-kanban automation card-123 run

# View automation status
sly-kanban automation card-123 status

# List all automation cards
sly-kanban automation list
sly-kanban automation list --tag "deploy"
```

**Key concepts:**
- Automation cards live on a dedicated Automations screen (not in kanban lanes)
- The automation system is a "session starter" — it injects a prompt and confirms activity, nothing more
- Schedule uses cron expressions (recurring) or ISO datetime (one-shot)
- One-shot automations auto-disable after firing, config preserved
- "Report via messaging" toggle appends instructions for the agent to send results

## Error Handling

The CLI provides clear error messages:
- `Card 'xxx' not found` - Check the card ID
- `Invalid stage` - Use: backlog, design, implementation, testing, done
- `Invalid type` - Use: feature, chore, bug
- `Invalid priority` - Use: low, medium, high, critical

## Notes

- The CLI modifies `documentation/kanban.json` directly
- Changes are visible in the web UI on refresh
- Archived cards are hidden by default (use `--include-archived` to see them)
- All timestamps are in ISO format
