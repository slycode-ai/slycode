import * as pty from 'node-pty';
import os from 'os';
export function spawnPty(options) {
    let shell = options.command || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');
    // On Windows, commands like 'claude' are installed as .cmd batch wrappers.
    // node-pty can't execute them directly — append .cmd if we're on Windows
    // and the command doesn't already have an extension.
    if (os.platform() === 'win32' && shell && !shell.includes('.') && !shell.includes('\\') && !shell.includes('/')) {
        shell = `${shell}.cmd`;
    }
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