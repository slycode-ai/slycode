---
name: feature
version: 1.1.1
updated: 2026-02-22
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, SlashCommand
argument-hint: "feature description (e.g., Add bulk message operations)"
description: "Create a numbered feature specification following project standards"
---

# Feature Planning

Create a new feature specification in `documentation/features/` with the next available number. The plan will follow a comprehensive feature planning format.

## Instructions

1. **Scan for next feature number** - Check existing features to determine next number
2. **Check project context** - If you need more context about specific areas:
   - Review relevant project documentation (if available: `/prime <area>` or CLAUDE.md)
   - Identify key architectural areas the feature touches
3. **Research the codebase** to understand existing patterns and architecture
4. **Create comprehensive plan** following the format below
5. **Name the file** as `{number}_{feature_name}.md` (e.g., `038_bulk_message_operations.md`)

## Workflow

1. **Determine next feature number**:
   - List files in `documentation/features/`
   - Find highest numbered feature
   - Next number = highest + 1
2. **Analyze feature requirements** from description
3. **Check if sufficient context** is loaded for the feature
4. **Create the plan** in `documentation/features/` directory
5. **Link feature to card** - Run this command to attach the feature spec to the kanban card:
   ```bash
   node scripts/kanban.js update <card-id> --feature-ref "documentation/features/{number}_{name}.md"
   ```
   **IMPORTANT:** This is a separate CLI command you must execute. Do NOT add the path to the card's description field. The `--feature-ref` flag sets a dedicated field on the card that links to this feature spec.

## Context Integration

Before creating the plan:
- Identify which project areas/modules the feature touches
- Check if sufficient context exists (project docs, CLAUDE.md, architecture files)
- If needed, suggest: "This feature involves {areas}. Consider reviewing {relevant docs} for better context."

## Plan Format

```md
# Feature {number}: {feature name}

**Status**: DRAFT
**Created**: YYYY-MM-DD
**Last Updated**: YYYY-MM-DD

## Feature Description
<describe the feature in detail, including its purpose and value to users>

## User Story
As a <type of user>
I want to <action/goal>
So that <benefit/value>

## Problem Statement
<clearly define the specific problem or opportunity this feature addresses>

## Solution Statement
<describe the proposed solution approach and how it solves the problem>

## Context Areas
<note which project areas/modules are relevant to this feature>
- Required areas: [list areas like frontend, backend, api, database, etc.]
- Additional context: [reference relevant documentation or architecture files]

## Relevant Files
Use these files to implement the feature:

<find and list the files that are relevant to the feature describe why they are relevant in bullet points. Reference patterns from CLAUDE.md and project documentation.>

### New Files
<if any new files need to be created, list them here following project conventions>

## Implementation Plan
### Phase 1: Foundation
<describe the foundational work needed before implementing the main feature>

### Phase 2: Core Implementation
<describe the main implementation work for the feature>

### Phase 3: Integration
<describe how the feature will integrate with existing functionality>

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

<list step by step tasks as h3 headers plus bullet points. Reference project patterns from CLAUDE.md and documentation.>

### Task 1: <descriptive name>
- <specific actions following project conventions>
- <file modifications>

### Task 2: <descriptive name>
- <specific actions>
- <file modifications>

### Task N: Run Full Validation
- Execute all validation commands
- Verify feature works end-to-end
- Check for regressions

## Testing Strategy
### Unit Tests
<describe unit tests needed following project test standards>

### Integration Tests
<describe integration tests needed>

### E2E Tests
<if applicable, describe end-to-end tests>

### Edge Cases
<list edge cases that need to be tested>

## Acceptance Criteria
<list specific, measurable criteria that must be met for the feature to be considered complete>
- [ ] Feature works as described
- [ ] All tests pass
- [ ] No regressions introduced
- [ ] Documentation updated
- [ ] <specific criteria for this feature>

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

<list project-specific validation commands - examples:>
- Run test suite (e.g., `pytest`, `npm test`, `make test`)
- Run linters (e.g., `npm run lint`, `flake8`, `eslint`)
- Run type checking (e.g., `mypy`, `tsc --noEmit`)
- Build the project (e.g., `npm run build`, `make build`)
- Manual testing steps
- <specific tests for this feature>

## Future Considerations
<optional: future enhancements or related features to consider>

## Notes
<optionally list any additional notes, dependencies, or context that are relevant to the feature>
```

## Reporting

After creating the plan, report:
- File created: `documentation/features/{number}_{feature_name}.md`
- Card linked: feature_ref updated via CLI command
- Feature number: {number}
- Status: DRAFT
- Next step: Run `/implement` with the plan path when ready

## Feature
$ARGUMENTS