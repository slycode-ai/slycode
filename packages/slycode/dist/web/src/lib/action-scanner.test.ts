/**
 * Tests for writeActionsFromConfig — the surgical actions write path
 * (card-1784368804712: modal save must never delete or revert files it
 * didn't knowingly change).
 *
 * The web/ package doesn't ship a configured test runner, so this file is a
 * self-contained script. Run via the tsx binary that lives in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/action-scanner.test.ts
 *
 * Exits 0 on success, 1 on any assertion failure. Keep it lightweight —
 * node:test/node:assert only, no framework deps.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  writeActionsFromConfig,
  scanActionFilesDetailed,
  parseActionFile,
  toParsedAction,
} from './action-scanner';
import type { SlyActionsConfig } from './sly-actions';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-scanner-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

// Hand-formatted file: unquoted label, so any rewrite changes the bytes.
const ALPHA_MD = `---
name: alpha
version: 2.3.0
label: Alpha
description: First action
placement: both
scope: global
classes:
  backlog: 10
---

Prompt for alpha
`;

const BETA_MD = `---
name: beta
version: 1.1.0
label: "Beta"
description: "Second action"
placement: toolbar
scope: global
---

Prompt for beta
`;

const BROKEN_MD = `---
name: broken
label: "Never closed frontmatter
`;

function writeFixture(name: string, content: string): string {
  const p = path.join(dir, `${name}.md`);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

function cmd(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: name,
    label: name[0].toUpperCase() + name.slice(1),
    description: `${name} description`,
    placement: 'both',
    scope: 'global',
    projects: [],
    prompt: `Prompt for ${name}`,
    ...overrides,
  };
}

function alphaCmdMatchingDisk() {
  // Matches ALPHA_MD semantics exactly.
  return cmd('alpha', { label: 'Alpha', description: 'First action', prompt: 'Prompt for alpha' });
}

function configOf(commands: Record<string, unknown>, classAssignments: Record<string, string[]> = {}): SlyActionsConfig {
  return { version: '4.0', commands, classAssignments } as unknown as SlyActionsConfig;
}

test('parse-failing file survives an intent save untouched', () => {
  writeFixture('alpha', ALPHA_MD);
  const brokenPath = writeFixture('broken', BROKEN_MD);

  writeActionsFromConfig(
    configOf({ alpha: alphaCmdMatchingDisk() }, { backlog: ['alpha'] }),
    { changedIds: ['alpha'] },
    dir,
  );

  assert.equal(fs.readFileSync(brokenPath, 'utf-8'), BROKEN_MD, 'broken.md must survive byte-identical');
});

test('parse-failing file survives a legacy (intent-less) save untouched', () => {
  writeFixture('alpha', ALPHA_MD);
  const brokenPath = writeFixture('broken', BROKEN_MD);

  writeActionsFromConfig(
    configOf({ alpha: alphaCmdMatchingDisk() }, { backlog: ['alpha'] }),
    undefined,
    dir,
  );

  assert.ok(fs.existsSync(brokenPath), 'broken.md must not be deleted by legacy saves');
  assert.equal(fs.readFileSync(brokenPath, 'utf-8'), BROKEN_MD);
});

test('parse-failing file is never deleted even when explicitly named in deletedIds', () => {
  const brokenPath = writeFixture('broken', BROKEN_MD);

  writeActionsFromConfig(configOf({}), { deletedIds: ['broken'] }, dir);

  assert.ok(fs.existsSync(brokenPath), 'failed files are excluded from explicit deletes too');
});

test('file on disk but absent from snapshot survives (assistant-created during cache window)', () => {
  writeFixture('alpha', ALPHA_MD);
  const betaPath = writeFixture('beta', BETA_MD);

  // Client snapshot only knows alpha (stale — beta was just created on disk).
  writeActionsFromConfig(
    configOf({ alpha: alphaCmdMatchingDisk() }, { backlog: ['alpha'] }),
    { changedIds: ['alpha'] },
    dir,
  );

  assert.ok(fs.existsSync(betaPath), 'beta.md must survive');
  assert.equal(fs.readFileSync(betaPath, 'utf-8'), BETA_MD, 'beta.md must not be reverted');
});

test('explicit deletedIds removes the file and nothing else', () => {
  writeFixture('alpha', ALPHA_MD);
  const betaPath = writeFixture('beta', BETA_MD);

  writeActionsFromConfig(
    configOf({ alpha: alphaCmdMatchingDisk() }, { backlog: ['alpha'] }),
    { deletedIds: ['beta'] },
    dir,
  );

  assert.ok(!fs.existsSync(betaPath), 'beta.md should be deleted');
  assert.ok(fs.existsSync(path.join(dir, 'alpha.md')), 'alpha.md untouched');
});

test('unchanged action is not rewritten (hand formatting preserved)', () => {
  const alphaPath = writeFixture('alpha', ALPHA_MD);

  writeActionsFromConfig(
    configOf({ alpha: alphaCmdMatchingDisk() }, { backlog: ['alpha'] }),
    { changedIds: ['alpha'] },
    dir,
  );

  assert.equal(
    fs.readFileSync(alphaPath, 'utf-8'),
    ALPHA_MD,
    'semantically identical action must not be reserialized',
  );
});

test('changed action is written and disk version is preserved', () => {
  const alphaPath = writeFixture('alpha', ALPHA_MD);

  writeActionsFromConfig(
    configOf(
      { alpha: cmd('alpha', { label: 'Alpha v2', description: 'First action', prompt: 'Prompt for alpha' }) },
      { backlog: ['alpha'] },
    ),
    { changedIds: ['alpha'] },
    dir,
  );

  const parsed = parseActionFile(fs.readFileSync(alphaPath, 'utf-8'));
  assert.ok(parsed);
  const action = toParsedAction(parsed.frontmatter, parsed.body);
  assert.equal(action.label, 'Alpha v2');
  assert.equal(action.version, '2.3.0', 'version must be preserved from disk');
  assert.deepEqual(action.classes, { backlog: 10 }, 'classes preserved from disk');
});

test('class-only change adjusts that class but keeps disk fields (no stale-field revert)', () => {
  const alphaPath = writeFixture('alpha', ALPHA_MD);

  // Client snapshot carries a STALE label for alpha; only the design class
  // changed. The stale label must NOT reach disk.
  writeActionsFromConfig(
    configOf(
      { alpha: cmd('alpha', { label: 'Stale Label', description: 'stale', prompt: 'stale' }) },
      { backlog: ['alpha'], design: ['alpha'] },
    ),
    { changedClasses: ['design'] },
    dir,
  );

  const parsed = parseActionFile(fs.readFileSync(alphaPath, 'utf-8'));
  assert.ok(parsed);
  const action = toParsedAction(parsed.frontmatter, parsed.body);
  assert.equal(action.label, 'Alpha', 'disk fields survive class-only saves');
  assert.equal(action.prompt, 'Prompt for alpha');
  assert.deepEqual(action.classes, { backlog: 10, design: 10 });
});

test('class-only change can remove an action from the class', () => {
  const alphaPath = writeFixture('alpha', ALPHA_MD);

  writeActionsFromConfig(
    configOf({ alpha: alphaCmdMatchingDisk() }, { backlog: [] }),
    { changedClasses: ['backlog'] },
    dir,
  );

  const parsed = parseActionFile(fs.readFileSync(alphaPath, 'utf-8'));
  assert.ok(parsed);
  const action = toParsedAction(parsed.frontmatter, parsed.body);
  assert.deepEqual(action.classes, {}, 'backlog assignment removed');
});

test('legacy payload writes diffs but deletes nothing', () => {
  writeFixture('alpha', ALPHA_MD);
  const betaPath = writeFixture('beta', BETA_MD);

  // Legacy client PUTs a snapshot that lacks beta entirely (the old code
  // would have deleted beta.md here).
  writeActionsFromConfig(
    configOf(
      { alpha: cmd('alpha', { label: 'Alpha v3', description: 'First action', prompt: 'Prompt for alpha' }) },
      { backlog: ['alpha'] },
    ),
    undefined,
    dir,
  );

  assert.ok(fs.existsSync(betaPath), 'legacy saves must never delete');
  const parsed = parseActionFile(fs.readFileSync(path.join(dir, 'alpha.md'), 'utf-8'));
  assert.ok(parsed);
  assert.equal(toParsedAction(parsed.frontmatter, parsed.body).label, 'Alpha v3');
});

test('new action (createCommand) is written with default version and no classes', () => {
  writeActionsFromConfig(
    configOf({ gamma: cmd('gamma') }),
    { changedIds: ['gamma'] },
    dir,
  );

  const { actions, failedFiles } = scanActionFilesDetailed(dir);
  assert.equal(failedFiles.length, 0);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].name, 'gamma');
  assert.equal(actions[0].version, '1.0.0');
  assert.deepEqual(actions[0].classes, {});
});

test('traversal-shaped names in intent are ignored', () => {
  const outside = path.join(dir, '..', `escape-target-${path.basename(dir)}.md`);
  fs.writeFileSync(outside, 'outside', 'utf-8');
  try {
    writeActionsFromConfig(
      configOf({}),
      { deletedIds: [`../escape-target-${path.basename(dir)}`] },
      dir,
    );
    assert.ok(fs.existsSync(outside), 'delete must not escape the actions dir');
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

test('scanActionFilesDetailed reports failed files and parses the rest', () => {
  writeFixture('alpha', ALPHA_MD);
  writeFixture('broken', BROKEN_MD);

  const { actions, failedFiles } = scanActionFilesDetailed(dir);
  assert.deepEqual(failedFiles, ['broken.md']);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].name, 'alpha');
});
