/**
 * Asset Scanner — scans .claude/ directories for commands, skills, and agents
 * Parses YAML frontmatter, compares versions across projects, builds CLI assets matrix
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  AssetType,
  AssetFrontmatter,
  AssetInfo,
  ProjectAssets,
  AssetCell,
  AssetRow,
  CliAssetsData,
  PlatformDetection,
  Project,
  ProviderId,
  UpdateEntry,
  IgnoredUpdates,
} from './types';

import { getSlycodeRoot } from './paths';
import { getProviderAssetDir, getProviderAssetFilePath } from './provider-paths';

// SlyCode root path — derived, not hardcoded
const MASTER_PATH = getSlycodeRoot();
const MASTER_PROJECT_ID = path.basename(MASTER_PATH);

// ============================================================================
// Frontmatter Parsing
// ============================================================================

/**
 * Extract YAML frontmatter from a markdown file's content.
 * Expects --- delimited block at the start of the file.
 */
export function parseFrontmatter(content: string): AssetFrontmatter | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result: AssetFrontmatter = {};

  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && value) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Check if frontmatter has the minimum required field for version comparison.
 * Only `version` is truly required — name is derived from filename, and
 * updated/description are nice-to-have metadata.
 */
export function validateFrontmatter(fm: AssetFrontmatter | null): boolean {
  if (!fm) return false;
  return !!fm.version;
}

/**
 * Get list of missing recommended frontmatter fields.
 * Returns empty array if all recommended fields are present.
 */
export function getMissingFrontmatterFields(fm: AssetFrontmatter | null): string[] {
  const missing: string[] = [];
  if (!fm) return ['version', 'updated', 'description'];
  if (!fm.version) missing.push('version');
  if (!fm.updated) missing.push('updated');
  if (!fm.description) missing.push('description');
  return missing;
}

// ============================================================================
// Directory Scanning
// ============================================================================

/**
 * Scan a single asset directory and return AssetInfo entries.
 *
 * Skills:  .claude/skills/<name>/SKILL.md (directories)
 * Agents:  .claude/agents/*.md (flat files)
 */
function scanAssetDir(basePath: string, type: AssetType): AssetInfo[] {
  const assets: AssetInfo[] = [];

  try {
    const dirPath = type === 'skill'
      ? path.join(basePath, '.claude', 'skills')
      : path.join(basePath, '.claude', 'agents');

    if (!fs.existsSync(dirPath)) return assets;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      let filePath: string;
      let relativePath: string;

      if (type === 'skill') {
        // Skills are directories containing SKILL.md
        if (!entry.isDirectory()) continue;
        filePath = path.join(dirPath, entry.name, 'SKILL.md');
        relativePath = path.join('skills', entry.name, 'SKILL.md');
        if (!fs.existsSync(filePath)) continue;
      } else {
        // Agents are flat .md files
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        filePath = path.join(dirPath, entry.name);
        relativePath = path.join('agents', entry.name);
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const frontmatter = parseFrontmatter(content);
      const name = frontmatter?.name as string || entry.name.replace(/\.md$/, '');

      assets.push({
        name,
        type,
        path: relativePath,
        frontmatter,
        isValid: validateFrontmatter(frontmatter),
      });
    }
  } catch {
    // Directory doesn't exist or isn't readable — return empty
  }

  return assets;
}

/**
 * Scan all asset types for a project at the given path.
 */
export function scanProjectAssets(projectPath: string, projectId: string): ProjectAssets {
  return {
    projectId,
    skills: scanAssetDir(projectPath, 'skill'),
    agents: scanAssetDir(projectPath, 'agent'),
  };
}

/**
 * Scan the workspace's own assets.
 */
export function scanMasterAssets(): ProjectAssets {
  return scanProjectAssets(MASTER_PATH, MASTER_PROJECT_ID);
}

// ============================================================================
// Version Comparison & Matrix Building
// ============================================================================

/**
 * Compare two semver-like version strings.
 * Returns true if they are the same version.
 */
function versionsMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.trim() === b.trim();
}

/**
 * Find an asset by name in an asset list.
 */
function findAsset(assets: AssetInfo[], name: string): AssetInfo | undefined {
  return assets.find(a => a.name === name);
}

/**
 * Build the full cross-project matrix for a single asset type.
 */
function buildMatrixForType(
  masterAssets: AssetInfo[],
  projectAssetsMap: Map<string, AssetInfo[]>,
  projects: Project[],
  type: AssetType,
): AssetRow[] {
  const rows: AssetRow[] = [];

  for (const masterAsset of masterAssets) {
    const cells: AssetCell[] = projects.map(project => {
      const projectAssets = projectAssetsMap.get(project.id);
      if (!projectAssets) {
        return { projectId: project.id, status: 'missing' as const };
      }

      const projectAsset = findAsset(projectAssets, masterAsset.name);
      if (!projectAsset) {
        return { projectId: project.id, status: 'missing' as const };
      }

      const masterVersion = masterAsset.frontmatter?.version as string | undefined;
      const projectVersion = projectAsset.frontmatter?.version as string | undefined;

      // Compare versions if both sides have one
      if (masterVersion && projectVersion) {
        return {
          projectId: project.id,
          status: versionsMatch(masterVersion, projectVersion) ? 'current' : 'outdated',
          masterVersion,
          projectVersion,
        };
      }

      // No version on one or both sides — can't compare, treat as outdated
      return {
        projectId: project.id,
        status: 'outdated' as const,
        masterVersion,
        projectVersion,
      };
    });

    rows.push({
      name: masterAsset.name,
      type,
      masterAsset,
      cells,
      isImported: true,
    });
  }

  return rows;
}

/**
 * Find assets that exist in projects but not in the workspace.
 */
function findNonImported(
  masterAssets: AssetInfo[],
  projectAssetsMap: Map<string, AssetInfo[]>,
  projects: Project[],
  type: AssetType,
): AssetRow[] {
  const masterNames = new Set(masterAssets.map(a => a.name));
  const nonImportedMap = new Map<string, { asset: AssetInfo; projectIds: Set<string> }>();

  for (const [projectId, assets] of projectAssetsMap) {
    for (const asset of assets) {
      if (masterNames.has(asset.name)) continue;

      if (!nonImportedMap.has(asset.name)) {
        nonImportedMap.set(asset.name, { asset, projectIds: new Set() });
      }
      nonImportedMap.get(asset.name)!.projectIds.add(projectId);
    }
  }

  const rows: AssetRow[] = [];
  for (const [name, { asset, projectIds }] of nonImportedMap) {
    const cells: AssetCell[] = projects.map(project => ({
      projectId: project.id,
      status: projectIds.has(project.id) ? 'current' as const : 'missing' as const,
      projectVersion: projectIds.has(project.id)
        ? (asset.frontmatter?.version as string | undefined)
        : undefined,
    }));

    rows.push({
      name,
      type,
      masterAsset: { ...asset, isValid: false }, // not in master, so not valid for comparison
      cells,
      isImported: false,
    });
  }

  return rows;
}

/**
 * Build the complete CLI assets matrix comparing master assets against all projects.
 */
export function buildAssetMatrix(
  masterAssets: ProjectAssets,
  allProjectAssets: Map<string, ProjectAssets>,
  projects: Project[],
): CliAssetsData {
  // Exclude the workspace itself from project columns
  const externalProjects = projects.filter(p => p.id !== MASTER_PROJECT_ID);

  // Build per-type maps
  const skillsMap = new Map<string, AssetInfo[]>();
  const agentsMap = new Map<string, AssetInfo[]>();

  for (const [projectId, assets] of allProjectAssets) {
    if (projectId === MASTER_PROJECT_ID) continue;
    skillsMap.set(projectId, assets.skills);
    agentsMap.set(projectId, assets.agents);
  }

  const skills = buildMatrixForType(masterAssets.skills, skillsMap, externalProjects, 'skill');
  const agents = buildMatrixForType(masterAssets.agents, agentsMap, externalProjects, 'agent');

  const nonImported = [
    ...findNonImported(masterAssets.skills, skillsMap, externalProjects, 'skill'),
    ...findNonImported(masterAssets.agents, agentsMap, externalProjects, 'agent'),
  ];

  return { skills, agents, nonImported };
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Detect which AI platforms a project supports by checking for config files and directories.
 */
export function detectPlatforms(projectPath: string): PlatformDetection {
  const exists = (p: string) => {
    try { return fs.existsSync(path.join(projectPath, p)); } catch { return false; }
  };

  return {
    claude: exists('CLAUDE.md') || exists('.claude'),
    gemini: exists('GEMINI.md') || exists('.gemini'),
    codex: exists('AGENTS.md') || exists('.codex') || exists('.agents'),
  };
}

// ============================================================================
// Asset File Operations (for sync/import)
// ============================================================================

/**
 * Get the full filesystem path for an asset in a project.
 */
export function getAssetPath(projectPath: string, assetType: AssetType, assetName: string): string {
  switch (assetType) {
    case 'skill':
      return path.join(projectPath, '.claude', 'skills', assetName);
    case 'agent':
      return path.join(projectPath, '.claude', 'agents', `${assetName}.md`);
    case 'mcp':
      return path.join(projectPath, '.mcp.json');
    default:
      return path.join(projectPath, '.claude', 'skills', assetName);
  }
}

/**
 * Copy an asset from source to destination project.
 * For skills (directories), copies the entire directory unless skillMainOnly is true,
 * in which case only the main SKILL.md file is copied (preserving project-specific references/).
 * For commands/agents (files), copies the single file.
 */
export function copyAsset(
  srcProjectPath: string,
  dstProjectPath: string,
  assetType: AssetType,
  assetName: string,
  options?: { skillMainOnly?: boolean },
): void {
  const srcPath = getAssetPath(srcProjectPath, assetType, assetName);
  const dstPath = getAssetPath(dstProjectPath, assetType, assetName);

  // Ensure destination directory exists
  const dstDir = assetType === 'skill' ? dstPath : path.dirname(dstPath);
  fs.mkdirSync(dstDir, { recursive: true });

  if (assetType === 'skill') {
    if (options?.skillMainOnly) {
      // Only copy the main SKILL.md file, preserving project-specific content
      const srcSkillMd = path.join(srcPath, 'SKILL.md');
      const dstSkillMd = path.join(dstPath, 'SKILL.md');
      if (fs.existsSync(srcSkillMd)) {
        fs.copyFileSync(srcSkillMd, dstSkillMd);
      }
    } else {
      // Copy entire skill directory
      copyDirRecursive(srcPath, dstPath);
    }
  } else {
    // Copy single file
    fs.copyFileSync(srcPath, dstPath);
  }
}

/**
 * Remove an asset from a project.
 */
export function removeAsset(
  projectPath: string,
  assetType: AssetType,
  assetName: string,
): void {
  const assetPath = getAssetPath(projectPath, assetType, assetName);

  if (assetType === 'skill') {
    fs.rmSync(assetPath, { recursive: true, force: true });
  } else {
    if (fs.existsSync(assetPath)) {
      fs.unlinkSync(assetPath);
    }
  }
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcEntry = path.join(src, entry.name);
    const dstEntry = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcEntry, dstEntry);
    } else {
      fs.copyFileSync(srcEntry, dstEntry);
    }
  }
}

/**
 * Count total outdated assets across all projects in a CliAssetsData result.
 */
export function countOutdatedAssets(cliAssets: CliAssetsData): number {
  let count = 0;
  const allRows = [...cliAssets.skills, ...cliAssets.agents];
  for (const row of allRows) {
    for (const cell of row.cells) {
      if (cell.status === 'outdated') count++;
    }
  }
  return count;
}

// ============================================================================
// Store-as-Master Matrix Building
// ============================================================================

/**
 * Build a cross-project matrix using store assets as master (not SlyCode .claude/).
 * This supports provider sub-tabs: for a given provider, store/{provider}/* is the
 * master source, and each project is scanned using provider-specific paths.
 */
export function buildStoreAssetMatrix(
  storeAssets: AssetInfo[],
  providerProjectAssets: Map<string, AssetInfo[]>,
  projects: Project[],
  type: AssetType,
): AssetRow[] {
  const rows: AssetRow[] = [];

  for (const masterAsset of storeAssets) {
    const cells: AssetCell[] = projects.map(project => {
      const projectAssets = providerProjectAssets.get(project.id);
      if (!projectAssets) {
        return { projectId: project.id, status: 'missing' as const };
      }

      const projectAsset = findAsset(projectAssets, masterAsset.name);
      if (!projectAsset) {
        return { projectId: project.id, status: 'missing' as const };
      }

      const masterVersion = masterAsset.frontmatter?.version as string | undefined;
      const projectVersion = projectAsset.frontmatter?.version as string | undefined;

      if (masterVersion && projectVersion) {
        return {
          projectId: project.id,
          status: versionsMatch(masterVersion, projectVersion) ? 'current' : 'outdated',
          masterVersion,
          projectVersion,
        };
      }

      return {
        projectId: project.id,
        status: 'outdated' as const,
        masterVersion,
        projectVersion,
      };
    });

    rows.push({
      name: masterAsset.name,
      type,
      masterAsset,
      cells,
      isImported: true,
    });
  }

  return rows;
}

/**
 * Find assets in projects that don't exist in the store (for a specific provider).
 */
export function findNonImportedForProvider(
  storeAssets: AssetInfo[],
  providerProjectAssets: Map<string, AssetInfo[]>,
  projects: Project[],
  type: AssetType,
): AssetRow[] {
  const storeNames = new Set(storeAssets.map(a => a.name));
  const nonImportedMap = new Map<string, { asset: AssetInfo; projectIds: Set<string> }>();

  for (const [projectId, assets] of providerProjectAssets) {
    for (const asset of assets) {
      if (storeNames.has(asset.name)) continue;

      if (!nonImportedMap.has(asset.name)) {
        nonImportedMap.set(asset.name, { asset, projectIds: new Set() });
      }
      nonImportedMap.get(asset.name)!.projectIds.add(projectId);
    }
  }

  const rows: AssetRow[] = [];
  for (const [name, { asset, projectIds }] of nonImportedMap) {
    const cells: AssetCell[] = projects.map(project => ({
      projectId: project.id,
      status: projectIds.has(project.id) ? 'current' as const : 'missing' as const,
      projectVersion: projectIds.has(project.id)
        ? (asset.frontmatter?.version as string | undefined)
        : undefined,
    }));

    rows.push({
      name,
      type,
      masterAsset: { ...asset, isValid: false },
      cells,
      isImported: false,
    });
  }

  return rows;
}

// ============================================================================
// Provider-Aware Asset Operations (for store)
// ============================================================================

/**
 * Scan assets for a specific provider in a project directory.
 * Uses provider-specific paths (e.g. .gemini/commands/ for Gemini).
 */
export function scanProviderAssets(
  projectPath: string,
  provider: ProviderId,
): AssetInfo[] {
  const assets: AssetInfo[] = [];
  const types: AssetType[] = ['skill', 'agent'];

  for (const type of types) {
    const dir = getProviderAssetDir(projectPath, provider, type);
    if (!dir || !fs.existsSync(dir)) continue;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        let filePath: string;
        let relativePath: string;
        const typeDir = type === 'skill' ? 'skills' : 'agents';

        if (type === 'skill') {
          if (!entry.isDirectory()) continue;
          filePath = path.join(dir, entry.name, 'SKILL.md');
          relativePath = path.join(typeDir, entry.name, 'SKILL.md');
          if (!fs.existsSync(filePath)) continue;
        } else {
          if (!entry.isFile()) continue;
          if (!entry.name.endsWith('.md')) continue;
          filePath = path.join(dir, entry.name);
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
      // Not readable
    }
  }

  return assets;
}

/**
 * Copy an asset from the flat canonical store to a project using provider-specific paths.
 * Store source: store/skills/<name>/ or store/agents/<name>.md
 * Project dest: .<provider>/skills/<name>/ (determined by provider param)
 */
export function copyStoreAssetToProject(
  projectPath: string,
  provider: ProviderId,
  assetType: AssetType,
  assetName: string,
  options?: { skillMainOnly?: boolean },
): void {
  const dstPath = getProviderAssetFilePath(projectPath, provider, assetType, assetName);
  if (!dstPath) {
    throw new Error(`Provider '${provider}' does not support asset type '${assetType}'`);
  }

  const typeDir = assetType === 'skill' ? 'skills' : 'agents';
  const root = getSlycodeRoot();

  if (assetType === 'skill') {
    const storeSkillDir = path.join(root, 'store', 'skills', assetName);
    if (options?.skillMainOnly) {
      fs.mkdirSync(dstPath, { recursive: true });
      const srcSkillMd = path.join(storeSkillDir, 'SKILL.md');
      const dstSkillMd = path.join(dstPath, 'SKILL.md');
      if (fs.existsSync(srcSkillMd)) {
        fs.copyFileSync(srcSkillMd, dstSkillMd);
      }
    } else {
      copyDirRecursive(storeSkillDir, dstPath);
    }
  } else {
    const storeFile = path.join(root, 'store', typeDir, `${assetName}.md`);
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.copyFileSync(storeFile, dstPath);
  }
}

/**
 * Import an asset from a project into the flat canonical store.
 * Store dest: store/skills/<name>/ or store/agents/<name>.md
 *
 * For skills (directories), defaults to copying only SKILL.md (skillMainOnly: true)
 * since project skills may have additional files (references/, area data) that are
 * project-specific and shouldn't overwrite the store's canonical copies.
 */
export function importAssetToStore(
  projectPath: string,
  provider: ProviderId,
  assetType: AssetType,
  assetName: string,
  options?: { skillMainOnly?: boolean },
): void {
  const srcFilePath = getProviderAssetFilePath(projectPath, provider, assetType, assetName);
  if (!srcFilePath) {
    throw new Error(`Provider '${provider}' does not support asset type '${assetType}'`);
  }

  const typeDir = assetType === 'skill' ? 'skills' : 'agents';
  const storePath = path.join(getSlycodeRoot(), 'store', typeDir);

  if (assetType === 'skill') {
    const dstDir = path.join(storePath, assetName);
    const mainOnly = options?.skillMainOnly ?? true;
    if (mainOnly) {
      fs.mkdirSync(dstDir, { recursive: true });
      const srcSkillMd = path.join(srcFilePath, 'SKILL.md');
      const dstSkillMd = path.join(dstDir, 'SKILL.md');
      if (fs.existsSync(srcSkillMd)) {
        fs.copyFileSync(srcSkillMd, dstSkillMd);
      } else {
        throw new Error(`SKILL.md not found in ${srcFilePath}`);
      }
    } else {
      copyDirRecursive(srcFilePath, dstDir);
    }
  } else {
    fs.mkdirSync(storePath, { recursive: true });
    const fileName = path.basename(srcFilePath);
    fs.copyFileSync(srcFilePath, path.join(storePath, fileName));
  }
}

// ============================================================================
// Update Delivery — updates/ vs store/ comparison and accept flow
// ============================================================================

const IGNORED_UPDATES_PATH = path.join(getSlycodeRoot(), 'store', '.ignored-updates.json');

/**
 * Scan the flat updates/skills/ folder and return AssetInfo entries.
 */
export function scanUpdatesFolder(): AssetInfo[] {
  const assets: AssetInfo[] = [];
  const updatesDir = path.join(getSlycodeRoot(), 'updates', 'skills');

  if (!fs.existsSync(updatesDir)) return assets;

  try {
    const entries = fs.readdirSync(updatesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(updatesDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) continue;

      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const frontmatter = parseFrontmatter(content);
      const name = (frontmatter?.name as string) || entry.name;

      assets.push({
        name,
        type: 'skill',
        path: path.join('skills', entry.name, 'SKILL.md'),
        frontmatter,
        isValid: validateFrontmatter(frontmatter),
      });
    }
  } catch {
    // Not readable
  }

  return assets;
}

/**
 * List all files in an updates skill directory (relative to the skill root).
 */
function listUpdateFiles(skillName: string): string[] {
  const skillDir = path.join(getSlycodeRoot(), 'updates', 'skills', skillName);
  const files: string[] = [];

  function walk(dir: string, prefix: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relPath);
      } else {
        files.push(relPath);
      }
    }
  }

  walk(skillDir, '');
  return files;
}

/**
 * Hash file content for comparison. Uses SHA-256 truncated to 12 hex chars.
 */
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * Build the updates matrix comparing flat updates/skills/ against flat store/skills/.
 * Uses content hashing — if upstream SKILL.md differs from store SKILL.md, it's an update.
 * Versions are preserved for display but not used for comparison.
 */
export function buildUpdatesMatrix(
  updatesAssets: AssetInfo[],
  storeAssets: AssetInfo[],
  ignoredUpdates: IgnoredUpdates,
): UpdateEntry[] {
  const root = getSlycodeRoot();
  const entries: UpdateEntry[] = [];
  let needsSaveIgnored = false;

  for (const updateAsset of updatesAssets) {
    const availableVersion = updateAsset.frontmatter?.version as string | undefined;

    // Read upstream SKILL.md and hash it
    const upstreamSkillPath = path.join(root, 'updates', 'skills', updateAsset.name, 'SKILL.md');
    let upstreamContent: string;
    try {
      upstreamContent = fs.readFileSync(upstreamSkillPath, 'utf-8');
    } catch {
      continue;
    }
    const upstreamHash = hashContent(upstreamContent);

    const storeAsset = findAsset(storeAssets, updateAsset.name);
    const ignoreKey = `skills/${updateAsset.name}`;

    // Skip if this hash has been dismissed or accepted
    if (ignoredUpdates[ignoreKey] === upstreamHash) continue;

    if (storeAsset) {
      // Read store SKILL.md and hash it
      const storeSkillPath = path.join(root, 'store', 'skills', updateAsset.name, 'SKILL.md');
      let storeContent: string;
      try {
        storeContent = fs.readFileSync(storeSkillPath, 'utf-8');
      } catch {
        storeContent = '';
      }
      const storeHash = hashContent(storeContent);

      // Same content — no update needed. Lazy-init: record hash so future user
      // edits to store/ don't trigger false updates from unchanged upstream.
      if (upstreamHash === storeHash) {
        if (!ignoredUpdates[ignoreKey]) {
          ignoredUpdates[ignoreKey] = upstreamHash;
          needsSaveIgnored = true;
        }
        continue;
      }

      const currentVersion = storeAsset.frontmatter?.version as string | undefined;
      const filesAffected = listUpdateFiles(updateAsset.name);

      entries.push({
        name: updateAsset.name,
        assetType: 'skill',
        status: 'update',
        currentVersion,
        availableVersion: availableVersion || '0.0.0',
        contentHash: upstreamHash,
        description: updateAsset.frontmatter?.description as string | undefined,
        updatesPath: `skills/${updateAsset.name}`,
        storePath: `skills/${updateAsset.name}`,
        filesAffected,
        skillMdOnly: filesAffected.length === 1 && filesAffected[0] === 'SKILL.md',
      });
    } else {
      const filesAffected = listUpdateFiles(updateAsset.name);

      entries.push({
        name: updateAsset.name,
        assetType: 'skill',
        status: 'new',
        availableVersion: availableVersion || '0.0.0',
        contentHash: upstreamHash,
        description: updateAsset.frontmatter?.description as string | undefined,
        updatesPath: `skills/${updateAsset.name}`,
        storePath: `skills/${updateAsset.name}`,
        filesAffected,
        skillMdOnly: filesAffected.length === 1 && filesAffected[0] === 'SKILL.md',
      });
    }
  }

  // Persist any newly recorded hashes from lazy initialization
  if (needsSaveIgnored) {
    saveIgnoredUpdates(ignoredUpdates);
  }

  return entries;
}

/**
 * Read the ignored updates file. Returns empty object if file doesn't exist or is corrupted.
 */
export function getIgnoredUpdates(): IgnoredUpdates {
  try {
    if (!fs.existsSync(IGNORED_UPDATES_PATH)) return {};
    const content = fs.readFileSync(IGNORED_UPDATES_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save the ignored updates file.
 */
export function saveIgnoredUpdates(ignored: IgnoredUpdates): void {
  fs.writeFileSync(IGNORED_UPDATES_PATH, JSON.stringify(ignored, null, 2) + '\n');
}

/**
 * Accept an update: back up existing store skill (simple overwrite), then full-replace from updates/.
 * Flat paths: store/skills/<name>, updates/skills/<name>
 * Returns the backup path if a backup was created.
 */
export function acceptUpdate(
  assetType: AssetType,
  assetName: string,
): string | null {
  const root = getSlycodeRoot();
  const typeDir = assetType === 'skill' ? 'skills' : 'agents';
  const storePath = path.join(root, 'store', typeDir, assetName);
  const updatesPath = path.join(root, 'updates', typeDir, assetName);

  if (!fs.existsSync(updatesPath)) {
    throw new Error(`Update not found: ${typeDir}/${assetName}`);
  }

  let backupPath: string | null = null;

  // Back up existing store skill — simple overwrite by skill name
  if (fs.existsSync(storePath)) {
    const backupDir = path.join(root, 'store', '.backups');
    backupPath = path.join(backupDir, assetName);

    // Overwrite any existing backup for this skill
    if (fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }

    fs.mkdirSync(backupPath, { recursive: true });
    copyDirRecursive(storePath, backupPath);

    // Remove existing store skill
    fs.rmSync(storePath, { recursive: true, force: true });
  }

  // Copy from updates/ → store/ (full replace)
  fs.mkdirSync(storePath, { recursive: true });
  copyDirRecursive(updatesPath, storePath);

  // Record upstream content hash as accepted — prevents resurface if store
  // content diverges slightly from upstream. Clears automatically when upstream changes.
  const ignored = getIgnoredUpdates();
  const ignoreKey = `${typeDir}/${assetName}`;
  const upstreamSkillMdPath = path.join(root, 'updates', typeDir, assetName, 'SKILL.md');
  if (fs.existsSync(upstreamSkillMdPath)) {
    const upstreamContent = fs.readFileSync(upstreamSkillMdPath, 'utf-8');
    ignored[ignoreKey] = hashContent(upstreamContent);
  } else {
    // Fallback: remove ignore entry if upstream SKILL.md doesn't exist
    delete ignored[ignoreKey];
  }
  saveIgnoredUpdates(ignored);

  return backupPath;
}
