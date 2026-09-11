/**
 * Session-name parsing (feature 086).
 *
 * Single home for the session-name grammar the bridge uses. Shapes seen in
 * the wild (see web/src/lib/session-keys.ts sessionNameFor and
 * SessionManager.toLegacySessionName):
 *
 *   {project}:{provider}:card:{cardId}   current card terminal
 *   {project}:card:{cardId}              legacy (pre multi-provider)
 *   {project}:{provider}:global          current project terminal
 *   {project}:global                     legacy
 *   {project}:{provider}:atlas           Code Mode atlas terminal (feature 076)
 *   {project}:atlas                      legacy atlas
 *   action-assistant:global              Sly action config assistant
 *
 * messaging/src/bridge-client.ts carries the same card regex; keep in step.
 */
const ACTION_ASSISTANT_KEY = 'action-assistant';
export function parseSessionName(name) {
    const parts = name.split(':');
    const projectKey = parts[0] ?? '';
    const isAction = projectKey === ACTION_ASSISTANT_KEY;
    // {project}:{provider}:card:{id}
    if (parts.length === 4 && parts[2] === 'card' && parts[3]) {
        return { projectKey, provider: parts[1], kind: 'card', cardId: parts[3] };
    }
    // {project}:card:{id}
    if (parts.length === 3 && parts[1] === 'card' && parts[2]) {
        return { projectKey, kind: 'card', cardId: parts[2] };
    }
    // {project}:{provider}:global | atlas
    if (parts.length === 3 && (parts[2] === 'global' || parts[2] === 'atlas')) {
        const kind = parts[2] === 'atlas' ? 'atlas' : (isAction ? 'action' : 'global');
        return { projectKey, provider: parts[1], kind };
    }
    // {project}:global | atlas
    if (parts.length === 2 && (parts[1] === 'global' || parts[1] === 'atlas')) {
        const kind = parts[1] === 'atlas' ? 'atlas' : (isAction ? 'action' : 'global');
        return { projectKey, kind };
    }
    return { projectKey, kind: 'unknown' };
}
/**
 * Rate-limit bucket key. Keeps PROVIDER identity (a card's claude and codex
 * terminals are different agents with their own allowance — one must never
 * block the other) while collapsing true aliases: the bridge resolves legacy
 * provider-less names to the live session before calling this, and a
 * reconnect/recreate of the same session name lands on the same key. A
 * provider-less legacy name is its own identity (`<project>:legacy:...`).
 */
export function canonicalRateKey(name) {
    const p = parseSessionName(name);
    const provider = (p.provider || 'legacy').toLowerCase();
    switch (p.kind) {
        case 'card': return `${p.projectKey}:${provider}:card:${p.cardId}`;
        case 'atlas': return `${p.projectKey}:${provider}:atlas`;
        case 'global':
        case 'action': return `${p.projectKey}:${provider}:global`;
        default: return name;
    }
}
/** Human label for the speech bubble: "#0348 · title", "proj · global terminal". */
export function sourceLabel(parsed, hints = {}) {
    const project = hints.projectName || parsed.projectKey || 'unknown project';
    if (parsed.kind === 'card') {
        const num = hints.cardNumber !== undefined && hints.cardNumber !== null && hints.cardNumber !== ''
            ? `#${String(hints.cardNumber).padStart(4, '0')}`
            : null;
        const title = hints.cardTitle?.trim();
        if (num && title)
            return `${num} · ${title}`;
        if (num)
            return `${num} · ${project}`;
        if (title)
            return `${project} · ${title}`;
        return `${project} · card ${parsed.cardId}`;
    }
    if (parsed.kind === 'atlas')
        return `${project} · atlas terminal`;
    if (parsed.kind === 'action')
        return 'Sly action assistant';
    if (parsed.kind === 'global')
        return `${project} · global terminal`;
    return project;
}
//# sourceMappingURL=session-name.js.map