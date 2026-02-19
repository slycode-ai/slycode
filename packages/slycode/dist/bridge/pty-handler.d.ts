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
export declare function spawnPty(options: PtyOptions): IPty;
export declare function writeToPty(ptyProcess: IPty, data: string): void;
export declare function resizePty(ptyProcess: IPty, cols: number, rows: number): void;
export declare function killPty(ptyProcess: IPty, signal?: string): void;
