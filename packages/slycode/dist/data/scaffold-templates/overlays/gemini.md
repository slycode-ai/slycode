INSTRUCTION_FILENAME: GEMINI.md
---
PROVIDER_HEADER:
This file is read by **Gemini CLI** as project context. It is loaded automatically when Gemini starts a session in this directory.
---
PROVIDER_NOTES:
## Gemini CLI Notes

- **File imports**: Use `@file.md` to reference other instruction files (relative or absolute paths, `.md` files only, non-recursive)
- **Global context**: Add global instructions in `~/.gemini/GEMINI.md`
- **Memory commands**: Use `/memory show` to view loaded context, `/memory refresh` to reload
- **Custom filenames**: Gemini can be configured to also read `AGENTS.md` via `settings.json` context configuration
