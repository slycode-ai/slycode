/**
 * Tests for atomicWriteFileSync — the synchronous tmp+rename helper used by
 * mcp-common for per-provider MCP config files (card #0333).
 *
 * The web/ package doesn't ship a configured test runner, so this file is a
 * self-contained script. Run via the tsx binary that lives in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx --test web/src/lib/atomic-write.test.ts
 *
 * node:test/node:assert only, no framework deps.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { atomicWriteFileSync } from './atomic-write';

let dir: string;
let target: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-test-'));
  target = path.join(dir, 'config.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writes the content and leaves no temp file behind', () => {
  atomicWriteFileSync(target, '{"a":1}\n');

  assert.equal(fs.readFileSync(target, 'utf-8'), '{"a":1}\n');
  assert.deepEqual(fs.readdirSync(dir), ['config.json'], 'no .tmp.* sibling may remain');
});

test('replaces an existing file in full', () => {
  fs.writeFileSync(target, 'old content that is much longer than the new one\n');

  atomicWriteFileSync(target, 'new\n');

  assert.equal(fs.readFileSync(target, 'utf-8'), 'new\n');
  assert.deepEqual(fs.readdirSync(dir), ['config.json']);
});

test('preserves the existing file mode across the rename', { skip: process.platform === 'win32' }, () => {
  fs.writeFileSync(target, 'secret\n');
  fs.chmodSync(target, 0o600);

  atomicWriteFileSync(target, 'still secret\n');

  assert.equal(fs.statSync(target).mode & 0o777, 0o600, 'a tightened 0600 must survive');
  assert.equal(fs.readFileSync(target, 'utf-8'), 'still secret\n');
});

test('rename failure propagates, cleans up the temp file, and leaves the destination untouched', () => {
  // A non-empty directory at the destination path makes renameSync throw
  // (EISDIR / ENOTEMPTY / EPERM depending on platform) — exercises the real
  // cleanup branch without mocking fs.
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'keep\n');

  assert.throws(() => atomicWriteFileSync(target, 'boom\n'));

  assert.ok(fs.statSync(target).isDirectory(), 'destination directory must be untouched');
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf-8'), 'keep\n');
  assert.deepEqual(fs.readdirSync(dir), ['config.json'], 'temp file must be cleaned up');
});
