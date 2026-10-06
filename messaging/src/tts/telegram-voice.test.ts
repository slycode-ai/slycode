/**
 * Telegram /voice command (tts/telegram-voice.ts, feature 087): the same
 * resolution as the CLI (no silent first match), stamped pick lists, and the
 * provider/revision recheck before any write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceCommands } from './telegram-voice.js';
import { VoiceLookupError, VoicesUnavailableError } from './errors.js';
import type { TtsProvider, TtsProviderId, VoiceRef } from './provider.js';

type Sent = { kind: 'text' | 'raw' | 'list'; text?: string; voices?: Array<{ id: string; name: string }>; meta?: { provider: string; revision: number } };

function setup(resolve: (v: string, ctx: { switchTo: (id: TtsProviderId) => void }) => Promise<VoiceRef>, opts: { list?: boolean } = {}) {
  let active: TtsProviderId = 'gemini';
  let revision = 3;
  const switchTo = (id: TtsProviderId) => { active = id; revision += 1; };
  const sent: Sent[] = [];
  const writes: Array<{ id: string; name: string; provider: string; expiresAt?: string; kind?: string }> = [];
  const provider = {
    id: 'gemini', label: 'Gemini',
    resolveVoiceValue: (v: string) => resolve(v, { switchTo }),
    envDefaultVoice: () => null,
    builtinDefaultVoice: () => ({ provider: 'gemini', id: 'kore', name: 'Kore' }),
  } as unknown as TtsProvider;
  const channel = {
    sendText: async (text: string) => { sent.push({ kind: 'text', text }); },
    sendTextRaw: async (text: string) => { sent.push({ kind: 'raw', text }); },
    sendTyping: async () => {},
    ...(opts.list === false ? {} : {
      sendVoiceList: async (voices: Array<{ id: string; name: string }>, meta?: { provider: string; revision: number }) => { sent.push({ kind: 'list', voices, meta }); },
    }),
  };
  const tts = {
    requireActive: () => provider,
    active: () => ({ id: active, provider: active === 'gemini' ? provider : null }),
    revision: () => revision,
    health: () => ({ warnings: [] }),
  };
  const state = {
    getVoice: () => null,
    setVoice: (id: string, name: string, p: string, extra?: { kind?: string; expiresAt?: string }) => {
      writes.push({ id, name, provider: p, ...(extra?.expiresAt ? { expiresAt: extra.expiresAt, kind: extra.kind } : {}) });
    },
    clearVoice: () => {},
  };
  const cmds = createVoiceCommands({ channel: channel as never, tts: tts as never, state: state as never });
  return { cmds, sent, writes, switchTo };
}

const row = (id: string, name: string) => ({ voice_id: id, name, category: 'premade', labels: { accent: 'australian' } });

test('/voice <exact name> sets the voice the resolver picked', async () => {
  const seen: string[] = [];
  const { cmds, sent, writes } = setup(async (v) => { seen.push(v); return { provider: 'gemini', id: 'sulafat', name: 'Sulafat' }; });
  await cmds.onCommand('  Sulafat ');
  assert.deepEqual(seen, ['Sulafat'], 'the trimmed query goes to resolveVoiceValue, like the CLI');
  assert.deepEqual(writes, [{ id: 'sulafat', name: 'Sulafat', provider: 'gemini' }]);
  assert.match(sent.at(-1)!.text!, /Voice set to Sulafat/);
});

test('/voice with an ambiguous name never takes the first match: it lists the candidates, stamped', async () => {
  const { cmds, sent, writes } = setup(async () => {
    throw new VoiceLookupError('voice_ambiguous', 'many', [row('lib-1', 'Charlie'), row('lib-2', 'Charlie')]);
  });
  await cmds.onCommand('Charlie');
  assert.equal(writes.length, 0, 'nothing written');
  const list = sent.find((s) => s.kind === 'list')!;
  assert.deepEqual(list.voices!.map((v) => v.id), ['lib-1', 'lib-2']);
  assert.deepEqual(list.meta, { provider: 'gemini', revision: 3 });
  assert.match(sent[0].text!, /matches 2 voices/);
});

test('/voice near miss shows closest matches; none at all says so', async () => {
  const near = setup(async () => { throw new VoiceLookupError('voice_not_found', 'nope', [row('v1', 'Alpha Voice')]); });
  await near.cmds.onCommand('alpha');
  assert.match(near.sent[0].text!, /No voice named exactly "alpha"/);
  assert.equal(near.sent[1].kind, 'list');
  assert.equal(near.writes.length, 0);

  const none = setup(async () => { throw new VoiceLookupError('voice_not_found', 'nope', []); });
  await none.cmds.onCommand('zzz');
  assert.deepEqual(none.sent.map((s) => s.kind), ['text']);
  assert.match(none.sent[0].text!, /No voices found for "zzz"/);
});

test('/voice without a list-capable channel prints ids to select by', async () => {
  const { cmds, sent } = setup(async () => {
    throw new VoiceLookupError('voice_ambiguous', 'many', [row('lib-1', 'Charlie'), row('lib-2', 'Charlie')]);
  }, { list: false });
  await cmds.onCommand('Charlie');
  assert.equal(sent.length, 1);
  assert.match(sent[0].text!, /lib-1[\s\S]*lib-2[\s\S]*\/voice <id>/);
});

test('/voice: a provider switch during the lookup is refused before the write', async () => {
  const { cmds, sent, writes } = setup(async (_v, { switchTo }) => {
    switchTo('elevenlabs');
    return { provider: 'gemini', id: 'sulafat', name: 'Sulafat' };
  });
  await cmds.onCommand('Sulafat');
  assert.equal(writes.length, 0);
  assert.match(sent.at(-1)!.text!, /provider changed/);
});

test('/voice: a list built from a lookup that straddled a switch carries the pre-switch revision, so its picks are refused', async () => {
  const { cmds, sent, writes } = setup(async (_v, { switchTo }) => {
    switchTo('elevenlabs');
    switchTo('gemini'); // back to the same provider, newer revision
    throw new VoiceLookupError('voice_ambiguous', 'many', [row('lib-1', 'Charlie'), row('lib-2', 'Charlie')]);
  });
  await cmds.onCommand('Charlie');
  const list = sent.find((s) => s.kind === 'list')!;
  assert.deepEqual(list.meta, { provider: 'gemini', revision: 3 }, 'stamped with the values captured before the await');
  await cmds.onSelect('lib-1', 'Charlie', { provider: list.meta!.provider, revision: list.meta!.revision, stale: false });
  assert.equal(writes.length, 0);
  assert.match(sent.at(-1)!.text!, /out of date/);
});

test('/voice reports an unreachable voice service plainly', async () => {
  const { cmds, sent, writes } = setup(async () => { throw new VoicesUnavailableError('Gemini voices unavailable: ECONNRESET'); });
  await cmds.onCommand('Sulafat');
  assert.equal(writes.length, 0);
  assert.match(sent.at(-1)!.text!, /unavailable right now: Gemini voices unavailable: ECONNRESET/);
});

test('voice picks: current list sets; stale, other-provider or older-revision picks do not', async () => {
  const { cmds, writes, sent } = setup(async () => ({ provider: 'gemini', id: 'x', name: 'x' }));
  await cmds.onSelect('v1', 'Alpha', { provider: 'gemini', revision: 3, stale: false });
  assert.deepEqual(writes, [{ id: 'v1', name: 'Alpha', provider: 'gemini' }]);
  for (const pick of [
    { provider: 'gemini', revision: 3, stale: true },
    { provider: 'elevenlabs', revision: 3, stale: false },
    { provider: 'gemini', revision: 2, stale: false },
    { provider: null, revision: null, stale: false },
  ]) {
    await cmds.onSelect('v2', 'Beta', pick);
  }
  assert.equal(writes.length, 1);
  assert.equal(sent.filter((s) => /out of date/.test(s.text ?? '')).length, 4);
});

test('/voice <designed voice> keeps its kind and expiry so expiry warnings work (phase 4)', async () => {
  const { cmds, writes } = setup(async () => ({ provider: 'gemini', id: 'voice_ab12', name: 'Astronomer', kind: 'custom', expiresAt: '2027-10-01T00:00:00Z' }));
  await cmds.onCommand('Astronomer');
  assert.deepEqual(writes, [{ id: 'voice_ab12', name: 'Astronomer', provider: 'gemini', expiresAt: '2027-10-01T00:00:00Z', kind: 'custom' }]);
});

test('designed voices keep kind + expiry through the pick list and the button press (fix loop)', async () => {
  const { cmds, sent, writes } = setup(async () => {
    throw new VoiceLookupError('voice_ambiguous', 'two', [
      { voice_id: 'voice_ab12', name: 'Astro', category: 'custom', labels: {}, expiresAt: '2027-10-01T00:00:00Z' },
      { voice_id: 'voice_cd34', name: 'Astro', category: 'custom', labels: {} },
    ]);
  });
  await cmds.onCommand('Astro');
  const list = sent.find((s) => s.kind === 'list')! as Sent & { voices: Array<Record<string, unknown>> };
  assert.equal(list.voices[0].kind, 'custom');
  assert.equal(list.voices[0].expiresAt, '2027-10-01T00:00:00Z');
  await cmds.onSelect('voice_ab12', 'Astro', { provider: 'gemini', revision: 3, stale: false, kind: 'custom', expiresAt: '2027-10-01T00:00:00Z' });
  assert.deepEqual(writes.at(-1), { id: 'voice_ab12', name: 'Astro', provider: 'gemini', expiresAt: '2027-10-01T00:00:00Z', kind: 'custom' });
});
