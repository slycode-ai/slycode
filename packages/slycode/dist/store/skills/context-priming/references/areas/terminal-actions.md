# Terminal Actions (Commands)

Updated: 2026-03-10

## Overview

Unified command system for SlyCode terminal sessions (all providers). Actions are individual `.md` files in `store/actions/` with YAML frontmatter (v4.0). Each file defines one action: metadata in frontmatter, prompt text as markdown body. Class assignments are assembled at runtime from per-action `classes` maps (sorted by priority). Context templates are hardcoded in `sly-actions.ts`. Commands split into **startup** (shown before/during session start) and **toolbar** (shown while running) via the `placement` field. Provider-agnostic — the same commands work across Claude, Codex, and Gemini sessions.

## Key Files

- `store/actions/*.md` - Individual action files (v4.0: YAML frontmatter + prompt body)
- `documentation/terminal-classes.json` - Terminal class definitions
- `web/src/lib/sly-actions.ts` - getActionsForClass(), renderTemplate(), buildPrompt(), CONTEXT_TEMPLATES, types
- `web/src/lib/action-scanner.ts` - Reads/writes action .md files, assembles config, caching (30s), update scanning, accept with additive class merge
- `web/src/app/api/sly-actions/route.ts` - GET assembled config / PUT writes back to individual .md files
- `web/src/app/api/sly-actions/stream/route.ts` - SSE watching store/actions/ directory for changes
- `web/src/app/api/sly-actions/invalidate/route.ts` - POST to invalidate actions cache (called on modal close)
- `web/src/app/api/terminal-classes/route.ts` - Serves terminal-classes.json
- `web/src/app/api/claude-actions/route.ts` - Serves commands in config format (legacy route name)
- `messaging/src/sly-action-filter.ts` - Standalone action scanner for messaging (duplicated parser, 30s cache)

## Action File Format

```markdown
---
name: onboard
version: 1.0.0
label: "Onboard"
description: "Analyze and improve a backlog item"
group: "Card Actions"
placement: both
scope: global
classes:
  backlog: 10
  design: 20
---

Prompt text here with {{card.id}} template variables...
```

Frontmatter fields: name, version, label, description, group, placement, scope, projects (array), cardTypes (array), classes (map: className → priority number). Priority determines sort order within each class (ascending, ties broken alphabetically).

## Data Models

```typescript
// Parsed from individual .md file
ParsedAction {
  name: string;
  version: string;
  label: string;
  description: string;
  group: string;
  placement: Placement;
  scope: 'global' | 'specific';
  projects: string[];
  cardTypes?: string[];
  classes: Record<string, number>;  // className → priority (lower = earlier)
  prompt: string;
}

// Assembled config served by API (same shape as v3, now v4.0)
SlyActionsConfig {
  version: string;          // "4.0"
  contextTemplate: { card: string; global: string };  // hardcoded in sly-actions.ts
  commands: Record<string, SlyActionItem>;
  classAssignments: Record<string, string[]>;  // assembled from per-action classes maps
}
```

## Key Functions

- `getActionsForClass(commands, classAssignments, terminalClass, options?)` - Single unified getter: looks up class → ordered IDs → filters by project/cardType → returns ordered array
- `renderTemplate(template, context)` - Handles {{var}}, {{#if}}, {{#each}}
- `buildPrompt(contextTemplate, actionPrompt, context)` - Combines context + task sections

## Template Syntax

- `{{var}}` - Simple substitution
- `{{obj.prop}}` - Nested property access (e.g., `{{card.title}}`)
- `{{#if var}}...{{/if}}` - Conditional block
- `{{#each arr}}...{{this}}...{{/each}}` - Array iteration

## Context Objects

Card context: `{ project, projectPath, card, stage, problems[] }`
Global context: `{ project, projectPath }`

## Command Groups

- **Card Actions** (14 commands) - Onboard, Design Requirements, Deep Design, Make Feature, Implement, Quick Fix, Debug, Complete, Review, Approve, Archive, Chore, Analyse Implementation, Test Review
- **Session** - Continue, Summarize (for resumed sessions)
- **Project** - Explore, Create Card, Update Priming, Organise Backlog
- **Utilities** - Clear, Checkpoint, Context, Show Card, Convert Asset
- **Action Assistant** - Configure Commands (for action-assistant terminal class)

### Notable Commands
- **Design Requirements** - Assesses complexity after design; recommends skipping feature spec for simple changes, creating one for complex. Adds design summary note to card after doc creation.
- **Deep Design** - Thorough design with parallel analysis sub-agents. Phase 1: create design doc. Phase 2: launch up to 6 parallel agents (Out-of-the-Box Thinker, Unintended Consequences, UI Polish, Prior Art Scout, Simplification Advocate, Edge Case Hunter) — skip agents that don't apply. Phase 3: synthesize findings into design doc "Analysis Notes" section with must/should/nice ratings. Phase 4: normal Q&A iteration. Added to `design` classAssignment.
- **Make Feature** - Creates feature spec, links to card, adds planning summary note with scope/milestones/risks.
- **Implement** - Instructs to move card to testing after implementation. Now includes structured checklist creation (via `sly-kanban checklist` commands) and implementation summary note.
- **Quick Fix** - Fast bug fix workflow for cards
- **Debug** - Diagnostic workflow for investigating issues
- **Complete / Review / Approve** - Card completion pipeline (complete work → review → approve)
- **Archive** - Archive completed cards
- **Chore** - Create maintenance/bug fix plan from card
- **Analyse Implementation** - Detailed analysis with findings table and problem logging
- **Test Review** - Interactive test review for testing lane (checklist assessment, implicit testing, max 3 questions per Q&A round, area context priming)
- **Convert Asset** - Cross-provider asset conversion (scoped to claude-master project only, placement: startup)
- **Organise Backlog** - Uses `kanban board` for snapshot and `kanban reorder` for reprioritisation

## Placement

- `startup` - Shown as buttons before session starts (and in "Previous Session" view)
- `toolbar` - Shown in footer toolbar while session is running
- `both` - Shown in both startup and toolbar contexts

## Class Assignments

Each action declares its own `classes` map (className → priority number). At runtime, `assembleClassAssignments()` groups actions by class and sorts by priority (ascending, ties alphabetical). This produces the same `Record<terminalClass, string[]>` shape as v3 but derived from individual files rather than a central list. Actions not in a class don't appear for that class.

## Command Flow

1. **No session / has history**: Show startup actions (placement: startup/both) as buttons
2. **Running session**: Show toolbar actions (placement: toolbar/both) in footer
3. Single `getActionsForClass()` call at the consumer level; consumer splits by placement locally

## Patterns & Invariants

- Single getter `getActionsForClass()` replaces the old dual getStartupActions/getActiveActions pattern
- ClaudeTerminalPanel receives single `actions` prop, splits by placement internally
- CardModal and GlobalClaudePanel each make one getActionsForClass() call
- Command order is explicit via classAssignments arrays (not implicit from JSON key order)
- MAX_VISIBLE_ACTIONS = 6, overflow goes to "..." menu
- Context button (id: 'context') appends card.areas to command
- Show Card button (id: 'show-card') appends cardId
- Shift+click on active command inserts without submitting
- Same commands appear regardless of which provider (Claude/Codex/Gemini) the session uses
- New commands default to placement: 'both', not added to any class until user adds via Classes tab
- Command deletion removes the .md file and references from all classAssignments
- writeActionsFromConfig() reverse-engineers classes from classAssignments (priority = position × 10)
- Action cache (30s TTL) in action-scanner.ts, invalidated on writes and via /api/sly-actions/invalidate
- Messaging has its own action scanner (sly-action-filter.ts) with duplicated YAML parser and 30s cache

## Action Update Delivery

Actions follow the same update delivery pattern as skills:
- `updates/actions/*.md` - Upstream action updates staged by build pipeline
- `scanActionUpdates()` - Content-hash comparison (not version-based) between updates/ and store/
- `acceptActionUpdate()` - Additive class merge: keeps user's class customizations, adds new upstream classes. Records upstream hash in `.ignored-updates.json` (key: `actions/{name}`) to prevent resurface after merge.
- `ActionUpdatesModal.tsx` - Dedicated modal for viewing/accepting/dismissing action updates with diff viewer
- ProjectHeader polls `/api/cli-assets/updates` for actionEntries count, shows badge on Actions button
- SlyActionConfigModal shows "Updates" tab when updates available

## When to Expand

- Adding new actions → create `store/actions/{name}.md` with frontmatter + add to `build/store-manifest.js` actions list
- Changing filter logic → getActionsForClass() in sly-actions.ts
- Template issues → renderTemplate() in sly-actions.ts
- UI for commands → ClaudeTerminalPanel.tsx
- Terminal class definitions → documentation/terminal-classes.json
- Command configuration UI → SlyActionConfigModal.tsx (Commands tab + Classes tab)
- Action update delivery → action-scanner.ts, ActionUpdatesModal.tsx
