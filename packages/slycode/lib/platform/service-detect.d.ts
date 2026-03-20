export declare const SERVICES: readonly ["web", "bridge", "messaging"];
export type ServiceName = typeof SERVICES[number];
export type RunMode = 'systemd' | 'launchd' | 'windows-task' | 'background' | 'none';
/**
 * Ensure XDG_RUNTIME_DIR is set.
 * Required for `systemctl --user` in environments like SSH, code-server, and cron
 * where the variable may not be inherited.
 */
export declare function ensureXdgRuntime(): void;
/**
 * Detect how services are currently running.
 * Checks platform service managers first, then falls back to PID state file.
 */
export declare function detectRunMode(stateFile: string): RunMode;
/**
 * Detect if service manager units/plists are installed (regardless of active state).
 * Used by start to decide whether to delegate to the service manager.
 */
export declare function detectInstalledServiceManager(): 'systemd' | 'launchd' | 'none';
//# sourceMappingURL=service-detect.d.ts.map