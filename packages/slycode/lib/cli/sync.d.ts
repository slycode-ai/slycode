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
 * Replace the providers block in workspace providers.json with the template version.
 * Preserves the defaults block (user preferences).
 */
export declare function refreshProviders(workspace: string): {
    updated: boolean;
};
export declare function sync(_args: string[]): Promise<void>;
//# sourceMappingURL=sync.d.ts.map