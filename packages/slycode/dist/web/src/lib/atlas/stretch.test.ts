/**
 * Feature 079 stretch tests: web↔CLI validator parity for the new artifact
 * types (digest / tour / db annotations), DB introspection parsers, debt
 * scoring, and context-brief budget truncation.
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/atlas/stretch.test.ts
 *   (run from the repo root)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { validateDigest, validateTour, validateDbAnnotations } from './schema';
import { computeDebt } from './store';
import type { AtlasDigest } from './schema';

const require2 = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cli: any = require2(path.resolve(__dirname, '../../../../scripts/atlas.js'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbi: any = require2(path.resolve(__dirname, '../../../../scripts/db-introspect.js'));

const AREAS = new Set(['web', 'bridge']);

// ---------------------------------------------------------------------------
// Parity fixtures: web and CLI validators must agree on every one.
// ---------------------------------------------------------------------------

const VALID_DIGEST = {
  schema_version: 1,
  headline: 'Messaging grew a filter module; most churn in web frontend.',
  areas: [
    { area: 'web', summary: 'Lots of Code Mode work.', commits: 12, files_changed: 9 },
    { area: 'bridge', summary: 'Quiet week.' },
  ],
  notable: [{ file: 'web/src/lib/atlas/store.ts', line: 40, note: 'new view-state engine' }],
};

const DIGEST_CASES: Array<[string, unknown, boolean]> = [
  ['valid digest', VALID_DIGEST, true],
  ['digest with stamped fields', { ...VALID_DIGEST, generated_at: new Date().toISOString(), since_commit: 'abcd1234', head_commit: 'ffff0000' }, true],
  ['missing headline', { ...VALID_DIGEST, headline: '' }, false],
  ['headline too long', { ...VALID_DIGEST, headline: 'x'.repeat(301) }, false],
  ['unknown area', { ...VALID_DIGEST, areas: [{ area: 'ghost', summary: 'hm' }] }, false],
  ['empty areas', { ...VALID_DIGEST, areas: [] }, false],
  ['negative commits', { ...VALID_DIGEST, areas: [{ area: 'web', summary: 'ok', commits: -1 }] }, false],
  ['notable without note', { ...VALID_DIGEST, notable: [{ file: 'a.ts' }] }, false],
  ['notable path traversal', { ...VALID_DIGEST, notable: [{ file: '../etc/passwd', note: 'nope' }] }, false],
  ['bad since_commit', { ...VALID_DIGEST, since_commit: 'not-hex' }, false],
  ['wrong schema_version', { ...VALID_DIGEST, schema_version: 2 }, false],
];

const VALID_TOUR = {
  schema_version: 1,
  id: 'messaging-pipeline',
  title: 'How a message becomes a prompt',
  description: 'Follow one inbound message.',
  area: 'web',
  updated_at: new Date().toISOString(),
  steps: [
    { file: 'a/b.ts', line: 10, endLine: 20, title: 'Entry', body: 'The webhook lands here.' },
    { file: 'a/c.ts', title: 'Exit', body: 'And leaves here.' },
  ],
};

const TOUR_CASES: Array<[string, unknown, boolean]> = [
  ['valid tour', VALID_TOUR, true],
  ['tour with prompt anchor', { ...VALID_TOUR, prompt: 'Explain how a message becomes a prompt.' }, true],
  ['empty prompt', { ...VALID_TOUR, prompt: '  ' }, false],
  ['prompt too long', { ...VALID_TOUR, prompt: 'x'.repeat(301) }, false],
  ['single step', { ...VALID_TOUR, steps: VALID_TOUR.steps.slice(0, 1) }, false],
  ['bad id slug', { ...VALID_TOUR, id: 'Bad_Slug!' }, false],
  ['unknown area', { ...VALID_TOUR, area: 'ghost' }, false],
  ['step endLine < line', { ...VALID_TOUR, steps: [{ file: 'a.ts', line: 20, endLine: 10, title: 't', body: 'b' }, VALID_TOUR.steps[1]] }, false],
  ['step missing body', { ...VALID_TOUR, steps: [{ file: 'a.ts', title: 't', body: '' }, VALID_TOUR.steps[1]] }, false],
  ['step body too long', { ...VALID_TOUR, steps: [{ file: 'a.ts', title: 't', body: 'x'.repeat(1501) }, VALID_TOUR.steps[1]] }, false],
  ['too many steps', { ...VALID_TOUR, steps: Array.from({ length: 31 }, (_, i) => ({ file: `f${i}.ts`, title: 't', body: 'b' })) }, false],
];

const VALID_DB = {
  schema_version: 1,
  updated_at: new Date().toISOString(),
  summary: 'The workspace database.',
  tables: { users: { summary: 'People.', columns: { email: 'login identity' } } },
  relations: [{ from: 'orders', to: 'users', label: 'buyer' }],
};

const DB_CASES: Array<[string, unknown, boolean]> = [
  ['valid db annotations', VALID_DB, true],
  ['tables optional', { schema_version: 1, summary: 'Just prose.' }, true],
  ['bad table name', { ...VALID_DB, tables: { 'users; DROP': {} } }, false],
  ['column note too long', { ...VALID_DB, tables: { users: { columns: { email: 'x'.repeat(161) } } } }, false],
  ['relation missing to', { ...VALID_DB, relations: [{ from: 'a' }] }, false],
  ['summary too long', { ...VALID_DB, summary: 'x'.repeat(2001) }, false],
];

test('digest validator parity (web ↔ CLI)', () => {
  for (const [name, fixture, shouldPass] of DIGEST_CASES) {
    const webErrs = validateDigest(fixture, AREAS);
    const cliErrs = cli.validateDigest(fixture, AREAS);
    assert.equal(webErrs.length === 0, shouldPass, `web: ${name} → ${JSON.stringify(webErrs)}`);
    assert.deepEqual(webErrs, cliErrs, `parity: ${name}`);
  }
});

test('tour validator parity (web ↔ CLI)', () => {
  for (const [name, fixture, shouldPass] of TOUR_CASES) {
    const webErrs = validateTour(fixture, AREAS);
    const cliErrs = cli.validateTour(fixture, AREAS);
    assert.equal(webErrs.length === 0, shouldPass, `web: ${name} → ${JSON.stringify(webErrs)}`);
    assert.deepEqual(webErrs, cliErrs, `parity: ${name}`);
  }
});

test('db annotations validator parity (web ↔ CLI)', () => {
  for (const [name, fixture, shouldPass] of DB_CASES) {
    const webErrs = validateDbAnnotations(fixture);
    const cliErrs = cli.validateDbAnnotations(fixture);
    assert.equal(webErrs.length === 0, shouldPass, `web: ${name} → ${JSON.stringify(webErrs)}`);
    assert.deepEqual(webErrs, cliErrs, `parity: ${name}`);
  }
});

// ---------------------------------------------------------------------------
// DB introspection parsers
// ---------------------------------------------------------------------------

test('prisma parser: models, pks, optionals, relations', () => {
  const schema = `
model User {
  id     Int     @id @default(autoincrement())
  email  String  @unique
  posts  Post[]
}
model Post {
  id       Int    @id
  title    String
  author   User   @relation(fields: [authorId], references: [id])
  authorId Int
  draft    Boolean?
}`;
  const { tables } = dbi.parsePrisma(schema);
  assert.equal(tables.length, 2);
  const user = tables.find((t: { name: string }) => t.name === 'User');
  assert.deepEqual(user.columns.map((c: { name: string }) => c.name), ['id', 'email']); // posts (relation list) excluded
  assert.equal(user.columns[0].pk, true);
  const post = tables.find((t: { name: string }) => t.name === 'Post');
  assert.deepEqual(post.fks, [{ column: 'authorId', refTable: 'User', refColumn: 'id' }]);
  const draft = post.columns.find((c: { name: string }) => c.name === 'draft');
  assert.equal(draft.nullable, true);
  assert.ok(!post.columns.some((c: { name: string }) => c.name === 'author')); // relation object excluded
});

test('sql ddl parser: nested parens, constraint fks, composite pk clause', () => {
  const sql = `
CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  balance DECIMAL(10,2) NOT NULL CHECK (balance >= 0),
  owner_id INTEGER REFERENCES users (id)
);
CREATE TABLE sessions (
  token TEXT NOT NULL,
  account_id BIGINT,
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  PRIMARY KEY (token)
);`;
  const { tables } = dbi.parseSqlDdl(sql);
  assert.equal(tables.length, 2);
  const accounts = tables[0];
  assert.equal(accounts.name, 'accounts');
  assert.equal(accounts.columns.length, 3); // CHECK constraint didn't break the split
  assert.equal(accounts.columns.find((c: { name: string }) => c.name === 'balance').type, 'DECIMAL(10,2)');
  assert.deepEqual(accounts.fks, [{ column: 'owner_id', refTable: 'users', refColumn: 'id' }]);
  const sessions = tables[1];
  assert.equal(sessions.columns.find((c: { name: string }) => c.name === 'token').pk, true); // PK clause applied
  assert.deepEqual(sessions.fks, [{ column: 'account_id', refTable: 'accounts', refColumn: 'id' }]);
});

test('sql ddl parser: quoted identifiers and schema qualifiers', () => {
  const sql = 'CREATE TABLE "public"."order-items" (id INT PRIMARY KEY, "order_id" INT REFERENCES "orders"("id"));';
  const { tables } = dbi.parseSqlDdl(sql);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].name, 'order-items'); // schema qualifier dropped, quotes stripped
  assert.deepEqual(tables[0].fks, [{ column: 'order_id', refTable: 'orders', refColumn: 'id' }]);
});

// ---------------------------------------------------------------------------
// Debt scoring + context budget
// ---------------------------------------------------------------------------

function digestFixture(): AtlasDigest {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    since_commit: 'abcd1234',
    head_commit: 'ffff0000',
    headline: 'h',
    areas: [
      { area: 'web', summary: 's', commits: 10 },
      { area: 'bridge', summary: 's', commits: 4 },
    ],
  };
}

test('debt: unviewed high-churn area outranks well-viewed higher-churn area', () => {
  const debt = computeDebt(digestFixture(), { area_views: { web: 9 } });
  // web: 10/(1+9)=1, bridge: 4/(1+0)=4 → bridge first
  assert.deepEqual(debt.map(d => d.areaId), ['bridge', 'web']);
  assert.equal(debt[0].score, 4);
  assert.equal(debt[1].score, 1);
});

test('debt: no digest → empty; no view-state → raw commits order', () => {
  assert.deepEqual(computeDebt(null, {}), []);
  const debt = computeDebt(digestFixture(), null);
  assert.deepEqual(debt.map(d => d.areaId), ['web', 'bridge']);
});

test('context markdown: budget drops tail sections, never truncates mid-section', () => {
  const ctx = {
    kind: 'project',
    overview: 'A system that does things.',
    areas: [
      { id: 'web', name: 'Web', paths: ['web/src'], summary: 'ui', gist: 'The web area.', key_files: [{ path: 'web/a.ts', role: 'entry' }] },
      { id: 'bridge', name: 'Bridge', paths: ['bridge/src'], summary: 'pty', gist: 'The bridge.', key_files: [{ path: 'bridge/b.ts', role: 'ptys' }] },
    ],
    flows: [{ from: 'web', to: 'bridge', label: 'ws' }],
  };
  const full = cli.contextMarkdown(ctx, 100000);
  assert.ok(full.includes('## Key files — Bridge'));
  const tight = cli.contextMarkdown(ctx, full.length - 10);
  assert.ok(!tight.includes('## Key files — Bridge'), 'tail section dropped');
  assert.ok(tight.length <= full.length - 10, 'budget is a hard ceiling');
  const tiny = cli.contextMarkdown(ctx, 60);
  assert.ok(tiny.length <= 60, 'budget respected even at tiny sizes');
  const micro = cli.contextMarkdown(ctx, 10);
  assert.ok(micro.length <= 10, 'first-section overflow is hard-truncated');
});
