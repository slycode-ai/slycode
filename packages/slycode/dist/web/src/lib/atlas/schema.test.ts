/**
 * Atlas schema validation tests + web↔CLI LOCKSTEP parity (feature 076).
 *
 * Runs both validators (web/src/lib/atlas/schema.ts and scripts/atlas.js)
 * over the same fixtures and asserts identical accept/reject decisions —
 * the guard for the mirrored-validation convention.
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/atlas/schema.test.ts
 *   (run from the repo root — the CLI locates the project via kanban.json)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { validateAtlasRoot, validateAtlasNode, validateNavEvent } from './schema';

const require2 = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cli: any = require2(path.resolve(__dirname, '../../../../scripts/atlas.js'));

const NOW = new Date().toISOString();

const VALID_ROOT = {
  schema_version: 1,
  updated_at: NOW,
  project_overview: 'A system.',
  areas: [
    { id: 'web', name: 'Web', paths: ['web/src'], summary: 'ui' },
    { id: 'bridge', name: 'Bridge', paths: ['bridge/src'], pinned: true },
  ],
  flows: [{ from: 'web', to: 'bridge', label: 'PTY' }],
};

const INVALID_ROOTS: Array<[string, unknown]> = [
  ['null', null],
  ['bad version', { ...VALID_ROOT, schema_version: 2 }],
  ['no areas', { ...VALID_ROOT, areas: [] }],
  ['bad slug', { ...VALID_ROOT, areas: [{ id: 'Bad Id', name: 'x', paths: ['a'] }] }],
  ['dup ids', { ...VALID_ROOT, areas: [{ id: 'a', name: 'x', paths: ['p'] }, { id: 'a', name: 'y', paths: ['q'] }] }],
  ['abs path', { ...VALID_ROOT, areas: [{ id: 'a', name: 'x', paths: ['/etc'] }] }],
  ['traversal path', { ...VALID_ROOT, areas: [{ id: 'a', name: 'x', paths: ['../up'] }] }],
  ['flow to unknown', { ...VALID_ROOT, flows: [{ from: 'web', to: 'ghost', label: 'x' }] }],
  ['bad date', { ...VALID_ROOT, updated_at: 'yesterday' }],
];

const KNOWN = new Set(['web', 'bridge']);
const VALID_NODE = {
  schema_version: 1,
  area: 'web',
  updated_at: NOW,
  explanation: 'The web area renders things.',
  key_files: [{ path: 'web/src/app.tsx', role: 'shell' }],
  modules: [{ path: 'web/src/lib/x.ts', name: 'x', summary: 'does x' }],
  symbol_summaries: { 'web/src/lib/x.ts': { doX: 'performs x' } },
  collections: [{ prefix: 'documentation/features/', summary: 'numbered specs' }],
  source_hashes: { 'web/src/app.tsx': 'abc123def456', 'documentation/features/': 'abc123def456' },
};

const INVALID_NODES: Array<[string, unknown]> = [
  ['null', null],
  ['unknown area', { ...VALID_NODE, area: 'ghost' }],
  ['empty explanation', { ...VALID_NODE, explanation: '  ' }],
  ['huge explanation', { ...VALID_NODE, explanation: 'x'.repeat(9000) }],
  ['no key files', { ...VALID_NODE, key_files: [] }],
  ['key file traversal', { ...VALID_NODE, key_files: [{ path: '../../etc/passwd', role: 'nope' }] }],
  ['bad hash', { ...VALID_NODE, source_hashes: { 'a.ts': 'nothex' } }],
  ['symbol summary too long', { ...VALID_NODE, symbol_summaries: { 'a.ts': { f: 'y'.repeat(300) } } }],
  ['collection abs prefix', { ...VALID_NODE, collections: [{ prefix: '/etc' }] }],
  ['collection traversal', { ...VALID_NODE, collections: [{ prefix: '../up/' }] }],
  ['collection summary too long', { ...VALID_NODE, collections: [{ prefix: 'docs/', summary: 'z'.repeat(300) }] }],
];

const VALID_NAVS: Array<[string, unknown]> = [
  ['navigate', { type: 'navigate', file: 'a/b.ts', line: 3 }],
  ['navigate bare', { type: 'navigate', file: 'a/b.ts' }],
  ['highlight', { type: 'highlight', file: 'a/b.ts', line: 3, endLine: 9, note: 'look' }],
  ['deck', { type: 'deck', deck: { title: 'usages', items: [{ file: 'a.ts', line: 1, note: 'hi' }] } }],
];

const INVALID_NAVS: Array<[string, unknown]> = [
  ['bad type', { type: 'teleport', file: 'a.ts' }],
  ['navigate abs file', { type: 'navigate', file: '/etc/passwd' }],
  ['highlight without line', { type: 'highlight', file: 'a.ts' }],
  ['endLine before line', { type: 'highlight', file: 'a.ts', line: 9, endLine: 3 }],
  ['deck no items', { type: 'deck', deck: { title: 'x', items: [] } }],
  ['deck item traversal', { type: 'deck', deck: { title: 'x', items: [{ file: '../out.ts' }] } }],
];

test('valid fixtures pass on BOTH validators', () => {
  assert.deepEqual(validateAtlasRoot(VALID_ROOT), []);
  assert.deepEqual(cli.validateAtlasRoot(VALID_ROOT), []);
  assert.deepEqual(validateAtlasNode(VALID_NODE, KNOWN), []);
  assert.deepEqual(cli.validateAtlasNode(VALID_NODE, KNOWN), []);
  for (const [name, nav] of VALID_NAVS) {
    assert.deepEqual(validateNavEvent(nav), [], `web nav: ${name}`);
    assert.deepEqual(cli.validateNavEvent(nav), [], `cli nav: ${name}`);
  }
});

test('invalid roots rejected identically (web ↔ CLI lockstep)', () => {
  for (const [name, fixture] of INVALID_ROOTS) {
    const web = validateAtlasRoot(fixture);
    const cliErrs = cli.validateAtlasRoot(fixture);
    assert.ok(web.length > 0, `web should reject root: ${name}`);
    assert.ok(cliErrs.length > 0, `cli should reject root: ${name}`);
    assert.deepEqual(web, cliErrs, `lockstep drift on root: ${name}`);
  }
});

test('invalid nodes rejected identically (web ↔ CLI lockstep)', () => {
  for (const [name, fixture] of INVALID_NODES) {
    const web = validateAtlasNode(fixture, KNOWN);
    const cliErrs = cli.validateAtlasNode(fixture, KNOWN);
    assert.ok(web.length > 0, `web should reject node: ${name}`);
    assert.ok(cliErrs.length > 0, `cli should reject node: ${name}`);
    assert.deepEqual(web, cliErrs, `lockstep drift on node: ${name}`);
  }
});

test('invalid nav events rejected identically (web ↔ CLI lockstep)', () => {
  for (const [name, fixture] of INVALID_NAVS) {
    const web = validateNavEvent(fixture);
    const cliErrs = cli.validateNavEvent(fixture);
    assert.ok(web.length > 0, `web should reject nav: ${name}`);
    assert.ok(cliErrs.length > 0, `cli should reject nav: ${name}`);
    assert.deepEqual(web, cliErrs, `lockstep drift on nav: ${name}`);
  }
});
