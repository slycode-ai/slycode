export interface SlyCodeConfig {
    host: string;
    ports: {
        web: number;
        bridge: number;
        messaging: number;
    };
    services: {
        web: boolean;
        bridge: boolean;
        messaging: boolean;
    };
}
/**
 * Resolve the SlyCode workspace directory.
 *
 * Resolution order:
 * 1. SLYCODE_HOME environment variable
 * 2. ~/.slycode/config.json → { "home": "/path/to/workspace" }
 * 3. Walk up from cwd looking for slycode.config.js or package.json with slycode dep
 */
export declare function resolveWorkspace(): string | null;
/**
 * Resolve workspace or exit with an error message.
 */
export declare function resolveWorkspaceOrExit(): string;
/**
 * Load slycode.config.js from the workspace, merged with defaults.
 */
export declare function resolveConfig(workspace: string): SlyCodeConfig;
/**
 * Get the path to the .slycode state directory (in home dir).
 */
export declare function getStateDir(): string;
/**
 * Ensure the .slycode state directory exists.
 */
export declare function ensureStateDir(): string;
/**
 * Save workspace path to ~/.slycode/config.json
 */
export declare function saveWorkspacePath(workspacePath: string): void;
/**
 * Resolve the path to the slycode package (in node_modules).
 */
export declare function resolvePackageDir(workspace: string): string | null;
//# sourceMappingURL=workspace.d.ts.map