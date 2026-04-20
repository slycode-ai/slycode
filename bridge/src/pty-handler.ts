import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import os from 'os';
import fs from 'fs';
import path from 'path';
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

// On macOS, node-pty uses a `spawn-helper` binary for PTY forking.
// npm doesn't always preserve the executable bit when installing packages,
// which causes every pty.spawn() to fail with "posix_spawnp failed".
// Check and fix this once at startup.
let spawnHelperChecked = false;

function ensureSpawnHelperPermissions(): void {
  if (spawnHelperChecked || os.platform() !== 'darwin') return;
  spawnHelperChecked = true;

  try {
    const ptyDir = path.dirname(require.resolve('node-pty/package.json'));
    const prebuildsDir = path.join(ptyDir, 'prebuilds');
    if (!fs.existsSync(prebuildsDir)) return;

    for (const dir of fs.readdirSync(prebuildsDir)) {
      if (!dir.startsWith('darwin')) continue;
      const helper = path.join(prebuildsDir, dir, 'spawn-helper');
      if (!fs.existsSync(helper)) continue;

      const stat = fs.statSync(helper);
      if (!(stat.mode & 0o111)) {
        fs.chmodSync(helper, 0o755);
        console.log(`[pty] Fixed spawn-helper permissions: ${helper}`);
      }
    }
  } catch (err) {
    console.warn('[pty] Could not check spawn-helper permissions:', (err as Error).message);
  }
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

// Cache of resolved command paths: bare name -> absolute path
const resolvedCommands = new Map<string, string>();

/**
 * Resolve a bare command name to its absolute path.
 * On macOS, posix_spawnp can fail on npm bin stubs (symlinks to scripts
 * with shebangs) even when the command IS on PATH. Passing an absolute
 * path bypasses posix_spawnp's path search entirely.
 */
function resolveCommand(command: string): string {
  if (command.includes('/')) return command; // already a path
  if (os.platform() === 'win32') return command;

  const cached = resolvedCommands.get(command);
  if (cached) return cached;

  // Strategy 1: resolve in the bridge's current PATH
  try {
    const resolved = execSync(`command -v ${command}`, {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (resolved && resolved.startsWith('/')) {
      resolvedCommands.set(command, resolved);
      console.log(`[pty] Resolved ${command} -> ${resolved}`);
      return resolved;
    }
  } catch { /* not found in current PATH */ }

  // Strategy 2: resolve via login shell (captures homebrew, nvm, etc.)
  try {
    const userShell = process.env.SHELL || '/bin/bash';
    const knownShells = ['/bin/bash', '/bin/zsh', '/bin/sh', '/usr/bin/bash', '/usr/bin/zsh'];
    const loginShell = knownShells.includes(userShell) ? userShell : '/bin/bash';
    const resolved = execSync(`${loginShell} -l -c 'command -v ${command}'`, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (resolved && resolved.startsWith('/')) {
      resolvedCommands.set(command, resolved);
      console.log(`[pty] Resolved ${command} -> ${resolved} (via login shell)`);
      return resolved;
    }
  } catch { /* not found in login shell either */ }

  console.warn(`[pty] Could not resolve absolute path for '${command}', falling back to bare name`);
  return command;
}

export function spawnPty(options: PtyOptions): IPty {
  let shell = options.command || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');

  // On Windows, commands like 'claude' are installed as .cmd batch wrappers.
  // node-pty can't execute them directly — append .cmd if we're on Windows
  // and the command doesn't already have an extension.
  if (os.platform() === 'win32' && shell && !shell.includes('.') && !shell.includes('\\') && !shell.includes('/')) {
    shell = `${shell}.cmd`;
  }

  // Ensure node-pty's spawn-helper is executable (macOS — one-time check)
  ensureSpawnHelperPermissions();

  // Ensure login shell PATH is captured (one-time, augments process.env.PATH)
  ensureLoginShellPath();

  // Resolve bare command names to absolute paths. On macOS, posix_spawnp
  // (used by node-pty) can fail on npm bin stubs even when on PATH.
  // Passing an absolute path bypasses the path search entirely.
  shell = resolveCommand(shell);

  // Clean env for spawned sessions:
  // 1. Remove npm_config_prefix to avoid nvm/linuxbrew conflict warning
  // 2. Strip npm_* vars leaked from npm run/npx lifecycle
  // 3. Sanitize PATH to remove node_modules/.bin and .npm/_npx entries
  //    injected by npm/npx — these cause stale binary resolution in AI sessions
  const cleanEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === 'npm_config_prefix') continue;
    if (key.startsWith('npm_')) continue;
    cleanEnv[key] = value;
  }

  // Sanitize PATH: remove node_modules/.bin and .npm/_npx entries
  if (cleanEnv.PATH) {
    const sep = os.platform() === 'win32' ? ';' : ':';
    cleanEnv.PATH = cleanEnv.PATH
      .split(sep)
      .filter(p => !p.includes('node_modules/.bin') && !p.includes('node_modules\\.bin')
                 && !p.includes('.npm/_npx') && !p.includes('.npm\\_npx'))
      .join(sep);
  }

  let ptyProcess: IPty;
  try {
    ptyProcess = pty.spawn(shell, options.args, {
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
  } catch (err) {
    const msg = (err as Error).message || '';
    if (msg.includes('posix_spawnp') && os.platform() === 'darwin') {
      throw new Error(
        `PTY spawn failed for '${shell}'. On macOS, this is usually caused by node-pty's spawn-helper ` +
        `missing execute permissions. Run: chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper`
      );
    }
    throw err;
  }

  ptyProcess.onData(options.onData);
  ptyProcess.onExit(({ exitCode }) => {
    options.onExit(exitCode);
  });

  return ptyProcess;
}

export function writeToPty(ptyProcess: IPty, data: string): void {
  ptyProcess.write(data);
}

/**
 * Write data to PTY with chunking on Windows to avoid ConPTY truncation.
 *
 * ConPTY silently truncates PTY writes larger than ~4KB. This function splits
 * large writes into 1024-byte chunks with delays between them, giving ConPTY
 * time to drain each chunk. On Linux/Mac, writes pass through directly (kernel
 * handles backpressure natively).
 *
 * **Convention:** Any code path that writes potentially large text (>1KB) to a
 * PTY must use this function instead of raw `writeToPty()` / `pty.write()`.
 * Keystroke input and short control sequences can use `writeToPty()` directly.
 *
 * @see documentation/designs/windows_conpty_chunked_writes.md
 * @see documentation/designs/fix_windows_paste_truncation.md
 */
export const CHUNKED_WRITE_SIZE = 1024;
export const CHUNKED_WRITE_DELAY_MS = 200;

export async function writeChunkedToPty(ptyProcess: IPty, data: string): Promise<void> {
  if (os.platform() !== 'win32' || data.length <= CHUNKED_WRITE_SIZE) {
    // Unix or small write — pass through directly
    if (data.length > CHUNKED_WRITE_SIZE) {
      console.log(`[writeChunkedToPty] passthrough (${os.platform()}): ${data.length} chars`);
    }
    ptyProcess.write(data);
    return;
  }

  // Windows: chunk to avoid ConPTY truncation at ~4KB
  const totalChunks = Math.ceil(data.length / CHUNKED_WRITE_SIZE);
  console.log(`[writeChunkedToPty] chunking: ${data.length} chars → ${totalChunks} × ${CHUNKED_WRITE_SIZE} (${CHUNKED_WRITE_DELAY_MS}ms delay)`);
  for (let i = 0, chunkNum = 1; i < data.length; chunkNum++) {
    let end = Math.min(i + CHUNKED_WRITE_SIZE, data.length);
    // Don't split surrogate pairs (emoji, some CJK) at chunk boundaries
    if (end < data.length) {
      const lastChar = data.charCodeAt(end - 1);
      if (lastChar >= 0xD800 && lastChar <= 0xDBFF) {
        end++;
      }
    }
    const chunk = data.slice(i, end);
    console.log(`[writeChunkedToPty] chunk ${chunkNum}/${totalChunks}: ${chunk.length} chars, starts="${chunk.slice(0, 30).replace(/\n/g, '\\n')}..."`);
    ptyProcess.write(chunk);
    i = end;
    if (i < data.length) {
      await new Promise(r => setTimeout(r, CHUNKED_WRITE_DELAY_MS));
    }
  }
  console.log(`[writeChunkedToPty] complete: ${data.length} chars written in ${totalChunks} chunks`);
}

export function resizePty(ptyProcess: IPty, cols: number, rows: number): void {
  ptyProcess.resize(cols, rows);
}

export function killPty(ptyProcess: IPty, signal?: string): void {
  ptyProcess.kill(signal);
}
