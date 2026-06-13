import type { IPty } from 'node-pty';
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
/**
 * Whether a session command is safe to spawn / resolve.
 *
 * The bridge only ever opens providers (claude/codex/gemini → bare command
 * names), 'bash'/'powershell.exe', or an absolute path. Anything else — in
 * particular a string carrying shell metacharacters — must never reach the
 * shell used by resolveCommand. This is the boundary check; resolveCommand
 * also binds the input as a positional arg so it can't be interpolated.
 *
 * Allowed:
 *   - absolute paths (node-pty spawns these directly, no shell)
 *   - bare tokens matching ^[\w.-]+$ (bash, powershell.exe, claude, codex, …)
 * Rejected: anything containing /bin/sh metacharacters (; $ ` ( ) | & < > ' " space …)
 */
export declare function isCommandShellSafe(command: string): boolean;
export declare function spawnPty(options: PtyOptions): IPty;
export declare function writeToPty(ptyProcess: IPty, data: string): void;
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
export declare const CHUNKED_WRITE_SIZE = 1024;
export declare const CHUNKED_WRITE_DELAY_MS = 200;
export declare function writeChunkedToPty(ptyProcess: IPty, data: string): Promise<void>;
export declare function resizePty(ptyProcess: IPty, cols: number, rows: number): void;
export declare function killPty(ptyProcess: IPty, signal?: string): void;
