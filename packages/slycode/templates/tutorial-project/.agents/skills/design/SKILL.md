---
name: design
version: 1.1.1
updated: 2026-02-22
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, SlashCommand
argument-hint: "design topic (e.g., Session management system)"
description: "Start iterative requirements gathering for a design document"
---

# Design Discovery

Start an iterative requirements-gathering session for a new design. Creates a lightweight document in `documentation/designs/` focused on exploring the problem space, not implementation details.

## Mode: Requirements Gathering

This command sets you into **requirements mode**:
- Ask clarifying questions rather than making assumptions
- Explore alternatives and trade-offs with the user
- Focus on WHAT and WHY, not HOW
- Keep the document evolving as understanding grows
- No implementation details, no code, no file lists

## Instructions

1. **Create initial design doc** with the problem statement and open questions
2. **Enter conversational mode** - engage the user to flesh out requirements
3. **Update the doc iteratively** as decisions are made
4. **Flag when design is ready** to become a feature spec

## Workflow

1. **Get current date** using bash
2. **Create design document** in `documentation/designs/`
3. **Name the file** as `{descriptive_name}.md` (snake_case, no date prefix)
4. **Link design to card** - Run this command to attach the design doc to the kanban card:
   ```bash
   node scripts/kanban.js update <card-id> --design-ref "documentation/designs/{name}.md"
   ```
   **IMPORTANT:** This is a separate CLI command you must execute. Do NOT add the path to the card's description field. The `--design-ref` flag sets a dedicated field on the card that links to this design document.
5. **Engage user** with initial clarifying questions
6. **Update doc** as requirements solidify

## Document Format

```md
# Design: {topic}

**Status:** Discovery
**Created:** YYYY-MM-DD
**Last Updated:** YYYY-MM-DD

## Problem Statement

<What problem are we solving? Why does it matter? Who is affected?>

## Goals

<What must this solution achieve?>
1. <goal>
2. <goal>

## Non-Goals

<What is explicitly out of scope?>
- <non-goal>

## Context

<Background info, constraints, related systems>

## Approach Options

### Option A: <name>
<Description, pros, cons>

### Option B: <name>
<Description, pros, cons>

## Decisions

<Record decisions as they're made>

| Decision | Choice | Rationale |
|----------|--------|-----------|
| <topic> | <choice> | <why> |

## Open Questions

<Questions that need answers before implementation>
- [ ] <question>
- [ ] <question>

## Related Areas

<Context-priming areas relevant to this design>
- <area>: <why relevant>

## Notes

<Captured thoughts, references, examples>
```

## Conversational Guidelines

When in design mode:

1. **Start with questions** - Don't assume you understand the problem
   - "What problem are you trying to solve?"
   - "Who will use this? In what context?"
   - "What constraints should I know about?"

2. **Present options** - When there are multiple approaches
   - "I see two main ways to approach this..."
   - "Option A trades X for Y, Option B does the opposite..."

3. **Capture decisions** - When the user makes a choice
   - Update the Decisions table with rationale
   - Remove resolved items from Open Questions

4. **Check readiness** - When requirements feel complete
   - "I think we've covered the requirements. Ready to create a feature spec?"
   - If yes: "Run `/feature {design name}` to create the implementation plan"

## Transition to Feature Spec

When the design is ready for implementation:
1. Update Status to "Ready"
2. Inform user to run `/feature` referencing this design
3. The feature spec will link back via `design_ref`

## Reporting

After creating the initial document:
- File created: `documentation/designs/{name}.md`
- Card linked: (if in card session) design_ref updated
- Status: Discovery
- Mode: Requirements gathering active
- First question: Start exploring the problem space

## Design Topic
$ARGUMENTS
