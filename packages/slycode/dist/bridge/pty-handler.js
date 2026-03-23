import * as pty from 'node-pty';
import os from 'os';
import { execSync } from 'child_process';
// One-time flag: login shell PATH has been merged into process.env.PATH.
// On macOS/Linux, CLI tools (claude, codex) are often installed in paths
// added by shell profiles (~/.zprofile, ~/.bashrc). When the bridge starts
// via nohup or systemd, these paths may be missing. We capture them once
// from a login shell and merge into process.env.PATH so that:
// 1. posix_spawnp (used by node-pty on macOS) can find the binary
// 2. The spawned child process inherits the full PATH
let loginPathCaptured = false;
function ensureLoginShellPath() {
    if (loginPathCaptured || os.platform() === 'win32')
        return;
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
    }
    catch (err) {
        console.warn('[pty] Could not capture login shell PATH:', err.message);
    }
}
// Cache of resolved command paths: bare name -> absolute path
const resolvedCommands = new Map();
/**
 * Resolve a bare command name to its absolute path.
 * On macOS, posix_spawnp can fail on npm bin stubs (symlinks to scripts
 * with shebangs) even when the command IS on PATH. Passing an absolute
 * path bypasses posix_spawnp's path search entirely.
 */
function resolveCommand(command) {
    if (command.includes('/'))
        return command; // already a path
    if (os.platform() === 'win32')
        return command;
    const cached = resolvedCommands.get(command);
    if (cached)
        return cached;
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
    }
    catch { /* not found in current PATH */ }
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
    }
    catch { /* not found in login shell either */ }
    console.warn(`[pty] Could not resolve absolute path for '${command}', falling back to bare name`);
    return command;
}
export function spawnPty(options) {
    let shell = options.command || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');
    // On Windows, commands like 'claude' are installed as .cmd batch wrappers.
    // node-pty can't execute them directly — append .cmd if we're on Windows
    // and the command doesn't already have an extension.
    if (os.platform() === 'win32' && shell && !shell.includes('.') && !shell.includes('\\') && !shell.includes('/')) {
        shell = `${shell}.cmd`;
    }
    // Ensure login shell PATH is captured (one-time, augments process.env.PATH)
    ensureLoginShellPath();
    // Resolve bare command names to absolute paths. On macOS, posix_spawnp
    // (used by node-pty) can fail on npm bin stubs even when on PATH.
    // Passing an absolute path bypasses the path search entirely.
    shell = resolveCommand(shell);
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
export function writeToPty(ptyProcess, data) {
    ptyProcess.write(data);
}
export function resizePty(ptyProcess, cols, rows) {
    ptyProcess.resize(cols, rows);
}
export function killPty(ptyProcess, signal) {
    ptyProcess.kill(signal);
}
//# sourceMappingURL=pty-handler.js.map