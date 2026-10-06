/**
 * Shape checks for bridge-sessions.json (card #0366). Pure, dependency-free.
 *
 * A document that parses is not necessarily safe to load: a salvaged prefix or a
 * hand-repaired file can carry `null` or half-written session records, and the
 * session manager dereferences records (`persisted.cwd`, `new Date(createdAt)`)
 * without re-checking. Validation is per record so one bad entry never costs the
 * rest of the history.
 *
 * Deliberately lenient: only the fields every writer has always set are
 * required; optional fields are checked only when present, so records written
 * by older versions still load.
 */
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const OPTIONAL_FIELDS = {
    claudeSessionId: (v) => v === null || typeof v === 'string',
    lastActive: (v) => typeof v === 'string',
    conversationStartedAt: (v) => typeof v === 'string',
    provider: (v) => typeof v === 'string',
    skipPermissions: (v) => typeof v === 'boolean',
    model: (v) => typeof v === 'string',
    exitCode: (v) => typeof v === 'number',
    exitedAt: (v) => typeof v === 'string',
    exitOutput: (v) => typeof v === 'string',
    pid: (v) => v === null || typeof v === 'number',
    transportState: isPlainObject,
};
export function isPersistedSession(value) {
    if (!isPlainObject(value))
        return false;
    if (typeof value.cwd !== 'string' || typeof value.createdAt !== 'string')
        return false;
    for (const [field, ok] of Object.entries(OPTIONAL_FIELDS)) {
        if (value[field] !== undefined && !ok(value[field]))
            return false;
    }
    return true;
}
/** null when the value is not a `{ sessions: {...} }` document at all. */
export function sanitizePersistedState(value) {
    if (!isPlainObject(value) || !isPlainObject(value.sessions))
        return null;
    const sessions = {};
    const dropped = [];
    for (const [name, record] of Object.entries(value.sessions)) {
        if (isPersistedSession(record))
            sessions[name] = record;
        else
            dropped.push(name);
    }
    return { state: { ...value, sessions }, dropped };
}
//# sourceMappingURL=persisted-state-validation.js.map