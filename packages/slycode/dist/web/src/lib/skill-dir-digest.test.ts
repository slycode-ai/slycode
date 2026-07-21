/**
 * Tests for the whole-directory skill digest (skill-dir-digest.ts) plus the
 * lockstep-mirror parity check against the CLI's hashSkillDirDigest.
 *
 * The web/ package doesn't ship a configured test runner, so this file is a
 * self-contained script. Run via the tsx binary that lives in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/skill-dir-digest.test.ts
 *
 * It exits 0 on success and 1 on any assertion failure. Keep it lightweight —
 * node:test/node:assert only, no framework deps.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashSkillDir, diffSkillDirs } from './skill-dir-digest';
import { hashSkillDirDigest as cliHashSkillDirDigest } from '../../../packages/slycode/src/cli/sync';
import { compareVersions } from './version-compare';

function makeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-digest-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

const BASE_FILES = {
  'SKILL.md': '---\nversion: 1.0.0\n---\nbody\n',
  'references/guide.md': 'guide content\n',
  'scripts/run.sh': '#!/bin/sh\necho hi\n',
};

test('hashSkillDir — deterministic for identical content', () => {
  const a = makeDir(BASE_FILES);
  const b = makeDir(BASE_FILES);
  assert.equal(hashSkillDir(a).digest, hashSkillDir(b).digest);
  assert.equal(hashSkillDir(a).digest.length, 12);
});

test('hashSkillDir — changes when any file content changes', () => {
  const base = hashSkillDir(makeDir(BASE_FILES)).digest;
  const refEdit = hashSkillDir(makeDir({ ...BASE_FILES, 'references/guide.md': 'edited\n' })).digest;
  const scriptEdit = hashSkillDir(makeDir({ ...BASE_FILES, 'scripts/run.sh': '#!/bin/sh\necho bye\n' })).digest;
  assert.notEqual(base, refEdit);
  assert.notEqual(base, scriptEdit);
  assert.notEqual(refEdit, scriptEdit);
});

test('hashSkillDir — changes when a file is added, removed, or renamed', () => {
  const base = hashSkillDir(makeDir(BASE_FILES)).digest;

  const added = { ...BASE_FILES, 'references/new.md': 'new\n' };
  assert.notEqual(base, hashSkillDir(makeDir(added)).digest);

  const removed: Record<string, string> = { ...BASE_FILES };
  delete removed['scripts/run.sh'];
  assert.notEqual(base, hashSkillDir(makeDir(removed)).digest);

  // Rename: same content, different path
  const renamed: Record<string, string> = { ...removed, 'scripts/start.sh': BASE_FILES['scripts/run.sh'] };
  assert.notEqual(base, hashSkillDir(makeDir(renamed)).digest);
});

test('hashSkillDir — missing and empty dirs are stable and equal', () => {
  const missing = hashSkillDir(path.join(os.tmpdir(), 'skill-digest-does-not-exist'));
  const empty = hashSkillDir(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-digest-empty-')));
  assert.equal(missing.digest, empty.digest);
  assert.deepEqual(missing.fileHashes, {});
});

test('hashSkillDir — per-file hashes use /-separated relative paths', () => {
  const { fileHashes } = hashSkillDir(makeDir(BASE_FILES));
  assert.deepEqual(
    Object.keys(fileHashes).sort(),
    ['SKILL.md', 'references/guide.md', 'scripts/run.sh'],
  );
});

test('diffSkillDirs — changed, added, and removed files listed, SKILL.md first', () => {
  const a = hashSkillDir(makeDir(BASE_FILES));
  const b = hashSkillDir(makeDir({
    'SKILL.md': '---\nversion: 1.0.1\n---\nbody\n',      // changed
    'references/guide.md': BASE_FILES['references/guide.md'], // identical
    'references/extra.md': 'extra\n',                     // only in b
    // scripts/run.sh only in a
  }));
  assert.deepEqual(diffSkillDirs(a, b), ['SKILL.md', 'references/extra.md', 'scripts/run.sh']);
  assert.deepEqual(diffSkillDirs(a, a), []);
});

test('parity — CLI hashSkillDirDigest matches web hashSkillDir', () => {
  const dirs = [
    makeDir(BASE_FILES),
    makeDir({ 'SKILL.md': 'only\n' }),
    fs.mkdtempSync(path.join(os.tmpdir(), 'skill-digest-empty-')),
  ];
  for (const dir of dirs) {
    assert.equal(
      cliHashSkillDirDigest(dir),
      hashSkillDir(dir).digest,
      `CLI and web digests diverged for ${dir} — the lockstep mirror in packages/slycode/src/cli/sync.ts must stay byte-identical to skill-dir-digest.ts`,
    );
  }
});

test('compareVersions — newer/older/equal and unparsable-as-equal', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.1.9', '1.2.0'), -1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions(undefined, '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0', undefined), 0);
});
