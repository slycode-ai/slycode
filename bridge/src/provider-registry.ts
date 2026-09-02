/**
 * Provider registry helpers (feature 085 sweep).
 *
 * Pure functions that derive the lists the bridge used to hardcode as a
 * literal union of provider ids from providers.json entries, so adding or
 * removing a provider is a registry edit. Dependency-free so they can be
 * table-tested.
 */
import type { ProviderConfig } from './provider-utils.js';

/**
 * Historical conversation-id shape accepted by the manual link route: UUIDs
 * (Claude, Gemini) and Codex rollout ids. Providers with other id shapes
 * declare `idPattern` in providers.json.
 */
export const DEFAULT_ID_PATTERN = /^[0-9a-f][0-9a-f-]{7,40}[0-9a-f]$/i;

/**
 * Whether a command may be spawned. Two sources of trust, both workspace
 * config: bridge-config.json `allowedCommands` (explicit allow-list, still
 * honoured verbatim) and providers.json (a resolved provider's own command is
 * allowed by construction). The second source is what stops a deployed
 * bridge-config.json that predates a new provider from rejecting it.
 */
export function isCommandAllowed(
  command: string,
  allowedCommands: readonly string[],
  providerConfig: Pick<ProviderConfig, 'command'> | null | undefined,
): boolean {
  if (allowedCommands.includes(command)) return true;
  return !!providerConfig && providerConfig.command === command;
}

/** Regex validating a conversation id for the given provider (or the default). */
export function idPatternFor(providerConfig: Pick<ProviderConfig, 'idPattern'> | null | undefined): RegExp {
  const source = providerConfig?.idPattern;
  if (!source) return DEFAULT_ID_PATTERN;
  try {
    return new RegExp(source);
  } catch {
    return DEFAULT_ID_PATTERN;
  }
}

/** Human label for a provider id; falls back to the id itself. */
export function labelFor(providers: Record<string, Pick<ProviderConfig, 'displayName'>>, providerId: string): string {
  return providers[providerId]?.displayName ?? providerId;
}

/** Agent identity used in cross-agent notes; falls back to the display name. */
export function agentIdentityFor(
  providers: Record<string, Pick<ProviderConfig, 'displayName' | 'agentIdentity'>>,
  providerId: string,
): string {
  const p = providers[providerId];
  return p?.agentIdentity ?? p?.displayName ?? providerId;
}

/** Every command a registry can spawn (for logs/doctor), deduped, plus extras. */
export function registryCommands(
  providers: Record<string, Pick<ProviderConfig, 'command'>>,
  extras: readonly string[] = [],
): string[] {
  const out = new Set<string>(extras);
  for (const p of Object.values(providers)) out.add(p.command);
  return [...out];
}
