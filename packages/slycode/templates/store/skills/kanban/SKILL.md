---
name: kanban
version: 1.10.0
updated: 2026-05-03
description: "Manage kanban cards via CLI with commands for search, create, update, move, reorder, problem tracking, cross-agent notes, scheduled automations, cross-card prompt execution, AI-set status line (manual + tiered auto-status), and structured questionnaires"
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
| `prompt` | Send a prompt to another card's session (cross-card) |
| `respond` | Reply to a cross-card prompt (--wait callback) |
| `areas` | List available areas |

## Card Identification

All commands accept either a **card ID** or an **exact card title** (case-insensitive, non-archived cards only):

```bash
sly-kanban show card-1234567890      # By ID
sly-kanban show "Test Card"          # By exact title
sly-kanban prompt "Test Card" "do X" # Title works for prompt too
```

If a title doesn't match, use the card ID instead.

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
sly-kanban update card-123 --html-ref "documentation/designs/foo.html"

# Clear an attached document (pass empty string)
sly-kanban update card-123 --html-ref ""

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

# Card status — short progress label visible on the card in the web UI
sly-kanban status card-123                              # print current status
sly-kanban status card-123 "Finished design"            # set status (max 120 chars)
sly-kanban status card-123 --clear                      # clear
sly-kanban status card-123 ""                           # also clears (empty arg)
sly-kanban update card-123 --status "Investigating"     # alternative set form
sly-kanban update card-123 --status ""                  # alternative clear form
sly-kanban move card-123 testing --status "Ready for review"   # move + set status in one shot

# List available areas
sly-kanban areas
```

### Card status line — important behavior

The `status` field is a short, free-form progress label (≤120 chars) that
appears on the card in the kanban web UI and is auto-included in agent context
preambles. There are two kinds:

- **Manual status** — set explicitly by `sly-kanban status`, `update --status`,
  or `move --status`. **Manual is sacred — auto-status NEVER overwrites it.**
- **Auto-status** — emitted automatically by certain CLI write paths (see table
  below). Tiered: high / medium / low. Lower tier can't overwrite higher.

**Move clears status by default.** Without `--status`, moving a card to a
different stage clears the card's status — within-stage progress doesn't carry.
Two ways to keep a status across a transition:

```bash
# Best: one shot — atomic move + manual status
sly-kanban move card-123 testing --status "Ready for review"

# Or: move first, then set
sly-kanban move card-123 testing
sly-kanban status card-123 "Ready for review"

# Wrong: status before move — wiped by the move
sly-kanban status card-123 "Ready for review"
sly-kanban move card-123 testing
```

Status text is normalized at write time (whitespace collapsed, control
characters stripped, capped at 120 grapheme clusters). The card's
onboarding/action context preambles automatically include the current status,
so agents picking up the card should NOT restate it in their first reply.

#### Auto-status — events that emit a status update

These CLI write paths automatically emit a status update when the underlying
operation actually changes state (idempotent re-sets do NOT auto-status):

| Trigger | Tier | Auto-status text |
|---|---|---|
| `update --design-ref <path>` (set) | medium | `Design doc attached` |
| `update --feature-ref <path>` (set) | medium | `Feature spec attached` |
| `update --html-ref <path>` (set) | medium | `HTML attachment added` |
| `update --test-ref <path>` (set) | medium | `Test doc attached` |
| `update` with multiple refs in one call | medium | `Docs attached` (one combined emission) |
| `notes add` | low | `Note added` |
| `checklist add` | low | `Checklist item added: <text>` |
| `checklist toggle` | low | `Checklist: <done>/<total>` |
| `problem add` | high | `Problem reported (<sev>)` |
| `problem resolve` (some open) | medium | `Problem resolved: <N> open` |
| `problem resolve` (all resolved) | medium | `All problems resolved` |
| `prompt` (cross-card, target card) | low | `Prompt received` |

**Tier rules** (manual is level -1, sacred):

- **Manual** can overwrite anything.
- **High-tier auto** overwrites empty/low/medium/equal-high. Cannot overwrite manual.
- **Medium-tier auto** overwrites empty/low/equal-medium. Cannot overwrite manual or high.
- **Low-tier auto** overwrites empty/equal-low. Cannot overwrite manual, high, or medium.

If you set a deliberate `Awaiting your call on color palette`, it survives every
auto event — `Note added`, `Design doc attached`, `Problem reported (critical)`.
Only another manual write (or a stage move) replaces it.

**CLI auto-status is command behavior, not proof of agent provenance.** A human
running `sly-kanban` from a shell triggers auto-status the same way an agent
does. Web UI human edits never auto-status (drag-drop, modal edits, right-click
clear).

#### When to set status manually

Beyond the automatic events, you should set a status manually whenever the card
is in a state that's interesting from the outside, especially when waiting on
something or the user would want to know at a glance. Use this recommended
prefix taxonomy when it fits — vary the wording naturally, don't be robotic:

- `Investigating: <specific area>` — actively digging into a question
- `Blocked: <needed input>` — can't progress without something
- `Waiting: <external/user action>` — paused on someone else
- `Running: <operation>` — long-running work in progress (tests, migration, etc.)
- `Ready: <next step>` — work complete, ready for review/merge/test
- `Done: <result>` — terminal state for this card's current stage

Common moments:

- **Asking the user a question** — set a status so anyone watching the board
  knows you're paused. Pair with the messaging skill (Telegram/Slack):
  `Question pending — see Telegram` or `Awaiting your call on the testing color`.
- **Hand-off / pivotal moment** — `Finished refactor — running tests`.
- **Long-running operation** — `Running full test suite (~5min)`.

When in doubt: prefer **specific** over **generic**. "Awaiting your call on the
testing color" beats "Waiting".

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
| Design Doc | `--design-ref` | Link to design document (Markdown) |
| Feature Spec | `--feature-ref` | Link to feature specification (Markdown) |
| Test Doc | `--test-ref` | Link to test documentation (Markdown) |
| HTML Attachment | `--html-ref` | Link to a single self-contained HTML file (rendered in a sandboxed iframe in the card modal) |
| Questionnaire | `--questionnaire-ref` | Append a structured Q&A questionnaire (JSON, multiple per card). See "Questionnaires" below. |

```bash
# Link design doc when moving to design stage
sly-kanban update card-123 --design-ref "documentation/designs/my-feature.md"

# Link feature spec when feature is fully specified
sly-kanban update card-123 --feature-ref "documentation/features/001_my_feature.md"

# Link test doc when test plan exists
sly-kanban update card-123 --test-ref "documentation/tests/my-feature-tests.md"

# Link an HTML mockup, POC, or interactive preview
sly-kanban update card-123 --html-ref "documentation/designs/my-feature-mockup.html"

# Append a questionnaire (cards can have multiple)
sly-kanban update card-123 --questionnaire-ref "documentation/questionnaires/001_scope.json"

# Clear any ref by passing an empty string (for questionnaires, clears ALL)
sly-kanban update card-123 --design-ref ""
sly-kanban update card-123 --questionnaire-ref ""
```

These appear as dedicated fields on the card (not in description).

**HTML attachment notes:** the file is rendered inside a sandboxed iframe (`sandbox="allow-scripts"`) with a tightened CSP (`connect-src 'none'`, `img-src data:`, `script-src https:`). This means:

- Library `<script src="https://cdn...">` tags work — load Tailwind, D3, etc. from any HTTPS CDN.
- Inline `<script>` and `<style>` blocks work.
- Web fonts work over HTTPS.
- `fetch` / XHR / WebSocket / EventSource are blocked (no runtime API calls).
- Remote images (`<img src="https://...">`) are blocked — embed images as `data:` URIs.
- The HTML cannot reach SlyCode app state (cookies, localStorage, /api/kanban, parent page).

The intended use is single-file mockups, design previews, and small interactive POCs — not full web apps.

## Questionnaires

Cards support **structured Q&A questionnaires** as a sibling artifact to design / feature / HTML / test refs. Use a questionnaire when you need to ask the user **3 or more related questions** — anything less, ask inline. Questionnaires give the user a focused fill-out form (autosave, the right input control per question, single Submit), and the answers come back as a Q&A prose block in the terminal.

### When to author one

**Threshold: ≥ 3 related questions** in one round → questionnaire. 1-2 questions → ask inline. The user often replies via voice/speech-to-text, where long inline question batches are hard to answer accurately; questionnaires sidestep that with proper input controls.

Concrete situations where a questionnaire is the right call:

- **Requirements discovery** — clarifying scope, acceptance criteria, constraints, technical preferences when many things are unknown at once (e.g., during `/design` or a deep-design session).
- **Multiple decisions / trade-offs after analysis** — after a synthesis phase produces several options to choose between (e.g., post-deep-design synthesis, cross-agent challenge review with multiple findings).
- **Structured verification** — batch confirmation questions like "did X work? did Y work? was Z deferred?" where boolean toggles or single_choice make answering faster than typing.
- **Debug intake** — gathering repro steps, environment, recent changes, expected vs actual when 3+ unknowns block investigation.
- **Chore scoping** — when a maintenance plan needs multiple inputs (scope, approach, risk tolerance, rollback strategy) before it can be written.

**When NOT to use one:**

- 1-2 inline questions — overhead isn't worth it.
- Action-oriented commands where the user just wants execution (`implement`, `complete`, `approve`).
- Output-only flows where you're presenting results, not asking decisions (`review`, `summarize`, `explore`).
- The `/feature` skill — it runs its own discovery; don't wrap it with a questionnaire.
- **When responding via messaging (Telegram, Slack, etc.)** — the user is interacting through the messaging channel and won't see the questionnaire on the card. Ask inline in the messaging response instead.

**Workflow expectations:**

- After Submit, fold the answers into the relevant artifact (design doc, chore plan, etc.) — don't leave them sitting only in the questionnaire.
- The submit is **async** — the user fills at their own pace. Don't block waiting; do other useful work or hand back to the user. The Q&A block lands in your terminal session when they submit.
- Item ids are load-bearing once the user starts answering — don't rename ids in a questionnaire that has live answers.

### How to author one

The agent writes the JSON file directly — same pattern as feature specs.

1. Pick the next available integer prefix in `documentation/questionnaires/` (e.g., `001_`, `002_` — same convention as feature specs).
2. Write the JSON to `documentation/questionnaires/NNN_<name>.json`. The `name` field in the JSON SHOULD match the `<name>` slug in the filename.
3. Attach to the card: `sly-kanban update <card-id> --questionnaire-ref documentation/questionnaires/NNN_<name>.json`.
4. Tell the user it's there ("I've added a questionnaire — open the card and fill out the Questionnaires tab").

### JSON schema

```json
{
  "name": "migration_scope",
  "title": "Migration scope clarifications",
  "intro": "Some context before we start...",
  "status": "draft",
  "schema_version": 1,
  "updated_at": "2026-05-03T00:00:00.000Z",
  "submitted_at": null,
  "submission_count": 0,
  "items": [
    { "type": "exposition", "text": "Background paragraph that explains what we're about to ask." },
    { "type": "free_text", "id": "q1", "question": "What's the rollout window?", "required": true, "answer": null },
    { "type": "single_choice", "id": "q2", "question": "Which environment goes first?", "options": ["Dev", "Staging", "Prod"], "answer": null },
    { "type": "single_choice", "id": "q3", "question": "Preferred rollback strategy?", "options": ["Feature flag", "Git revert", "DB snapshot"], "allow_other": true, "answer": null },
    { "type": "multi_choice", "id": "q4", "question": "Which checks should run pre-deploy?", "options": ["Lint", "Unit", "Integration", "Smoke"], "allow_other": true, "answer": null },
    { "type": "boolean", "id": "q5", "question": "Run on a Friday?", "required": true, "answer": null },
    { "type": "scale", "id": "q6", "question": "How risky is this change?", "min": 1, "max": 5, "step": 1, "answer": null },
    { "type": "number", "id": "q7", "question": "Estimated rollout duration in hours.", "min": 0, "step": 0.5, "answer": null }
  ]
}
```

**Item types:**

| Type | Notes | Answer shape |
|---|---|---|
| `exposition` | Text-only block (no input). Use for intros / context between question groups. | (no answer) |
| `free_text` | Multi-line text input. | `string` |
| `single_choice` | Radio buttons. Add `allow_other: true` for an "Other" option with a free-text field. | `string` (an option, or `"Other: <text>"`) |
| `multi_choice` | Checkboxes. Add `allow_other: true` for an "Other" option with a free-text field. | `string[]` |
| `boolean` | Yes/No toggle. Required-check is `answer !== null` (so `false` is a valid answer). | `boolean` |
| `scale` | Segmented integer scale (e.g. 1-5). Requires `min` and `max`; optional `step` (default 1). | `number` |
| `number` | Free numeric input. Optional `min`, `max`, `step`. | `number` |

**Required questions** (`required: true`) block Submit until answered. Use sparingly — only for things the agent genuinely can't proceed without.

**Item ids** (`q1`, `q2`, …) are load-bearing for the autosave pipeline — the UI patches answers by id. When editing an existing questionnaire you may freely reorder, rename labels, or change wording, but **do not rename or remove ids while a user might be filling it out**. If you do need a structural change after answers exist, the saved values are preserved as-is (the UI shows "(no longer in options)" for stale choice answers).

### Strict format — required fields

**Top-level fields are ALL required for a new questionnaire.** Use these starting values verbatim — the API rejects missing fields with 422:

```jsonc
{
  "name": "<slug>",            // lowercase_with_underscores
  "title": "<human title>",
  "intro": "<optional>",       // OPTIONAL — omit field entirely if not used
  "status": "draft",           // start "draft"
  "schema_version": 1,         // start at 1; bump when editing items
  "updated_at": "<ISO 8601>",  // e.g. 2026-05-03T00:00:00.000Z
  "submitted_at": null,
  "submission_count": 0,
  "items": []
}
```

**Per-item required fields** (in addition to `type`):

- `exposition` → `text` only (no `id`, no `answer`)
- `free_text` → `id`, `question`, `answer` (use `null` until answered)
- `single_choice` / `multi_choice` → `id`, `question`, `options` (non-empty `string[]`), `answer`. Optional: `allow_other: true`
- `boolean` → `id`, `question`, `answer`
- `scale` → `id`, `question`, `min`, `max` (must satisfy `min < max`), `answer`. Optional: `step` (default 1, must be > 0)
- `number` → `id`, `question`, `answer`. Optional: `min`, `max`, `step` (must be > 0 if set)

All non-exposition items also accept `required: true` (default false).

**Authoring rules:**

- Item ids: non-empty strings, unique within the questionnaire, stable once the user starts answering.
- `multi_choice` answer is `null` when nothing is selected (NOT `[]`).
- "Other" answers: store as the literal string `"Other: <text>"` (with a space). For multi_choice, that string lives inside the array.
- `schema_version`: bump by 1 whenever you edit `items` (add/remove a question, reword, change options) so the UI reloads stale forms in any open browser tab.
- `name` field is the lookup key — the API resolves questionnaires by `name`, not by filename. Filename slug should match `name` for clarity but mismatch is non-fatal.

### Reading answers

Three options, in order of preference:

1. **Wait for the Submit message.** When the user clicks Submit, a Q&A prose block lands in your terminal session — same delivery channel as Sly Actions. No need to fetch anything.
2. **`sly-kanban questionnaire answers <card-id> [--name <slug>]`** — token-light read of just the Q&A in the same prose format as the Submit message. Use this if you've forgotten what was answered.
3. **`cat documentation/questionnaires/NNN_<name>.json`** — full file with raw schema + answers. Heavier; only when you need the structure (e.g. before editing the questionnaire).

### CLI commands

```bash
# Attach (cards can have multiple questionnaires)
sly-kanban update <card-id> --questionnaire-ref documentation/questionnaires/NNN_<name>.json

# Clear ALL questionnaires from a card (empty string)
sly-kanban update <card-id> --questionnaire-ref ""

# List attached questionnaires with status + counts
sly-kanban questionnaire list <card-id>

# Print Q&A in submit-message format (token-light read)
sly-kanban questionnaire answers <card-id>                  # if only one attached
sly-kanban questionnaire answers <card-id> --name <slug>    # if multiple

# Patch a single answer (used by the web UI's autosave; also useful for scripted input)
sly-kanban questionnaire answer <card-id> --name <slug> --item q1 --value '"Tuesday evening"'
sly-kanban questionnaire answer <card-id> --name <slug> --item q5 --value 'false'
sly-kanban questionnaire answer <card-id> --name <slug> --item q6 --value '4'
```

The `--value` argument MUST be valid JSON (note the quoted strings). Path validation rejects anything outside `documentation/questionnaires/` or without a `.json` extension.

### Submit behavior

- Submit writes a human-readable `Q: ... / A: ...` block into the card's terminal session via the same PTY primitive as Sly Actions. Control characters are stripped.
- If no terminal session is active, Submit starts/resumes one (same UX as Sly Actions). The user must have an active provider selected on the card for this to work — otherwise the UI surfaces "No active terminal session — open the Terminal tab first to start one."
- After successful delivery, the modal auto-switches the user back to the Terminal tab.
- Re-submit is allowed: editing answers and clicking Submit again re-fires the message, bumps `submission_count`, and updates `submitted_at`.

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

## Cross-Card Prompt Execution

Send prompts to other cards' sessions for orchestration, multi-provider review, and automation chains.

**IMPORTANT:** Only use `sly-kanban prompt` when **explicitly instructed** to do so — either by a user, a card description, or an automation instruction. Never fire prompts at other cards on your own initiative (e.g., during testing, exploration, or as a "helpful" side-effect). Cross-card prompts start real sessions that consume resources and are hard to track if unexpected.

### Fire-and-Forget (async)

```bash
sly-kanban prompt <card-id> "Your prompt text"
sly-kanban prompt <card-id> "Your prompt" --provider codex
sly-kanban prompt <card-id> "Your prompt" --provider codex --model o3
sly-kanban prompt <card-id> "Your prompt" --fresh   # Stop existing session, start clean
```

Delivers the prompt and returns immediately. Session handling:
- **Running session** → submits prompt to it directly
- **Stopped session** → **resumes** it (preserves conversation context), then delivers the prompt
- **No session** → creates a fresh one

Use `--fresh` only when you explicitly want to discard the existing session and start clean. Without it, stopped sessions are always resumed to preserve context.

**Card context is auto-injected.** Every prompt is automatically prepended with the target card's ID, title, stage, type, priority, and description. The called AI always knows its own card details without needing to look them up. Your prompt text follows after a `---` separator.

### Wait-for-Response (sync)

```bash
sly-kanban prompt <card-id> "Analyze this design" --wait --timeout 120
```

Sends the prompt with an embedded callback instruction. The called card must run `sly-kanban respond` to return data. The CLI blocks until the response arrives or the timeout is reached.

**Timeout outcomes:**
- Response received → data printed to stdout (exit 0)
- Timeout + session still active → message indicating work is ongoing (exit 1)
- Timeout + session idle → terminal snapshot showing what blocked it (exit 1)

Late responses are automatically injected into the calling session's terminal even after timeout.

### Responding to a Prompt

When your session receives a prompt with a callback instruction like:

> When you have completed this task, you MUST run: `sly-kanban respond <response-id> "<your response>"`

Run the respond command:

```bash
sly-kanban respond <response-id> "Your response data here"
```

### Session Guards

The submit endpoint enforces three checks:
1. **Call-locked** — another `--wait` prompt is active on the target session → rejected (409)
2. **Active/busy** — the target session is mid-generation → rejected (409)
3. **Idle/ready** — proceeds with submission

Use `--force` to bypass all guards.

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
