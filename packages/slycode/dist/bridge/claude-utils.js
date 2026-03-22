import fs from 'fs/promises';
import path from 'path';
import os from 'os';
/**
 * Get the Claude projects directory path for a given working directory.
 * Claude transforms /path/to/project into ~/.claude/projects/-path-to-project/
 * On Linux: forward slashes and underscores become hyphens.
 * On Windows: backslashes, colons, forward slashes, and underscores become hyphens.
 *   e.g. D:\Dev\Projects\slycode -> D--Dev-Projects-slycode
 */
export function getClaudeProjectDir(cwd) {
    const claudeBase = path.join(os.homedir(), '.claude', 'projects');
    const transformedPath = cwd.replace(/[\\/:_]/g, '-');
    return path.join(claudeBase, transformedPath);
}
/**
 * List all .jsonl session files in a Claude project directory
 */
export async function listSessionFiles(claudeDir) {
    try {
        const files = await fs.readdir(claudeDir);
        return files
            .filter(f => f.endsWith('.jsonl'))
            .map(f => f.replace('.jsonl', ''));
    }
    catch {
        return [];
    }
}
/**
 * Extract GUID from a session filename
 */
export function extractGuidFromFilename(filename) {
    return filename.replace('.jsonl', '');
}
/**
 * Check if a string is a valid UUID/GUID format
 */
export function isValidGuid(str) {
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return guidRegex.test(str);
}
/**
 * Detect a new Claude session ID by comparing before/after file lists.
 * Call getSessionFilesBefore() before spawning, then call this after first output.
 */
export async function detectNewSessionId(claudeDir, beforeFiles) {
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
export async function getMostRecentSessionId(cwd) {
    const claudeDir = getClaudeProjectDir(cwd);
    try {
        const files = await fs.readdir(claudeDir);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
        if (jsonlFiles.length === 0) {
            return null;
        }
        // Get file stats to find most recent
        const fileStats = await Promise.all(jsonlFiles.map(async (f) => {
            const filePath = path.join(claudeDir, f);
            const stat = await fs.stat(filePath);
            return { file: f, mtime: stat.mtime };
        }));
        // Sort by modification time, newest first
        fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        const mostRecent = fileStats[0].file;
        const guid = extractGuidFromFilename(mostRecent);
        return isValidGuid(guid) ? guid : null;
    }
    catch {
        return null;
    }
}
/**
 * Watch for a new session file to appear (with timeout)
 */
export function watchForNewSession(claudeDir, beforeFiles, timeoutMs = 10000) {
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
/**
 * Get all Claude sessions for a project
 */
export async function getProjectSessions(cwd) {
    const claudeDir = getClaudeProjectDir(cwd);
    try {
        const files = await fs.readdir(claudeDir);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
        const sessions = [];
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
    }
    catch {
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
export function getCodexSessionDir() {
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
export async function listCodexSessionFiles(dir) {
    try {
        const files = await fs.readdir(dir);
        return files.filter(f => CODEX_UUID_REGEX.test(f));
    }
    catch {
        return [];
    }
}
/**
 * Extract UUID from a Codex rollout filename.
 */
export function extractCodexSessionId(filename) {
    const match = filename.match(CODEX_UUID_REGEX);
    return match ? match[1] : null;
}
/**
 * Detect a new Codex session by comparing before/after file lists.
 */
export async function detectNewCodexSessionId(dir, beforeFiles) {
    const afterFiles = await listCodexSessionFiles(dir);
    const newFiles = afterFiles.filter(f => !beforeFiles.includes(f));
    if (newFiles.length === 0)
        return null;
    // Sort by name (contains timestamp) to get the most recent
    newFiles.sort((a, b) => b.localeCompare(a));
    return extractCodexSessionId(newFiles[0]);
}
// ============================================================
// Gemini session detection
// Sessions: ~/.gemini/tmp/<slug>/chats/session-*.json
// Slug resolved from ~/.gemini/projects.json registry or computed via slugify
// Full UUID stored inside JSON as sessionId field
// ============================================================
/**
 * Slugify a name the same way Gemini CLI does (projectRegistry.ts).
 * Lowercase, replace non-alphanumeric with hyphens, collapse, trim.
 */
function geminiSlugify(text) {
    return (text
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'project');
}
/**
 * Get the Gemini chats directory for a given cwd.
 * Reads ~/.gemini/projects.json for the canonical slug (Gemini's own registry).
 * Falls back to computing the slug for first-run cases.
 */
export function getGeminiSessionDir(cwd) {
    const geminiDir = path.join(os.homedir(), '.gemini');
    const geminiBase = path.join(geminiDir, 'tmp');
    // Read Gemini's project registry for the canonical slug
    const registryPath = path.join(geminiDir, 'projects.json');
    try {
        const data = JSON.parse(require('fs').readFileSync(registryPath, 'utf-8'));
        const slug = data?.projects?.[cwd];
        if (slug) {
            return path.join(geminiBase, slug, 'chats');
        }
    }
    catch { /* registry doesn't exist yet */ }
    // Fallback: compute slug the same way Gemini does
    const baseName = path.basename(cwd) || 'project';
    return path.join(geminiBase, geminiSlugify(baseName), 'chats');
}
/**
 * List all session files in a Gemini chats directory.
 * Returns filenames for before/after comparison.
 */
export async function listGeminiSessionFiles(dir) {
    try {
        const files = await fs.readdir(dir);
        return files.filter(f => f.startsWith('session-') && f.endsWith('.json'));
    }
    catch {
        return [];
    }
}
/**
 * Extract the full session UUID from a Gemini session JSON file.
 */
export async function extractGeminiSessionId(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        const id = data.sessionId;
        return typeof id === 'string' && isValidGuid(id) ? id : null;
    }
    catch {
        return null;
    }
}
/**
 * Detect a new Gemini session by comparing before/after file lists.
 */
export async function detectNewGeminiSessionId(dir, beforeFiles) {
    const afterFiles = await listGeminiSessionFiles(dir);
    const newFiles = afterFiles.filter(f => !beforeFiles.includes(f));
    if (newFiles.length === 0)
        return null;
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
export async function getMostRecentProviderSessionId(providerId, cwd) {
    const dir = getProviderSessionDir(providerId, cwd);
    if (!dir)
        return null;
    switch (providerId) {
        case 'claude': return getMostRecentSessionId(cwd);
        case 'codex': {
            const files = await listCodexSessionFiles(dir);
            if (files.length === 0)
                return null;
            // Codex filenames contain timestamps — lexicographic sort gives most recent last
            const sorted = [...files].sort((a, b) => b.localeCompare(a));
            // Get stats to confirm — filenames may not always sort correctly
            const fileStats = await Promise.all(sorted.slice(0, 5).map(async (f) => {
                try {
                    const stat = await fs.stat(path.join(dir, f));
                    return { file: f, mtime: stat.mtime };
                }
                catch {
                    return null;
                }
            }));
            const valid = fileStats.filter(Boolean);
            valid.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
            return valid.length > 0 ? extractCodexSessionId(valid[0].file) : null;
        }
        case 'gemini': {
            const files = await listGeminiSessionFiles(dir);
            if (files.length === 0)
                return null;
            // Get stats to find most recent by mtime
            const fileStats = await Promise.all(files.map(async (f) => {
                try {
                    const stat = await fs.stat(path.join(dir, f));
                    return { file: f, mtime: stat.mtime };
                }
                catch {
                    return null;
                }
            }));
            const valid = fileStats.filter(Boolean);
            valid.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
            if (valid.length === 0)
                return null;
            return extractGeminiSessionId(path.join(dir, valid[0].file));
        }
        default: return null;
    }
}
/**
 * Get the session directory for a provider.
 */
export function getProviderSessionDir(providerId, cwd) {
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
export async function listProviderSessionFiles(providerId, dir) {
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
export async function detectNewProviderSessionId(providerId, dir, beforeFiles) {
    switch (providerId) {
        case 'claude': return detectNewSessionId(dir, beforeFiles);
        case 'codex': return detectNewCodexSessionId(dir, beforeFiles);
        case 'gemini': return detectNewGeminiSessionId(dir, beforeFiles);
        default: return null;
    }
}
//# sourceMappingURL=claude-utils.js.map