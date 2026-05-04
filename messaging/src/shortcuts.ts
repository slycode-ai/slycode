/**
 * Quick-launch Shortcuts — read-only resolver for messaging.
 *
 * Mirrors web/src/lib/shortcuts.ts. Messaging only reads; the web API is the
 * single source of truth for writes and tag-uniqueness validation.
 */

import fs from 'fs';
import path from 'path';
import type { Shortcut, ShortcutsFile, KanbanBoard, Project } from './types.js';

const STAGE_ORDER: Array<keyof KanbanBoard['stages']> = ['backlog', 'design', 'implementation', 'testing', 'done'];

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

export function loadShortcuts(projectPath: string): ShortcutsFile {
  try {
    const content = fs.readFileSync(shortcutsPath(projectPath), 'utf-8');
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

/** Build the workspace-wide shortcut snapshot from a project list. */
export function loadAllShortcuts(projects: Project[]): ProjectShortcuts[] {
  const out: ProjectShortcuts[] = [];
  for (const p of projects) {
    if (!p.path || !fs.existsSync(p.path)) continue;
    out.push({
      projectId: p.id,
      projectName: p.name,
      projectPath: p.path,
      file: loadShortcuts(p.path),
    });
  }
  return out;
}

function loadKanban(projectPath: string): KanbanBoard | null {
  try {
    const content = fs.readFileSync(path.join(projectPath, 'documentation', 'kanban.json'), 'utf-8');
    return JSON.parse(content) as KanbanBoard;
  } catch {
    return null;
  }
}

function findCardById(board: KanbanBoard | null, cardId: string): { archived: boolean } | null {
  if (!board?.stages) return null;
  for (const stage of STAGE_ORDER) {
    const card = (board.stages[stage] || []).find((c) => c.id === cardId);
    if (card) return { archived: !!card.archived };
  }
  return null;
}

function findCardByNumber(board: KanbanBoard | null, num: number): { id: string; archived: boolean } | null {
  if (!board?.stages) return null;
  for (const stage of STAGE_ORDER) {
    for (const card of board.stages[stage] || []) {
      if ((card as { number?: number }).number === num) {
        return { id: card.id, archived: !!card.archived };
      }
    }
  }
  return null;
}

/**
 * Resolve a token to a target.
 *
 * Telegram form (unscoped): `<tag>-<digits|label>` or `global`.
 */
export function resolveToken(token: string, allShortcuts: ProjectShortcuts[]): ResolvedToken {
  const trimmed = token.trim().toLowerCase();
  if (!trimmed) return { kind: 'miss', reason: 'Empty token.' };
  if (trimmed === 'global') return { kind: 'global' };

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

  // All-digit → card-number
  if (/^[0-9]+$/.test(rest)) {
    const board = loadKanban(project.projectPath);
    const hit = findCardByNumber(board, parseInt(rest, 10));
    if (!hit || hit.archived) {
      return { kind: 'miss', reason: `No card found with number ${rest} in project "${project.projectName}".` };
    }
    return { kind: 'card', projectId: project.projectId, cardId: hit.id };
  }

  // Otherwise saved label
  const shortcut = project.file.shortcuts.find((s) => s.label.toLowerCase() === rest);
  if (!shortcut) {
    return { kind: 'miss', reason: `No shortcut "${rest}" in project "${project.projectName}".` };
  }
  const board = loadKanban(project.projectPath);
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
