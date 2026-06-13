/**
 * Session-key helpers for messaging. Mirror of web/src/lib/session-keys.ts —
 * kept as a package-local copy because messaging doesn't share the web types.
 * The normalization rule must match scripts/kanban.js:37 and the web helper.
 */

type ProjectKeyShape = {
  id: string;
  path: string;
  name?: string;
  sessionKey?: string;
  sessionKeyAliases?: string[];
};

export function normalizeSessionKey(input: string): string {
  return input.replace(/[^a-zA-Z0-9-]/g, '-');
}

export function computeSessionKey(projectPath: string): string {
  const parts = projectPath.split(/[/\\]/).filter(Boolean);
  const base = parts[parts.length - 1] ?? '';
  return normalizeSessionKey(base);
}

export function projectSessionKeys(project: ProjectKeyShape): string[] {
  const primary = project.sessionKey ?? computeSessionKey(project.path);
  const aliases = project.sessionKeyAliases ?? (project.id !== primary ? [project.id] : []);
  return Array.from(new Set([primary, ...aliases].filter(Boolean)));
}

export function sessionNameFor(
  project: ProjectKeyShape,
  provider: string | undefined,
  cardId?: string,
): string {
  const primary = project.sessionKey ?? computeSessionKey(project.path);
  const suffix = cardId ? `card:${cardId}` : 'global';
  return provider ? `${primary}:${provider}:${suffix}` : `${primary}:${suffix}`;
}

export function sessionBelongsToProject(
  sessionName: string,
  project: ProjectKeyShape,
): boolean {
  const firstSegment = sessionName.split(':')[0];
  return projectSessionKeys(project).includes(firstSegment);
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function projectKeyAlternation(project: ProjectKeyShape): string {
  return projectSessionKeys(project).map(escapeRegex).join('|');
}

export type ResolveProjectIdResult =
  | { id: string; via: 'id' | 'sessionKey' | 'alias' | 'name' }
  | null;

/**
 * Resolve an arbitrary project key (canonical project.id, sessionKey, or
 * sessionKeyAlias) to the canonical project.id. Used by the Telegram
 * sw_card_ / sw_proj_ callback handlers, which can receive any of those
 * forms depending on when the button was emitted: post-fix buttons embed
 * canonical project.id; pre-fix buttons still in Telegram history embed
 * sessionKey; buttons emitted before a dashboard path rename embed the
 * old sessionKey (now living in sessionKeyAliases).
 *
 * Match order is intentional: id → sessionKey → alias → name. Display-name
 * matching (case-insensitive exact) is last so it can never shadow a
 * canonical key; it exists for human-facing callers like
 * `messaging-cli generate --project SlyCode`. Returns null when nothing
 * matches.
 */
export function resolveCanonicalProjectId(
  key: string,
  projects: ProjectKeyShape[],
): ResolveProjectIdResult {
  const byId = projects.find(p => p.id === key);
  if (byId) return { id: byId.id, via: 'id' };

  const bySessionKey = projects.find(p => {
    const sk = p.sessionKey ?? computeSessionKey(p.path);
    return sk === key;
  });
  if (bySessionKey) return { id: bySessionKey.id, via: 'sessionKey' };

  const byAlias = projects.find(p => {
    const sk = p.sessionKey ?? computeSessionKey(p.path);
    const aliases = p.sessionKeyAliases ?? (p.id !== sk ? [p.id] : []);
    return aliases.includes(key);
  });
  if (byAlias) return { id: byAlias.id, via: 'alias' };

  const lowered = key.toLowerCase();
  const byName = projects.find(p => p.name?.toLowerCase() === lowered);
  if (byName) return { id: byName.id, via: 'name' };

  return null;
}
