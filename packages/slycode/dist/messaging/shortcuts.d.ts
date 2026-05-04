/**
 * Quick-launch Shortcuts — read-only resolver for messaging.
 *
 * Mirrors web/src/lib/shortcuts.ts. Messaging only reads; the web API is the
 * single source of truth for writes and tag-uniqueness validation.
 */
import type { ShortcutsFile, Project } from './types.js';
export type ResolvedToken = {
    kind: 'card';
    projectId: string;
    cardId: string;
} | {
    kind: 'shortcut';
    projectId: string;
    cardId: string;
    prompt?: string;
    provider?: string;
    preferExistingSession?: boolean;
} | {
    kind: 'project';
    projectId: string;
} | {
    kind: 'global';
} | {
    kind: 'miss';
    reason: string;
};
export interface ProjectShortcuts {
    projectId: string;
    projectName: string;
    projectPath: string;
    file: ShortcutsFile;
}
export declare function loadShortcuts(projectPath: string): ShortcutsFile;
/** Build the workspace-wide shortcut snapshot from a project list. */
export declare function loadAllShortcuts(projects: Project[]): ProjectShortcuts[];
/**
 * Resolve a token to a target.
 *
 * Telegram form (unscoped): `<tag>-<digits|label>` or `global`.
 */
export declare function resolveToken(token: string, allShortcuts: ProjectShortcuts[]): ResolvedToken;
