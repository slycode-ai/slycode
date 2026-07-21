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
 * Whole-directory content digest: sorted '/'-normalized relative paths +
 * per-file sha256 (12 hex) rolled into one sha256, truncated to 12 hex.
 * Detects changes to ANY file in a skill, not just SKILL.md.
 *
 * LOCKSTEP MIRROR of web/src/lib/skill-dir-digest.ts:hashSkillDir (the CLI
 * cannot import from web/). Keep walk order, separator normalization, and
 * roll format identical or the two detection stages will disagree.
 * Exported for the parity test in web/src/lib/skill-dir-digest.test.ts.
 */
export declare function hashSkillDirDigest(dir: string): string;
/**
 * Compare package templates/updates/skills/ vs workspace updates/skills/ by
 * whole-directory content digest. Copy when ANY file differs or skill is
 * missing — a reference/script fix without a version bump still propagates.
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
 *
 * INVARIANT (feature 073): `defaults` is user config — the single global
 * default provider/model (including free-text custom model ids) lives there.
 * It MUST survive the providers-block replacement; never extend this merge
 * to overwrite `defaults`.
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