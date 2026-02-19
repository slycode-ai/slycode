---
name: implement
version: 1.1.1
updated: 2026-02-22
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, TodoWrite, Task
argument-hint: "path to chore or feature plan"
description: "Execute a chore or feature plan and handle document lifecycle"
---

# Implement Plan

Execute the specified chore or feature plan, then handle the appropriate document lifecycle. This command follows a pattern where completed chores move to a completed directory while features remain in place with updated status.

## Instructions

1. **Detect document type** from the file path:
   - If path contains `/chores/`: This is a chore
   - If path contains `/features/`: This is a feature
2. **Read and execute** the plan thoroughly
3. **Handle lifecycle** based on document type (see lifecycle patterns below)
4. **Update indexes** (if project maintains index files) and report results

**Note**: The lifecycle management pattern below is a suggested approach. Adapt to your project's documentation structure and workflow.

## Workflow

### Phase 1: Plan Analysis
- Read the plan document
- Identify all tasks to execute
- Note validation commands
- Check completion criteria

### Phase 2: Implementation
- Execute tasks in order
- Run validation commands
- Verify completion criteria met
- Track all changes made

### Phase 3: Document Lifecycle

**For Chores** (suggested pattern):
1. Move file from `documentation/chores/` to `documentation/chores/completed/`
2. Update status in file from ACTIVE to COMPLETED
3. Add completion date
4. Update project indexes (if maintained):
   - Remove from active chores list
   - Add to completed chores list

**For Features** (suggested pattern):
1. Keep file in `documentation/features/` (features typically remain in place)
2. Update status from DRAFT to FINAL (or IMPLEMENTED/COMPLETE as per project convention)
3. Update last modified date
4. Update feature index/README (if project maintains one)

**Note**: Adjust these lifecycle steps to match your project's documentation conventions.

### Phase 3b: Kanban Card Update

If `sly-kanban` is available, move the associated card to testing:

1. Check if kanban CLI exists: `command -v sly-kanban`
2. If the plan references a card ID (in frontmatter or content), or if running in a card session:
   - Move card to testing: `sly-kanban move <card-id> testing`
3. This signals the work is ready for testing/review

### Phase 4: Reporting

Generate comprehensive report including:
- Summary of work completed
- Files modified (with git diff --stat)
- Tests run and results
- Document status changes
- Index updates performed

## Plan
$ARGUMENTS

## Lifecycle Actions

Based on the document type detected, perform appropriate actions:

### Chore Completion (Example)
```bash
# Move to completed directory (if using this pattern)
mv documentation/chores/{file} documentation/chores/completed/

# Update status in document (ACTIVE → COMPLETED)
# Add completion date
# Update project indexes (if applicable)
```

### Feature Completion (Example)
```bash
# Update status in document (DRAFT → FINAL/IMPLEMENTED)
# Update last modified date
# Update feature index (if project maintains one)
```

**Adapt these actions to your project's structure and conventions.**

## Report Format

Provide a comprehensive report following this template:

```
✅ Implementation Complete

**Document**: {path}
**Type**: {Chore|Feature}
**Status**: {COMPLETED|FINAL|IMPLEMENTED}

**Work Summary**:
- {task 1 completed}
- {task 2 completed}
- {validation passed}

**Files Changed**:
{git diff --stat output or summary of changes}

**Lifecycle Actions**:
- {Document moved to completed/ | Status updated to FINAL}
- {Index updates performed (if applicable)}

**Validation Results**:
- {Tests run and results}
- {Build/lint status}

**Next Steps**:
- {Any follow-up actions or recommendations}
```

Adapt the report format to include project-specific metrics or validation results.