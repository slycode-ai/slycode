/**
 * Session-key helpers — canonical identity for bridge session names.
 *
 * Background: `project.id` in the registry is for routing, display, and state.
 * It is NOT safe to use for bridge session naming because it can contain dots,
 * drift from the folder name, or even be typo'd. Bridge session names must
 * match what the CLI (scripts/kanban.js:37) produces from path.basename, which
 * uses `/[^a-zA-Z0-9-]/g -> '-'`.
 *
 * This module provides:
 *   - `normalizeSessionKey()` — the canonical transform (mirror of CLI)
 *   - `computeSessionKey(path)` — derive from a project's filesystem path
 *   - `projectSessionKeys(project)` — alias-aware key set for matching
 *   - `sessionNameFor(project, provider, cardId?)` — build a new session name
 *   - `sessionBelongsToProject(name, project)` — filter by alias-aware prefix
 *
 * Writers always use `project.sessionKey` (the canonical form).
 * Readers use alias-aware matching so existing sessions created under the old
 * `project.id` form keep working after upgrade.
 */

import type { Project } from './types';

/**
 * Shape consumers use when they have a project-like object but may not yet
 * have the sessionKey populated (e.g. during the migration window or when
 * components receive separate id/path props and synthesize the shape).
 */
type ProjectKeyShape = {
  id: string;
  path: string;
  sessionKey?: string;
  sessionKeyAliases?: string[];
};

/**
 * Transform a raw string into a session-safe identifier. Matches
 * `scripts/kanban.js:37` exactly — DO NOT drift these.
 */
export function normalizeSessionKey(input: string): string {
  return input.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Compute the canonical sessionKey from a project's filesystem path.
 * Browser- and node-safe (handles both separators).
 */
export function computeSessionKey(projectPath: string): string {
  // basename that works across / and \
  const parts = projectPath.split(/[/\\]/).filter(Boolean);
  const base = parts[parts.length - 1] ?? '';
  return normalizeSessionKey(base);
}

/**
 * Return [sessionKey, ...aliases] deduped. Used for alias-aware matching.
 * Falls back gracefully if sessionKey is missing (pre-migration state).
 */
export function projectSessionKeys(project: ProjectKeyShape): string[] {
  const primary = project.sessionKey ?? computeSessionKey(project.path);
  const aliases = project.sessionKeyAliases ?? (project.id !== primary ? [project.id] : []);
  return Array.from(new Set([primary, ...aliases].filter(Boolean)));
}

/**
 * Build a new session name for creating or directly fetching a session.
 * Always uses the canonical sessionKey (never an alias) for new sessions.
 */
export function sessionNameFor(
  project: ProjectKeyShape,
  provider: string | undefined,
  cardId?: string,
): string {
  const primary = project.sessionKey ?? computeSessionKey(project.path);
  const suffix = cardId ? `card:${cardId}` : 'global';
  return provider
    ? `${primary}:${provider}:${suffix}`
    : `${primary}:${suffix}`;
}

/**
 * Return session-name candidates in preference order: canonical first, then
 * aliases. Consumers that do direct GETs should try each until one resolves.
 */
export function sessionNameCandidates(
  project: ProjectKeyShape,
  provider: string | undefined,
  cardId?: string,
): string[] {
  const suffix = cardId ? `card:${cardId}` : 'global';
  return projectSessionKeys(project).map(key =>
    provider ? `${key}:${provider}:${suffix}` : `${key}:${suffix}`,
  );
}

/**
 * Check whether a session name belongs to a project (alias-aware).
 * Matches on the first colon-separated segment.
 */
export function sessionBelongsToProject(
  sessionName: string,
  project: ProjectKeyShape,
): boolean {
  const firstSegment = sessionName.split(':')[0];
  return projectSessionKeys(project).includes(firstSegment);
}

/**
 * Escape a string for safe interpolation into a RegExp.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a regex alternation matching any of the project's session keys.
 * Consumers that need pattern matching (not simple equality) can use this.
 */
export function projectKeyAlternation(project: ProjectKeyShape): string {
  return projectSessionKeys(project).map(escapeRegex).join('|');
}

/**
 * Sum bridge-stats counts across all of a project's session keys (canonical
 * + aliases). Used for activity indicators that aggregate session counts by
 * the first segment of the session name. Without alias awareness, projects
 * whose registry id differs from sessionKey would always show zero.
 */
export function sumProjectActivityCounts(
  project: ProjectKeyShape,
  counts: Record<string, number>,
): number {
  return projectSessionKeys(project).reduce(
    (sum, key) => sum + (counts[key] ?? 0),
    0,
  );
}

/**
 * Ensure a project has sessionKey + sessionKeyAliases populated. Mutates the
 * project in place. Returns true if anything was changed (for dirty tracking).
 *
 * Self-heal rules:
 *   - sessionKey, if missing, is computed from path.basename.
 *   - sessionKeyAliases, if undefined, is initialized from project.id when it
 *     differs from the computed sessionKey (so old bridge sessions still
 *     resolve). An empty array means "explicitly no aliases".
 */
export function ensureProjectSessionKey(project: Project): boolean {
  let dirty = false;
  if (!project.sessionKey) {
    project.sessionKey = computeSessionKey(project.path);
    dirty = true;
  }
  if (project.sessionKeyAliases === undefined) {
    project.sessionKeyAliases =
      project.id && project.id !== project.sessionKey ? [project.id] : [];
    dirty = true;
  }
  return dirty;
}
