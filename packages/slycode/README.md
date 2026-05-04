# @slycode/slycode

The SlyCode CLI — workspace manager and command-center server for AI coding agents (Claude Code, Codex, Gemini CLI).

Most users start a new workspace via the scaffold tool:

```bash
npx @slycode/create-slycode my-workspace
cd my-workspace
slycode start
```

See https://slycode.ai for the full overview.

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

## Diagnostics

Once installed, run `slycode doctor` for a health check covering Node version, build tools, ports, AI agents, and workspace layout.

## License

[BUSL-1.1](./LICENSE) — open core. See https://slycode.ai for licensing details.
