---
name: chore
version: 1.1.1
updated: 2026-02-22
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, SlashCommand
argument-hint: "chore description (e.g., Fix WebSocket reconnection issues)"
description: "Create a structured chore plan for maintenance tasks, bug fixes, or refactors"
---

# Chore Planning

Create a new chore plan in `documentation/chores/` to address the specified maintenance task. The plan will be created with proper naming convention including date and category.

## Instructions

1. **Analyze the chore** to determine its category (bug, refactor, performance, security, debt, docs)
2. **If category is BUG** - explicitly state this and follow the bug-specific workflow (see below)
3. **Check project context** - If you need more context about a specific area:
   - Review relevant project documentation (if available: `/prime <area>` or CLAUDE.md)
   - Identify key areas the chore touches
4. **Research the codebase** using appropriate tools to understand the current state
5. **Create structured plan** following the format below
6. **Name the file** as `YYYY-MM-DD_{category}_{descriptive_name}.md`

## Workflow

1. **Get current date** using bash command
2. **Determine category** from keywords:
   - bug: fix, error, crash, broken, fails, issue, regression
   - refactor: refactor, restructure, reorganize, simplify, cleanup
   - performance: optimize, slow, speed, cache, memory
   - security: security, vulnerability, auth, permission
   - debt: debt, TODO, hack, workaround, temporary
   - docs: documentation, readme, comments, guide
3. **Check if sufficient context** is loaded for the task
4. **Create the plan** in `documentation/chores/` directory

## Bug-Specific Workflow

When category is **bug**, explicitly announce: "This is a bug fix. I will perform additional analysis to understand the root cause."

Then follow these additional steps:
1. **Attempt to reproduce** - Understand exact conditions that trigger the bug
2. **Identify symptoms** - Document expected vs actual behavior
3. **Root cause analysis** - Investigate *why* the bug occurs, not just *where*
4. **Plan surgical fix** - Minimal changes to fix the root cause, avoid scope creep
5. **Plan validation** - Include steps to reproduce before fix and verify after fix

Include the optional bug sections in the plan (Steps to Reproduce, Root Cause Analysis).

## Plan Format

```md
# Chore: <chore name>

**Status**: ACTIVE
**Category**: <bug|refactor|performance|security|debt|docs>
**Created**: YYYY-MM-DD

## Chore Description
<describe the chore in detail, including the problem it solves>

## Steps to Reproduce (Bug Only)
<INCLUDE THIS SECTION ONLY FOR BUGS. List exact steps to reproduce the issue.>
1. <step 1>
2. <step 2>
3. <observe: expected vs actual behavior>

## Root Cause Analysis (Bug Only)
<INCLUDE THIS SECTION ONLY FOR BUGS. Explain WHY the bug occurs, not just where.>

## Context Areas
<if specific areas needed, note which project areas/modules are relevant>
- Suggested areas: [list relevant areas like frontend, backend, api, database, etc.]
- Additional context: [reference relevant documentation or architecture files]

## Relevant Files
Use these files to resolve the chore:

<find and list the files that are relevant to the chore describe why they are relevant in bullet points. If there are new files that need to be created to accomplish the chore, list them in an h3 'New Files' section.>

### New Files
<if any new files need to be created, list them here>

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. use as many h3 headers as needed to accomplish the chore. Order matters, start with the foundational shared changes required to fix the chore then move on to the specific changes required to fix the chore. Your last step should be running the `Validation Commands` to validate the chore is complete with zero regressions.>

### Task 1: <descriptive name>
- <specific actions>
- <file modifications>

### Task 2: <descriptive name>
- <specific actions>
- <file modifications>

### Task N: Run Validation
- Execute all validation commands
- Verify no regressions

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

<list project-specific validation commands - examples:>
- Run test suite (e.g., `pytest`, `npm test`, `make test`)
- Run linters (e.g., `npm run lint`, `flake8`, `eslint`)
- Run type checking (e.g., `mypy`, `tsc --noEmit`)
- Build the project (e.g., `npm run build`, `make build`)
- <other specific tests related to the chore>

### Bug Validation (Bug Only)
<INCLUDE FOR BUGS: Commands/steps to reproduce the bug BEFORE the fix, then verify it's resolved AFTER.>
- Before fix: <how to reproduce and observe the bug>
- After fix: <same steps should now show correct behavior>

## Completion Criteria
<clear, measurable criteria that define when this chore is done>
- [ ] All tests pass
- [ ] No lint errors
- [ ] <specific criteria for this chore>

## Notes
<optionally list any additional notes or context that are relevant to the chore that will be helpful to the developer>
```

## Reporting

After creating the plan, report:
- File created: `documentation/chores/YYYY-MM-DD_{category}_{name}.md`
- Category: {detected category}
- Next step: Run `/implement` with the plan path

## Chore
$ARGUMENTS