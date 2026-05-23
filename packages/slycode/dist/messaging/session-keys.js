/**
 * Session-key helpers for messaging. Mirror of web/src/lib/session-keys.ts —
 * kept as a package-local copy because messaging doesn't share the web types.
 * The normalization rule must match scripts/kanban.js:37 and the web helper.
 */
export function normalizeSessionKey(input) {
    return input.replace(/[^a-zA-Z0-9-]/g, '-');
}
export function computeSessionKey(projectPath) {
    const parts = projectPath.split(/[/\\]/).filter(Boolean);
    const base = parts[parts.length - 1] ?? '';
    return normalizeSessionKey(base);
}
export function projectSessionKeys(project) {
    const primary = project.sessionKey ?? computeSessionKey(project.path);
    const aliases = project.sessionKeyAliases ?? (project.id !== primary ? [project.id] : []);
    return Array.from(new Set([primary, ...aliases].filter(Boolean)));
}
export function sessionNameFor(project, provider, cardId) {
    const primary = project.sessionKey ?? computeSessionKey(project.path);
    const suffix = cardId ? `card:${cardId}` : 'global';
    return provider ? `${primary}:${provider}:${suffix}` : `${primary}:${suffix}`;
}
export function sessionBelongsToProject(sessionName, project) {
    const firstSegment = sessionName.split(':')[0];
    return projectSessionKeys(project).includes(firstSegment);
}
export function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export function projectKeyAlternation(project) {
    return projectSessionKeys(project).map(escapeRegex).join('|');
}
/**
 * Resolve an arbitrary project key (canonical project.id, sessionKey, or
 * sessionKeyAlias) to the canonical project.id. Used by the Telegram
 * sw_card_ / sw_proj_ callback handlers, which can receive any of those
 * forms depending on when the button was emitted: post-fix buttons embed
 * canonical project.id; pre-fix buttons still in Telegram history embed
 * sessionKey; buttons emitted before a dashboard path rename embed the
 * old sessionKey (now living in sessionKeyAliases).
 *
 * Match order is intentional: id → sessionKey → alias. Returns null when
 * nothing matches.
 */
export function resolveCanonicalProjectId(key, projects) {
    const byId = projects.find(p => p.id === key);
    if (byId)
        return { id: byId.id, via: 'id' };
    const bySessionKey = projects.find(p => {
        const sk = p.sessionKey ?? computeSessionKey(p.path);
        return sk === key;
    });
    if (bySessionKey)
        return { id: bySessionKey.id, via: 'sessionKey' };
    const byAlias = projects.find(p => {
        const sk = p.sessionKey ?? computeSessionKey(p.path);
        const aliases = p.sessionKeyAliases ?? (p.id !== sk ? [p.id] : []);
        return aliases.includes(key);
    });
    if (byAlias)
        return { id: byAlias.id, via: 'alias' };
    return null;
}
//# sourceMappingURL=session-keys.js.map