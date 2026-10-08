/**
 * /api/projects/folders + reorder `move` (card #0381 Phase B), against a temp
 * registry (SLYCODE_HOME) — never the real one.
 *
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/app/api/projects/folders/route.test.ts
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'folders-route-test-'));
const REGISTRY = path.join(home, 'projects', 'registry.json');
type Handler = (request: Request) => Promise<Response>;
let GET: () => Promise<Response>, POST: Handler, PATCH: Handler, DELETE: Handler, REORDER: Handler;

before(async () => {
  process.env.SLYCODE_HOME = home;
  fs.mkdirSync(path.dirname(REGISTRY), { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify({
    version: '2.0.0', lastUpdated: '',
    projects: ['a', 'b'].map((id, i) => ({
      id, name: id.toUpperCase(), description: '', path: path.join(home, id), hasClaudeMd: false,
      masterCompliant: false, areas: [], tags: [], order: i, sessionKey: id, sessionKeyAliases: [],
    })),
  }, null, 2));
  ({ GET, POST, PATCH, DELETE } = await import('./route'));
  ({ POST: REORDER } = await import('../reorder/route'));
});

const json = (method: string, body: unknown, url = 'http://x/api/projects/folders') =>
  new Request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const reg = () => JSON.parse(fs.readFileSync(REGISTRY, 'utf-8'));

test('create (+assign), duplicate 409, rename keeps id', async () => {
  let res = await POST(json('POST', { name: 'Work', projectId: 'a' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).folder.id, 'fld-work');
  assert.equal(reg().projects[0].folderId, 'fld-work');
  assert.equal(reg().version, '2.1.0');

  res = await POST(json('POST', { name: 'work' }));
  assert.equal(res.status, 409);

  res = await PATCH(json('PATCH', { id: 'fld-work', name: 'Day job' }));
  assert.equal(res.status, 200);
  assert.deepEqual(reg().folders, [{ id: 'fld-work', name: 'Day job', order: 0 }]);
  const listed = await (await GET()).json();
  assert.deepEqual(listed.counts, { 'fld-work': 1 });
});

test('move via PATCH, reorder folders, bad bodies rejected', async () => {
  await POST(json('POST', { name: 'Personal' }));
  let res = await PATCH(json('PATCH', { projectId: 'b', folderId: 'fld-personal' }));
  assert.equal(res.status, 200);
  assert.equal(reg().projects[1].folderId, 'fld-personal');
  res = await PATCH(json('PATCH', { projectId: 'b', folderId: 'fld-ghost' }));
  assert.equal(res.status, 404);
  res = await PATCH(json('PATCH', { order: ['fld-personal', 'fld-work'] }));
  assert.deepEqual(reg().folders.map((f: { id: string }) => f.id), ['fld-personal', 'fld-work']);
  res = await PATCH(json('PATCH', { nonsense: true }));
  assert.equal(res.status, 400);
});

test('reorder with move: order and folder in one write; unfile with null', async () => {
  const res = await REORDER(json('POST', { projectIds: ['b', 'a'], move: { projectId: 'b', folderId: 'fld-work' } }, 'http://x/api/projects/reorder'));
  assert.equal(res.status, 200);
  const r = reg();
  assert.deepEqual(r.projects.map((p: { id: string; order: number; folderId?: string }) => [p.id, p.order, p.folderId]), [['a', 1, 'fld-work'], ['b', 0, 'fld-work']]);
  await REORDER(json('POST', { projectIds: ['b', 'a'], move: { projectId: 'a', folderId: null } }, 'http://x/api/projects/reorder'));
  assert.equal(reg().projects[0].folderId, undefined);
});

test('delete unfiles its projects; nothing else removed', async () => {
  const res = await DELETE(new Request('http://x/api/projects/folders?id=fld-work', { method: 'DELETE' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).unfiled, 1);
  const r = reg();
  assert.equal(r.projects.length, 2);
  assert.equal(r.projects[1].folderId, undefined);
  assert.deepEqual(r.folders.map((f: { id: string }) => f.id), ['fld-personal']);
  const missing = await DELETE(new Request('http://x/api/projects/folders?id=fld-work', { method: 'DELETE' }));
  assert.equal(missing.status, 404);
});
