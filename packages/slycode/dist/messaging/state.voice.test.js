import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// StateManager resolves SLYCODE_HOME at call time (getWorkspaceRoot), so a
// temp workspace per test isolates the state file and the registry.
let home;
const originalHome = process.env.SLYCODE_HOME;
function writeRegistry(projects) {
    fs.mkdirSync(path.join(home, 'projects'), { recursive: true });
    fs.writeFileSync(path.join(home, 'projects', 'registry.json'), JSON.stringify({ projects }));
}
function readState() {
    return JSON.parse(fs.readFileSync(path.join(home, 'messaging-state.json'), 'utf-8'));
}
async function freshManager() {
    // Cache-bust the module so each test builds a StateManager against its own home.
    const mod = await import(`./state.js?t=${Date.now()}-${Math.random()}`);
    return new mod.StateManager();
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
    if (originalHome === undefined)
        delete process.env.SLYCODE_HOME;
    else
        process.env.SLYCODE_HOME = originalHome;
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
test('a failed strict save rolls the project back: memory never claims a voice the file lacks (fix loop)', async () => {
    const state = await freshManager();
    state.setProjectVoice('alpha', { id: 'kore', name: 'Kore', provider: 'gemini' });
    const before = { el: state.getProjectVoice('alpha', 'elevenlabs'), gem: state.getProjectVoice('alpha', 'gemini') };
    const stateFile = path.join(home, 'messaging-state.json');
    fs.rmSync(stateFile);
    fs.mkdirSync(stateFile);
    assert.throws(() => state.setProjectVoice('alpha', { id: 'voice_new', name: 'New', kind: 'custom', provider: 'gemini' }));
    assert.throws(() => state.setProjectVoice('alpha', { id: 'ELNEW000000000000000', name: 'El New' }));
    assert.throws(() => state.clearProjectVoice('alpha', 'gemini'));
    assert.deepEqual(state.getProjectVoice('alpha', 'gemini'), before.gem, 'Gemini slot restored after failed set and clear');
    assert.deepEqual(state.getProjectVoice('alpha', 'elevenlabs'), before.el, 'ElevenLabs slot restored');
    // A project with no prefs entry stays without one.
    assert.throws(() => state.setProjectVoice('gamma-unregistered', { id: 'kore', name: 'Kore', provider: 'gemini' }));
    assert.equal(state.getProjectVoice('gamma-unregistered', 'gemini').stored, null);
});
// --- Per-provider voice slots (feature 087) ---------------------------------
test('a Gemini slot is separate: ElevenLabs legacy fields are untouched and stay readable by older builds', async () => {
    const state = await freshManager();
    state.setProjectVoice('alpha', { id: 'kore', name: 'Kore', kind: 'prebuilt', provider: 'gemini' });
    const saved = readState();
    assert.deepEqual(saved.targetPrefs.alpha.voices.gemini, { id: 'kore', name: 'Kore', kind: 'prebuilt' });
    assert.equal(saved.targetPrefs.alpha.voice.id, 'TOPLEVEL000000000000', 'ElevenLabs slot stays in the legacy field');
    assert.equal(saved.voiceId, 'TOPLEVEL000000000000', 'legacy top-level voice still written');
    assert.equal(saved.targetPrefs.alpha.voices.elevenlabs, undefined, 'no second copy of the ElevenLabs slot');
    assert.equal(state.getProjectVoice('alpha', 'gemini').effective?.id, 'kore');
    assert.equal(state.getProjectVoice('alpha', 'elevenlabs').effective?.id, 'TOPLEVEL000000000000');
    assert.equal(state.getProjectVoice('beta', 'gemini').effective, null, 'beta has no Gemini voice and no install default');
});
test('slots per provider: switching providers rewrites nothing and both slots survive a reload', async () => {
    let state = await freshManager();
    state.setProjectVoice('alpha', { id: 'ALPHAVOICE0000000000', name: 'Alpha EL' });
    state.setProjectVoice('alpha', { id: 'sulafat', name: 'Sulafat', provider: 'gemini' });
    state = await freshManager();
    const slots = state.getProjectVoiceSlots('alpha');
    assert.equal(slots.elevenlabs.stored?.id, 'ALPHAVOICE0000000000');
    assert.equal(slots.gemini.stored?.id, 'sulafat');
    state.clearProjectVoice('alpha', 'gemini');
    assert.equal(state.getProjectVoice('alpha', 'gemini').stored, null);
    assert.equal(state.getProjectVoice('alpha', 'elevenlabs').stored?.id, 'ALPHAVOICE0000000000', 'clearing one provider leaves the other');
});
test('Telegram set mirrors into the install default; project clear keeps it; global clear removes it — per provider', async () => {
    for (const provider of ['elevenlabs', 'gemini']) {
        const state = await freshManager();
        state.selectProject('alpha');
        state.setVoice('MIRROR', 'Mirrored', provider);
        assert.equal(state.getDefaultVoice(provider)?.id, 'MIRROR', `${provider}: set mirrors`);
        assert.equal(state.getProjectVoice('alpha', provider).stored?.id, 'MIRROR');
        state.clearVoice(provider);
        assert.equal(state.getProjectVoice('alpha', provider).stored, null, `${provider}: project clear removes the project slot`);
        assert.equal(state.getDefaultVoice(provider)?.id, 'MIRROR', `${provider}: project clear keeps the install default`);
        state.selectGlobal();
        state.clearVoice(provider);
        assert.equal(state.getDefaultVoice(provider), null, `${provider}: global clear removes the install default`);
    }
});
test('anchoring works per slot: a new project copies the current Gemini install default', async () => {
    fs.writeFileSync(path.join(home, 'messaging-state.json'), JSON.stringify({
        targetType: 'global', voiceId: 'TOPLEVEL000000000000', voiceName: 'Top', targetPrefs: {},
        defaultVoices: { gemini: { id: 'kore', name: 'Kore' } },
    }));
    const state = await freshManager();
    const saved = readState();
    assert.deepEqual(saved.targetPrefs.beta.voices.gemini, { id: 'kore', name: 'Kore' });
    assert.equal(saved.targetPrefs.beta.voice.id, 'TOPLEVEL000000000000');
    assert.equal(state.getProjectVoice('beta', 'gemini').source, 'project', 'anchored, so later default changes do not leak');
});
test('provider switch state persists; a pre-087 file reads as no switch, revision 0', async () => {
    const state = await freshManager();
    assert.deepEqual(state.getTtsProviderChoice(), { provider: null, revision: 0 });
    fs.writeFileSync(path.join(home, 'messaging-state.json'), JSON.stringify({ ...readState(), ttsProvider: 'gemini', ttsProviderRevision: 7 }));
    assert.deepEqual((await freshManager()).getTtsProviderChoice(), { provider: 'gemini', revision: 7 });
    fs.writeFileSync(path.join(home, 'messaging-state.json'), JSON.stringify({ ...readState(), ttsProvider: 'bogus' }));
    assert.equal((await freshManager()).getTtsProviderChoice().provider, null, 'unknown provider ignored');
});
test('session and context resolution report where the voice came from, per provider', async () => {
    const state = await freshManager();
    state.setProjectVoice('alpha', { id: 'puck', name: 'Puck', provider: 'gemini' });
    assert.deepEqual(state.resolveContextSlot({ session: 'alpha:claude:card:card-1' }, 'gemini'), { voice: { id: 'puck', name: 'Puck' }, source: 'project' });
    assert.deepEqual(state.resolveContextSlot({ session: 'beta:claude:global' }, 'gemini'), { voice: null, source: null });
    assert.deepEqual(state.resolveContextSlot({ session: 'beta:claude:global' }, 'elevenlabs').source, 'project', 'beta was anchored to the top-level ElevenLabs voice');
    assert.equal(state.resolveSessionSlot('alpha:codex:card:card-2', 'gemini').voice?.id, 'puck');
});
//# sourceMappingURL=state.voice.test.js.map