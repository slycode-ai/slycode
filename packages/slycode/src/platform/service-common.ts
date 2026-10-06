import * as path from 'path';
import * as fs from 'fs';
import { type SlyCodeConfig, resolvePackageDir } from '../cli/workspace';
import { SERVICES, type ServiceName } from './service-detect';

export { SERVICES, type ServiceName };
export type { SlyCodeConfig };

/**
 * Resolve the entry point for a service.
 * Web uses server.js (Next.js standalone), others use index.js.
 */
export function resolveEntryPoint(service: string, workspace: string): string {
  const packageDir = resolvePackageDir(workspace);
  const distDir = packageDir ? path.join(packageDir, 'dist') : null;

  // Web uses server.js (Next.js standalone), others use index.js
  const entryFile = service === 'web' ? 'server.js' : 'index.js';

  if (distDir) {
    // Standalone Next.js output nests under web/web/ due to outputFileTracingRoot
    const webPath = service === 'web' ? path.join(distDir, 'web', 'web', entryFile) : null;
    if (webPath && fs.existsSync(webPath)) return webPath;
    const distPath = path.join(distDir, service, entryFile);
    if (fs.existsSync(distPath)) return distPath;
  }

  // Fallback to local dev build
  if (service === 'web') {
    return path.join(workspace, 'web', 'node_modules', '.bin', 'next');
  }
  return path.join(workspace, service, 'dist', 'index.js');
}

/**
 * Resolve the env wrapper script path.
 */
export function resolveWrapperScript(workspace: string): string {
  const packageDir = resolvePackageDir(workspace);
  const wrapperPath = packageDir
    ? path.join(packageDir, 'dist', 'scripts', 'slycode-env-wrapper.sh')
    : path.join(workspace, 'packages', 'slycode', 'src', 'platform', 'slycode-env-wrapper.sh');
  return wrapperPath;
}

/**
 * Load .env from the workspace and return key=value pairs.
 * Used by service installers for enablement checks (e.g. messaging tokens).
 */
export function loadEnvFile(workspace: string): Record<string, string> {
  const envFile = path.join(workspace, '.env');
  const vars: Record<string, string> = {};
  if (!fs.existsSync(envFile)) return vars;

  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (val) vars[key] = val; // Only include non-empty values
    }
  }
  return vars;
}

/**
 * The messaging service has work to do when a chat channel OR a TTS provider
 * is configured: it also renders spoken terminal replies (feature 086), for
 * ElevenLabs or Gemini (feature 087). One rule for start, update and service
 * install, so a TTS-only workspace never loses `speak`.
 */
export function messagingHasWork(envVars: Record<string, string>): boolean {
  return !!(envVars.TELEGRAM_BOT_TOKEN || envVars.SLACK_TOKEN || envVars.ELEVENLABS_API_KEY || envVars.GEMINI_API_KEY);
}

/**
 * Determine which services should be installed.
 * Skips disabled services and messaging with nothing to do (no chat channel, no TTS key).
 */
export function getEnabledServices(
  config: SlyCodeConfig,
  envVars: Record<string, string>
): ServiceName[] {
  const enabled: ServiceName[] = [];
  for (const svc of SERVICES) {
    if (!config.services[svc]) {
      console.log(`  \u2298 ${svc}: disabled in config \u2014 skipping`);
      continue;
    }
    if (svc === 'messaging' && !messagingHasWork(envVars)) {
      console.log(`  \u2298 messaging: no channels or TTS configured \u2014 skipping`);
      console.log('    (add TELEGRAM_BOT_TOKEN, ELEVENLABS_API_KEY or GEMINI_API_KEY to .env, then run service install again)');
      continue;
    }
    enabled.push(svc);
  }
  return enabled;
}
