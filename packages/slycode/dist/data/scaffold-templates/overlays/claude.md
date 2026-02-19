INSTRUCTION_FILENAME: CLAUDE.md
---
PROVIDER_HEADER:
This file is read by **Claude Code** as project instructions. It is loaded automatically when Claude starts a session in this directory.
---
PROVIDER_NOTES:
## Claude Code Notes

- **File imports**: Use `@path/to/file` in this document to reference other instruction files (recursive, up to 5 levels deep)
- **Local overrides**: Create `CLAUDE.local.md` for personal project-specific instructions (auto-gitignored)
- **Modular rules**: Add topic-specific rules in `.claude/rules/*.md` with optional path-scoped YAML frontmatter
- **Memory**: Claude may auto-create memory files in `~/.claude/projects/` to remember project context across sessions
