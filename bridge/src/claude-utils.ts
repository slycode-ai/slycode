import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import os from 'os';

/**
 * Get the Claude projects directory path for a given working directory.
 * Claude transforms /path/to/project into ~/.claude/projects/-path-to-project/
 * On Linux: forward slashes and underscores become hyphens.
 * On Windows: backslashes, colons, forward slashes, and underscores become hyphens.
 *   e.g. D:\Dev\Projects\slycode -> D--Dev-Projects-slycode
 */
export function getClaudeProjectDir(cwd: string): string {
  const claudeBase = path.join(os.homedir(), '.claude', 'projects');
  const transformedPath = cwd.replace(/[\\/:_]/g, '-');
  return path.join(claudeBase, transformedPath);
}

/**
 * List all .jsonl session files in a Claude project directory
 */
export async function listSessionFiles(claudeDir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(claudeDir);
    return files
      .filter(f => f.endsWith('.jsonl'))
      .map(f => f.replace('.jsonl', ''));
  } catch {
    return [];
  }
}

/**
 * Extract GUID from a session filename
 */
export function extractGuidFromFilename(filename: string): string {
  return filename.replace('.jsonl', '');
}

/**
 * Check if a string is a valid UUID/GUID format
 */
export function isValidGuid(str: string): boolean {
  const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return guidRegex.test(str);
}

/**
 * Detect a new Claude session ID by comparing before/after file lists.
 * Call getSessionFilesBefore() before spawning, then call this after first output.
 */
export async function detectNewSessionId(
  claudeDir: string,
  beforeFiles: string[]
): Promise<string | null> {
  const afterFiles = await listSessionFiles(claudeDir);

  // Find new file that wasn't there before
  const newFiles = afterFiles.filter(f => !beforeFiles.includes(f));

  if (newFiles.length === 0) {
    return null;
  }

  // Return the most recent one (in case multiple appeared)
  // Usually there should only be one
  const validGuids = newFiles.filter(isValidGuid);
  return validGuids[0] || null;
}

/**
 * Get the most recent session ID for a project directory.
 * Useful when we don't have a stored GUID but want to resume the latest session.
 */
export async function getMostRecentSessionId(cwd: string): Promise<string | null> {
  const claudeDir = getClaudeProjectDir(cwd);

  try {
    const files = await fs.readdir(claudeDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      return null;
    }

    // Get file stats to find most recent
    const fileStats = await Promise.all(
      jsonlFiles.map(async f => {
        const filePath = path.join(claudeDir, f);
        const stat = await fs.stat(filePath);
        return { file: f, mtime: stat.mtime };
      })
    );

    // Sort by modification time, newest first
    fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    const mostRecent = fileStats[0].file;
    const guid = extractGuidFromFilename(mostRecent);

    return isValidGuid(guid) ? guid : null;
  } catch {
    return null;
  }
}

/**
 * Watch for a new session file to appear (with timeout)
 */
export function watchForNewSession(
  claudeDir: string,
  beforeFiles: string[],
  timeoutMs: number = 10000
): Promise<string | null> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const pollInterval = 200; // Check every 200ms

    const check = async () => {
      const sessionId = await detectNewSessionId(claudeDir, beforeFiles);

      if (sessionId) {
        resolve(sessionId);
        return;
      }

      if (Date.now() - startTime > timeoutMs) {
        resolve(null);
        return;
      }

      setTimeout(check, pollInterval);
    };

    check();
  });
}

export interface ClaudeSessionInfo {
  sessionId: string;
  projectDir: string;
  lastModified: Date;
}

/**
 * Get all Claude sessions for a project
 */
export async function getProjectSessions(cwd: string): Promise<ClaudeSessionInfo[]> {
  const claudeDir = getClaudeProjectDir(cwd);

  try {
    const files = await fs.readdir(claudeDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    const sessions: ClaudeSessionInfo[] = [];

    for (const file of jsonlFiles) {
      const guid = extractGuidFromFilename(file);
      if (isValidGuid(guid)) {
        const filePath = path.join(claudeDir, file);
        const stat = await fs.stat(filePath);
        sessions.push({
          sessionId: guid,
          projectDir: claudeDir,
          lastModified: stat.mtime,
        });
      }
    }

    // Sort by last modified, newest first
    sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

    return sessions;
  } catch {
    return [];
  }
}

// ============================================================
// Codex session detection
// Sessions: ~/.codex/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDThh-mm-ss-<UUID>.jsonl
// ============================================================

const CODEX_UUID_REGEX = /rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/**
 * Get the Codex sessions directory for the current date.
 * Codex stores sessions globally (not per-project) in ~/.codex/sessions/YYYY/MM/DD/
 */
export function getCodexSessionDir(): string {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return path.join(os.homedir(), '.codex', 'sessions', yyyy, mm, dd);
}

/**
 * List all session IDs from Codex rollout files in a directory.
 * Returns filenames (without path) as keys for before/after comparison.
 */
export async function listCodexSessionFiles(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => CODEX_UUID_REGEX.test(f));
  } catch {
    return [];
  }
}

/**
 * Extract UUID from a Codex rollout filename.
 */
export function extractCodexSessionId(filename: string): string | null {
  const match = filename.match(CODEX_UUID_REGEX);
  return match ? match[1] : null;
}

/**
 * Detect a new Codex session by comparing before/after file lists.
 */
export async function detectNewCodexSessionId(
  dir: string,
  beforeFiles: string[]
): Promise<string | null> {
  const afterFiles = await listCodexSessionFiles(dir);
  const newFiles = afterFiles.filter(f => !beforeFiles.includes(f));

  if (newFiles.length === 0) return null;

  // Sort by name (contains timestamp) to get the most recent
  newFiles.sort((a, b) => b.localeCompare(a));
  return extractCodexSessionId(newFiles[0]);
}

// ============================================================
// Gemini session detection
// Gemini v1: ~/.gemini/tmp/<SHA256(cwd)>/chats/session-*.json
// Gemini v2: ~/.gemini/tmp/<basename(cwd)>/chats/session-*.json
// Full UUID stored inside JSON as sessionId field
// ============================================================

/**
 * Get the Gemini chats directory for a given cwd.
 * Gemini v2 uses the project folder name; v1 used SHA-256 hash.
 * Uses v1 if its directory already exists (existing install), otherwise defaults
 * to v2 — even if the v2 path doesn't exist yet (Gemini creates it on first run).
 */
export function getGeminiSessionDir(cwd: string): string {
  const geminiBase = path.join(os.homedir(), '.gemini', 'tmp');

  // Check if v1 hash-based path exists (legacy Gemini installs)
  const projectHash = crypto.createHash('sha256').update(cwd).digest('hex');
  const v1Path = path.join(geminiBase, projectHash, 'chats');
  try {
    require('fs').accessSync(v1Path);
    return v1Path;
  } catch {
    // Default to v2 folder-name path (don't check existence — Gemini creates it lazily)
    const folderName = path.basename(cwd);
    return path.join(geminiBase, folderName, 'chats');
  }
}

/**
 * List all session files in a Gemini chats directory.
 * Returns filenames for before/after comparison.
 */
export async function listGeminiSessionFiles(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.startsWith('session-') && f.endsWith('.json'));
  } catch {
    return [];
  }
}

/**
 * Extract the full session UUID from a Gemini session JSON file.
 */
export async function extractGeminiSessionId(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    const id = data.sessionId;
    return typeof id === 'string' && isValidGuid(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Detect a new Gemini session by comparing before/after file lists.
 */
export async function detectNewGeminiSessionId(
  dir: string,
  beforeFiles: string[]
): Promise<string | null> {
  const afterFiles = await listGeminiSessionFiles(dir);
  const newFiles = afterFiles.filter(f => !beforeFiles.includes(f));

  if (newFiles.length === 0) return null;

  // Sort by name (contains timestamp) to get the most recent
  newFiles.sort((a, b) => b.localeCompare(a));
  const filePath = path.join(dir, newFiles[0]);
  return extractGeminiSessionId(filePath);
}

// ============================================================
// Unified provider-agnostic session detection
// ============================================================

/**
 * Get the most recently modified session ID for any provider.
 * Used by the "relink" feature to re-detect the active session.
 */
export async function getMostRecentProviderSessionId(providerId: string, cwd: string): Promise<string | null> {
  const dir = getProviderSessionDir(providerId, cwd);
  if (!dir) return null;

  switch (providerId) {
    case 'claude': return getMostRecentSessionId(cwd);
    case 'codex': {
      const files = await listCodexSessionFiles(dir);
      if (files.length === 0) return null;
      // Codex filenames contain timestamps — lexicographic sort gives most recent last
      const sorted = [...files].sort((a, b) => b.localeCompare(a));
      // Get stats to confirm — filenames may not always sort correctly
      const fileStats = await Promise.all(
        sorted.slice(0, 5).map(async f => {
          try {
            const stat = await fs.stat(path.join(dir, f));
            return { file: f, mtime: stat.mtime };
          } catch { return null; }
        })
      );
      const valid = fileStats.filter(Boolean) as { file: string; mtime: Date }[];
      valid.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      return valid.length > 0 ? extractCodexSessionId(valid[0].file) : null;
    }
    case 'gemini': {
      const files = await listGeminiSessionFiles(dir);
      if (files.length === 0) return null;
      // Get stats to find most recent by mtime
      const fileStats = await Promise.all(
        files.map(async f => {
          try {
            const stat = await fs.stat(path.join(dir, f));
            return { file: f, mtime: stat.mtime };
          } catch { return null; }
        })
      );
      const valid = fileStats.filter(Boolean) as { file: string; mtime: Date }[];
      valid.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      if (valid.length === 0) return null;
      return extractGeminiSessionId(path.join(dir, valid[0].file));
    }
    default: return null;
  }
}

/**
 * Get the session directory for a provider.
 */
export function getProviderSessionDir(providerId: string, cwd: string): string | null {
  switch (providerId) {
    case 'claude': return getClaudeProjectDir(cwd);
    case 'codex': return getCodexSessionDir();
    case 'gemini': return getGeminiSessionDir(cwd);
    default: return null;
  }
}

/**
 * List session file identifiers for before/after comparison.
 */
export async function listProviderSessionFiles(providerId: string, dir: string): Promise<string[]> {
  switch (providerId) {
    case 'claude': return listSessionFiles(dir);
    case 'codex': return listCodexSessionFiles(dir);
    case 'gemini': return listGeminiSessionFiles(dir);
    default: return [];
  }
}

/**
 * Detect a new session ID by comparing before/after file lists.
 */
export async function detectNewProviderSessionId(
  providerId: string,
  dir: string,
  beforeFiles: string[]
): Promise<string | null> {
  switch (providerId) {
    case 'claude': return detectNewSessionId(dir, beforeFiles);
    case 'codex': return detectNewCodexSessionId(dir, beforeFiles);
    case 'gemini': return detectNewGeminiSessionId(dir, beforeFiles);
    default: return null;
  }
}