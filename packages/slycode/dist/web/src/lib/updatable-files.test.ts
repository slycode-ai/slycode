/**
 * Tests for the `updatable:` opt-in push gating (updatable-files.ts) — the
 * default-deny allowlist that stops full-folder deploys from overwriting
 * project-owned skill files (e.g. context-priming's area references).
 *
 * Self-contained script (no test runner configured in web/). Run via:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/updatable-files.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseUpdatableList, isUpdatable, copySkillDirGated, planSkillDirGated } from './updatable-files';

function makeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updatable-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, ...rel.split('/')), 'utf-8');

test('parseUpdatableList — parses the list, tolerates quotes, ends at next key', () => {
  const content = `---
name: demo
version: 1.0.0
updatable:
  - references/maintenance.md
  - "scripts/**"
description: something after the list
---
body`;
  assert.deepEqual(parseUpdatableList(content), ['references/maintenance.md', 'scripts/**']);
});

test('parseUpdatableList — absent key or no frontmatter yields []', () => {
  assert.deepEqual(parseUpdatableList('---\nname: demo\n---\nbody'), []);
  assert.deepEqual(parseUpdatableList('no frontmatter at all'), []);
});

test('isUpdatable — SKILL.md always; exact match; dir/** prefix; default deny', () => {
  const list = ['references/maintenance.md', 'scripts/**'];
  assert.equal(isUpdatable('SKILL.md', []), true);
  assert.equal(isUpdatable('SKILL.md', list), true);
  assert.equal(isUpdatable('references/maintenance.md', list), true);
  assert.equal(isUpdatable('scripts/run.sh', list), true);
  assert.equal(isUpdatable('scripts/nested/deep.sh', list), true);
  assert.equal(isUpdatable('references/area-index.md', list), false);
  assert.equal(isUpdatable('references/areas/web.md', list), false);
  // Prefix must respect the directory boundary encoded in the pattern
  assert.equal(isUpdatable('scripts-extra/run.sh', list), false);
});

test('copySkillDirGated — updates declared files, keeps undeclared project copies, seeds gaps', () => {
  const src = makeDir({
    'SKILL.md': '---\nname: demo\nversion: 2.0.0\nupdatable:\n  - references/maintenance.md\n---\nnew body',
    'references/maintenance.md': 'new maintenance doctrine',
    'references/area-index.md': 'EMPTY TEMPLATE INDEX',
    'references/areas/starter.md': 'starter area template',
  });
  const dst = makeDir({
    'SKILL.md': 'old skill body',
    'references/maintenance.md': 'old maintenance',
    'references/area-index.md': 'CURATED PROJECT INDEX — precious',
    // note: no areas/starter.md — should be seeded
  });

  const result = copySkillDirGated(src, dst);

  // Declared + SKILL.md overwritten
  assert.equal(read(dst, 'SKILL.md').includes('new body'), true);
  assert.equal(read(dst, 'references/maintenance.md'), 'new maintenance doctrine');
  // Project-owned file untouched — THE invariant this whole mechanism exists for
  assert.equal(read(dst, 'references/area-index.md'), 'CURATED PROJECT INDEX — precious');
  // Missing file seeded
  assert.equal(read(dst, 'references/areas/starter.md'), 'starter area template');

  assert.deepEqual(result.updated.sort(), ['SKILL.md', 'references/maintenance.md']);
  assert.deepEqual(result.seeded, ['references/areas/starter.md']);
  assert.deepEqual(result.kept, ['references/area-index.md']);
});

test('copySkillDirGated — no declaration means SKILL.md-only overwrite + seeding', () => {
  const src = makeDir({
    'SKILL.md': 'v2',
    'references/notes.md': 'template notes',
  });
  const dst = makeDir({
    'SKILL.md': 'v1',
    'references/notes.md': 'my notes',
  });

  const result = copySkillDirGated(src, dst);
  assert.equal(read(dst, 'SKILL.md'), 'v2');
  assert.equal(read(dst, 'references/notes.md'), 'my notes');
  assert.deepEqual(result.updated, ['SKILL.md']);
  assert.deepEqual(result.kept, ['references/notes.md']);
});

test('copySkillDirGated — fresh destination gets the full seed', () => {
  const src = makeDir({
    'SKILL.md': 'skill',
    'references/area-index.md': 'template index',
  });
  const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'updatable-fresh-')), 'skill');

  const result = copySkillDirGated(src, dst);
  assert.equal(read(dst, 'references/area-index.md'), 'template index');
  assert.deepEqual(result.updated, ['SKILL.md']);
  assert.deepEqual(result.seeded, ['references/area-index.md']);
  assert.deepEqual(result.kept, []);
});

// ---------------------------------------------------------------------------
// planSkillDirGated (feature 084 — deploy review modal)
// ---------------------------------------------------------------------------

test('planSkillDirGated — classifies fates against the real destination', () => {
  const src = makeDir({
    'SKILL.md': '---\nname: demo\nversion: 2.0.0\nupdatable:\n  - references/maintenance.md\n  - references/identical.md\n---\nnew body',
    'references/maintenance.md': 'new maintenance doctrine',
    'references/identical.md': 'same bytes',
    'references/area-index.md': 'EMPTY TEMPLATE INDEX',
    'references/areas/starter.md': 'starter area template',
  });
  const dst = makeDir({
    'SKILL.md': 'old skill body',
    'references/maintenance.md': 'old maintenance',
    'references/identical.md': 'same bytes',
    'references/area-index.md': 'CURATED PROJECT INDEX — precious',
    // no areas/starter.md — should plan as seed
  });

  const plan = planSkillDirGated(src, dst);
  const byPath = Object.fromEntries(plan.map(e => [e.path, e]));

  assert.deepEqual(byPath['SKILL.md'], { path: 'SKILL.md', fate: 'overwrite', updatable: true });
  assert.deepEqual(byPath['references/maintenance.md'], { path: 'references/maintenance.md', fate: 'overwrite', updatable: true });
  assert.deepEqual(byPath['references/identical.md'], { path: 'references/identical.md', fate: 'unchanged', updatable: true });
  assert.deepEqual(byPath['references/area-index.md'], { path: 'references/area-index.md', fate: 'keep', updatable: false });
  assert.deepEqual(byPath['references/areas/starter.md'], { path: 'references/areas/starter.md', fate: 'seed', updatable: false });

  // SKILL.md first, then path order; nothing written
  assert.equal(plan[0].path, 'SKILL.md');
  assert.equal(read(dst, 'SKILL.md'), 'old skill body');
});

test('planSkillDirGated — fresh destination plans everything as seed', () => {
  const src = makeDir({
    'SKILL.md': 'skill',
    'references/area-index.md': 'template index',
  });
  const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'updatable-plan-fresh-')), 'skill');

  const plan = planSkillDirGated(src, dst);
  assert.deepEqual(plan.map(e => e.fate), ['seed', 'seed']);
  assert.equal(plan[0].path, 'SKILL.md');
  assert.equal(plan[0].updatable, true);
  assert.equal(plan[1].updatable, false);
  assert.equal(fs.existsSync(dst), false); // plan never creates the destination
});

test('planSkillDirGated — symlinked source entry is skipped, never copied', () => {
  const src = makeDir({
    'SKILL.md': 'skill',
    'secret-target.md': 'outside content',
  });
  fs.symlinkSync(path.join(src, 'secret-target.md'), path.join(src, 'references-link.md'));
  const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'updatable-plan-sym-')), 'skill');

  const plan = planSkillDirGated(src, dst);
  const link = plan.find(e => e.path === 'references-link.md');
  assert.equal(link?.fate, 'skipped');

  const result = copySkillDirGated(src, dst);
  assert.equal(fs.existsSync(path.join(dst, 'references-link.md')), false);
  assert.equal([...result.updated, ...result.seeded, ...result.kept].includes('references-link.md'), false);
});

test('planSkillDirGated / copySkillDirGated — copy executes exactly the plan', () => {
  const src = makeDir({
    'SKILL.md': '---\nname: demo\nupdatable:\n  - references/maintenance.md\n---\nv2',
    'references/maintenance.md': 'new doctrine',
    'references/area-index.md': 'template index',
    'references/areas/starter.md': 'starter',
  });
  const dst = makeDir({
    'SKILL.md': 'v1',
    'references/area-index.md': 'precious project index',
  });

  const plan = planSkillDirGated(src, dst);
  const result = copySkillDirGated(src, dst);

  // Agreement: `updated` = updatable files the copy owns (overwrite/unchanged/seed),
  // `seeded` = non-updatable seeds, `kept` = keeps.
  const expectUpdated = plan.filter(e => e.updatable && e.fate !== 'skipped').map(e => e.path).sort();
  const expectSeeded = plan.filter(e => !e.updatable && e.fate === 'seed').map(e => e.path).sort();
  const expectKept = plan.filter(e => !e.updatable && e.fate === 'keep').map(e => e.path).sort();
  assert.deepEqual(result.updated.slice().sort(), expectUpdated);
  assert.deepEqual(result.seeded.slice().sort(), expectSeeded);
  assert.deepEqual(result.kept.slice().sort(), expectKept);

  // And the disk matches the fates
  assert.equal(read(dst, 'SKILL.md').includes('v2'), true);
  assert.equal(read(dst, 'references/area-index.md'), 'precious project index');
  assert.equal(read(dst, 'references/maintenance.md'), 'new doctrine');
  assert.equal(read(dst, 'references/areas/starter.md'), 'starter');
});
