import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// StateManager resolves SLYCODE_HOME at call time (getWorkspaceRoot), so a
// temp workspace per test isolates the state file and the registry.
let home: string;
const originalHome = process.env.SLYCODE_HOME;

function writeRegistry(projects: Array<{ id: string; name: string; path: string }>): void {
  fs.mkdirSync(path.join(home, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(home, 'projects', 'registry.json'), JSON.stringify({ projects }));
}

function readState(): any {
  return JSON.parse(fs.readFileSync(path.join(home, 'messaging-state.json'), 'utf-8'));
}

async function freshManager() {
  // Cache-bust the module so each test builds a StateManager against its own home.
  const mod = await import(`./state.js?t=${Date.now()}-${Math.random()}`);
  return new mod.StateManager() as import('./state.js').StateManager;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'state-voice-test-'));
  process.env.SLYCODE_HOME = home;
  writeRegistry([
    { id: 'alpha', name: 'Alpha', path: '/tmp/alpha' },
    { id: 'beta', name: 'Beta', path: '/tmp/beta' },
  ]);
  fs.writeFileSync(path.join(home, 'messaging-state.json'), JSON.stringify({
    targetType: 'global',
    voiceId: 'TOPLEVEL000000000000',
    voiceName: 'Top',
    responseMode: 'text',
    voiceTone: null,
    targetPrefs: {},
  }));
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.SLYCODE_HOME;
  else process.env.SLYCODE_HOME = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
});

test('setProjectVoice writes only the project entry and never the top-level mirror', async () => {
  const state = await freshManager();
  state.setProjectVoice('alpha', { id: 'ALPHAVOICE0000000000', name: 'Alpha Voice' });

  const saved = readState();
  assert.equal(saved.voiceId, 'TOPLEVEL000000000000', 'top-level voice must be untouched');
  assert.equal(saved.voiceName, 'Top');
  assert.deepEqual(saved.targetPrefs.alpha.voice, { id: 'ALPHAVOICE0000000000', name: 'Alpha Voice' });
  // beta was anchored to the top-level at load and must still be the top-level
  assert.equal(saved.targetPrefs.beta.voice.id, 'TOPLEVEL000000000000');

  assert.deepEqual(state.getProjectVoice('alpha'), {
    stored: { id: 'ALPHAVOICE0000000000', name: 'Alpha Voice' },
    effective: { id: 'ALPHAVOICE0000000000', name: 'Alpha Voice' },
    source: 'project',
  });
  // resolveContextVoice sees the new project voice for a session in that project
  assert.equal(state.resolveContextVoice({ session: 'alpha:claude:card:card-1' })?.id, 'ALPHAVOICE0000000000');
  assert.equal(state.resolveContextVoice({ session: 'beta:claude:global' })?.id, 'TOPLEVEL000000000000');
});

test('clearProjectVoice removes the override and reports the inherited default', async () => {
  const state = await freshManager();
  state.setProjectVoice('alpha', { id: 'ALPHAVOICE0000000000', name: 'Alpha Voice' });
  state.clearProjectVoice('alpha');

  const v = state.getProjectVoice('alpha');
  assert.equal(v.stored, null);
  assert.equal(v.source, 'inherited');
  assert.equal(v.effective?.id, 'TOPLEVEL000000000000');
  assert.equal(readState().targetPrefs.alpha?.voice, undefined);
});

test('resolveProjectIdFrom accepts id, display name and session names', async () => {
  const state = await freshManager();
  assert.equal(state.resolveProjectIdFrom({ projectId: 'alpha' }), 'alpha');
  assert.equal(state.resolveProjectIdFrom({ projectId: 'Beta' }), 'beta');
  assert.equal(state.resolveProjectIdFrom({ session: 'alpha:codex:card:card-9' }), 'alpha');
  assert.equal(state.resolveProjectIdFrom({ session: 'global' }), null);
  assert.equal(state.resolveProjectIdFrom({ projectId: 'nope' }), null);
});

test('persistence failure surfaces to the caller instead of being logged away', async () => {
  const state = await freshManager();
  // Replace the state file with a directory so the atomic rename fails.
  const stateFile = path.join(home, 'messaging-state.json');
  fs.rmSync(stateFile);
  fs.mkdirSync(stateFile);
  assert.throws(() => state.setProjectVoice('alpha', { id: 'X', name: 'X' }));
  assert.throws(() => state.clearProjectVoice('alpha'));
});
