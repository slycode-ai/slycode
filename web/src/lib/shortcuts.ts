/**
 * Quick-launch Shortcuts — shared loader, validator, resolver.
 *
 * Per-project file lives at `<projectPath>/documentation/shortcuts.json`
 * alongside `kanban.json`. Schema:
 *
 *   {
 *     "projectTag": "cm",
 *     "shortcuts": [
 *       { "label": "grog", "cardId": "...", "prompt": "...", "provider": "claude", "preferExistingSession": false }
 *     ]
 *   }
 *
 * Server-side only — uses Node fs.
 */

import { promises as fs, existsSync, readFileSync } from 'fs';
import path from 'path';
import type { Shortcut, ShortcutsFile, KanbanBoard, KanbanStage } from './types';
import { loadRegistry } from './registry';

const TAG_RE = /^[a-z0-9]{1,6}$/;
const LABEL_RE = /^[a-z0-9]{1,50}$/;
const STAGE_ORDER: KanbanStage[] = ['backlog', 'design', 'implementation', 'testing', 'done'];
const RESERVED_LABELS = new Set(['global']);

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export type ResolvedToken =
  | { kind: 'card'; projectId: string; cardId: string }
  | { kind: 'shortcut'; projectId: string; cardId: string; prompt?: string; provider?: string; preferExistingSession?: boolean }
  | { kind: 'project'; projectId: string }
  | { kind: 'global' }
  | { kind: 'miss'; reason: string };

export interface ProjectShortcuts {
  projectId: string;
  projectName: string;
  projectPath: string;
  file: ShortcutsFile;
}

function shortcutsPath(projectPath: string): string {
  return path.join(projectPath, 'documentation', 'shortcuts.json');
}

function emptyFile(): ShortcutsFile {
  return { projectTag: '', shortcuts: [] };
}

/**
 * Read a project's shortcuts file. Returns an empty (untagged) file if missing
 * or unreadable — callers can treat that as "no shortcuts configured yet".
 */
export async function loadShortcuts(projectPath: string): Promise<ShortcutsFile> {
  try {
    const content = await fs.readFile(shortcutsPath(projectPath), 'utf-8');
    const parsed = JSON.parse(content) as Partial<ShortcutsFile>;
    return {
      projectTag: typeof parsed.projectTag === 'string' ? parsed.projectTag : '',
      shortcuts: Array.isArray(parsed.shortcuts) ? parsed.shortcuts.filter(isValidShortcut) : [],
    };
  } catch {
    return emptyFile();
  }
}

/** Synchronous variant for use in Next.js route handlers that need it. */
export function loadShortcutsSync(projectPath: string): ShortcutsFile {
  try {
    const content = readFileSync(shortcutsPath(projectPath), 'utf-8');
    const parsed = JSON.parse(content) as Partial<ShortcutsFile>;
    return {
      projectTag: typeof parsed.projectTag === 'string' ? parsed.projectTag : '',
      shortcuts: Array.isArray(parsed.shortcuts) ? parsed.shortcuts.filter(isValidShortcut) : [],
    };
  } catch {
    return emptyFile();
  }
}

function isValidShortcut(raw: unknown): raw is Shortcut {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return typeof r.label === 'string' && typeof r.cardId === 'string';
}

/**
 * Atomic write — temp file + rename, mirroring registry.ts pattern.
 */
export async function saveShortcuts(projectPath: string, file: ShortcutsFile): Promise<void> {
  const target = shortcutsPath(projectPath);
  const docDir = path.dirname(target);
  await fs.mkdir(docDir, { recursive: true });
  const tmpPath = `${target}.tmp.${process.pid}.${Date.now()}`;
  const out = JSON.stringify(file, null, 2) + '\n';
  await fs.writeFile(tmpPath, out, 'utf-8');
  await fs.rename(tmpPath, target);
}

/**
 * Load every project's shortcuts file. Used for tag-uniqueness checks and the
 * workspace tag map exposed by /api/shortcuts.
 */
export async function loadAllShortcuts(): Promise<ProjectShortcuts[]> {
  const registry = await loadRegistry();
  const results: ProjectShortcuts[] = [];
  for (const project of registry.projects) {
    if (!existsSync(project.path)) continue;
    const file = await loadShortcuts(project.path);
    results.push({
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      file,
    });
  }
  return results;
}

/**
 * Validate a project tag. Returns { ok: false, error } on failure, otherwise ok.
 *
 * Pass `currentProjectId` so the project's own existing tag doesn't count as a
 * collision against itself.
 */
export function validateTag(
  tag: string,
  currentProjectId: string,
  allFiles: ProjectShortcuts[],
): ValidationResult {
  const normalized = tag.toLowerCase();
  if (!normalized) return { ok: false, error: 'Tag is required.' };
  if (!TAG_RE.test(normalized)) {
    return { ok: false, error: 'Tag must be 1–6 lowercase alphanumeric characters.' };
  }
  for (const entry of allFiles) {
    if (entry.projectId === currentProjectId) continue;
    if (entry.file.projectTag && entry.file.projectTag.toLowerCase() === normalized) {
      return { ok: false, error: `Tag "${normalized}" is already used by project "${entry.projectName}".` };
    }
  }
  return { ok: true };
}

/**
 * Validate a shortcut label. Pass the project's current shortcuts file so we
 * can check intra-project uniqueness. `excludeLabel` lets the modal edit a
 * shortcut without it counting as a self-collision.
 *
 * Labels that exactly match the project's own `projectTag` are rejected —
 * the bare-tag form is reserved for "open the project terminal" and a label
 * collision would make the meaning ambiguous.
 */
export function validateLabel(
  label: string,
  projectFile: ShortcutsFile,
  excludeLabel?: string,
): ValidationResult {
  const normalized = label.toLowerCase();
  if (!normalized) return { ok: false, error: 'Label is required.' };
  if (!LABEL_RE.test(normalized)) {
    return { ok: false, error: 'Label must be 1–50 lowercase alphanumeric characters.' };
  }
  if (RESERVED_LABELS.has(normalized)) {
    return { ok: false, error: `"${normalized}" is reserved.` };
  }
  if (/^[0-9]+$/.test(normalized)) {
    return { ok: false, error: 'Label must contain at least one letter (all-digit labels collide with card-number references).' };
  }
  if (projectFile.projectTag && projectFile.projectTag.toLowerCase() === normalized) {
    return { ok: false, error: `Label can't equal the project tag "${normalized}" — the bare tag is reserved for the project terminal.` };
  }
  for (const s of projectFile.shortcuts) {
    if (s.label.toLowerCase() === normalized && (!excludeLabel || s.label.toLowerCase() !== excludeLabel.toLowerCase())) {
      return { ok: false, error: `Label "${normalized}" already exists in this project.` };
    }
  }
  return { ok: true };
}

function loadKanbanSync(projectPath: string): KanbanBoard | null {
  try {
    const content = readFileSync(path.join(projectPath, 'documentation', 'kanban.json'), 'utf-8');
    return JSON.parse(content) as KanbanBoard;
  } catch {
    return null;
  }
}

function findCardById(board: KanbanBoard | null, cardId: string): { stage: KanbanStage; archived: boolean } | null {
  if (!board?.stages) return null;
  for (const stage of STAGE_ORDER) {
    const card = (board.stages[stage] || []).find((c) => c.id === cardId);
    if (card) return { stage, archived: !!card.archived };
  }
  return null;
}

function findCardByNumber(board: KanbanBoard | null, num: number): { id: string; archived: boolean } | null {
  if (!board?.stages) return null;
  for (const stage of STAGE_ORDER) {
    for (const card of board.stages[stage] || []) {
      if (card.number === num) return { id: card.id, archived: !!card.archived };
    }
  }
  return null;
}

/**
 * Resolve a token to a target.
 *
 * Token forms (Telegram):
 *   <tag>-<digits>   → card by number in the project owning that tag
 *   <tag>-<label>    → saved shortcut in that project
 *   global           → reserved global terminal
 *
 * Token forms (web, scoped to a project): the `<tag>-` prefix is omitted —
 * `<digits>` or `<label>` resolve against `scopedProjectId` directly.
 *
 * @param token raw token string
 * @param scopedProjectId set when resolving against a known project (web URL); null when resolving from Telegram (resolver derives the project from the tag)
 * @param allShortcuts result of loadAllShortcuts()
 */
export function resolveToken(
  token: string,
  scopedProjectId: string | null,
  allShortcuts: ProjectShortcuts[],
): ResolvedToken {
  const trimmed = token.trim().toLowerCase();
  if (!trimmed) return { kind: 'miss', reason: 'Empty token.' };

  if (trimmed === 'global') return { kind: 'global' };

  // Web (scoped) form: token is just the digits or label, no tag prefix.
  // Also: if the token equals THIS project's own tag, route to its terminal —
  // gives a one-shot URL like /project/<id>/<tag> that opens the project
  // terminal instead of just the kanban page.
  if (scopedProjectId) {
    const project = allShortcuts.find((p) => p.projectId === scopedProjectId);
    if (!project) return { kind: 'miss', reason: `Project "${scopedProjectId}" not found.` };
    if (project.file.projectTag && project.file.projectTag.toLowerCase() === trimmed) {
      return { kind: 'project', projectId: project.projectId };
    }
    return resolveAgainstProject(trimmed, project);
  }

  // Telegram (unscoped) form. Two shapes:
  //   <tag>          → project terminal for that project
  //   <tag>-<rest>   → card-number / saved-shortcut inside that project
  const dashIdx = trimmed.indexOf('-');

  // Bare-tag form: no separator. Resolves to the project terminal.
  if (dashIdx === -1) {
    const project = allShortcuts.find((p) => p.file.projectTag.toLowerCase() === trimmed);
    if (!project) {
      return { kind: 'miss', reason: `No project found for tag "${trimmed}".` };
    }
    return { kind: 'project', projectId: project.projectId };
  }

  if (dashIdx === 0) {
    return { kind: 'miss', reason: `Token "${token}" can't start with a separator.` };
  }
  const tag = trimmed.slice(0, dashIdx);
  const rest = trimmed.slice(dashIdx + 1);
  if (!rest) return { kind: 'miss', reason: `Token "${token}" missing value after tag.` };

  const project = allShortcuts.find((p) => p.file.projectTag.toLowerCase() === tag);
  if (!project) return { kind: 'miss', reason: `No project found for tag "${tag}".` };

  return resolveAgainstProject(rest, project);
}

function resolveAgainstProject(rest: string, project: ProjectShortcuts): ResolvedToken {
  // All-digit → card number lookup
  if (/^[0-9]+$/.test(rest)) {
    const board = loadKanbanSync(project.projectPath);
    const hit = findCardByNumber(board, parseInt(rest, 10));
    if (!hit || hit.archived) {
      return { kind: 'miss', reason: `No card found with number ${rest} in project "${project.projectName}".` };
    }
    return { kind: 'card', projectId: project.projectId, cardId: hit.id };
  }

  // Otherwise treat as a saved shortcut label
  const shortcut = project.file.shortcuts.find((s) => s.label.toLowerCase() === rest.toLowerCase());
  if (!shortcut) {
    return { kind: 'miss', reason: `No shortcut "${rest}" in project "${project.projectName}".` };
  }
  // Ensure target card still exists and isn't archived
  const board = loadKanbanSync(project.projectPath);
  const card = findCardById(board, shortcut.cardId);
  if (!card || card.archived) {
    return { kind: 'miss', reason: `Shortcut "${rest}" points to a missing or archived card.` };
  }
  return {
    kind: 'shortcut',
    projectId: project.projectId,
    cardId: shortcut.cardId,
    prompt: shortcut.prompt,
    provider: shortcut.provider,
    preferExistingSession: shortcut.preferExistingSession,
  };
}

// Re-export for convenience
export type { Shortcut, ShortcutsFile };
