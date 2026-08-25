/**
 * Tests for the read-only deploy planners (feature 084 — deploy review
 * modal): planStoreAssetDeploy / planMasterAssetDeploy must report per-file
 * fates against a project's actual on-disk state without writing anything.
 *
 * Self-contained script (no test runner configured in web/). Run via:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/asset-scanner-plan.test.ts
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

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-plan-fixture-'));
process.env.SLYCODE_HOME = ROOT;

function writeFiles(baseDir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(baseDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

const SKILL_MD =
  '---\nname: demo\nversion: 2.0.0\nupdatable:\n  - references/maintenance.md\n---\nnew body\n';

// Store skill with a declared updatable file + template references
writeFiles(path.join(ROOT, 'store', 'skills', 'demo'), {
  'SKILL.md': SKILL_MD,
  'references/maintenance.md': 'doctrine v2\n',
  'references/area-index.md': 'EMPTY TEMPLATE INDEX\n',
  'references/areas/starter.md': 'starter template\n',
});
// Store agent (single file)
writeFiles(path.join(ROOT, 'store', 'agents'), { 'helper.md': 'agent v2\n' });

// Project A: no copy at all
const PROJECT_A = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-plan-projA-'));

// Project B: has an older copy with curated project-owned data
const PROJECT_B = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-plan-projB-'));
writeFiles(path.join(PROJECT_B, '.claude', 'skills', 'demo'), {
  'SKILL.md': '---\nname: demo\nversion: 1.0.0\n---\nold body\n',
  'references/maintenance.md': 'doctrine v2\n',              // identical — unchanged
  'references/area-index.md': 'CURATED PROJECT INDEX\n',     // differs but undeclared — keep
  // no references/areas/starter.md — seed
});
writeFiles(path.join(PROJECT_B, '.claude', 'agents'), { 'helper.md': 'agent v1\n' });

test('planStoreAssetDeploy — fresh project plans everything as seed, exists=false', async () => {
  const { planStoreAssetDeploy } = await import('./asset-scanner');

  const plan = planStoreAssetDeploy(PROJECT_A, 'claude', 'skill', 'demo');
  assert.equal(plan.targetDir, '.claude/skills/demo');
  assert.equal(plan.exists, false);
  assert.equal(plan.files.length, 4);
  assert.deepEqual([...new Set(plan.files.map(f => f.fate))], ['seed']);
  assert.equal(plan.files[0].path, 'SKILL.md');       // SKILL.md first
  assert.equal(plan.files[0].updatable, true);
  // Read-only: nothing was created
  assert.equal(fs.existsSync(path.join(PROJECT_A, '.claude')), false);
});

test('planStoreAssetDeploy — installed project gets actual per-file fates', async () => {
  const { planStoreAssetDeploy } = await import('./asset-scanner');

  const plan = planStoreAssetDeploy(PROJECT_B, 'claude', 'skill', 'demo');
  assert.equal(plan.exists, true);
  const fates = Object.fromEntries(plan.files.map(f => [f.path, f.fate]));
  assert.deepEqual(fates, {
    'SKILL.md': 'overwrite',
    'references/maintenance.md': 'unchanged',
    'references/area-index.md': 'keep',
    'references/areas/starter.md': 'seed',
  });
  // Curated file untouched by planning
  assert.equal(
    fs.readFileSync(path.join(PROJECT_B, '.claude', 'skills', 'demo', 'references', 'area-index.md'), 'utf-8'),
    'CURATED PROJECT INDEX\n',
  );
});

test('planStoreAssetDeploy — agent asset yields a single-file plan', async () => {
  const { planStoreAssetDeploy } = await import('./asset-scanner');

  const fresh = planStoreAssetDeploy(PROJECT_A, 'claude', 'agent', 'helper');
  assert.equal(fresh.exists, false);
  assert.deepEqual(fresh.files, [{ path: 'helper.md', fate: 'seed', updatable: true }]);

  const installed = planStoreAssetDeploy(PROJECT_B, 'claude', 'agent', 'helper');
  assert.equal(installed.exists, true);
  assert.deepEqual(installed.files, [{ path: 'helper.md', fate: 'overwrite', updatable: true }]);
});

test('planStoreAssetDeploy — mcp assets are refused (config merge, no file plan)', async () => {
  const { planStoreAssetDeploy } = await import('./asset-scanner');
  assert.throws(() => planStoreAssetDeploy(PROJECT_A, 'claude', 'mcp', 'anything'));
});

test('planMasterAssetDeploy — plans master-repo skills with the same gating', async () => {
  const { planMasterAssetDeploy } = await import('./asset-scanner');

  const MASTER = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-plan-master-'));
  writeFiles(path.join(MASTER, '.claude', 'skills', 'demo'), {
    'SKILL.md': SKILL_MD,
    'references/maintenance.md': 'doctrine v2\n',
  });

  const plan = planMasterAssetDeploy(MASTER, PROJECT_B, 'skill', 'demo');
  assert.equal(plan.targetDir, '.claude/skills/demo');
  const fates = Object.fromEntries(plan.files.map(f => [f.path, f.fate]));
  assert.deepEqual(fates, {
    'SKILL.md': 'overwrite',
    'references/maintenance.md': 'unchanged',
  });
});

test('plan matches what copyStoreAssetToProject then does', async () => {
  const { planStoreAssetDeploy, copyStoreAssetToProject } = await import('./asset-scanner');

  const PROJECT_C = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-plan-projC-'));
  writeFiles(path.join(PROJECT_C, '.claude', 'skills', 'demo'), {
    'SKILL.md': 'old\n',
    'references/area-index.md': 'precious\n',
  });

  const plan = planStoreAssetDeploy(PROJECT_C, 'claude', 'skill', 'demo');
  copyStoreAssetToProject(PROJECT_C, 'claude', 'skill', 'demo');

  const dst = path.join(PROJECT_C, '.claude', 'skills', 'demo');
  for (const f of plan.files) {
    const abs = path.join(dst, ...f.path.split('/'));
    switch (f.fate) {
      case 'overwrite':
      case 'unchanged':
      case 'seed': {
        // Copied: content now matches the store
        const storeAbs = path.join(ROOT, 'store', 'skills', 'demo', ...f.path.split('/'));
        assert.equal(fs.readFileSync(abs, 'utf-8'), fs.readFileSync(storeAbs, 'utf-8'), f.path);
        break;
      }
      case 'keep':
        assert.equal(fs.readFileSync(abs, 'utf-8'), 'precious\n', f.path);
        break;
    }
  }
});
