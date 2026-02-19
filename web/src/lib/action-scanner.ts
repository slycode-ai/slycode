/**
 * Action Scanner — reads individual .md action files from store/actions/,
 * parses YAML frontmatter, assembles SlyActionsConfig with in-memory caching.
 *
 * Each action is a .md file with YAML frontmatter (name, version, label, etc.)
 * and the prompt text as the markdown body.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSlycodeRoot } from './paths';
import { getIgnoredUpdates, saveIgnoredUpdates } from './asset-scanner';
import type { SlyActionsConfig } from './sly-actions';
import type { Placement } from './types';

// ============================================================================
// Types
// ============================================================================

export interface ParsedAction {
  name: string;
  version: string;
  label: string;
  description: string;
  group: string;
  placement: Placement;
  scope: 'global' | 'specific';
  projects: string[];
  cardTypes?: string[];
  classes: Record<string, number>;
  prompt: string;
}

export interface ActionUpdateEntry {
  name: string;
  assetType: 'action';
  status: 'new' | 'update';
  currentVersion?: string;
  upstreamVersion: string;
  contentHash: string;
  description?: string;
  changedFields?: string[];
  newClasses?: string[];
}

// ============================================================================
// Frontmatter Parsing
// ============================================================================

/**
 * Parse YAML frontmatter from an action .md file.
 * Returns the frontmatter fields and the body (prompt text) separately.
 */
export function parseActionFile(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)/);
  if (!match) return null;

  const yamlStr = match[1];
  const body = (match[2] || '').trim();
  const frontmatter: Record<string, unknown> = {};

  let currentKey: string | null = null;
  let currentMap: Record<string, number> | null = null;
  let currentArray: string[] | null = null;

  for (const line of yamlStr.split('\n')) {
    // Indented line — part of a map or array
    if (line.startsWith('  ')) {
      const trimmed = line.trim();
      if (currentArray !== null && trimmed.startsWith('- ')) {
        let value = trimmed.slice(2).trim();
        value = stripQuotes(value);
        currentArray.push(value);
        continue;
      }
      if (currentMap !== null) {
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx !== -1) {
          const key = trimmed.slice(0, colonIdx).trim();
          const val = trimmed.slice(colonIdx + 1).trim();
          currentMap[key] = Number(val);
          continue;
        }
      }
      continue;
    }

    // Flush previous collection
    if (currentKey && currentMap) {
      frontmatter[currentKey] = currentMap;
      currentMap = null;
      currentKey = null;
    }
    if (currentKey && currentArray) {
      frontmatter[currentKey] = currentArray;
      currentArray = null;
      currentKey = null;
    }

    // Top-level key: value
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (!rawValue) {
      // Value on next lines (map or array)
      currentKey = key;
      // Peek ahead to determine type — but we can't easily here,
      // so we'll determine on the first indented line
      // For now, check if key is known to be a map or array
      if (key === 'classes') {
        currentMap = {};
      } else {
        currentArray = [];
      }
      continue;
    }

    frontmatter[key] = stripQuotes(rawValue);
  }

  // Flush final collection
  if (currentKey && currentMap) frontmatter[currentKey] = currentMap;
  if (currentKey && currentArray) frontmatter[currentKey] = currentArray;

  return { frontmatter, body };
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Convert parsed frontmatter + body to a ParsedAction.
 */
export function toParsedAction(frontmatter: Record<string, unknown>, body: string): ParsedAction {
  return {
    name: String(frontmatter.name || ''),
    version: String(frontmatter.version || '1.0.0'),
    label: String(frontmatter.label || ''),
    description: String(frontmatter.description || ''),
    group: String(frontmatter.group || ''),
    placement: (frontmatter.placement as Placement) || 'both',
    scope: (frontmatter.scope as 'global' | 'specific') || 'global',
    projects: Array.isArray(frontmatter.projects) ? frontmatter.projects.map(String) : [],
    cardTypes: Array.isArray(frontmatter.cardTypes) ? frontmatter.cardTypes.map(String) : undefined,
    classes: (typeof frontmatter.classes === 'object' && frontmatter.classes !== null && !Array.isArray(frontmatter.classes))
      ? frontmatter.classes as Record<string, number>
      : {},
    prompt: body,
  };
}

// ============================================================================
// Directory Scanning
// ============================================================================

/**
 * Scan a directory for action .md files and return parsed actions.
 */
export function scanActionFiles(actionsDir: string): ParsedAction[] {
  const actions: ParsedAction[] = [];

  if (!fs.existsSync(actionsDir)) return actions;

  try {
    const entries = fs.readdirSync(actionsDir);
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const filePath = path.join(actionsDir, entry);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseActionFile(content);
        if (!parsed) continue;
        const action = toParsedAction(parsed.frontmatter, parsed.body);
        if (!action.name) {
          // Fallback: derive name from filename
          action.name = entry.replace(/\.md$/, '');
        }
        actions.push(action);
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory not readable
  }

  return actions;
}

/**
 * Assemble classAssignments from per-action classes maps.
 * Groups by class, sorts by priority (ascending), ties broken alphabetically.
 */
export function assembleClassAssignments(actions: ParsedAction[]): Record<string, string[]> {
  const classMap: Record<string, { name: string; priority: number }[]> = {};

  for (const action of actions) {
    for (const [cls, priority] of Object.entries(action.classes)) {
      if (!classMap[cls]) classMap[cls] = [];
      classMap[cls].push({ name: action.name, priority });
    }
  }

  const result: Record<string, string[]> = {};
  for (const [cls, entries] of Object.entries(classMap)) {
    entries.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.name.localeCompare(b.name);
    });
    result[cls] = entries.map(e => e.name);
  }

  return result;
}

/**
 * Build a SlyActionsConfig from parsed actions.
 */
export function buildActionsConfig(actions: ParsedAction[]): SlyActionsConfig {
  const commands: Record<string, SlyActionsConfig['commands'][string]> = {};

  for (const action of actions) {
    commands[action.name] = {
      id: action.name,
      label: action.label,
      description: action.description,
      group: action.group || undefined,
      cardTypes: action.cardTypes,
      placement: action.placement,
      prompt: action.prompt,
      scope: action.scope,
      projects: action.projects,
    };
  }

  return {
    version: '4.0',
    commands,
    classAssignments: assembleClassAssignments(actions),
  };
}

// ============================================================================
// Cache
// ============================================================================

const CACHE_MAX_AGE_MS = 30_000; // 30 seconds

let cachedConfig: SlyActionsConfig | null = null;
let cacheTimestamp = 0;

function getActionsDir(): string {
  return path.join(getSlycodeRoot(), 'store', 'actions');
}

function isCacheStale(): boolean {
  return Date.now() - cacheTimestamp > CACHE_MAX_AGE_MS;
}

/**
 * Get the assembled actions config, using cache when valid.
 */
export function getActionsConfig(): SlyActionsConfig {
  if (cachedConfig && !isCacheStale()) return cachedConfig;

  const actions = scanActionFiles(getActionsDir());
  cachedConfig = buildActionsConfig(actions);
  cacheTimestamp = Date.now();
  return cachedConfig;
}

/**
 * Invalidate the actions cache (call after writes).
 */
export function invalidateActionsCache(): void {
  cachedConfig = null;
  cacheTimestamp = 0;
}

// ============================================================================
// Write Support
// ============================================================================

/**
 * Serialize a ParsedAction back to a .md file string.
 */
export function serializeActionFile(action: ParsedAction): string {
  const lines: string[] = ['---'];
  lines.push(`name: ${action.name}`);
  lines.push(`version: ${action.version}`);
  lines.push(`label: "${action.label}"`);
  lines.push(`description: "${action.description.replace(/"/g, '\\"')}"`);
  if (action.group) lines.push(`group: "${action.group}"`);
  lines.push(`placement: ${action.placement}`);
  lines.push(`scope: ${action.scope}`);

  if (action.projects.length > 0) {
    lines.push('projects:');
    for (const p of action.projects) lines.push(`  - "${p}"`);
  }

  if (action.cardTypes && action.cardTypes.length > 0) {
    lines.push('cardTypes:');
    for (const ct of action.cardTypes) lines.push(`  - "${ct}"`);
  }

  if (Object.keys(action.classes).length > 0) {
    lines.push('classes:');
    const sorted = Object.entries(action.classes).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [cls, priority] of sorted) {
      lines.push(`  ${cls}: ${priority}`);
    }
  }

  lines.push('---');
  return `${lines.join('\n')}\n\n${action.prompt}\n`;
}

/**
 * Write a single action file atomically (temp + rename).
 */
export function writeActionFile(action: ParsedAction, dir?: string): void {
  const actionsDir = dir || getActionsDir();
  fs.mkdirSync(actionsDir, { recursive: true });

  const content = serializeActionFile(action);
  const targetPath = path.join(actionsDir, `${action.name}.md`);
  const tmpPath = path.join(actionsDir, `.${action.name}.md.tmp`);

  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, targetPath);
}

/**
 * Write all actions from a SlyActionsConfig to individual files.
 * Used when saving from SlyActionConfigModal.
 */
export function writeActionsFromConfig(
  config: SlyActionsConfig,
  dir?: string,
): void {
  const actionsDir = dir || getActionsDir();

  // Build reverse class map: actionName → { className: priority }
  // We need to reconstruct the classes from classAssignments + ordering
  const classesMap: Record<string, Record<string, number>> = {};
  for (const [cls, ids] of Object.entries(config.classAssignments)) {
    for (let i = 0; i < ids.length; i++) {
      const name = ids[i];
      if (!classesMap[name]) classesMap[name] = {};
      classesMap[name][cls] = (i + 1) * 10;
    }
  }

  // Read existing files to preserve versions and any fields we don't model
  const existingActions = scanActionFiles(actionsDir);
  const existingVersions: Record<string, string> = {};
  for (const a of existingActions) {
    existingVersions[a.name] = a.version;
  }

  for (const [name, cmd] of Object.entries(config.commands)) {
    const action: ParsedAction = {
      name,
      version: existingVersions[name] || '1.0.0',
      label: cmd.label,
      description: cmd.description,
      group: cmd.group || '',
      placement: cmd.placement,
      scope: cmd.scope,
      projects: cmd.projects,
      cardTypes: cmd.cardTypes,
      classes: classesMap[name] || {},
      prompt: cmd.prompt,
    };
    writeActionFile(action, actionsDir);
  }

  // Remove action files that no longer exist in config
  try {
    const existing = fs.readdirSync(actionsDir).filter(f => f.endsWith('.md'));
    const configNames = new Set(Object.keys(config.commands));
    for (const file of existing) {
      const name = file.replace(/\.md$/, '');
      if (!configNames.has(name)) {
        fs.unlinkSync(path.join(actionsDir, file));
      }
    }
  } catch {
    // Best effort cleanup
  }

  invalidateActionsCache();
}

// ============================================================================
// Update Scanning
// ============================================================================

/**
 * Hash file content for comparison. Uses SHA-256 truncated to 12 hex chars.
 */
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * Scan updates/actions/ for available action updates.
 * Uses content hashing — if upstream file differs from store file, it's an update.
 * Versions are preserved for display but not used for comparison.
 */
export function scanActionUpdates(ignoredUpdates: Record<string, string>): ActionUpdateEntry[] {
  const root = getSlycodeRoot();
  const updatesDir = path.join(root, 'updates', 'actions');
  const storeDir = path.join(root, 'store', 'actions');

  if (!fs.existsSync(updatesDir)) return [];

  const entries: ActionUpdateEntry[] = [];
  let needsSaveIgnored = false;

  let upstreamFiles: string[];
  try {
    upstreamFiles = fs.readdirSync(updatesDir).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }

  for (const file of upstreamFiles) {
    try {
      const upstreamPath = path.join(updatesDir, file);
      const upstreamContent = fs.readFileSync(upstreamPath, 'utf-8');
      const upstreamHash = hashContent(upstreamContent);

      const upstreamParsed = parseActionFile(upstreamContent);
      if (!upstreamParsed) continue;
      const upstream = toParsedAction(upstreamParsed.frontmatter, upstreamParsed.body);
      if (!upstream.name) upstream.name = file.replace(/\.md$/, '');

      const ignoreKey = `actions/${upstream.name}`;
      if (ignoredUpdates[ignoreKey] === upstreamHash) continue;

      const storePath = path.join(storeDir, file);

      if (fs.existsSync(storePath)) {
        const storeContent = fs.readFileSync(storePath, 'utf-8');
        const storeHash = hashContent(storeContent);

        // Same content — no update needed. Record hash so future user
        // edits to store/ don't trigger false updates from unchanged upstream.
        if (upstreamHash === storeHash) {
          if (!ignoredUpdates[ignoreKey]) {
            ignoredUpdates[ignoreKey] = upstreamHash;
            needsSaveIgnored = true;
          }
          continue;
        }

        // Content differs — determine which fields changed
        const storeParsed = parseActionFile(storeContent);
        const current = storeParsed ? toParsedAction(storeParsed.frontmatter, storeParsed.body) : null;

        const changedFields: string[] = [];
        if (current) {
          if (upstream.prompt !== current.prompt) changedFields.push('prompt');
          if (upstream.label !== current.label) changedFields.push('label');
          if (upstream.description !== current.description) changedFields.push('description');
          if (upstream.placement !== current.placement) changedFields.push('placement');
          if (upstream.group !== current.group) changedFields.push('group');
        }

        const newClasses = current
          ? Object.keys(upstream.classes).filter(c => !(c in current.classes))
          : Object.keys(upstream.classes);

        entries.push({
          name: upstream.name,
          assetType: 'action',
          status: 'update',
          currentVersion: current?.version,
          upstreamVersion: upstream.version,
          contentHash: upstreamHash,
          description: upstream.description,
          changedFields,
          newClasses: newClasses.length > 0 ? newClasses : undefined,
        });
      } else {
        // New action
        entries.push({
          name: upstream.name,
          assetType: 'action',
          status: 'new',
          upstreamVersion: upstream.version,
          contentHash: upstreamHash,
          description: upstream.description,
          newClasses: Object.keys(upstream.classes),
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Persist any newly recorded hashes from lazy initialization
  if (needsSaveIgnored) {
    saveIgnoredUpdates(ignoredUpdates);
  }

  return entries;
}

/**
 * Accept an action update with additive class merge.
 * Records the upstream content hash as accepted so the update doesn't resurface
 * (the class merge means store/ content will differ from updates/ content).
 * Returns backup path if a backup was created.
 */
export function acceptActionUpdate(actionName: string): string | null {
  const root = getSlycodeRoot();
  const updatesPath = path.join(root, 'updates', 'actions', `${actionName}.md`);
  const storePath = path.join(root, 'store', 'actions', `${actionName}.md`);

  if (!fs.existsSync(updatesPath)) {
    throw new Error(`Action update not found: ${actionName}`);
  }

  const upstreamContent = fs.readFileSync(updatesPath, 'utf-8');
  const upstreamHash = hashContent(upstreamContent);
  const upstreamParsed = parseActionFile(upstreamContent);
  if (!upstreamParsed) throw new Error(`Failed to parse upstream action: ${actionName}`);
  const upstream = toParsedAction(upstreamParsed.frontmatter, upstreamParsed.body);

  let backupPath: string | null = null;

  if (fs.existsSync(storePath)) {
    // Backup existing
    const backupDir = path.join(root, 'store', '.backups', 'actions');
    fs.mkdirSync(backupDir, { recursive: true });
    backupPath = path.join(backupDir, `${actionName}.md`);
    fs.copyFileSync(storePath, backupPath);

    // Read current for class merge
    const currentContent = fs.readFileSync(storePath, 'utf-8');
    const currentParsed = parseActionFile(currentContent);
    if (currentParsed) {
      const current = toParsedAction(currentParsed.frontmatter, currentParsed.body);

      // Additive class merge: keep user's classes and priorities, add new upstream classes
      const mergedClasses = { ...current.classes };
      for (const [cls, priority] of Object.entries(upstream.classes)) {
        if (!(cls in mergedClasses)) {
          mergedClasses[cls] = priority;
        }
      }
      upstream.classes = mergedClasses;
    }
  }

  // Write atomically
  const storeDir = path.join(root, 'store', 'actions');
  fs.mkdirSync(storeDir, { recursive: true });
  writeActionFile(upstream, storeDir);

  // Record upstream hash as accepted — prevents resurface after class merge
  // changes the store content. Clears automatically when upstream changes.
  const ignored = getIgnoredUpdates();
  ignored[`actions/${actionName}`] = upstreamHash;
  saveIgnoredUpdates(ignored);

  invalidateActionsCache();
  return backupPath;
}

