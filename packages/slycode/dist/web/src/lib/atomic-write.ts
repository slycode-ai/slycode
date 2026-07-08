import { promises as fs } from 'fs';

/**
 * Write a file atomically: write to a unique temp file first, then rename it
 * over the destination (rename is atomic on POSIX). This prevents a crash or a
 * concurrent write mid-`writeFile` from truncating the destination — important
 * for the project's single-source-of-truth JSON state (kanban.json, providers,
 * scheduler board), where a truncated file breaks the UI and automations.
 *
 * Mirrors the bridge's `savePersistedState` pattern (session-manager.ts).
 */
export async function atomicWriteFile(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, filePath);
  } catch (err) {
    // Clean up the orphaned temp file on failure.
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
