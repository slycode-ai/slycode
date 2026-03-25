/**
 * Store Scanner — scans flat store/ directory for canonical assets
 * No provider iteration — each skill exists once in store/skills/
 */

import fs from 'fs';
import path from 'path';
import { parseFrontmatter, validateFrontmatter } from './asset-scanner';
import { getSlycodeRoot } from './paths';
import type {
  AssetType,
  StoreAssetInfo,
  StoreData,
} from './types';

function getStorePath(): string {
  return path.join(getSlycodeRoot(), 'store');
}

// ============================================================================
// Store Directory Scanning
// ============================================================================

/**
 * Scan a flat asset directory in the store (store/skills/ or store/agents/).
 */
function scanStoreAssetDir(
  storePath: string,
  type: AssetType,
): StoreAssetInfo[] {
  const assets: StoreAssetInfo[] = [];
  const typeDir = type === 'skill' ? 'skills' : 'agents';
  const dirPath = path.join(storePath, typeDir);

  try {
    if (!fs.existsSync(dirPath)) return assets;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      let filePath: string;
      let relativePath: string;

      if (type === 'skill') {
        // Skills are directories containing SKILL.md
        if (!entry.isDirectory()) continue;
        filePath = path.join(dirPath, entry.name, 'SKILL.md');
        relativePath = path.join(typeDir, entry.name, 'SKILL.md');
        if (!fs.existsSync(filePath)) continue;
      } else {
        // Agents are flat .md files
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.md')) continue;
        filePath = path.join(dirPath, entry.name);
        relativePath = path.join(typeDir, entry.name);
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const frontmatter = parseFrontmatter(content);
      const name = (frontmatter?.name as string) || entry.name.replace(/\.md$/, '');

      assets.push({
        name,
        type,
        path: relativePath,
        frontmatter,
        isValid: validateFrontmatter(frontmatter),
      });
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }

  return assets.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Scan MCP configs from store/mcp/ directory.
 */
function scanStoreMcp(storePath: string): StoreAssetInfo[] {
  const mcpDir = path.join(storePath, 'mcp');
  const assets: StoreAssetInfo[] = [];

  try {
    if (!fs.existsSync(mcpDir)) return assets;

    const entries = fs.readdirSync(mcpDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      const filePath = path.join(mcpDir, entry.name);
      const content = fs.readFileSync(filePath, 'utf-8');
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        continue;
      }

      const name = parsed.name || entry.name.replace(/\.json$/, '');

      assets.push({
        name,
        type: 'mcp',
        path: path.join('mcp', entry.name),
        frontmatter: {
          name,
          version: parsed.version,
          description: parsed.description,
          updated: parsed.updated,
        },
        isValid: !!(parsed.name && (parsed.command || parsed.url)),
      });
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }

  return assets;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Full store scan — returns all assets in the store.
 * The manifest is only used by the build pipeline (build-package.ts) to control
 * what ships in the npm package. The store UI shows everything.
 */
export function scanStore(): StoreData {
  const storePath = getStorePath();
  const skills = scanStoreAssetDir(storePath, 'skill');
  const agents = scanStoreAssetDir(storePath, 'agent');
  const mcp = scanStoreMcp(storePath);
  return { skills, agents, mcp };
}

/**
 * Get flat list of all store assets (skills + agents).
 * Used as the master source for project matrix comparison.
 */
export function getStoreAssets(): StoreAssetInfo[] {
  const storePath = getStorePath();
  const skills = scanStoreAssetDir(storePath, 'skill');
  const agents = scanStoreAssetDir(storePath, 'agent');
  return [...skills, ...agents];
}
