# Area Index

Updated: 2026-02-14

## Areas

### web-frontend
- path: areas/web-frontend.md
- updated: 2026-02-14
- load-when: dashboard, kanban, cards, modal, UI components, drag-drop, project page, checklist, command config, health monitor, reconnection, toolkit, assets, search, scaffolding, activity feed, keyboard shortcuts, health score, tab sync, theme, design system, colors, gradient, texture, grain, noise, logo, neon, glow, blend mode, terminal styling, dark mode, light mode, provider selector, provider dropdown
- notes:
  - CardModal tabs are dynamic: Details, Design?, Feature?, Test?, Checklist?, Terminal
  - Terminal tab auto-connects when session is running
  - HealthMonitor in ProjectHeader shows CPU/memory/terminals, expands on hover
  - ConnectionManager handles SSE reconnection with Page Visibility API
  - Cards with active work show pulsing green glow (active-glow-card CSS class)
  - Commands use startupCommands (session start) and activeCommands (toolbar)
  - ToolkitTab manages cross-project asset deployment (commands/skills/agents)
  - HealthDot on ProjectCard shows 0-100 score (green/amber/red)
  - paths.ts replaces all hardcoded paths with dynamic resolution
  - CardModal has edit session protection (2000ms grace period, last-known-value tracking)
  - Provider selector in ClaudeTerminalPanel pre-fills from stage defaults via /api/providers
  - CardModal detects existing session's provider from session name (projectId:provider:card:cardId)
  - NEVER use dark-end color scales for dark mode vibrant colors — use bright color at low opacity
  - soft-light blend produces warm/red cast on dark backgrounds — use screen or overlay instead
  - drop-shadow filters create rectangular glow on images with opaque backgrounds — incompatible with mix-blend-mode logo transparency
  - Gradient direction: always left (vibrant) to right (soft), never center-out
  - Texture is three layers: fine grain + perlin noise + depth highlight — each with separate light/dark tuning

### terminal-bridge
- path: areas/terminal-bridge.md
- updated: 2026-02-14
- load-when: terminal, Claude panel, xterm, bridge, pty, session, websocket, SSE, spawn, terminal class, security, stats, activity log, stop-all, provider, providers.json, multi-provider, gemini, codex, claude, resume, skip-permissions, YOLO
- notes:
  - Pass prompts as positional args to Claude CLI, NOT -p flag (-p is print mode)
  - Bridge binds to localhost by default (not 0.0.0.0) for security
  - Command whitelist in bridge-config.json (only 'claude' and 'bash' allowed)
  - CWD validated before spawning PTY (must be absolute path)
  - Activity tracking: lastOutputAt timestamp, 2s threshold for "active" status
  - Grace period (5s) after disconnect prevents idle timeout race condition
  - ActivityTransition logging with trigger details for debugging phantom blips
  - Atomic state saves (temp file + rename) prevent data corruption
  - POST /sessions/:name/stop sends Escape key (soft stop) vs DELETE (kill)
  - Session names now include provider: {projectId}:{provider}:card:{cardId} (with legacy fallback)
  - provider-utils.ts builds command args from providers.json config (flag vs subcommand resume)
  - GUID detection only for Claude; Gemini/Codex use --resume --last

### claude-actions
- path: areas/claude-actions.md
- updated: 2026-02-09
- load-when: actions, prompts, templates, context injection, commands, visibility, command config
- notes:
  - Unified command system in data/commands.json (v2.0)
  - No 'type' field on Command - filtering by class + sessionState
  - getStartupCommands() for session start, getActiveCommands() for toolbar
  - Session states: new, resume, active, any
  - Groups: Card Actions, Session, Project, Utilities, Problems, Command Assistant
  - Update Priming and Chore Plan are newer commands

### messaging
- path: areas/messaging.md
- updated: 2026-02-14
- load-when: telegram, messaging, voice, TTS, STT, speech, channel, bot, ElevenLabs, Whisper, voice swap, stop command, response mode, tone, command filter, provider, permission mismatch
- notes:
  - Channel abstraction in types.ts, Telegram is first implementation
  - Voice pipeline: Whisper STT → ElevenLabs v3 TTS with [audio tags]
  - sendTextRaw() bypasses Markdown (preserves [brackets] for voice tags)
  - Chat actions for status indicators (record_voice, typing, upload_voice)
  - Voice search queries both personal (/v2/voices) and community (/v1/shared-voices)
  - State persisted in messaging-state.json (project + voice + responseMode + voiceTone)
  - CLI tool used by messaging skill to send outbound messages
  - "stop" text intercepted and sends Escape to active session (not forwarded as prompt)
  - command-filter.ts provides context-aware command filtering with template resolution
  - kanban-client.ts gives direct access to project card data for prompts
  - Messaging always forces skipPermissions: true (remote can't approve prompts)
  - Permission mismatch detection when session started from web UI without skip-permissions
  - State persists selectedProvider alongside project/voice/mode/tone

### skills
- path: areas/skills.md
- updated: 2026-02-09
- load-when: skills, commands, agents, hooks, slash commands, SKILL.md, scaffolding
- notes:
  - Skills live in .claude/skills/, commands in .claude/commands/, agents in .claude/agents/
  - 6 skills: context-priming, interactive-explainer, skill-creator, messaging, claude-code-docs-maintainer, kanban
  - 1 agent: doc-updater
  - 10 commands: checkpoint, feature, chore, implement, design, doc-discovery, doc-update, reference-fetch, create-command, problem_summary
  - Scaffold templates in data/scaffold-templates/

### scripts-deployment
- path: areas/scripts-deployment.md
- updated: 2026-02-10
- load-when: setup, scripts, deployment, start, stop, restart, dev, ports, service, systemd, launchd, linger, PID, zombie, sly-start, sly-stop, sly-dev, sly-restart, setup.sh, .env, environment, production, build, tmux, bridge-sessions, XDG_RUNTIME_DIR
- notes:
  - Two port ranges: dev (3003/4/5) and prod (7591/2/3 = "sly" on keypad)
  - Stop by port, NOT PID files (npm spawns children, PIDs go stale)
  - bridge-sessions.json is critical — crash on read errors, never silently wipe
  - XDG_RUNTIME_DIR must be set for systemctl --user in code-server
  - Build every time on prod start — no stale build risk
  - sly-dev.sh tmux hook calls sly-stop.sh on session close to prevent zombies
  - Global CLIs: sly-kanban, sly-messaging, sly-scaffold (symlinked to ~/bin)
