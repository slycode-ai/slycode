/**
 * Write a file atomically (synchronous): write to a unique temp file first,
 * then rename it over the destination (rename is atomic on POSIX). Prevents a
 * crash or concurrent write mid-`writeFileSync` from truncating the target.
 *
 * Mirrors the bridge's `savePersistedState` tmp+rename+unlink pattern.
 */
export declare function atomicWriteFileSync(filePath: string, data: string): void;
