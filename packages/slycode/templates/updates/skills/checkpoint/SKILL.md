---
name: checkpoint
version: 1.3.1
updated: 2026-02-22
allowed-tools: Bash, Read
argument-hint: [optional commit message]
description: Create a git checkpoint of ALL recent changes
---

# Git Checkpoint Creation

Create a checkpoint commit of ALL uncommitted changes in the repository.

## Process

1. **Check status**: Run `git status --short` to see all changes
2. **Analyze changes**: For each modified/added file, briefly review what changed using `git diff <file> | head -50` or read new files
3. **Stage everything**: Run `git add -A` to stage ALL changes (modified, new, and deleted files)
4. **Write commit message**: Based on analysis, write a clear commit message that:
   - Has a concise summary line (under 72 chars)
   - Lists key changes as bullet points
   - Groups related changes together
5. **Commit**: Create the commit with the message

## Important Rules

- **Commit EVERYTHING**: Do not selectively pick files. All uncommitted changes should be included.
- **Analyze first**: Read diffs or file contents to understand what changed before writing the commit message.
- **Be descriptive**: The commit message should explain WHAT was done, not just list file names.
- **No AI attribution**: Do not include "Co-Authored-By: Claude" or similar.

## Example Commit Message Format

```
Summary of changes in imperative mood

- Add feature X with support for Y
- Fix bug in Z where condition was wrong
- Update config to enable new option
- Refactor module for better performance
```

If an optional message argument is provided, use it as the summary line.