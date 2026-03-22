import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import os from 'os';
import { execSync } from 'child_process';

export interface PtyOptions {
  command: string;
  args: string[];
  cwd: string;
  cols?: number;
  rows?: number;
  extraEnv?: Record<string, string>;
  onData: (data: string) => void;
  onExit: (code: number) => void;
}

// One-time flag: login shell PATH has been merged into process.env.PATH.
// On macOS/Linux, CLI tools (claude, codex) are often installed in paths
// added by shell profiles (~/.zprofile, ~/.bashrc). When the bridge starts
// via nohup or systemd, these paths may be missing. We capture them once
// from a login shell and merge into process.env.PATH so that:
// 1. posix_spawnp (used by node-pty on macOS) can find the binary
// 2. The spawned child process inherits the full PATH
let loginPathCaptured = false;

function ensureLoginShellPath(): void {
  if (loginPathCaptured || os.platform() === 'win32') return;
  loginPathCaptured = true;

  try {
    // Use the user's default shell with -l to source their profile.
    // This ensures we capture paths from ~/.zprofile (macOS/zsh),
    // ~/.bash_profile (Linux/bash), nvm, homebrew, etc.
    const userShell = process.env.SHELL || '/bin/bash';
    const knownShells = ['/bin/bash', '/bin/zsh', '/bin/sh', '/usr/bin/bash', '/usr/bin/zsh'];
    const shell = knownShells.includes(userShell) ? userShell : '/bin/bash';

    const loginPath = execSync(`${shell} -l -c 'printf "%s" "$PATH"'`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (loginPath) {
      const currentPaths = new Set((process.env.PATH || '').split(':'));
      const additions = loginPath.split(':').filter(p => p && !currentPaths.has(p));
      if (additions.length > 0) {
        process.env.PATH = `${process.env.PATH}:${additions.join(':')}`;
        console.log(`[pty] Augmented PATH with ${additions.length} entries from login shell`);
      }
    }
  } catch (err) {
    console.warn('[pty] Could not capture login shell PATH:', (err as Error).message);
  }
}

export function spawnPty(options: PtyOptions): IPty {
  let shell = options.command || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');

  // On Windows, commands like 'claude' are installed as .cmd batch wrappers.
  // node-pty can't execute them directly — append .cmd if we're on Windows
  // and the command doesn't already have an extension.
  if (os.platform() === 'win32' && shell && !shell.includes('.') && !shell.includes('\\') && !shell.includes('/')) {
    shell = `${shell}.cmd`;
  }

  // Ensure login shell PATH is captured (one-time, augments process.env.PATH)
  ensureLoginShellPath();

  // Clean env - remove npm_config_prefix to avoid nvm/linuxbrew conflict warning
  const { npm_config_prefix, ...cleanEnv } = process.env;

  const ptyProcess = pty.spawn(shell, options.args, {
    name: 'xterm-256color',
    cols: options.cols || 80,
    rows: options.rows || 24,
    cwd: options.cwd,
    env: {
      ...cleanEnv,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      ...options.extraEnv,
    },
  });

  ptyProcess.onData(options.onData);
  ptyProcess.onExit(({ exitCode }) => {
    options.onExit(exitCode);
  });

  return ptyProcess;
}

export function writeToPty(ptyProcess: IPty, data: string): void {
  ptyProcess.write(data);
}

export function resizePty(ptyProcess: IPty, cols: number, rows: number): void {
  ptyProcess.resize(cols, rows);
}

export function killPty(ptyProcess: IPty, signal?: string): void {
  ptyProcess.kill(signal);
}
