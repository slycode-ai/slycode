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
import type { PersistedSession, PersistedState } from './types.js';
export declare function isPersistedSession(value: unknown): value is PersistedSession;
export interface SanitizedState {
    state: PersistedState;
    /** Names of session records that were dropped as invalid. */
    dropped: string[];
}
/** null when the value is not a `{ sessions: {...} }` document at all. */
export declare function sanitizePersistedState(value: unknown): SanitizedState | null;
