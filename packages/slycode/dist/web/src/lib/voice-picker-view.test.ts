/**
 * Tests for the web voice picker view logic (feature 087 phase 3).
 *
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/voice-picker-view.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCENT_CHIPS,
  STALE_PICK_MESSAGE,
  VOICES_DOWN_MESSAGE,
  emptyResultsText,
  interpretChangeResponse,
  interpretPreviewFailure,
  interpretProjectsResponse,
  interpretSearchResponse,
  DESIGN_COST_NOTE,
  designBody,
  designFormProblem,
  designedAsPickerVoice,
  formatExpiry,
  interpretDesignResponse,
  installDefaultSource,
  othersToggleLabel,
  projectIdFromPath,
  splitProjects,
  previewBody,
  searchQuery,
  setBody,
  sourceText,
  voiceDetail,
  type PickerVoice,
  cloneBody,
  cloneFormProblem,
  clonedAsPickerVoice,
  initialConsentLocale,
  interpretCloneResponse,
  INSTALL_DEFAULT_ROW_ID,
  changeVoiceUrl,
  installDefaultRow,
  isInstallDefaultRow,
  rowVoiceText,
  type ProjectVoiceRow,
} from './voice-picker-view';

const geminiSearch = {
  ok: true, query: null, provider: 'gemini', revision: 4,
  voices: [
    { provider: 'gemini', voice_id: 'kore', name: 'Kore', category: 'studio', description: 'Firm', labels: {} },
    { provider: 'gemini', voice_id: 'en-au-advisor-1', name: 'Authoritative Advisor 1', category: 'library', description: '33-year-old Lawyer from Sydney Australia.', labels: { accent: 'Sydney English', gender: 'male', language: 'en-AU' } },
    { name: 'no id, dropped' },
  ],
};

test('search results carry the provider and revision they were found under', () => {
  const r = interpretSearchResponse(200, geminiSearch);
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.deepEqual(r.stamp, { provider: 'gemini', revision: 4 });
  assert.equal(r.voices.length, 2, 'rows without an id are dropped');
  for (const v of r.voices) assert.deepEqual(v.stamp, { provider: 'gemini', revision: 4 });
  assert.equal(r.voices[1].accent, 'Sydney English');
  assert.equal(r.voices[1].gender, 'male');
  assert.equal(r.truncated, false);
});

test('set and preview send the stamp back, never the current provider', () => {
  const r = interpretSearchResponse(200, geminiSearch);
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  const kore = r.voices[0];
  assert.deepEqual(setBody(kore), { voiceId: 'kore', voiceName: 'Kore', provider: 'gemini', revision: 4 });
  assert.deepEqual(previewBody(kore), setBody(kore));
});

test('a search answer without a stamp is refused rather than trusted', () => {
  const r = interpretSearchResponse(200, { ok: true, voices: [] });
  assert.equal(r.kind, 'error');
});

test('ElevenLabs sample clips are kept only when https', () => {
  const r = interpretSearchResponse(200, {
    ok: true, provider: 'elevenlabs', revision: 0,
    voices: [
      { voice_id: 'a'.repeat(20), name: 'Rachel', category: 'premade', description: '', labels: { accent: 'american' }, preview_url: 'https://cdn.example/r.mp3' },
      { voice_id: 'b'.repeat(20), name: 'Odd', category: 'premade', description: '', labels: {}, preview_url: 'http://cdn.example/o.mp3' },
    ],
  });
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.equal(r.voices[0].previewUrl, 'https://cdn.example/r.mp3');
  assert.equal(r.voices[1].previewUrl, null);
});

test('a full page of results is flagged so the picker can say to narrow the search', () => {
  const voices = Array.from({ length: 50 }, (_, i) => ({ voice_id: `v${i}`, name: `V${i}`, category: 'library', description: '', labels: {} }));
  const r = interpretSearchResponse(200, { ok: true, provider: 'gemini', revision: 0, voices });
  assert.equal(r.kind === 'ok' && r.truncated, true);
});

test('search never names a provider (messaging searches the active one); chips only on Gemini', () => {
  const filters = { text: ' warm ', gender: 'female', language: 'en-AU' };
  assert.equal(searchQuery('gemini', filters), 'q=warm&gender=female&language=en-AU');
  assert.equal(searchQuery('elevenlabs', filters), 'q=warm');
  assert.equal(searchQuery(null, { text: '', gender: null, language: null }), '');
  assert.ok(ACCENT_CHIPS.every((c) => /^en-[A-Z]{2}$/.test(c.language)));
});

test('project list: rows with their effective voice and source, stamped', () => {
  const r = interpretProjectsResponse(200, {
    ok: true, provider: 'gemini', revision: 2,
    projects: [
      { projectId: 'alpha', name: 'Alpha', provider: 'gemini', stored: { id: 'sulafat', name: 'Sulafat' }, effective: { id: 'sulafat', name: 'Sulafat' }, source: 'project' },
      { projectId: 'beta', name: 'Beta', provider: 'gemini', stored: null, effective: { id: 'kore', name: 'Kore' }, source: 'builtin' },
      { projectId: 'gamma', provider: 'gemini', stored: null, effective: null, source: null },
    ],
  });
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.deepEqual(r.stamp, { provider: 'gemini', revision: 2 });
  assert.deepEqual(r.rows.map((x) => [x.projectId, x.name, x.voice?.name ?? null, x.source]), [
    ['alpha', 'Alpha', 'Sulafat', 'project'],
    ['beta', 'Beta', 'Kore', 'builtin'],
    ['gamma', 'gamma', null, null],
  ]);
});

test('project list: an older messaging build (404) says to restart it; down says to start it', () => {
  const old = interpretProjectsResponse(404, { ok: false, error: 'bad_response', message: 'x' });
  assert.equal(old.kind, 'error');
  assert.match(old.kind === 'error' ? old.message : '', /Restart it/);
  const down = interpretProjectsResponse(503, null);
  assert.deepEqual(down, { kind: 'error', message: VOICES_DOWN_MESSAGE });
});

test('set/reset: 409 stale_provider means refresh, other failures show messaging\'s message', () => {
  assert.deepEqual(interpretChangeResponse(409, { ok: false, error: 'stale_provider', message: 'old' }), { kind: 'stale', message: STALE_PICK_MESSAGE });
  assert.equal(STALE_PICK_MESSAGE, 'Provider changed; results refreshed.');
  assert.deepEqual(interpretChangeResponse(404, { ok: false, error: 'voice_not_found', message: 'No Gemini voice with id x.' }), { kind: 'error', message: 'No Gemini voice with id x.' });
  assert.deepEqual(interpretChangeResponse(504, { ok: false, message: 'slow' }), { kind: 'error', message: 'slow' });
  const done = interpretChangeResponse(200, { ok: true, projectId: 'alpha', provider: 'gemini', effective: { id: 'kore', name: 'Kore' }, source: 'project' });
  assert.deepEqual(done, { kind: 'done', voice: { id: 'kore', name: 'Kore' }, source: 'project' });
});

test('preview failures: stale refreshes; an old messaging build is named', () => {
  assert.equal(interpretPreviewFailure(409, { error: 'stale_provider' }).kind, 'stale');
  assert.match(interpretPreviewFailure(404, 'Cannot POST').message, /Restart it/);
  assert.equal(interpretPreviewFailure(404, { ok: false, error: 'voice_not_found', message: 'No Gemini voice with id x.' }).message, 'No Gemini voice with id x.');
  assert.equal(interpretPreviewFailure(429, { ok: false, error: 'rate_limited', message: 'Gemini TTS is rate limited; try again in 12 s.' }).message, 'Gemini TTS is rate limited; try again in 12 s.');
});

test('row text: source in plain words; detail avoids repeating the accent', () => {
  assert.equal(sourceText('project'), 'chosen for this project');
  assert.equal(sourceText('builtin'), 'built-in default');
  assert.equal(sourceText(null), 'no voice');
  const v = (over: Partial<PickerVoice>): PickerVoice => ({ id: 'x', name: 'X', category: 'library', description: '', accent: null, gender: null, previewUrl: null, stamp: { provider: 'gemini', revision: 0 }, ...over });
  assert.equal(voiceDetail(v({ description: 'Firm' })), 'Firm');
  assert.equal(voiceDetail(v({ description: 'Calm narrator.', accent: 'Dublin English' })), 'Calm narrator, Dublin English');
  assert.equal(voiceDetail(v({ description: 'Warm voice with a Dublin English lilt', accent: 'Dublin English' })), 'Warm voice with a Dublin English lilt');
  assert.equal(voiceDetail(v({ category: 'studio' })), 'Studio');
});

test('empty results say what to change', () => {
  assert.match(emptyResultsText({ text: 'zzz', gender: 'male', language: null }), /Clear a filter/);
  assert.match(emptyResultsText({ text: '', gender: null, language: 'en-NZ' }), /Clear one/);
  assert.match(emptyResultsText({ text: 'zzz', gender: null, language: null }), /Try another word/);
});

test('a search that straddled a provider switch (409 stale_provider) reads as stale, never as rows', () => {
  assert.deepEqual(interpretSearchResponse(409, { ok: false, error: 'stale_provider', message: 'changed' }), { kind: 'stale', message: STALE_PICK_MESSAGE });
});

test('the picker opens on the project in view; every other project sits behind the toggle (owner ruling)', () => {
  const r = interpretProjectsResponse(200, {
    ok: true, provider: 'gemini', revision: 1,
    projects: [
      { projectId: 'alpha', name: 'Alpha', effective: { id: 'kore', name: 'Kore' }, source: 'inherited' },
      { projectId: 'beta', name: 'Beta', effective: { id: 'puck', name: 'Puck' }, source: 'project' },
      { projectId: 'gamma', name: 'Gamma', effective: { id: 'kore', name: 'Kore' }, source: 'inherited' },
    ],
    installDefault: { voice: { id: 'kore', name: 'Kore' }, source: 'state' },
  });
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.deepEqual(r.installDefault, { voice: { id: 'kore', name: 'Kore' }, source: 'state' });

  const inCard = splitProjects(r.rows, 'beta');
  assert.equal(inCard.current?.projectId, 'beta');
  assert.deepEqual(inCard.others.map((x) => x.projectId), ['alpha', 'gamma']);
  assert.equal(othersToggleLabel(inCard.others.length, true, false), 'Show other projects (2)');
  assert.equal(othersToggleLabel(inCard.others.length, true, true), 'Hide other projects');

  for (const id of [null, undefined, 'not-registered']) {
    const none = splitProjects(r.rows, id);
    assert.equal(none.current, null, `${id}: no current project`);
    assert.equal(none.others.length, 3, 'everything sits behind the toggle');
  }
  assert.equal(othersToggleLabel(3, false, false), 'Show projects (3)');
});

test('install default: tolerant parse, plain source words; an older messaging build reads as none', () => {
  const old = interpretProjectsResponse(200, { ok: true, provider: 'elevenlabs', revision: 0, projects: [] });
  assert.deepEqual(old.kind === 'ok' && old.installDefault, { voice: null, source: null });
  assert.equal(installDefaultSource('state'), 'last chosen in Telegram');
  assert.equal(installDefaultSource('env'), 'from .env');
  assert.equal(installDefaultSource('builtin'), 'built-in');
  assert.equal(installDefaultSource(null), 'none set');
  assert.equal(sourceText('inherited'), 'install default', 'same words as the install default line');
});

test('the floating widget finds the project from the URL only on project pages', () => {
  assert.equal(projectIdFromPath('/project/claude-master'), 'claude-master');
  assert.equal(projectIdFromPath('/project/next.js/some-token'), 'next.js');
  assert.equal(projectIdFromPath('/project/my%20proj'), 'my proj');
  assert.equal(projectIdFromPath('/global'), null);
  assert.equal(projectIdFromPath('/'), null);
  assert.equal(projectIdFromPath(null), null);
});

test('designed voices show as designed, with their expiry, in the list', () => {
  const r = interpretSearchResponse(200, { ok: true, provider: 'gemini', revision: 2, voices: [
    { voice_id: 'voice_ab12', name: 'Isla', category: 'custom', description: 'calm Scottish narrator', labels: {}, expiresAt: '2027-10-04T09:00:00Z' },
  ] });
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.equal(r.voices[0].expiresAt, '2027-10-04T09:00:00Z');
  assert.equal(voiceDetail(r.voices[0]), 'Designed, expires 4 Oct 2027, calm Scottish narrator');
  assert.equal(formatExpiry('2027-01-31T23:00:00Z'), '31 Jan 2027');
});

test('voice design: free checks first, the list stamp rides along, results map cleanly', () => {
  const form = { description: '  warm, dry-witted Australian engineer, mid-40s ', name: ' Isla ', gender: 'female', language: 'en-AU' };
  assert.equal(designFormProblem({ ...form, description: ' ' }), 'Describe the voice first.');
  assert.equal(designFormProblem({ ...form, name: '' }), 'Give the voice a name.');
  assert.equal(designFormProblem(form), null);
  assert.deepEqual(designBody(form, { provider: 'gemini', revision: 3 }), {
    description: 'warm, dry-witted Australian engineer, mid-40s', name: 'Isla', revision: 3, gender: 'female', language: 'en-AU',
  });
  assert.deepEqual(Object.keys(designBody({ ...form, gender: null, language: null }, { provider: 'gemini', revision: 3 })).sort(), ['description', 'name', 'revision']);
  assert.match(DESIGN_COST_NOTE, /3¢.*20 seconds/);

  const ok = interpretDesignResponse(200, { ok: true, voice: { id: 'voice_ab12', name: 'Isla', expiresAt: '2027-10-04T00:00:00Z' }, sample: { contentType: 'audio/mpeg', data: 'AAAA' }, warnings: ['w'] });
  assert.deepEqual(ok, { kind: 'designed', voice: { id: 'voice_ab12', name: 'Isla', expiresAt: '2027-10-04T00:00:00Z' }, sample: { contentType: 'audio/mpeg', data: 'AAAA' }, warnings: ['w'] });
  assert.equal(interpretDesignResponse(409, { error: 'stale_provider' }).kind, 'stale');
  assert.deepEqual(interpretDesignResponse(400, { ok: false, error: 'tts_unconfigured', message: 'Voice design needs GEMINI_API_KEY in .env.' }), { kind: 'error', message: 'Voice design needs GEMINI_API_KEY in .env.' });
  assert.equal(interpretDesignResponse(200, { ok: true, voice: {} }).kind, 'error');
  const noSample = interpretDesignResponse(200, { ok: true, voice: { id: 'voice_x' }, sample: null });
  assert.equal(noSample.kind === 'designed' && noSample.sample, null);

  const asRow = designedAsPickerVoice({ id: 'voice_ab12', name: 'Isla', expiresAt: '2027-10-04T00:00:00Z' }, form, { provider: 'gemini', revision: 3 });
  assert.deepEqual(setBody(asRow), { voiceId: 'voice_ab12', voiceName: 'Isla', provider: 'gemini', revision: 3 }, '"Use" is the normal stamped set');
  assert.equal(asRow.category, 'custom');
});

// --- Voice cloning (#0376) ------------------------------------------------------

test('clone: free checks in the order a person fills the form', () => {
  const take = (seconds: number) => ({ wavBase64: 'UklGRg==', seconds });
  const ok = { name: 'Greg', locale: 'en-AU', sample: take(15), consent: take(6) };
  assert.equal(cloneFormProblem(ok), null);
  assert.match(cloneFormProblem({ ...ok, sample: null }) ?? '', /Record or upload your voice sample/);
  assert.equal(cloneFormProblem({ ...ok, sample: take(7.04) }), 'The sample is 7 s; Google needs 10–30 s.');
  assert.equal(cloneFormProblem({ ...ok, sample: take(9.8) }), null, 'a quarter-second of slack for rounding');
  assert.match(cloneFormProblem({ ...ok, sample: take(31) }) ?? '', /31 s/);
  assert.match(cloneFormProblem({ ...ok, consent: null }) ?? '', /consent statement/);
  assert.match(cloneFormProblem({ ...ok, consent: take(2) }) ?? '', /2 s; it needs 3–20 s/);
  assert.match(cloneFormProblem({ ...ok, locale: 'en-NZ' }) ?? '', /language/);
  assert.match(cloneFormProblem({ ...ok, name: '  ' }) ?? '', /name/);
});

test('clone: the body carries both takes, the name, the locale and the list revision', () => {
  const body = cloneBody({ name: ' Greg ', locale: 'en-AU', sample: { wavBase64: 'S', seconds: 15 }, consent: { wavBase64: 'C', seconds: 6 } }, { provider: 'gemini', revision: 7 });
  assert.deepEqual(body, { name: 'Greg', locale: 'en-AU', sample: 'S', consent: 'C', revision: 7 });
});

test('clone: answers read like design; refusals pass Google\'s plain message through', () => {
  const ok = interpretCloneResponse(200, { ok: true, voice: { id: 'voice_c1', name: 'Greg', expiresAt: '2027-10-05T00:00:00Z' }, sample: null, warnings: [] });
  assert.equal(ok.kind, 'designed');
  const refused = interpretCloneResponse(422, { ok: false, error: 'clone_consent_failed', message: "Google couldn't confirm the consent recording. Record both again…" });
  assert.deepEqual(refused, { kind: 'error', message: "Google couldn't confirm the consent recording. Record both again…" });
  assert.equal(interpretCloneResponse(409, { ok: false, error: 'stale_provider' }).kind, 'stale');
  const row = clonedAsPickerVoice({ id: 'voice_c1', name: 'Greg', expiresAt: '2027-10-05T00:00:00Z' }, { provider: 'gemini', revision: 7 });
  assert.equal(voiceDetail(row), 'Cloned, expires 5 Oct 2027');
  assert.equal(initialConsentLocale('en-AU'), 'en-AU');
  assert.equal(initialConsentLocale('en-NZ'), 'en-US');
  assert.equal(initialConsentLocale(null), 'en-US');
});

test('clone: list rows say Cloned or Designed from the voice\'s origin label', () => {
  const r = interpretSearchResponse(200, { ok: true, provider: 'gemini', revision: 1, voices: [
    { voice_id: 'voice_a', name: 'Greg', category: 'custom', description: '', labels: { origin: 'cloned' }, expiresAt: '2027-10-05T00:00:00Z' },
    { voice_id: 'voice_b', name: 'Isla', category: 'custom', description: '', labels: { origin: 'designed' } },
    { voice_id: 'voice_c', name: 'Old', category: 'custom', description: '', labels: {} },
  ] });
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.deepEqual(r.voices.map(voiceDetail), ['Cloned, expires 5 Oct 2027', 'Designed', 'Designed']);
});

// --- Install default in the expanded list (#0376 owner feedback) -----------------

test('project rows: own voice says so; inherited reads "Zuri (install default)"', () => {
  const row = (source: ProjectVoiceRow['source'], voice: ProjectVoiceRow['voice'] = { id: 'en-us-zuri', name: 'Zuri' }): ProjectVoiceRow => ({ projectId: 'p', name: 'P', voice, source });
  assert.equal(rowVoiceText(row('project', { id: 'voice_a', name: 'Aimy' })), 'Aimy, chosen for this project');
  assert.equal(rowVoiceText(row('inherited')), 'Zuri (install default)');
  assert.equal(rowVoiceText(row('builtin')), 'Zuri (install default)');
  assert.equal(rowVoiceText(row('env')), 'Zuri (install default)');
  assert.equal(rowVoiceText(row(null, null)), 'No voice');
});

test('the install default is a pickable row whose sets go to its own route', () => {
  const r = installDefaultRow({ voice: { id: 'en-us-zuri', name: 'Zuri' }, source: 'builtin' });
  assert.equal(isInstallDefaultRow(r), true);
  assert.equal(r.name, 'the install default');
  assert.deepEqual(r.voice, { id: 'en-us-zuri', name: 'Zuri' });
  assert.equal(changeVoiceUrl(r), '/api/messaging/voices/default');
  assert.equal(changeVoiceUrl({ projectId: 'claude master' }), '/api/messaging/voices/projects/claude%20master');
  assert.equal(isInstallDefaultRow({ projectId: 'alpha' }), false);
  assert.equal(INSTALL_DEFAULT_ROW_ID, '__install_default__');
});
