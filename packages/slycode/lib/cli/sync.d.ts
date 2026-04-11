export interface RefreshResult {
    refreshed: number;
    removed: number;
    skipped: number;
    details: {
        name: string;
        from: string;
        to: string;
    }[];
}
/**
 * Compare versions in package templates/updates/skills/ vs workspace updates/skills/.
 * Copy when versions differ or skill is missing.
 */
export declare function refreshUpdates(workspace: string): RefreshResult;
/**
 * Sync action updates from package templates/updates/actions/ to workspace updates/actions/.
 * Uses content comparison — copies when file content differs or action is new.
 * Removes workspace actions not in the package template (manifest is authoritative).
 */
export declare function refreshActionUpdates(workspace: string): RefreshResult;
/**
 * Replace the providers block in workspace providers.json with the template version.
 * Preserves the defaults block (user preferences).
 */
export declare function refreshProviders(workspace: string): {
    updated: boolean;
};
/**
 * Seed terminal-classes.json from package templates if missing in workspace.
 * This ensures existing installations get the file on first sync/update.
 */
export declare function refreshTerminalClasses(workspace: string): {
    seeded: boolean;
};
export declare function sync(_args: string[]): Promise<void>;
//# sourceMappingURL=sync.d.ts.map