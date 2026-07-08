import * as fs from 'fs';

/**
 * Write a file atomically (synchronous): write to a unique temp file first,
 * then rename it over the destination (rename is atomic on POSIX). Prevents a
 * crash or concurrent write mid-`writeFileSync` from truncating the target.
 *
 * Mirrors the bridge's `savePersistedState` tmp+rename+unlink pattern.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // Clean up the orphaned temp file on failure.
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
