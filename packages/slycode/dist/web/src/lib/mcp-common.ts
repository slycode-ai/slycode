/**
 * MCP Common Format — provider-neutral MCP config with transformers
 *
 * Store holds MCP configs in a common JSON format.
 * Transformers convert to/from each provider's native format:
 *   Claude:  JSON in .claude/settings.json (mcpServers key)
 *   Gemini:  JSON in .gemini/settings.json (mcpServers key)
 *   Codex:   TOML in .codex/config.toml ([mcp_servers.name] section)
 */

import fs from 'fs';
import path from 'path';
import type { ProviderId } from './types';
import { getProviderMcpConfigPath } from './provider-paths';

// ============================================================================
// Common MCP Config Type
// ============================================================================

export interface CommonMcpConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  version?: string;
  description?: string;
  updated?: string;
}

// ============================================================================
// Store I/O
// ============================================================================

/**
 * Read a common MCP config from the store.
 */
export function parseMcpFromStore(jsonPath: string): CommonMcpConfig | null {
  try {
    const content = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(content) as CommonMcpConfig;
  } catch {
    return null;
  }
}

// ============================================================================
// Provider Transformers
// ============================================================================

/**
 * Transform common config to Claude's mcpServers format.
 * Claude uses JSON: { "mcpServers": { "name": { command, args, env } } }
 */
export function transformToClaudeMcp(config: CommonMcpConfig): Record<string, unknown> {
  const entry: Record<string, unknown> = {};

  if (config.url) {
    // HTTP transport
    entry.type = 'http';
    entry.url = config.url;
    if (config.headers && Object.keys(config.headers).length > 0) entry.headers = config.headers;
  } else if (config.command) {
    // Stdio transport
    entry.command = config.command;
    if (config.args?.length) entry.args = config.args;
    if (config.env && Object.keys(config.env).length > 0) entry.env = config.env;
    if (config.timeout) entry.timeout = config.timeout;
  }

  return { [config.name]: entry };
}

/**
 * Transform common config to Gemini's mcpServers format.
 * Gemini also uses JSON, similar to Claude.
 */
export function transformToGeminiMcp(config: CommonMcpConfig): Record<string, unknown> {
  const entry: Record<string, unknown> = {};

  if (config.url) {
    // HTTP transport — Gemini uses httpUrl (NOT url; url means SSE in Gemini)
    entry.httpUrl = config.url;
    if (config.headers && Object.keys(config.headers).length > 0) entry.headers = config.headers;
  } else if (config.command) {
    // Stdio transport
    entry.command = config.command;
    if (config.args?.length) entry.args = config.args;
    if (config.env && Object.keys(config.env).length > 0) entry.env = config.env;
  }

  return { [config.name]: entry };
}

/**
 * Transform common config to Codex's TOML format.
 * Codex uses: [mcp_servers.name] with command, args, env keys.
 */
export function transformToCodexMcp(config: CommonMcpConfig): string {
  const lines: string[] = [];
  lines.push(`[mcp_servers.${config.name}]`);

  if (config.url) {
    // HTTP transport — Codex uses url + http_headers (not headers)
    lines.push(`url = "${config.url}"`);
    if (config.headers && Object.keys(config.headers).length > 0) {
      lines.push('');
      lines.push(`[mcp_servers.${config.name}.http_headers]`);
      for (const [key, value] of Object.entries(config.headers)) {
        lines.push(`${key} = "${value}"`);
      }
    }
  } else if (config.command) {
    // Stdio transport
    lines.push(`command = "${config.command}"`);
    if (config.args?.length) {
      const argsStr = config.args.map(a => `"${a}"`).join(', ');
      lines.push(`args = [${argsStr}]`);
    }
    if (config.env && Object.keys(config.env).length > 0) {
      lines.push('');
      lines.push(`[mcp_servers.${config.name}.env]`);
      for (const [key, value] of Object.entries(config.env)) {
        lines.push(`${key} = "${value}"`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================================
// MCP Activation/Deactivation
// ============================================================================

/**
 * Activate an MCP server in a project for a specific provider.
 * Reads the provider's config file, merges the MCP entry, writes back.
 */
export type ActivateResult = 'deployed' | 'already_exists';

export function activateMcp(
  projectPath: string,
  provider: ProviderId,
  config: CommonMcpConfig,
): ActivateResult {
  const configPath = getProviderMcpConfigPath(projectPath, provider);
  if (!configPath) {
    throw new Error(`Provider '${provider}' does not have an MCP config path`);
  }

  if (provider === 'codex') {
    return activateCodexMcp(configPath, config);
  } else {
    return activateJsonMcp(configPath, config, provider);
  }
}

/**
 * Deactivate an MCP server from a project for a specific provider.
 */
export function deactivateMcp(
  projectPath: string,
  provider: ProviderId,
  mcpName: string,
): void {
  const configPath = getProviderMcpConfigPath(projectPath, provider);
  if (!configPath) return;

  if (provider === 'codex') {
    deactivateCodexMcp(configPath, mcpName);
  } else {
    deactivateJsonMcp(configPath, mcpName);
  }
}

// ============================================================================
// JSON-based MCP (Claude, Gemini)
// ============================================================================

function activateJsonMcp(
  configPath: string,
  config: CommonMcpConfig,
  provider: ProviderId,
): ActivateResult {
  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(configPath)) {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch {
    existing = {};
  }

  const mcpServers = (existing.mcpServers || {}) as Record<string, unknown>;

  // Skip if an entry with this name already exists
  if (config.name in mcpServers) return 'already_exists';

  const transformed = provider === 'claude'
    ? transformToClaudeMcp(config)
    : transformToGeminiMcp(config);

  Object.assign(mcpServers, transformed);
  existing.mcpServers = mcpServers;

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
  return 'deployed';
}

function deactivateJsonMcp(configPath: string, mcpName: string): void {
  if (!fs.existsSync(configPath)) return;

  try {
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const mcpServers = existing.mcpServers as Record<string, unknown> | undefined;
    if (!mcpServers || !mcpServers[mcpName]) return;

    delete mcpServers[mcpName];
    existing.mcpServers = mcpServers;
    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');
  } catch {
    // Config file corrupt or unreadable
  }
}

// ============================================================================
// TOML-based MCP (Codex)
// ============================================================================

function activateCodexMcp(configPath: string, config: CommonMcpConfig): ActivateResult {
  let content = '';
  try {
    if (fs.existsSync(configPath)) {
      content = fs.readFileSync(configPath, 'utf-8');
    }
  } catch {
    content = '';
  }

  // Skip if this MCP section already exists
  const sectionHeader = `[mcp_servers.${config.name}]`;
  if (content.includes(sectionHeader)) return 'already_exists';

  // Append new section
  const tomlSection = transformToCodexMcp(config);
  content = content.trimEnd() + '\n\n' + tomlSection + '\n';

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, content);
  return 'deployed' as const;
}

function deactivateCodexMcp(configPath: string, mcpName: string): void {
  if (!fs.existsSync(configPath)) return;

  try {
    let content = fs.readFileSync(configPath, 'utf-8');
    content = removeTomlSection(content, `mcp_servers.${mcpName}`);
    fs.writeFileSync(configPath, content);
  } catch {
    // Config file corrupt or unreadable
  }
}

/**
 * Remove a TOML section and all its subsections.
 * Matches [sectionName] and any [sectionName.*] (e.g. .env, .http_headers).
 * Removes lines until the next unrelated [section] or EOF.
 */
function removeTomlSection(content: string, sectionName: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  const prefix = `[${sectionName}`;
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match [sectionName] or [sectionName.anything]
    if (trimmed.startsWith(prefix) && (trimmed === `${prefix}]` || trimmed.startsWith(`${prefix}.`))) {
      skipping = true;
      continue;
    }

    // Stop skipping when we hit a different section header
    if (skipping && trimmed.startsWith('[')) {
      skipping = false;
    }

    if (!skipping) {
      result.push(line);
    }
  }

  return result.join('\n');
}
