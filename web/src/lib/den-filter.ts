/**
 * Den status filter + tile ordering (card #0381, feature 089) — pure, client-safe.
 *
 * The filter is NOT remembered: the Den always opens on Active. The current
 * selection lives in the URL (`/?show=active,paused`) so back navigation and
 * bookmarks keep it; the default selection serialises to no param at all.
 */

import type { ProjectFolder, ProjectStatus } from './types';
import { PROJECT_STATUSES, isProjectStatus, projectStatus } from './project-status';
import { folderOf, sortedFolders } from './project-folders';

export const DEFAULT_SHOWN: readonly ProjectStatus[] = ['active'];

/** `?show=` → selection. Unknown tokens are dropped; nothing valid → default. */
export function parseShowParam(raw: string | null | undefined): Set<ProjectStatus> {
  const picked = (raw ?? '').split(',').map(s => s.trim()).filter(isProjectStatus);
  return new Set(picked.length > 0 ? picked : DEFAULT_SHOWN);
}

/** Selection → `?show=` value, or null when it is the default (drop the param). */
export function serializeShow(shown: ReadonlySet<ProjectStatus>): string | null {
  const ordered = PROJECT_STATUSES.filter(s => shown.has(s));
  if (ordered.length === DEFAULT_SHOWN.length && DEFAULT_SHOWN.every(s => shown.has(s))) return null;
  return ordered.join(',');
}

/** Toggle one chip. The last chip can't be switched off — an empty Den helps no one. */
export function toggleShown(shown: ReadonlySet<ProjectStatus>, status: ProjectStatus): Set<ProjectStatus> {
  const next = new Set(shown);
  if (next.has(status)) {
    if (next.size > 1) next.delete(status);
  } else {
    next.add(status);
  }
  return next;
}

export function statusCounts(projects: { status?: unknown }[]): Record<ProjectStatus, number> {
  const counts: Record<ProjectStatus, number> = { active: 0, paused: 0, complete: 0, archived: 0 };
  for (const p of projects) counts[projectStatus(p)]++;
  return counts;
}

const TILE_RANK: Record<ProjectStatus, number> = { active: 0, paused: 1, complete: 2, archived: 3 };

/**
 * What the Den renders for a selection: tiles (active first, then paused,
 * then complete; registry order within each) and archived cold rows.
 * Input order is the registry order and is preserved within a status.
 */
export function denView<T extends { status?: unknown }>(
  projects: readonly T[],
  shown: ReadonlySet<ProjectStatus>,
): { tiles: T[]; cold: T[] } {
  const visible = projects
    .map((p, i) => ({ p, i, s: projectStatus(p) }))
    .filter(x => shown.has(x.s));
  const tiles = visible
    .filter(x => x.s !== 'archived')
    .sort((a, b) => TILE_RANK[a.s] - TILE_RANK[b.s] || a.i - b.i)
    .map(x => x.p);
  const cold = visible.filter(x => x.s === 'archived').map(x => x.p);
  return { tiles, cold };
}

/** Drag-reorder is only meaningful when the Den shows exactly the default (Active) set. */
export function canReorder(shown: ReadonlySet<ProjectStatus>): boolean {
  return serializeShow(shown) === null;
}

// ---------------------------------------------------------------------------
// Folder sections (Phase B)
// ---------------------------------------------------------------------------

export interface DenSection<T> {
  /** null = the "No folder" section (or the single header-less section when there are no folders). */
  folder: ProjectFolder | null;
  /** Visible tiles under the current filter (active first). */
  tiles: T[];
  /** Visible archived cold rows. */
  cold: T[];
  /** Every project in the section, filter ignored — for collapsed-header counts. */
  members: T[];
}

/**
 * Group the Den into folder sections, in folder order, then "No folder".
 * - No folders defined → one header-less section (the Den looks as before).
 * - A folder whose projects are all filtered out is hidden; a folder with no
 *   projects at all is kept (so a new folder is visible and can be filled).
 * - A dangling folderId reads as no folder.
 */
export function groupDen<T extends { status?: unknown; folderId?: string }>(
  projects: readonly T[],
  folders: readonly ProjectFolder[] | undefined,
  shown: ReadonlySet<ProjectStatus>,
): { grouped: boolean; sections: DenSection<T>[] } {
  const list = sortedFolders(folders);
  if (list.length === 0) {
    const v = denView(projects, shown);
    return { grouped: false, sections: [{ folder: null, tiles: v.tiles, cold: v.cold, members: [...projects] }] };
  }
  const byFolder = new Map<string, T[]>(list.map(f => [f.id, []]));
  const unfiled: T[] = [];
  for (const p of projects) {
    const f = folderOf(p, list);
    if (f) byFolder.get(f.id)!.push(p);
    else unfiled.push(p);
  }
  const sections: DenSection<T>[] = [];
  for (const folder of list) {
    const members = byFolder.get(folder.id)!;
    const v = denView(members, shown);
    if (members.length === 0 || v.tiles.length + v.cold.length > 0) {
      sections.push({ folder, tiles: v.tiles, cold: v.cold, members });
    }
  }
  const v = denView(unfiled, shown);
  if (v.tiles.length + v.cold.length > 0) sections.push({ folder: null, tiles: v.tiles, cold: v.cold, members: unfiled });
  return { grouped: true, sections };
}

/** Number-key shortcut order: visible tiles top to bottom, skipping collapsed folders. */
export function shortcutOrder<T>(sections: readonly DenSection<T>[], collapsed: ReadonlySet<string>): T[] {
  return sections.flatMap(s => (s.folder && collapsed.has(s.folder.id) ? [] : s.tiles));
}

/**
 * The full registry order after dropping `draggedId` at `index` within the
 * target section's visible tiles. Other projects keep their relative order;
 * the dragged project lands just before the tile it was dropped on (or after
 * the section's last visible tile).
 */
export function reorderAfterDrop<T extends { id: string }>(
  allInOrder: readonly T[],
  sectionTiles: readonly T[],
  draggedId: string,
  index: number,
): string[] {
  const ids = allInOrder.map(p => p.id).filter(id => id !== draggedId);
  const targets = sectionTiles.map(p => p.id).filter(id => id !== draggedId);
  // Translate the drop index (counted with the dragged tile still present when
  // it is in this section) into "insert before targets[k]".
  const fromIdx = sectionTiles.findIndex(p => p.id === draggedId);
  const k = fromIdx !== -1 && index > fromIdx ? index - 1 : index;
  if (k < targets.length) {
    ids.splice(ids.indexOf(targets[k]), 0, draggedId);
  } else if (targets.length > 0) {
    ids.splice(ids.indexOf(targets[targets.length - 1]) + 1, 0, draggedId);
  } else {
    ids.push(draggedId);
  }
  return ids;
}

/** Hero "N agents working" — Active projects only (#0381, Codex P2). */
export function workingInActive(projects: readonly { status?: unknown; activeSessions?: number }[]): number {
  return projects.reduce((n, p) => n + (projectStatus(p) === 'active' ? (p.activeSessions ?? 0) : 0), 0);
}
