INSTRUCTION_FILENAME: AGENTS.md
---
PROVIDER_HEADER:
This file is read by **OpenCode** as project instructions. OpenCode loads `AGENTS.md` automatically when it starts in this directory (falling back to `CLAUDE.md` when `AGENTS.md` is absent).
---
PROVIDER_NOTES:
## OpenCode Notes

- **Shared file**: `AGENTS.md` is also what Codex reads — keep it provider-neutral and put OpenCode-only guidance under this heading
- **Instruction lookup**: `AGENTS.md` first, then `CLAUDE.md`, then `~/.config/opencode/AGENTS.md`; extra files via the `instructions` key in `opencode.json`
- **Skills**: OpenCode discovers skills from `.agents/skills/`, `.claude/skills/` and `.opencode/skills/` — no separate copy is needed
- **Models**: `provider/model` ids (e.g. `openai/gpt-5.4`); the SlyCode model picker's Refresh button lists what this machine can reach
- **Auth**: run `opencode auth login` once per machine (ChatGPT Plus/Pro OAuth, API keys); SlyCode refuses to start a session until a credential exists
- **Permissions**: SlyCode starts OpenCode with `--auto`; explicit `deny` rules in `opencode.json` are still enforced
