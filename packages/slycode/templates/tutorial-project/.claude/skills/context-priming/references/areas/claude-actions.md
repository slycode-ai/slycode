# Claude Actions (Commands)

Updated: 2026-02-09

## Overview

Unified command system for Claude terminals. Commands are defined in `data/sly-actions.json` with visibility controlled by terminal classes and session state. Commands are split into **startup commands** (shown before/during session start) and **active commands** (shown in toolbar while running).

## Key Files

- `data/sly-actions.json` - Unified command definitions (prompts, visibility, groups)
- `documentation/terminal-classes.json` - Terminal class definitions
- `web/src/lib/sly-actions.ts` - getStartupActions(), getActiveActions(), renderTemplate(), buildPrompt()
- `web/src/lib/types.ts` - Command, CommandsConfig, TerminalClass types
- `web/src/app/api/commands/route.ts` - CRUD for sly-actions.json
- `web/src/app/api/commands/stream/route.ts` - SSE for file change detection
- `web/src/app/api/terminal-classes/route.ts` - Serves terminal-classes.json
- `web/src/app/api/claude-actions/route.ts` - Serves commands in ClaudeActionsConfig format

## Data Models

```typescript
// Unified command (no 'type' field - filtering by class + sessionState)
Command {
  label: string;
  description: string;
  group?: string;           // Card Actions, Session, Project, Utilities, Problems
  cardTypes?: string[];     // Filter: feature/bug/chore
  prompt: string;           // Template with {{placeholders}}
  visibleIn: {
    classes: string[];      // Terminal classes where this appears
    projects: string[];     // Specific projects (if scope='specific')
  };
  scope: 'global' | 'specific';
  sessionState: 'new' | 'resume' | 'active' | 'any';
}

// Internal format used by ClaudeTerminalPanel
ClaudeCommand {
  id: string;
  label: string;
  description: string;
  group?: string;
  cardTypes?: string[];
  prompt: string;
  visibleIn: { classes: string[]; projects: string[] };
  scope: 'global' | 'specific';
  sessionState: 'new' | 'resume' | 'active' | 'any';
}

// Config format served by /api/claude-actions
ClaudeActionsConfig {
  version: string;
  contextTemplate: { card: string; global: string };
  commands: ClaudeCommand[];
}
```

## Key Functions

- `getStartupActions(commands, terminalClass, hasHistory)` - Commands for session start (new/resume/any states)
- `getActiveActions(commands, terminalClass)` - Commands for toolbar while running (active/any states)
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

- **Card Actions** - Stage-specific workflows (Onboard, Design Doc, Implement, Debug, etc.)
- **Session** - Continue, Summarize (for resume state)
- **Project** - Explore, New Card (for project-level terminals)
- **Utilities** - Compact, Clear, Checkpoint, Context, Show Card
- **Problems** - Log Problem, Triage Problems, Fix Issues
- **Action Assistant** - Configure, Update Priming (for action-assistant terminal class)

### Additional Commands
- **Chore Plan** - Create maintenance/bug fix plan from card

## Session States

- `new` - No history, shown for fresh start
- `resume` - Has history, shown when resuming (Continue, Summarize)
- `active` - Shown in toolbar when terminal is running
- `any` - Always shown regardless of state

## Command Flow

1. **No session**: Show `startupCommands` (new + any states) as buttons
2. **Has history**: Show Resume button + `startupCommands` (new + any) for fresh start options
3. **Running**: Show `activeCommands` (active + any states) in footer toolbar

## Patterns & Invariants

- Commands filtered by: terminalClass + sessionState
- Startup commands: sessionState in ['new', 'resume', 'any'] based on hasHistory
- Active commands: sessionState in ['active', 'any']
- MAX_VISIBLE_ACTIONS = 6, overflow goes to "..." menu
- Context button (id: 'context') appends card.areas to command
- Show Card button (id: 'show-card') appends cardId
- Shift+click on active command inserts without submitting

## When to Expand

- Adding new commands → data/sly-actions.json
- Changing filter logic → getStartupActions/getActiveActions in sly-actions.ts
- Template issues → renderTemplate() in sly-actions.ts
- UI for commands → ClaudeTerminalPanel.tsx
- Terminal class definitions → documentation/terminal-classes.json
- Command configuration UI → SlyActionConfigModal.tsx
