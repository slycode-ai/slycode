INSTRUCTION_FILENAME: AGENTS.md
---
PROVIDER_HEADER:
This file is read by **OpenAI Codex** as project instructions. It is loaded automatically when Codex starts a session in this directory.
---
PROVIDER_NOTES:
## Codex Notes

- **Hierarchical loading**: Codex walks from the project root to your current directory, loading `AGENTS.md` at each level
- **Override file**: Create `AGENTS.override.md` in any directory for higher-priority instructions
- **Sandbox**: Codex runs in a sandboxed environment by default — file writes are limited to the workspace
- **Size limit**: Instruction files are capped at 32 KiB by default (configurable in `~/.codex/config.toml`)
