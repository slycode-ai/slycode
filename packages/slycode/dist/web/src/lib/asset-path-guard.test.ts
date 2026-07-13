/**
 * Tests for the asset path traversal guard (card-1783205554613).
 *
 * The web/ package ships no configured test runner, so this file is a
 * self-contained script (same convention as html-refs.test.ts / input-queue.test.ts):
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/asset-path-guard.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { validateAssetName, assertInside, safeAssetJoin } from './asset-path-guard';

// ---------------------------------------------------------------------------
// validateAssetName
// ---------------------------------------------------------------------------

test('validateAssetName accepts legitimate identifiers', () => {
  for (const name of ['kanban', 'my-skill', 'messaging.v2', 'agent_1', 'A', 'x.y.z', 'skill-2026']) {
    assert.equal(validateAssetName(name), true, `expected ${name} to be valid`);
  }
});

test('validateAssetName rejects traversal and separators', () => {
  // The critical regression: `..` is only dots — a naive /^[\w.-]+$/ ALLOWS it.
  for (const name of ['..', '.', '../../../.slycode', 'a/b', 'a\\b', './x', '../x']) {
    assert.equal(validateAssetName(name), false, `expected ${name} to be rejected`);
  }
});

test('validateAssetName rejects empty, NUL, leading-dot, oversize, non-string', () => {
  assert.equal(validateAssetName(''), false);
  assert.equal(validateAssetName('foo\0bar'), false);
  assert.equal(validateAssetName('.hidden'), false); // must start alphanumeric
  assert.equal(validateAssetName('-leadinghyphen'), false);
  assert.equal(validateAssetName('a'.repeat(256)), false);
  assert.equal(validateAssetName(null), false);
  assert.equal(validateAssetName(undefined), false);
  assert.equal(validateAssetName(42 as unknown), false);
});

// ---------------------------------------------------------------------------
// assertInside — the load-bearing containment check
// ---------------------------------------------------------------------------

test('assertInside returns a path under the base for plain names', () => {
  const base = '/home/ec2-user/.slycode/store/skills';
  const got = assertInside(base, 'kanban');
  assert.equal(got, path.join(base, 'kanban'));
});

test('assertInside returns null when the name escapes the base', () => {
  const base = '/home/ec2-user/.slycode/store/skills';
  assert.equal(assertInside(base, '../../../.slycode'), null);
  assert.equal(assertInside(base, '../../..'), null);
  assert.equal(assertInside(base, '/etc/passwd'), null); // absolute escapes too
});

// ---------------------------------------------------------------------------
// safeAssetJoin — the three PoC shapes (read / delete / copy) all resolve null
// ---------------------------------------------------------------------------

test('safeAssetJoin blocks the ../../../.slycode PoC for read/delete/copy bases', () => {
  const bases = [
    '/home/ec2-user/.slycode/store/skills', // DELETE + POST-copy destination
    '/home/ec2-user/projects/foo/.claude/skills', // preview read (provider dir)
    '/home/ec2-user/.slycode/store/agents',
  ];
  for (const base of bases) {
    assert.equal(safeAssetJoin(base, '../../../.slycode'), null, `PoC should be blocked for ${base}`);
    assert.equal(safeAssetJoin(base, '..'), null);
  }
});

test('safeAssetJoin returns a valid in-base path for legitimate names (no false rejection)', () => {
  const base = '/home/ec2-user/.slycode/store/skills';
  assert.equal(safeAssetJoin(base, 'kanban'), path.join(base, 'kanban'));
  assert.equal(safeAssetJoin(base, 'messaging.json'), path.join(base, 'messaging.json'));
});
