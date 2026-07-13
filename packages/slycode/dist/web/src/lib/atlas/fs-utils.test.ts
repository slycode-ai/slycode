/**
 * Tests for Code Mode fs-utils (feature 076): path containment, tree folding,
 * binary sniff.
 *
 * Self-contained node:test script (web/ has no configured runner):
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/atlas/fs-utils.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { containedPath, foldTree, looksBinary, AtlasPathError } from './fs-utils';

const ROOT = path.resolve('/tmp/proj');

test('containedPath resolves normal relative paths', () => {
  assert.equal(containedPath(ROOT, 'src/index.ts'), path.join(ROOT, 'src', 'index.ts'));
  assert.equal(containedPath(ROOT, '.env'), path.join(ROOT, '.env'));
  // backslashes normalize
  assert.equal(containedPath(ROOT, 'src\\index.ts'), path.join(ROOT, 'src', 'index.ts'));
});

test('containedPath rejects escapes and absolutes', () => {
  for (const bad of ['../outside', 'src/../../etc/passwd', '/etc/passwd', 'C:/windows/system32', '']) {
    assert.throws(() => containedPath(ROOT, bad), AtlasPathError, `should reject: ${bad}`);
  }
});

test('containedPath rejects dot-dot that lands exactly on parent', () => {
  assert.throws(() => containedPath(ROOT, 'a/../..'), AtlasPathError);
});

test('containedPath allows dot-dot that stays inside', () => {
  assert.equal(containedPath(ROOT, 'a/../src/x.ts'), path.join(ROOT, 'src', 'x.ts'));
});

test('foldTree groups dirs first, sorted, files after', () => {
  const tree = foldTree(['b.txt', 'a/z.ts', 'a/b/c.ts', 'a/a.ts', 'README.md']);
  assert.equal(tree[0].name, 'a');
  assert.equal(tree[0].type, 'dir');
  const a = tree[0];
  assert.equal(a.children![0].name, 'b'); // subdir before files
  assert.deepEqual(a.children!.map(c => c.name), ['b', 'a.ts', 'z.ts']);
  // localeCompare is case-insensitive-ish: 'b.txt' sorts before 'README.md'
  assert.deepEqual(tree.map(n => n.name), ['a', 'b.txt', 'README.md']);
  assert.equal(a.children![0].children![0].path, 'a/b/c.ts');
});

test('foldTree handles empty input', () => {
  assert.deepEqual(foldTree([]), []);
});

test('looksBinary detects NUL bytes, passes text', () => {
  assert.equal(looksBinary(Buffer.from('hello world\nmore text')), false);
  assert.equal(looksBinary(Buffer.from([0x68, 0x00, 0x69])), true);
  assert.equal(looksBinary(Buffer.from('')), false);
});

test('foldTree marks ignored files (feature 079 — .env reachable in the tree)', () => {
  const tree = foldTree(['src/app.ts', '.env', 'src/local.json'], new Set(['.env', 'src/local.json']));
  const env = tree.find(n => n.name === '.env')!;
  assert.equal(env.ignored, true);
  const src = tree.find(n => n.name === 'src')!;
  assert.equal(src.children!.find(c => c.name === 'local.json')!.ignored, true);
  assert.equal(src.children!.find(c => c.name === 'app.ts')!.ignored, undefined);
});
