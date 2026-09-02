import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { preflightFile, FileSendError, SENSITIVE_PATH_PATTERNS } from './file-send.js';

// Builds a throwaway home-like tree so the deny-list is exercised against
// real resolved paths (preflightFile realpaths before matching).
function makeTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-send-test-'));
  const files: Record<string, string> = {
    '.local/share/opencode/auth.json': '{"openai":{"type":"oauth"}}',
    '.local/share/opencode/opencode.db': 'sqlite',
    '.config/opencode/opencode.jsonc': '{}',
    '.claude/.credentials.json': '{}',
    '.codex/auth.json': '{}',
    'project/notes.txt': 'hello',
    'project/.claude/skills/foo/SKILL.md': '# skill',
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

async function expectDenied(p: string) {
  await assert.rejects(
    () => preflightFile(p),
    (err: unknown) => err instanceof FileSendError && err.code === 'denied_path' && err.httpStatus === 403,
    `expected denied_path for ${p}`,
  );
}

test('deny-list refuses OpenCode credential and config locations', async () => {
  const root = makeTree();
  try {
    await expectDenied(path.join(root, '.local/share/opencode/auth.json'));
    await expectDenied(path.join(root, '.local/share/opencode/opencode.db'));
    await expectDenied(path.join(root, '.config/opencode/opencode.jsonc'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deny-list refuses Claude and Codex credential stores', async () => {
  const root = makeTree();
  try {
    await expectDenied(path.join(root, '.claude/.credentials.json'));
    await expectDenied(path.join(root, '.codex/auth.json'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deny-list is applied to the realpath, so a symlink cannot bypass it', async () => {
  const root = makeTree();
  try {
    const link = path.join(root, 'project', 'innocent.json');
    fs.symlinkSync(path.join(root, '.local/share/opencode/auth.json'), link);
    await expectDenied(link);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ordinary project files (including a project .claude/ skill) still pass', async () => {
  const root = makeTree();
  try {
    const notes = await preflightFile(path.join(root, 'project/notes.txt'));
    assert.equal(notes.bytes, 5);
    assert.equal(notes.kind, null);
    const skill = await preflightFile(path.join(root, 'project/.claude/skills/foo/SKILL.md'));
    assert.ok(skill.absolutePath.endsWith('SKILL.md'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('relative paths resolve against the caller cwd', async () => {
  const root = makeTree();
  try {
    await expectDenied(path.join(root, 'project', '..', '.local/share/opencode/auth.json'));
    const ok = await preflightFile('notes.txt', path.join(root, 'project'));
    assert.equal(ok.bytes, 5);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every deny pattern is anchored to a path separator or start', () => {
  for (const re of SENSITIVE_PATH_PATTERNS) {
    assert.match(re.source, /^(\^|\\\/|\(\?:\^\|\\\/\))/, `unanchored pattern: ${re}`);
  }
});
