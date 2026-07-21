/**
 * Tests for whole-directory update detection in buildUpdatesMatrix and the
 * digest recorded by acceptUpdate — reference/script edits without a version
 * bump must surface as updates (the old SKILL.md-only hashing masked them).
 *
 * Self-contained script (no test runner configured in web/). Run via:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/asset-scanner-updates.test.ts
 *
 * Points SLYCODE_HOME at a temp fixture BEFORE importing asset-scanner (the
 * module captures its root paths at load time), so this file must not import
 * asset-scanner statically.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AssetInfo } from './types';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-scanner-fixture-'));
process.env.SLYCODE_HOME = ROOT;

function writeFiles(baseDir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(baseDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function asset(name: string, version: string): AssetInfo {
  return {
    name,
    type: 'skill',
    path: `skills/${name}/SKILL.md`,
    frontmatter: { name, version, description: 'test skill', updated: '2026-01-01' },
    isValid: true,
  } as AssetInfo;
}

const SKILL_MD = '---\nname: foo\nversion: 1.0.0\n---\nbody\n';

test('buildUpdatesMatrix — reference-only edit surfaces as an update with the file named', async () => {
  const { buildUpdatesMatrix } = await import('./asset-scanner');

  writeFiles(path.join(ROOT, 'updates', 'skills', 'foo'), {
    'SKILL.md': SKILL_MD,
    'references/guide.md': 'fixed guide\n',
  });
  writeFiles(path.join(ROOT, 'store', 'skills', 'foo'), {
    'SKILL.md': SKILL_MD,                       // identical — no version bump
    'references/guide.md': 'stale guide\n',     // differs
  });

  const entries = buildUpdatesMatrix([asset('foo', '1.0.0')], [asset('foo', '1.0.0')], {});
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'update');
  assert.deepEqual(entries[0].changedFiles, ['references/guide.md']);
  assert.deepEqual(entries[0].filesAffected, ['SKILL.md', 'references/guide.md']);
  assert.equal(entries[0].skillMdOnly, false);
});

test('buildUpdatesMatrix — identical dirs lazy-record the digest and stay silent', async () => {
  const { buildUpdatesMatrix } = await import('./asset-scanner');
  const { hashSkillDir } = await import('./skill-dir-digest');

  writeFiles(path.join(ROOT, 'updates', 'skills', 'same'), {
    'SKILL.md': SKILL_MD,
    'references/guide.md': 'same\n',
  });
  writeFiles(path.join(ROOT, 'store', 'skills', 'same'), {
    'SKILL.md': SKILL_MD,
    'references/guide.md': 'same\n',
  });

  const ignored: Record<string, string> = {};
  const entries = buildUpdatesMatrix([asset('same', '1.0.0')], [asset('same', '1.0.0')], ignored);
  assert.equal(entries.length, 0);
  // Lazy-init recorded the whole-directory digest
  const expected = hashSkillDir(path.join(ROOT, 'updates', 'skills', 'same')).digest;
  assert.equal(ignored['skills/same'], expected);
});

test('buildUpdatesMatrix — dismissed digest suppresses the entry until upstream changes again', async () => {
  const { buildUpdatesMatrix } = await import('./asset-scanner');
  const { hashSkillDir } = await import('./skill-dir-digest');

  const upstreamDigest = hashSkillDir(path.join(ROOT, 'updates', 'skills', 'foo')).digest;
  const dismissed = { 'skills/foo': upstreamDigest };
  assert.equal(buildUpdatesMatrix([asset('foo', '1.0.0')], [asset('foo', '1.0.0')], dismissed).length, 0);

  // Upstream changes again → digest no longer matches → resurfaces
  writeFiles(path.join(ROOT, 'updates', 'skills', 'foo'), {
    'references/guide.md': 'fixed guide v2\n',
  });
  const entries = buildUpdatesMatrix([asset('foo', '1.0.0')], [asset('foo', '1.0.0')], dismissed);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].changedFiles, ['references/guide.md']);
});

test('buildUpdatesMatrix — skill missing from store is "new" with all files changed', async () => {
  const { buildUpdatesMatrix } = await import('./asset-scanner');

  writeFiles(path.join(ROOT, 'updates', 'skills', 'brand-new'), {
    'SKILL.md': SKILL_MD,
    'scripts/run.sh': 'echo hi\n',
  });

  const entries = buildUpdatesMatrix([asset('brand-new', '2.0.0')], [], {});
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'new');
  assert.deepEqual(entries[0].changedFiles, ['SKILL.md', 'scripts/run.sh']);
});

test('acceptUpdate — records the whole-directory digest as accepted', async () => {
  const { acceptUpdate, getIgnoredUpdates } = await import('./asset-scanner');
  const { hashSkillDir } = await import('./skill-dir-digest');

  acceptUpdate('skill', 'foo');

  const ignored = getIgnoredUpdates();
  const expected = hashSkillDir(path.join(ROOT, 'updates', 'skills', 'foo')).digest;
  assert.equal(ignored['skills/foo'], expected);

  // Store now matches upstream — no further update entry
  const { buildUpdatesMatrix } = await import('./asset-scanner');
  const entries = buildUpdatesMatrix([asset('foo', '1.0.0')], [asset('foo', '1.0.0')], ignored);
  assert.equal(entries.length, 0);
});
