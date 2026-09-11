/**
 * Board settings (feature #0350): the small, project-owned policy block at the
 * root of documentation/kanban.json — today just `allowCrossProjectPrompts`.
 *
 * Reads and writes go through here so every writer preserves the rest of the
 * board root (stages, nextCardNumber, project_id) and only the whitelisted keys
 * can change. The CLI reads the same key (scripts/kanban.js
 * allowsCrossProjectPrompts) — keep the shape in lockstep.
 */
import { promises as fs } from 'fs';
import type { KanbanBoard, KanbanBoardSettings } from './types';
import { atomicWriteFile } from './atomic-write';

export const SETTING_KEYS = ['allowCrossProjectPrompts'] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Normalize whatever is on disk into a fully-populated settings object. */
export function readBoardSettings(board: Partial<KanbanBoard> | null | undefined): Required<KanbanBoardSettings> {
  const raw = board?.settings;
  return {
    allowCrossProjectPrompts: raw?.allowCrossProjectPrompts === true,
  };
}

/**
 * Validate a settings patch from a client. Returns the cleaned patch or an
 * error message. Unknown keys and non-boolean values are refused, not dropped —
 * a typo in the UI should fail loudly.
 */
export function validateSettingsPatch(input: unknown): { patch: Partial<KanbanBoardSettings> } | { error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { error: 'Payload must be an object of settings' };
  }
  const patch: Partial<KanbanBoardSettings> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) {
      return { error: `Unknown setting "${key}" (writable: ${SETTING_KEYS.join(', ')})` };
    }
    if (typeof value !== 'boolean') {
      return { error: `Setting "${key}" must be a boolean` };
    }
    patch[key as SettingKey] = value;
  }
  if (Object.keys(patch).length === 0) return { error: 'No settings provided' };
  return { patch };
}

/**
 * Apply a validated patch to a board object. Pure: returns a new board with
 * every other root key untouched. `false` values are stored explicitly so an
 * owner who switched a setting off after on can see that in the file.
 */
export function applySettingsPatch<T extends Partial<KanbanBoard>>(board: T, patch: Partial<KanbanBoardSettings>): T {
  return {
    ...board,
    settings: { ...(board.settings ?? {}), ...patch },
    last_updated: new Date().toISOString(),
  };
}

/**
 * Read-modify-write the board file under the caller's lock. Returns the
 * resulting settings. Throws if the board file is missing or malformed —
 * settings are never written to a board that doesn't exist yet.
 */
export async function writeBoardSettings(kanbanPath: string, patch: Partial<KanbanBoardSettings>): Promise<Required<KanbanBoardSettings>> {
  const board = JSON.parse(await fs.readFile(kanbanPath, 'utf-8')) as KanbanBoard;
  const next = applySettingsPatch(board, patch);
  await atomicWriteFile(kanbanPath, JSON.stringify(next, null, 2));
  return readBoardSettings(next);
}
