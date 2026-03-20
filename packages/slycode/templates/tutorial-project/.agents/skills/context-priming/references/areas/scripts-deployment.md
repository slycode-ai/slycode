# Scripts & Deployment

Updated: 2026-02-11

## Overview

SlyCode has a two-tier deployment model: **dev** (individual services via tmux) and **prod** (background processes with builds). All scripts live in `scripts/`. A guided installer (`setup.sh`) handles first-time and repeat setup. No hardcoded paths — everything is derived at runtime.

## Scripts

| Script | Purpose |
|--------|---------|
| `setup.sh` | Interactive guided installer — deps, builds, CLI symlinks, optional services, linger |
| `sly-start.sh` | Build all services then start in production (background processes or systemd/launchd) |
| `sly-stop.sh` | Stop production services by finding processes on their ports |
| `sly-restart.sh` | Stop then start (delegates to sly-stop + sly-start) |
| `sly-dev.sh` | Tmux session "sly" with three side-by-side panes running `npm run dev` |
| `kanban.js` | Kanban CLI (standalone Node.js, no build needed) |
| `scaffold.js` | Project scaffolding CLI (standalone Node.js) |

## Port Architecture

Two separate port ranges — dev and prod never overlap:

| Service | Dev port | Prod port | Env var |
|---------|----------|-----------|---------|
| Web | 3003 | 7591 | `WEB_PORT` |
| Bridge | 3004 | 7592 | `BRIDGE_PORT` |
| Messaging | 3005 | 7593 | `MESSAGING_SERVICE_PORT` |

- **7591/2/3**: "sly" = 759 on a phone keypad
- **Dev ports**: hardcoded in each service's `package.json` dev scripts
- **Prod ports**: configured in `.env`, read by `sly-start.sh`, passed as `PORT` env var to `npm start`
- `BRIDGE_URL` must match bridge port — `sly-start.sh` derives it automatically
- Next.js reads `PORT` env var natively (no `--port` flag in prod `npm start`)

## Process Management

### Production (`sly-start.sh` / `sly-stop.sh`)

- **Start**: runs `npm start` in background with `nohup` (assumes services are already built via `setup.sh`)
- **Stop**: finds PIDs by port (not PID files — those are unreliable with npm subshells), kills process tree with `pkill -P` + `kill`
- Ports file at `~/.slycode/ports` records which ports were started for stop to read
- Health check after start: verifies each port is listening
- Log files: `~/.slycode/logs/{web,bridge,messaging}.log` with 10MB rotation

### Dev (`sly-dev.sh`)

- Creates tmux session "sly" with three horizontal panes
- Each pane runs `npm run dev` in its service directory
- `session-closed` hook calls `sly-stop.sh` to prevent zombie processes
- If session already exists, just attaches
- Switch panes: `Ctrl-b` + arrows. Zoom: `Ctrl-b z`

### Platform Services (optional, via `setup.sh`)

- **Linux**: systemd user services (`~/.config/systemd/user/slycode-{web,bridge,messaging}.service`)
- **macOS**: launchd user agents (`~/Library/LaunchAgents/com.slycode.{web,bridge,messaging}.plist`)
- `sly-start.sh` / `sly-stop.sh` detect installed services and use them instead of background processes
- `setup.sh --service` installs, `setup.sh --remove-service` removes

## Setup Flow (`setup.sh`)

1. Welcome banner (platform, SlyCode root, Node version)
2. Create directories (`~/bin`, `~/.slycode/logs`)
3. `npm install` in web, bridge, messaging
4. Build bridge, messaging, web (web last — heaviest, needs most memory)
5. `chmod +x` on CLI scripts
6. Symlink CLIs to `~/bin` (sly-kanban, sly-scaffold, sly-messaging)
7. Update `registry.json` with correct SlyCode path
8. Copy `.env.example` to `.env` if missing
9. Prompt: install as system service?
10. Linux: check linger, offer to enable

**Flags**: `--yes` (non-interactive), `--service` (auto-install services), `--remove-service` (cleanup)

## Global CLIs

Symlinked to `~/bin` by `setup.sh`:

| Command | Target | Type |
|---------|--------|------|
| `sly-kanban` | `scripts/kanban.js` | Standalone Node.js |
| `sly-scaffold` | `scripts/scaffold.js` | Standalone Node.js |
| `sly-messaging` | `messaging/dist/cli.js` | Built from TypeScript |

### CLI Port Detection (`sly-messaging`)

The CLI auto-detects which mode (dev/prod) the messaging service is running in:

1. Read cached port from `~/.slycode/messaging-port` (if exists), try it first
2. Probe dev port (3005) then prod port (7593) via `/health`
3. Cache the successful port for next time

This means `sly-messaging` works regardless of whether you started with `sly-dev.sh` or `sly-start.sh`. After the first successful call, subsequent calls skip probing entirely.

## Key Design Decisions

### No hardcoded paths anywhere
- Web: `web/src/lib/paths.ts` derives SlyCode root from `process.cwd()` (detects `/web` suffix)
- Bridge: reads `BRIDGE_PORT` from env
- Messaging: CLI auto-detects service port (dev 3005 / prod 7593) with caching; service reads port from env
- Skills: reference `sly-kanban` and `sly-messaging` by global command name, not paths
- Documentation: uses `<slycode-root>` placeholder instead of absolute paths
- `registry.json`: `setup.sh` updates the SlyCode path entry at install time

### Stop by port, not PID files
PID files are unreliable because `npm start` spawns child processes — the recorded PID is the npm wrapper which dies, leaving orphaned node/next-server children. Port-based discovery always finds the actual listening process.

### Build in setup, not start
`sly-start.sh` does NOT build — it assumes services are already built. Builds happen in `setup.sh` (which users rerun when code changes). This keeps start fast and avoids memory-heavy builds blocking service startup.

### XDG_RUNTIME_DIR fix
Code-server terminals don't set `XDG_RUNTIME_DIR`, breaking `systemctl --user`. All scripts set it to `/run/user/$(id -u)` if missing and the directory exists. Safe, standard, no side effects.

### bridge-sessions.json protection
- Path resolved via `__dirname` (never relative — avoids reading wrong file from wrong cwd)
- Only starts fresh on ENOENT (file doesn't exist = first run)
- Any other read error crashes loudly instead of silently wiping session data
- Saves are atomic (write `.tmp` then `rename`)

### Bridge CWD validation
Bridge requires absolute path for session `cwd` — no defaults, no relative paths. This ensures Claude associates sessions with the correct project directory in `~/.claude/projects/`.

## Env Files

- **`.env.example`**: template with all config vars, prod port defaults, placeholder secrets
- **`.env`**: actual config, created from example by `setup.sh`, gitignored
- `.env` lives at repo root — messaging loads it via `dotenv`, bridge reads env vars, web gets them via `sly-start.sh` exports

## Related Files

- `documentation/designs/global_cli_setup.md` — full design document
- `documentation/features/020_global_cli_setup.md` — 9-phase implementation plan
- `web/src/lib/paths.ts` — runtime path resolution for web app
- `bridge/src/session-manager.ts` — session persistence, CWD validation
- `bridge/bridge-sessions.json` — persisted session state (NEVER wipe)
- `.env.example` / `.env` — environment configuration
