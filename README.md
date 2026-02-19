# SlyCode

A workspace manager for AI coding agents.

SlyCode gives each task its own workspace — terminal, context, and persistent session — so you can pick up any task exactly where you left off. It works with Claude Code, Codex, and Gemini CLI, and runs wherever you do: at your desk, on your phone, or walking through a park.

## The Problem

CLI-based AI agents are genuinely good at what they do. But the more capable they get, the harder it is to manage them across multiple projects.

You're running several projects at once, each with its own context and momentum. Context switching is expensive — you lose your place, you lose your flow, and you burn energy just getting back to where you were. Sessions vanish when you close a terminal. Skills and configurations are scattered across projects and providers.

SlyCode exists because the biggest problem in AI development isn't the AI. It's everything around it.

## The Idea

Every project management tool separates planning from doing. The board tells you what to work on, then you switch to your terminal and pay the context-switch tax.

SlyCode's answer: **the card is the workspace.** Each card holds what needs to happen, why it matters, and an embedded terminal with a live AI session that already knows the task. Click a card and you're working — not setting up, not re-explaining the problem to the AI. Working.

Because each card keeps its scope contained, the AI stays focused longer. The session for Card A is exactly where you left it when you come back from Card B.

## Features

### Core

- **Embedded terminals in cards** — the card is the workspace, not just a tracker
- **Mobile + voice via Telegram** — full AI interaction from your phone, anywhere. Slack, Teams, and other channels coming soon.
- **Multi-provider support** — Claude Code, Codex, Gemini CLI. Switch per card or per project.
- **Session persistence** — come back to any card and continue exactly where you stopped

### Workflow

- **Context priming** — your AI already knows your codebase when the session starts
- **Automated tasks** — scheduled context refreshes, documentation updates, morning standups
- **Card lifecycle** — backlog through done, with linked design docs, feature specs, and test plans at each stage
- **Zero lock-in** — everything lives in your project directories. Remove SlyCode and nothing changes.

### Quality of Life

- **Cross-card search** — find any task from the web UI or Telegram
- **Skill management** — store, sync, and deploy skills across projects and providers
- **Health monitoring** — see session status at a glance, shut everything down safely when you need to

## Quick Start (recommended)

Requires [Node.js](https://nodejs.org/) 20 or later.

```bash
# Create a new workspace
npx @slycode/create-slycode slycode

# Start services
cd slycode
npx slycode start

# Open http://localhost:7591 in your browser

# Check that everything is healthy
npx slycode doctor
```

<details>
<summary>Installing from source</summary>

If you'd rather not pull packages from npm, you can clone the repository and scaffold from source. Runtime dependencies (express, ws, node-pty) still require npm.

```bash
git clone https://github.com/slycode-ai/slycode.git slycode-source
cd slycode-source/packages/slycode && npm install
cd ../create-slycode && npm install
cd ../..
node packages/create-slycode/bin/create-slycode.js ~/slycode
cd ~/slycode
npx slycode start
```

</details>

## What Ships in the Box

SlyCode includes a set of skills that power the structured development workflow. These ship with the product — they're not plugins you install later.

**System**
- **Kanban** — card operations, checklists, agent notes, search, automations
- **Messaging** — routes text, voice, and images through Telegram (and future channels)

**Workflow**
- **Design** — interactive requirements gathering that builds a design document as you talk through the problem
- **Feature** — creates a numbered feature specification from a design
- **Chore** — structured plans for maintenance tasks, bug fixes, and refactors
- **Implement** — executes a feature or chore plan, working through the checklist
- **Context Priming** — teaches the AI to create and maintain information-dense references for your codebase

**Utility**
- **Checkpoint** — git checkpoint of all recent changes

Skills live in `.claude/skills/` in your workspace. They're yours to customize — updates never overwrite your changes.

## CLI Reference

| Command | Description |
|---------|-------------|
| `slycode start` | Start all services (web, bridge, messaging) |
| `slycode stop` | Stop all services |
| `slycode doctor` | Check your environment is healthy |
| `slycode skills list` | Show installed and available skills |
| `slycode skills check` | Check for new or updated skills |
| `slycode skills add <name>` | Add a skill to your workspace |
| `slycode update` | Update SlyCode to latest and restart services |
| `slycode service install` | Auto-start on boot |
| `slycode service remove` | Remove auto-start service |
| `slycode config` | View or change settings |
| `slycode uninstall` | Remove services and CLI tools (your files are preserved) |

## Configuration

Edit `slycode.config.js` in your workspace:

```js
module.exports = {
  ports: {
    web: 7591,       // Web UI (command center)
    bridge: 7592,    // Terminal bridge (PTY management)
    messaging: 7593, // Messaging service
  },
  services: {
    web: true,
    bridge: true,
    messaging: true,
  },
};
```

Default ports spell **SLY** on a phone keypad (7-5-9).

## Provider Support

SlyCode works with multiple AI coding agents:

| Provider | CLI | Status |
|----------|-----|--------|
| Claude Code | `claude` | Supported |
| Codex | `codex` | Supported |
| Gemini CLI | `gemini` | Supported |

- Switch providers per card or per project from the web UI or Telegram
- `slycode doctor` checks which providers are installed on your machine
- Each provider's CLI must be installed separately — SlyCode orchestrates them, it doesn't bundle them

## License

SlyCode is source-available under the [Business Source License 1.1](./LICENSE).

**Free for:** personal use, non-commercial projects, education, evaluation, and open-source contributions.

**Requires a commercial license:** use by or on behalf of a company, organization, or entity with paid employees.

On **March 3, 2029**, the code converts to the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

For commercial licensing, visit [slycode.ai](https://slycode.ai).

## Provider Terms of Service

SlyCode is a workspace manager — it doesn't provide AI services directly. You authenticate with your own provider accounts and are responsible for complying with your chosen provider's Terms of Service.

**A note on API keys vs subscription plans:** Consumer subscription plans — Claude Max, ChatGPT Plus, Google AI Pro, and similar — are designed for ordinary individual interactive use. SlyCode is licensed for individual use on the free tier. If you're using SlyCode with multiple people, you'll need the Teams tier and API key authentication (usage-based billing) rather than personal subscription plans.

Review your provider's terms:
- [Anthropic Terms of Service](https://www.anthropic.com/legal/consumer-terms)
- [OpenAI Terms of Use](https://openai.com/policies/terms-of-use/)
- [Google AI Terms of Service](https://ai.google.dev/gemini-api/terms)

## Teams

A paid Teams tier is coming soon — shared workspaces, role-based access, and workflow integrations for organizations. [Stay updated.](https://slycode.ai)

---

[slycode.ai](https://slycode.ai) · [Report an issue](https://github.com/slycode-ai/slycode/issues) · [Feedback welcome](https://github.com/slycode-ai/slycode/discussions)
