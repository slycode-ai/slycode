/**
 * Get the Claude projects directory path for a given working directory.
 * Claude transforms /path/to/project into ~/.claude/projects/-path-to-project/
 * On Linux: forward slashes and underscores become hyphens.
 * On Windows: backslashes, colons, forward slashes, and underscores become hyphens.
 *   e.g. D:\Dev\Projects\slycode -> D--Dev-Projects-slycode
 *
 * IMPORTANT: Resolve symlinks before transforming, because Claude CLI uses
 * realpathSync internally. Without this, a symlinked CWD (e.g. /home/user/link
 * -> /opt/actual) causes the bridge to poll a different directory than where
 * Claude writes session files, and GUID detection silently fails.
 */
export declare function getClaudeProjectDir(cwd: string): string;
/**
 * List all .jsonl session files in a Claude project directory
 */
export declare function listSessionFiles(claudeDir: string): Promise<string[]>;
/**
 * Extract GUID from a session filename
 */
export declare function extractGuidFromFilename(filename: string): string;
/**
 * Check if a string is a valid UUID/GUID format
 */
export declare function isValidGuid(str: string): boolean;
/**
 * Detect a new Claude session ID by comparing before/after file lists.
 * Call getSessionFilesBefore() before spawning, then call this after first output.
 */
export declare function detectNewSessionId(claudeDir: string, beforeFiles: string[]): Promise<string | null>;
/**
 * Get the most recent session ID for a project directory.
 * Useful when we don't have a stored GUID but want to resume the latest session.
 */
export declare function getMostRecentSessionId(cwd: string): Promise<string | null>;
/**
 * Watch for a new session file to appear (with timeout)
 */
export declare function watchForNewSession(claudeDir: string, beforeFiles: string[], timeoutMs?: number): Promise<string | null>;
export interface ClaudeSessionInfo {
    sessionId: string;
    projectDir: string;
    lastModified: Date;
}
/**
 * Get all Claude sessions for a project
 */
export declare function getProjectSessions(cwd: string): Promise<ClaudeSessionInfo[]>;
/**
 * Get the Codex sessions directory for the current date.
 * Codex stores sessions globally (not per-project) in ~/.codex/sessions/YYYY/MM/DD/
 */
export declare function getCodexSessionDir(): string;
/**
 * List all session IDs from Codex rollout files in a directory.
 * Returns filenames (without path) as keys for before/after comparison.
 */
export declare function listCodexSessionFiles(dir: string): Promise<string[]>;
/**
 * Extract UUID from a Codex rollout filename.
 */
export declare function extractCodexSessionId(filename: string): string | null;
/**
 * Detect a new Codex session by comparing before/after file lists.
 */
export declare function detectNewCodexSessionId(dir: string, beforeFiles: string[]): Promise<string | null>;
/**
 * Get the Gemini chats directory for a given cwd.
 * Reads ~/.gemini/projects.json for the canonical slug (Gemini's own registry).
 * Falls back to computing the slug for first-run cases.
 */
export declare function getGeminiSessionDir(cwd: string): string;
/**
 * List all session files in a Gemini chats directory.
 * Returns filenames for before/after comparison.
 */
export declare function listGeminiSessionFiles(dir: string): Promise<string[]>;
/**
 * Extract the full session UUID from a Gemini session JSON file.
 */
export declare function extractGeminiSessionId(filePath: string): Promise<string | null>;
/**
 * Detect a new Gemini session by comparing before/after file lists.
 */
export declare function detectNewGeminiSessionId(dir: string, beforeFiles: string[]): Promise<string | null>;
/**
 * Get the most recently modified session ID for any provider.
 * Used by the "relink" feature to re-detect the active session.
 */
export declare function getMostRecentProviderSessionId(providerId: string, cwd: string): Promise<string | null>;
/**
 * Get the session directory for a provider.
 */
export declare function getProviderSessionDir(providerId: string, cwd: string): string | null;
/**
 * List session file identifiers for before/after comparison.
 */
export declare function listProviderSessionFiles(providerId: string, dir: string): Promise<string[]>;
/**
 * Detect a new session ID by comparing before/after file lists.
 */
export declare function detectNewProviderSessionId(providerId: string, dir: string, beforeFiles: string[]): Promise<string | null>;
