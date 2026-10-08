/**
 * Den folders (card #0381, feature 089 Phase B) — pure registry operations.
 *
 * `registry.folders[]` holds {id, name, order}; a project points at one with
 * `folderId` (absent = no folder; a dangling id also reads as no folder).
 * Ids are slugs (`fld-work`, `fld-work-2`) fixed at creation, so a rename
 * keeps every project's assignment. Names are unique (case-insensitive) and
 * at most FOLDER_NAME_MAX characters. Deleting a folder unfiles its projects —
 * nothing is ever deleted with it.
 *
 * Mirrored (create-by-name, rename, delete, assign) in scripts/kanban.js
 * `projects folder` / `projects folders` — keep the rules in lockstep.
 */

import type { ProjectFolder, Registry } from './types';

export const FOLDER_NAME_MAX = 40;

export class FolderError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

export function normalizeFolderName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

export function sortedFolders(folders: readonly ProjectFolder[] | undefined): ProjectFolder[] {
  return [...(folders ?? [])].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function findFolderByName(folders: readonly ProjectFolder[] | undefined, name: string): ProjectFolder | undefined {
  const want = normalizeFolderName(name).toLowerCase();
  return (folders ?? []).find(f => f.name.toLowerCase() === want);
}

/** The folder a project is in, or null (absent or dangling folderId). */
export function folderOf(project: { folderId?: string }, folders: readonly ProjectFolder[] | undefined): ProjectFolder | null {
  if (!project.folderId) return null;
  return (folders ?? []).find(f => f.id === project.folderId) ?? null;
}

function validateName(name: string, folders: readonly ProjectFolder[], excludeId?: string): void {
  if (!name) throw new FolderError('Folder name is required');
  if (name.length > FOLDER_NAME_MAX) throw new FolderError(`Folder name must be ${FOLDER_NAME_MAX} characters or fewer`);
  const clash = folders.find(f => f.id !== excludeId && f.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new FolderError(`A folder called "${clash.name}" already exists`, 409);
}

export function folderIdFor(name: string, existing: readonly ProjectFolder[]): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'folder';
  const taken = new Set(existing.map(f => f.id));
  let id = `fld-${slug}`;
  for (let n = 2; taken.has(id); n++) id = `fld-${slug}-${n}`;
  return id;
}

/** Create a folder at the end of the folder order. Mutates the registry. */
export function createFolder(registry: Registry, rawName: unknown): ProjectFolder {
  const folders = registry.folders ?? (registry.folders = []);
  const name = normalizeFolderName(rawName);
  validateName(name, folders);
  const order = folders.reduce((m, f) => Math.max(m, f.order + 1), 0);
  const folder: ProjectFolder = { id: folderIdFor(name, folders), name, order };
  folders.push(folder);
  return folder;
}

export function renameFolder(registry: Registry, id: string, rawName: unknown): ProjectFolder {
  const folders = registry.folders ?? [];
  const folder = folders.find(f => f.id === id);
  if (!folder) throw new FolderError(`No folder with id "${id}"`, 404);
  const name = normalizeFolderName(rawName);
  validateName(name, folders, id);
  folder.name = name;
  return folder;
}

/** Delete a folder; its projects become unfiled. Returns how many were unfiled. */
export function deleteFolder(registry: Registry, id: string): number {
  const folders = registry.folders ?? [];
  const idx = folders.findIndex(f => f.id === id);
  if (idx === -1) throw new FolderError(`No folder with id "${id}"`, 404);
  folders.splice(idx, 1);
  let unfiled = 0;
  for (const p of registry.projects) {
    if (p.folderId === id) {
      delete p.folderId;
      unfiled++;
    }
  }
  return unfiled;
}

/** Reorder folders: listed ids first in that order, any others after (stable). */
export function reorderFolders(registry: Registry, ids: readonly string[]): void {
  const folders = sortedFolders(registry.folders);
  const rank = new Map(ids.map((id, i) => [id, i]));
  const listed = folders.filter(f => rank.has(f.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const rest = folders.filter(f => !rank.has(f.id));
  [...listed, ...rest].forEach((f, i) => { f.order = i; });
  registry.folders = [...listed, ...rest];
}

/** Put a project in a folder (null = no folder). */
export function moveProjectToFolder(registry: Registry, projectId: string, folderId: string | null): void {
  const project = registry.projects.find(p => p.id === projectId);
  if (!project) throw new FolderError(`Project '${projectId}' not found`, 404);
  if (folderId === null) {
    delete project.folderId;
    return;
  }
  if (!(registry.folders ?? []).some(f => f.id === folderId)) throw new FolderError(`No folder with id "${folderId}"`, 404);
  project.folderId = folderId;
}

/**
 * Folder order after dropping `dragged` before or after `target` (header
 * drag, Codex P2: an after-target is needed to move a folder to the end).
 * Unknown ids leave the order unchanged.
 */
export function folderOrderAfterDrop(
  ids: readonly string[],
  dragged: string,
  target: string,
  position: 'before' | 'after',
): string[] {
  if (dragged === target || !ids.includes(dragged) || !ids.includes(target)) return [...ids];
  const rest = ids.filter(id => id !== dragged);
  const at = rest.indexOf(target) + (position === 'after' ? 1 : 0);
  rest.splice(at, 0, dragged);
  return rest;
}
