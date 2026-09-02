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
export declare const DEFAULT_ID_PATTERN: RegExp;
/**
 * Whether a command may be spawned. Two sources of trust, both workspace
 * config: bridge-config.json `allowedCommands` (explicit allow-list, still
 * honoured verbatim) and providers.json (a resolved provider's own command is
 * allowed by construction). The second source is what stops a deployed
 * bridge-config.json that predates a new provider from rejecting it.
 */
export declare function isCommandAllowed(command: string, allowedCommands: readonly string[], providerConfig: Pick<ProviderConfig, 'command'> | null | undefined): boolean;
/** Regex validating a conversation id for the given provider (or the default). */
export declare function idPatternFor(providerConfig: Pick<ProviderConfig, 'idPattern'> | null | undefined): RegExp;
/** Human label for a provider id; falls back to the id itself. */
export declare function labelFor(providers: Record<string, Pick<ProviderConfig, 'displayName'>>, providerId: string): string;
/** Agent identity used in cross-agent notes; falls back to the display name. */
export declare function agentIdentityFor(providers: Record<string, Pick<ProviderConfig, 'displayName' | 'agentIdentity'>>, providerId: string): string;
/** Every command a registry can spawn (for logs/doctor), deduped, plus extras. */
export declare function registryCommands(providers: Record<string, Pick<ProviderConfig, 'command'>>, extras?: readonly string[]): string[];
