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
export declare function normalizeSessionKey(input: string): string;
export declare function computeSessionKey(projectPath: string): string;
export declare function projectSessionKeys(project: ProjectKeyShape): string[];
export declare function sessionNameFor(project: ProjectKeyShape, provider: string | undefined, cardId?: string): string;
export declare function sessionBelongsToProject(sessionName: string, project: ProjectKeyShape): boolean;
export declare function escapeRegex(s: string): string;
export declare function projectKeyAlternation(project: ProjectKeyShape): string;
export {};
