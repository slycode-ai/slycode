/**
 * Den folders (card #0381 Phase B): registry ops, grouping, collapse prefs.
 *
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/project-folders.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFolder, renameFolder, deleteFolder, reorderFolders, moveProjectToFolder,
  folderIdFor, folderOf, FolderError, FOLDER_NAME_MAX, folderOrderAfterDrop,
} from './project-folders';
import { groupDen, shortcutOrder, reorderAfterDrop, workingInActive } from './den-filter';
import { readCollapsedFolders, writeCollapsedFolders, COLLAPSED_KEY, type StorageLike } from './den-collapse-prefs';
import type { Registry } from './types';

function reg(): Registry {
  return {
    version: '2.1.0', lastUpdated: '',
    projects: ['a', 'b', 'c'].map((id, i) => ({
      id, name: id.toUpperCase(), description: '', path: `/p/${id}`, hasClaudeMd: false,
      masterCompliant: false, areas: [], tags: [], order: i,
    })),
  };
}

test('createFolder: slug ids with collision suffix, trimmed names, appended order', () => {
  const r = reg();
  const work = createFolder(r, '  Work   stuff ');
  assert.deepEqual(work, { id: 'fld-work-stuff', name: 'Work stuff', order: 0 });
  const w2 = createFolder(r, 'Work-Stuff!');
  assert.equal(w2.id, 'fld-work-stuff-2');
  assert.equal(w2.order, 1);
  assert.equal(folderIdFor('???', []), 'fld-folder');
});

test('createFolder/renameFolder: validation', () => {
  const r = reg();
  createFolder(r, 'Work');
  assert.throws(() => createFolder(r, 'work'), (e: FolderError) => e.status === 409);
  assert.throws(() => createFolder(r, '   '), /required/);
  assert.throws(() => createFolder(r, 'x'.repeat(FOLDER_NAME_MAX + 1)), /characters or fewer/);
  const p = createFolder(r, 'Personal');
  assert.throws(() => renameFolder(r, p.id, 'WORK'), (e: FolderError) => e.status === 409);
  renameFolder(r, p.id, 'personal'); // case change of itself is fine
  assert.equal(r.folders!.find(f => f.id === p.id)!.name, 'personal');
  assert.equal(p.id, 'fld-personal', 'rename keeps the id');
  assert.throws(() => renameFolder(r, 'fld-nope', 'x'), (e: FolderError) => e.status === 404);
});

test('move, delete unfiles (nothing deleted), dangling id reads as no folder', () => {
  const r = reg();
  const w = createFolder(r, 'Work');
  moveProjectToFolder(r, 'a', w.id);
  moveProjectToFolder(r, 'b', w.id);
  assert.equal(folderOf(r.projects[0], r.folders), r.folders![0]);
  assert.throws(() => moveProjectToFolder(r, 'a', 'fld-ghost'), /No folder/);
  assert.throws(() => moveProjectToFolder(r, 'zzz', w.id), /not found/);
  moveProjectToFolder(r, 'b', null);
  assert.equal(r.projects[1].folderId, undefined);
  assert.equal(deleteFolder(r, w.id), 1);
  assert.equal(r.projects.length, 3, 'projects survive');
  assert.equal(r.projects[0].folderId, undefined);
  assert.equal(folderOf({ folderId: 'fld-gone' }, r.folders), null);
});

test('reorderFolders: listed first, rest keep order, order renumbered', () => {
  const r = reg();
  const [a, b, c] = ['A', 'B', 'C'].map(n => createFolder(r, n));
  reorderFolders(r, [c.id, a.id]);
  assert.deepEqual(r.folders!.map(f => [f.name, f.order]), [['C', 0], ['A', 1], ['B', 2]]);
  void b;
});

test('groupDen: no folders → one header-less section (Den unchanged)', () => {
  const ps = [{ id: 'a' }, { id: 'b', status: 'paused' }];
  const g = groupDen(ps, [], new Set(['active'] as const));
  assert.equal(g.grouped, false);
  assert.equal(g.sections.length, 1);
  assert.equal(g.sections[0].folder, null);
  assert.deepEqual(g.sections[0].tiles.map(p => p.id), ['a']);
});

test('groupDen: folder order, No folder last, filtered-out folders hidden, empty folders kept', () => {
  const folders = [
    { id: 'fld-p', name: 'Personal', order: 1 },
    { id: 'fld-w', name: 'Work', order: 0 },
    { id: 'fld-e', name: 'Empty', order: 2 },
    { id: 'fld-h', name: 'Held only', order: 3 },
  ];
  const ps = [
    { id: 'p1', folderId: 'fld-p' }, { id: 'w1', folderId: 'fld-w' }, { id: 'w2', folderId: 'fld-w', status: 'paused' },
    { id: 'h1', folderId: 'fld-h', status: 'complete' }, { id: 'u1' }, { id: 'd1', folderId: 'fld-dangling' },
  ];
  const g = groupDen(ps, folders, new Set(['active'] as const));
  assert.equal(g.grouped, true);
  assert.deepEqual(g.sections.map(s => s.folder?.name ?? 'No folder'), ['Work', 'Personal', 'Empty', 'No folder']);
  assert.deepEqual(g.sections[0].tiles.map(p => p.id), ['w1']);
  assert.deepEqual(g.sections[0].members.map(p => p.id), ['w1', 'w2'], 'members ignore the filter (collapsed-header counts)');
  assert.deepEqual(g.sections[3].tiles.map(p => p.id), ['u1', 'd1'], 'dangling folderId → No folder');
  const all = groupDen(ps, folders, new Set(['active', 'paused', 'complete'] as const));
  assert.ok(all.sections.some(s => s.folder?.id === 'fld-h'));
});

test('shortcutOrder skips collapsed folders', () => {
  const g = groupDen(
    [{ id: 'a', folderId: 'f1' }, { id: 'b', folderId: 'f2' }, { id: 'c' }],
    [{ id: 'f1', name: 'One', order: 0 }, { id: 'f2', name: 'Two', order: 1 }],
    new Set(['active'] as const),
  );
  assert.deepEqual(shortcutOrder(g.sections, new Set()).map(p => p.id), ['a', 'b', 'c']);
  assert.deepEqual(shortcutOrder(g.sections, new Set(['f1'])).map(p => p.id), ['b', 'c']);
});

test('reorderAfterDrop: within a section and into another section', () => {
  const all = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
  // section [b, c, d]; drag d before b
  assert.deepEqual(reorderAfterDrop(all, [all[1], all[2], all[3]], 'd', 0), ['a', 'd', 'b', 'c', 'e']);
  // drag b to the end of its own section (index 3 = after d)
  assert.deepEqual(reorderAfterDrop(all, [all[1], all[2], all[3]], 'b', 3), ['a', 'c', 'd', 'b', 'e']);
  // drag a (from elsewhere) into section [c, d] at index 1 → before d
  assert.deepEqual(reorderAfterDrop(all, [all[2], all[3]], 'a', 1), ['b', 'c', 'a', 'd', 'e']);
  // drop into an empty section → appended
  assert.deepEqual(reorderAfterDrop(all, [], 'b', 0), ['a', 'c', 'd', 'e', 'b']);
});

function memStore(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } };
}

test('collapse prefs: round trip, stale ids dropped, junk + throwing storage tolerated', () => {
  const s = memStore();
  assert.deepEqual([...readCollapsedFolders(s)], []);
  writeCollapsedFolders(new Set(['f1', 'gone']), ['f1', 'f2'], s);
  assert.deepEqual([...readCollapsedFolders(s)], ['f1']);
  writeCollapsedFolders(new Set(), undefined, s);
  assert.equal(s.data.has(COLLAPSED_KEY), false, 'empty set removes the key');
  s.data.set(COLLAPSED_KEY, '{not json');
  assert.deepEqual([...readCollapsedFolders(s)], []);
  s.data.set(COLLAPSED_KEY, '[1, "ok", null]');
  assert.deepEqual([...readCollapsedFolders(s)], ['ok']);
  const boom: StorageLike = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  assert.deepEqual([...readCollapsedFolders(boom)], []);
  assert.doesNotThrow(() => writeCollapsedFolders(new Set(['x']), undefined, boom));
  assert.deepEqual([...readCollapsedFolders(null)], []);
});

// Codex P2 (fix loop): a folder can be dropped AFTER a target, so it can move to the end.

test('folderOrderAfterDrop: before/after, to the very end, no-ops', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(folderOrderAfterDrop(ids, 'a', 'c', 'after'), ['b', 'c', 'a'], 'first → last (was impossible)');
  assert.deepEqual(folderOrderAfterDrop(ids, 'a', 'c', 'before'), ['b', 'a', 'c']);
  assert.deepEqual(folderOrderAfterDrop(ids, 'c', 'a', 'before'), ['c', 'a', 'b'], 'last → first');
  assert.deepEqual(folderOrderAfterDrop(ids, 'c', 'a', 'after'), ['a', 'c', 'b']);
  assert.deepEqual(folderOrderAfterDrop(ids, 'b', 'b', 'after'), ids);
  assert.deepEqual(folderOrderAfterDrop(ids, 'zz', 'a', 'after'), ids);
});

test('workingInActive: hero count ignores paused/complete/archived projects', () => {
  assert.equal(workingInActive([
    { activeSessions: 2 }, { status: 'paused', activeSessions: 3 }, { status: 'complete', activeSessions: 1 },
    { status: 'archived', activeSessions: 1 }, { status: 'active', activeSessions: 1 }, {},
  ]), 3);
});
