export declare const CLI_TOOLS: readonly ["slycode", "sly-atlas", "sly-kanban", "sly-messaging", "sly-scaffold"];
/**
 * Create global CLI symlinks/shims for sly-kanban, sly-messaging, sly-scaffold.
 */
export declare function linkClis(workspace: string): void;
/**
 * Quiet, idempotent self-heal of the CLI links — run on `slycode start`.
 *
 * Why this exists: `slycode update` re-links, but the update command RUNS the
 * OLD package's code (loaded before npm swaps it), so a CLI tool introduced in
 * the new release isn't in the old CLI_TOOLS list and never gets linked (this
 * is exactly how sly-atlas ended up missing on upgraded installs). start runs
 * the NEW code, so healing here converges after any update path — including a
 * plain `npm install` that bypasses linkClis entirely. Silent when everything
 * is already correct; never throws.
 */
export declare function ensureClis(workspace: string): void;
/**
 * Remove global CLI symlinks/shims.
 */
export declare function unlinkClis(): void;
//# sourceMappingURL=symlinks.d.ts.map