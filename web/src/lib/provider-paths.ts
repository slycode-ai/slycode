/**
 * Provider Paths — maps provider IDs to their asset directory conventions
 *
 * Claude:  .claude/{skills,agents}
 * Agents:  .agents/skills/ — universal cross-tool directory (read natively by Codex and OpenCode)
 * Codex:   .codex/skills/ — Codex-specific overrides
 */

import path from 'path';
import type { ProviderId, AssetType, ProviderAssetPaths } from './types';
import { validateAssetName, assertInside } from './asset-path-guard';

// ============================================================================
// Provider Directory Conventions
// ============================================================================

const PROVIDER_PATHS: Record<ProviderId, ProviderAssetPaths> = {
  claude: {
    skills: '.claude/skills',
    agents: '.claude/agents',
    mcpConfig: '.mcp.json',
  },
  agents: {
    skills: '.agents/skills',
    agents: '.agents/agents',
    mcpConfig: null,                   // MCP configured per-provider
  },
  codex: {
    skills: '.codex/skills',
    agents: null,                      // Codex has no agents — uses profiles
    mcpConfig: '.codex/config.toml',
  },
};

/**
 * Runtime guard for provider ids arriving from query params / request bodies.
 * A stale or unknown id (e.g. a bookmarked URL for a removed provider) must
 * produce a clean miss, never an `undefined[key]` TypeError.
 */
export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && value in PROVIDER_PATHS;
}

/** Lookup that tolerates unknown ids (returns undefined instead of throwing). */
function pathsFor(provider: ProviderId): ProviderAssetPaths | undefined {
  return PROVIDER_PATHS[provider];
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Get the asset directory path for a provider/type combination in a project.
 * Returns null if the provider doesn't support this asset type.
 */
export function getProviderAssetDir(
  projectPath: string,
  provider: ProviderId,
  assetType: AssetType,
): string | null {
  if (assetType === 'mcp') return null; // MCP uses config files, not a directory

  const key = assetType === 'skill' ? 'skills' : 'agents';
  const relativePath = pathsFor(provider)?.[key];
  if (!relativePath) return null;

  return path.join(projectPath, relativePath);
}

/**
 * Get the full filesystem path for a specific asset file in a project.
 * Returns null if the provider doesn't support this asset type.
 */
export function getProviderAssetFilePath(
  projectPath: string,
  provider: ProviderId,
  assetType: AssetType,
  assetName: string,
): string | null {
  const dir = getProviderAssetDir(projectPath, provider, assetType);
  if (!dir) return null;

  // Traversal guard: assetName must be a plain identifier and the resolved
  // path must stay inside the provider asset dir. Returns null (→ 404/400 at
  // the callers, which already branch on null) on any escape attempt.
  if (!validateAssetName(assetName)) return null;
  const fileName = assetType === 'skill' ? assetName : `${assetName}.md`;
  if (!assertInside(dir, fileName)) return null;

  return path.join(dir, fileName);
}

/**
 * Check if a provider supports a given asset type.
 */
export function isAssetTypeSupported(provider: ProviderId, assetType: AssetType): boolean {
  if (assetType === 'mcp') return true; // All providers support MCP
  const key = assetType === 'skill' ? 'skills' : 'agents';
  return (pathsFor(provider)?.[key] ?? null) !== null;
}

/**
 * Get the path to a provider's MCP config file in a project.
 * Returns null if provider doesn't have MCP config support.
 */
export function getProviderMcpConfigPath(
  projectPath: string,
  provider: ProviderId,
): string | null {
  const configPath = pathsFor(provider)?.mcpConfig;
  if (!configPath) return null;
  return path.join(projectPath, configPath);
}

/**
 * Get the relative asset directory (without project path prefix) for a provider.
 * Useful for display and store path construction.
 */
export function getProviderRelativeDir(
  provider: ProviderId,
  assetType: AssetType,
): string | null {
  if (assetType === 'mcp') return null;
  const key = assetType === 'skill' ? 'skills' : 'agents';
  return pathsFor(provider)?.[key] ?? null;
}

/**
 * Get provider paths configuration (for UI display).
 */
export function getProviderPaths(provider: ProviderId): ProviderAssetPaths {
  return { ...(pathsFor(provider) ?? { skills: null, agents: null, mcpConfig: null }) };
}
