import { type SlyCodeConfig } from '../cli/workspace';
import { SERVICES, type ServiceName } from './service-detect';
export { SERVICES, type ServiceName };
export type { SlyCodeConfig };
/**
 * Resolve the entry point for a service.
 * Web uses server.js (Next.js standalone), others use index.js.
 */
export declare function resolveEntryPoint(service: string, workspace: string): string;
/**
 * Resolve the env wrapper script path.
 */
export declare function resolveWrapperScript(workspace: string): string;
/**
 * Load .env from the workspace and return key=value pairs.
 * Used by service installers for enablement checks (e.g. messaging tokens).
 */
export declare function loadEnvFile(workspace: string): Record<string, string>;
/**
 * The messaging service has work to do when a chat channel OR a TTS provider
 * is configured: it also renders spoken terminal replies (feature 086), for
 * ElevenLabs or Gemini (feature 087). One rule for start, update and service
 * install, so a TTS-only workspace never loses `speak`.
 */
export declare function messagingHasWork(envVars: Record<string, string>): boolean;
/**
 * Determine which services should be installed.
 * Skips disabled services and messaging with nothing to do (no chat channel, no TTS key).
 */
export declare function getEnabledServices(config: SlyCodeConfig, envVars: Record<string, string>): ServiceName[];
//# sourceMappingURL=service-common.d.ts.map