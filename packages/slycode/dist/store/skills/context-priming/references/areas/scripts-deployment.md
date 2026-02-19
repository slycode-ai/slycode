# Scripts & Deployment

Updated: 2026-03-14

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
| `migrate-store.sh` | Migrate store from provider-split to canonical flat layout |

## Port Architecture

Two separate port ranges — dev and prod never overlap:

| Service | Dev port | Prod port | Env var |
|---------|----------|-----------|---------|
| Web | 3003 | 7591 | `WEB_PORT` |
| Bridge | 3004 | 7592 | `BRIDGE_PORT` |
| Messaging | 3005 | 7593 | `MESSAGING_SERVICE_PORT` |

- **7591/2/3**: "sly" = 759 on a phone keypad
- **Dev ports**: hardcoded in each service's `package.json` dev scripts
- **Prod ports**: configured in `slycode.config.js` (loaded by `start.ts`), or `.env` fallback, passed as `PORT` env var
- `BRIDGE_URL` must match bridge port — `sly-start.sh` derives it automatically
- Next.js reads `PORT` env var natively (no `--port` flag in prod `npm start`)

## Process Management

### Production (`sly-start.sh` / `sly-stop.sh`)

- **Start**: `slycode start` spawns services with `cwd: workspace` (ensures services inherit correct working directory). Sets `SLYCODE_HOME` env var for prod path resolution.
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
2. Check build tools (`check_build_tools()` — gcc, make, g++ for node-pty compilation)
3. Create directories (`~/bin`, `~/.slycode/logs`)
4. `npm install` in web, bridge, messaging
5. Build bridge, messaging, web (web last — heaviest, needs most memory)
6. `chmod +x` on CLI scripts
7. Symlink CLIs to `~/bin` (sly-kanban, sly-scaffold, sly-messaging)
8. Update `registry.json` with correct SlyCode path
9. Copy `.env.example` to `.env` if missing
10. Prompt: install as system service?
11. Linux: check linger, offer to enable

**Flags**: `--yes` (non-interactive), `--service` (auto-install services), `--remove-service` (cleanup)

## Global CLIs

Symlinked to `~/bin` by `setup.sh`:

| Command | Target | Type |
|---------|--------|------|
| `sly-kanban` | `sly-kanban` | Standalone Node.js |
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
- Web: `web/src/lib/paths.ts` — centralized `getSlycodeRoot()` (via `SLYCODE_HOME` → cwd fallback) and `getPackageDir()` (detects `node_modules/slycode/dist/` for prod). All 10+ API routes import from paths.ts — no local `getRepoRoot()` helpers. `legacy root env var` env var removed.
- Bridge: reads `BRIDGE_PORT` from env
- Messaging: uses `SLYCODE_HOME` env var for workspace resolution (replaces `__dirname`-relative paths that broke in prod npm packages). CLI auto-detects service port (dev 3005 / prod 7593) with caching.
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
Bridge requires absolute path for session `cwd` — no defaults, no relative paths. This ensures the AI CLI associates sessions with the correct project directory.

## Env Files

- **`.env.example`**: template with all config vars, prod port defaults, placeholder secrets, TZ timezone var, DEV_HOSTNAME (Tailscale hostname for Next.js dev origins)
- **`.env`**: actual config, created from example by `setup.sh`, gitignored
- `.env` lives at repo root — messaging loads it via `dotenv`, bridge reads env vars, web gets them via `sly-start.sh` exports

## slycode.config.js

Workspace-level configuration file loaded by `packages/slycode/src/config/loader.ts`:

```js
module.exports = {
  ports: { web: 7591, bridge: 7592, messaging: 7593 },
  services: { web: true, bridge: true, messaging: true },
  host: '127.0.0.1',  // Only web binds to this; bridge+messaging always localhost
};
```

- `slycode config [key] [value]` — View/modify config via CLI
- Defaults: ports 7591/7592/7593, all services enabled, host `127.0.0.1`
- Only web binds to `config.host`; bridge and messaging are always `127.0.0.1`

## NPM Distribution (`packages/`)

- `packages/slycode/` (`@slycode/slycode` v0.1.11) — Main npm package providing `slycode` CLI
  - Subcommands: workspace, start, stop, service, doctor, skills, sync, update, config, uninstall
  - `slycode skills list|check|add|reset` for skill management
  - `slycode config [key] [value]` for slycode.config.js management
  - `slycode uninstall` for removing services and CLI tools
  - Platform-specific service management (Linux systemd, macOS launchd, Windows Task Scheduler)
  - Templates in `templates/` use flat canonical store layout, includes `tutorial-project/` template
  - `files` in package.json: `bin/`, `data/`, `lib/`, `dist/`, `templates/`. Dependencies include `multer` (bridge image upload).
  - Default host: `127.0.0.1` (configurable via slycode.config.js)
- `packages/create-slycode/` (`@slycode/create-slycode` v0.1.11) — Scaffold tool for initializing new SlyCode workspaces
  - Exports `create-slycode` CLI command
  - Setup wizard prompts for timezone (auto-detects system TZ, writes `TZ=` to .env for cron scheduling)
  - Seeds `providers.json` and `sly-actions.json` from package templates during workspace creation. System service prompt skipped on Windows.
  - Tutorial content seeded into workspace root via `seedTutorialWorkspaceContent()` (not a separate `slycode_tutorial/` subdirectory)
  - Registry seeds workspace root as default project (id: `slycode`, path: workspace dir)
  - Kanban seed uses correct stage-based format (`project_id`, `stages`, `last_updated`)
- `build/build-package.ts` — Full build pipeline: builds services, syncs store→updates, copies templates, scaffold-templates/, store/, and store/actions/ to templates/store/actions/ for scaffold seeding. Preserves tutorial-project template during wipe/rebuild.
- `build/sync-updates.ts` — Sync manifest skills from store/ to updates/ (enforces manifest as authority)
- `build/store-manifest.js` — Curated list of skills included in package distribution

### slycode CLI new subcommands
- `slycode sync` — Refresh workspace updates/ from package templates
- `slycode update` — Platform-aware restart (systemd/launchd/Windows Task Scheduler/background)
- `slycode start` — Auto-refreshes updates + npm version check (3s timeout). Passes workspace as `cwd` to spawned services and sets `SLYCODE_HOME` env var (fixes prod path resolution where Next.js server.js does `process.chdir(__dirname)`).

## Related Files

- `documentation/designs/global_cli_setup.md` — full design document
- `documentation/features/020_global_cli_setup.md` — 9-phase implementation plan
- `web/src/lib/paths.ts` — runtime path resolution for web app
- `bridge/src/session-manager.ts` — session persistence, CWD validation
- `bridge/bridge-sessions.json` — persisted session state (NEVER wipe)
- `.env.example` / `.env` — environment configuration
