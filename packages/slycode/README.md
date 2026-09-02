# @slycode/slycode

The SlyCode CLI — workspace manager and command-center server for AI coding agents (Claude Code, Codex, OpenCode, Gemini CLI).

Most users start a new workspace via the scaffold tool:

```bash
npx @slycode/create-slycode slycode   # any directory name works
cd slycode
npx slycode start
```

Full README — features, Code Mode, configuration, known limitations: https://github.com/slycode-ai/slycode#readme

## Prerequisites

### All platforms

- **Node.js 20.0.0 or newer.**

### macOS (arm64, x64)

No additional setup. SlyCode bundles `node-pty`, which ships a prebuilt native binary for macOS — no compiler required.

### Windows (arm64, x64)

No additional setup. SlyCode bundles a prebuilt `node-pty` binary for Windows — no Visual Studio Build Tools required.

### Linux (arm64, x64)

No additional setup on the standard architectures — SlyCode bundles prebuilt `node-pty` binaries for `linux-arm64` and `linux-x64`.

### Other platforms (Alpine/musl, FreeBSD, linux-armv6l/armv7l, etc.)

These platforms have no `node-pty` prebuild and will compile from source during `npm install`. You need a C/C++ toolchain. The install command depends on your distribution:

| Distribution | Install command |
|---|---|
| Amazon Linux / RHEL / Fedora | `sudo dnf install -y gcc gcc-c++ make python3` |
| CentOS / older RHEL | `sudo yum install -y gcc gcc-c++ make python3` |
| Debian / Ubuntu | `sudo apt-get update && sudo apt-get install -y build-essential python3` |
| Alpine | `sudo apk add --no-cache build-base python3` |
| Arch | `sudo pacman -S --needed base-devel python` |

If your toolchain is missing, the SlyCode install will print an actionable preflight warning naming the missing tools and the install command for your detected package manager. The install will then continue and `node-pty`'s source build will fail with its own error — running the suggested command and retrying will get you through.

## Providers

Claude Code, Codex, OpenCode (`npm i -g opencode-ai`, then `opencode auth login`), and Gemini CLI are installed separately — SlyCode orchestrates them, it doesn't bundle them. Gemini CLI with a personal Google account needs an API key: add `GEMINI_API_KEY=<key>` to your workspace `.env` and restart SlyCode.

## Diagnostics

Once installed, run `npx slycode doctor` for a health check covering Node version, build tools, ports, AI agents, and workspace layout.

## License

[BUSL-1.1](https://github.com/slycode-ai/slycode/blob/main/LICENSE) — open core. Free for individuals, including freelancers. Organisations with paid employees need a commercial licence. Details: https://slycode.ai
