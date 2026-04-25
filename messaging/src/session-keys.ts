/**
 * Session-key helpers for messaging. Mirror of web/src/lib/session-keys.ts —
 * kept as a package-local copy because messaging doesn't share the web types.
 * The normalization rule must match scripts/kanban.js:37 and the web helper.
 */

type ProjectKeyShape = {
  id: string;
  path: string;
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
