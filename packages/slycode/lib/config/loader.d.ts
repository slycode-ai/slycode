export interface SlyCodeConfig {
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
export declare const DEFAULTS: SlyCodeConfig;
/**
 * Load slycode.config.js from a directory, merged with defaults.
 */
export declare function loadConfig(dir: string): SlyCodeConfig;
//# sourceMappingURL=loader.d.ts.map