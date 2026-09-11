import fsSync, { promises as fs } from 'fs';

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

/**
 * Synchronous twin of `atomicWriteFile` for call sites that are themselves
 * synchronous (mcp-common's activate/deactivate/merge helpers, which run
 * inside sync loops in the cli-assets routes). Same temp-then-rename shape,
 * same `.tmp.<pid>.<ts>` naming (covered by the `*.tmp.*` gitignore rule).
 *
 * Unlike an in-place `writeFileSync`, a rename replaces the inode, which would
 * silently reset a user-tightened mode (e.g. 0600 on a credential file) back
 * to the umask default. So the destination's existing mode is read first and
 * applied to the temp file before the rename. A destination that does not
 * exist yet gets the umask default, exactly as before.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  let mode: number | undefined;
  try {
    mode = fsSync.statSync(filePath).mode & 0o777;
  } catch {
    /* destination does not exist yet — new file, umask default */
  }
  try {
    fsSync.writeFileSync(tmp, data, mode !== undefined ? { mode } : undefined);
    fsSync.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fsSync.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
