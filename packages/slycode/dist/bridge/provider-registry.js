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
export function isCommandAllowed(command, allowedCommands, providerConfig) {
    if (allowedCommands.includes(command))
        return true;
    return !!providerConfig && providerConfig.command === command;
}
/** Regex validating a conversation id for the given provider (or the default). */
export function idPatternFor(providerConfig) {
    const source = providerConfig?.idPattern;
    if (!source)
        return DEFAULT_ID_PATTERN;
    try {
        return new RegExp(source);
    }
    catch {
        return DEFAULT_ID_PATTERN;
    }
}
/** Human label for a provider id; falls back to the id itself. */
export function labelFor(providers, providerId) {
    return providers[providerId]?.displayName ?? providerId;
}
/** Agent identity used in cross-agent notes; falls back to the display name. */
export function agentIdentityFor(providers, providerId) {
    const p = providers[providerId];
    return p?.agentIdentity ?? p?.displayName ?? providerId;
}
/** Every command a registry can spawn (for logs/doctor), deduped, plus extras. */
export function registryCommands(providers, extras = []) {
    const out = new Set(extras);
    for (const p of Object.values(providers))
        out.add(p.command);
    return [...out];
}
//# sourceMappingURL=provider-registry.js.map