/**
 * Provider Paths — maps provider IDs to their asset directory conventions
 *
 * Claude:  .claude/{skills,agents}
 * Agents:  .agents/skills/ — universal cross-tool directory read by both Codex and Gemini
 * Codex:   .codex/skills/ — Codex-specific overrides
 * Gemini:  .gemini/{skills,agents}
 */

import path from 'path';
import type { ProviderId, AssetType, ProviderAssetPaths } from './types';

// ============================================================================
// Provider Directory Conventions
// ============================================================================

const PROVIDER_PATHS: Record<ProviderId, ProviderAssetPaths> = {
  claude: {
    skills: '.claude/skills',
    agents: '.claude/agents',
    mcpConfig: '.claude/settings.json',
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
  gemini: {
    skills: '.gemini/skills',
    agents: '.gemini/agents',
    mcpConfig: '.gemini/settings.json',
  },
};

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
  const relativePath = PROVIDER_PATHS[provider][key];
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

  if (assetType === 'skill') {
    return path.join(dir, assetName); // Skills are directories
  }

  // Agents are .md files
  return path.join(dir, `${assetName}.md`);
}

/**
 * Check if a provider supports a given asset type.
 */
export function isAssetTypeSupported(provider: ProviderId, assetType: AssetType): boolean {
  if (assetType === 'mcp') return true; // All providers support MCP
  const key = assetType === 'skill' ? 'skills' : 'agents';
  return PROVIDER_PATHS[provider][key] !== null;
}

/**
 * Get the path to a provider's MCP config file in a project.
 * Returns null if provider doesn't have MCP config support.
 */
export function getProviderMcpConfigPath(
  projectPath: string,
  provider: ProviderId,
): string | null {
  const configPath = PROVIDER_PATHS[provider].mcpConfig;
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
  return PROVIDER_PATHS[provider][key];
}

/**
 * Get provider paths configuration (for UI display).
 */
export function getProviderPaths(provider: ProviderId): ProviderAssetPaths {
  return { ...PROVIDER_PATHS[provider] };
}
