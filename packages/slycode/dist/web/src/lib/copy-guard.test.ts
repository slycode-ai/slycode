import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { copyFileNoFollow, copyDirNoFollow } from './copy-guard';

function makeFixture(): { src: string; dst: string; cleanup: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-guard-'));
  const src = path.join(base, 'src');
  const dst = path.join(base, 'dst');
  fs.mkdirSync(src, { recursive: true });

  // Regular file
  fs.writeFileSync(path.join(src, 'regular.txt'), 'regular content');
  // Nested regular file
  fs.mkdirSync(path.join(src, 'nested'));
  fs.writeFileSync(path.join(src, 'nested', 'deep.txt'), 'deep content');
  // Secret outside the source tree, targeted by symlinks
  const secret = path.join(base, 'secret.txt');
  fs.writeFileSync(secret, 'SECRET');
  // Symlinked file and symlinked directory inside the source tree
  fs.symlinkSync(secret, path.join(src, 'link-file.txt'));
  fs.symlinkSync(base, path.join(src, 'link-dir'));

  return { src, dst, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('copyDirNoFollow copies regular files and skips symlinks', () => {
  const { src, dst, cleanup } = makeFixture();
  try {
    copyDirNoFollow(src, dst);

    assert.equal(fs.readFileSync(path.join(dst, 'regular.txt'), 'utf-8'), 'regular content');
    assert.equal(fs.readFileSync(path.join(dst, 'nested', 'deep.txt'), 'utf-8'), 'deep content');
    assert.equal(fs.existsSync(path.join(dst, 'link-file.txt')), false);
    assert.equal(fs.existsSync(path.join(dst, 'link-dir')), false);
  } finally {
    cleanup();
  }
});

test('copyFileNoFollow copies a regular file', () => {
  const { src, dst, cleanup } = makeFixture();
  try {
    fs.mkdirSync(dst, { recursive: true });
    const copied = copyFileNoFollow(path.join(src, 'regular.txt'), path.join(dst, 'out.txt'));
    assert.equal(copied, true);
    assert.equal(fs.readFileSync(path.join(dst, 'out.txt'), 'utf-8'), 'regular content');
  } finally {
    cleanup();
  }
});

test('copyFileNoFollow refuses a symlink source', () => {
  const { src, dst, cleanup } = makeFixture();
  try {
    fs.mkdirSync(dst, { recursive: true });
    const copied = copyFileNoFollow(path.join(src, 'link-file.txt'), path.join(dst, 'leak.txt'));
    assert.equal(copied, false);
    assert.equal(fs.existsSync(path.join(dst, 'leak.txt')), false);
  } finally {
    cleanup();
  }
});
