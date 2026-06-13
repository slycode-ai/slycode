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
export declare function normalizeSessionKey(input: string): string;
export declare function computeSessionKey(projectPath: string): string;
export declare function projectSessionKeys(project: ProjectKeyShape): string[];
export declare function sessionNameFor(project: ProjectKeyShape, provider: string | undefined, cardId?: string): string;
export declare function sessionBelongsToProject(sessionName: string, project: ProjectKeyShape): boolean;
export declare function escapeRegex(s: string): string;
export declare function projectKeyAlternation(project: ProjectKeyShape): string;
export type ResolveProjectIdResult = {
    id: string;
    via: 'id' | 'sessionKey' | 'alias' | 'name';
} | null;
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
export declare function resolveCanonicalProjectId(key: string, projects: ProjectKeyShape[]): ResolveProjectIdResult;
export {};
