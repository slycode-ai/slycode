import { readFileSync } from 'fs';
import path from 'path';
import { getSlycodeRoot } from './paths';

/**
 * Read one key from the workspace .env (SLYCODE_HOME/.env). Dev doesn't
 * export the workspace .env into process.env (Next only auto-loads web/.env),
 * so settings the setup wizard writes there are read through this.
 * Returns null when the file or key is missing or the value is empty.
 */
export function readWorkspaceEnvKey(key: string): string | null {
  try {
    const content = readFileSync(path.join(getSlycodeRoot(), '.env'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      if (trimmed.slice(0, eq).trim() !== key) continue;
      return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '') || null;
    }
  } catch { /* no .env */ }
  return null;
}
