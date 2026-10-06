/**
 * Route tests for the web voice picker proxies (feature 087 phase 3):
 * /api/messaging/voices, /voices/projects, /voices/projects/[id], /voices/preview.
 * The handlers run against a stub messaging server on a random port.
 *
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/messaging-voice-proxy.test.ts
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

interface Seen { method: string; url: string; body: string }
const seen: Seen[] = [];
let reply: (req: Seen) => { status: number; type: string; body: string | Buffer } = () => ({ status: 200, type: 'application/json', body: '{}' });
let server: http.Server;
const env = { NODE_ENV: process.env.NODE_ENV, MESSAGING_URL: process.env.MESSAGING_URL, HOME: process.env.HOME };
let authHome: string;
/** A valid session cookie for the write/preview routes' own session check. */
let cookie = '';

before(async () => {
  // auth.ts keeps its file under ~/.slycode: point HOME at a scratch dir
  // BEFORE it is first imported, so the test never touches the real one.
  authHome = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-proxy-auth-'));
  process.env.HOME = authHome;
  const auth = await import('./auth');
  auth.setInitialPassword('test-password');
  cookie = `${auth.SESSION_COOKIE}=${auth.createSessionToken()}`;
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const s = { method: req.method ?? '', url: req.url ?? '', body };
      seen.push(s);
      const r = reply(s);
      res.writeHead(r.status, { 'Content-Type': r.type });
      res.end(r.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  // getMessagingUrl() honours MESSAGING_URL in production mode.
  (process.env as Record<string, string>).NODE_ENV = 'production';
  process.env.MESSAGING_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(authHome, { recursive: true, force: true });
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string>)[k] = v;
  }
});

const json = (status: number, body: unknown) => ({ status, type: 'application/json', body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

test('search forwards only the known filters and passes the stamped answer through', async () => {
  const { GET } = await import('../app/api/messaging/voices/route');
  seen.length = 0;
  reply = () => json(200, { ok: true, provider: 'gemini', revision: 3, voices: [] });
  const res = await GET(new Request('http://web/api/messaging/voices?q=warm&gender=female&language=en-AU&evil=1'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, provider: 'gemini', revision: 3, voices: [] });
  assert.equal(seen[0].url, '/voices/search?q=warm&gender=female&language=en-AU');
});

test('project list: down → 503 with a start-it message; an old messaging build (non-JSON 404) → 404', async () => {
  const { GET } = await import('../app/api/messaging/voices/projects/route');
  const { VOICES_DOWN_MESSAGE } = await import('./voice-picker-view');
  reply = () => ({ status: 404, type: 'text/html', body: 'Cannot GET /tts/project-voices' });
  const old = await GET(new Request('http://web/api/messaging/voices/projects'));
  assert.equal(old.status, 404);
  const saved = process.env.MESSAGING_URL;
  process.env.MESSAGING_URL = 'http://127.0.0.1:9';
  try {
    const down = await GET(new Request('http://web/api/messaging/voices/projects'));
    assert.equal(down.status, 503);
    assert.equal((await down.json()).message, VOICES_DOWN_MESSAGE);
  } finally {
    process.env.MESSAGING_URL = saved;
  }
});

test('set forwards exactly the voice and its stamp; a 409 stale_provider passes through; no stamp → 400 without forwarding', async () => {
  const { PUT } = await import('../app/api/messaging/voices/projects/[id]/route');
  seen.length = 0;
  reply = () => json(409, { ok: false, error: 'stale_provider', message: 'out of date', revision: 4 });
  const stale = await PUT(new Request('http://web/x', {
    method: 'PUT', headers: { cookie }, body: JSON.stringify({ voiceId: ' kore ', voiceName: 'Kore', provider: 'gemini', revision: 3, extra: 'dropped' }),
  }), ctx('my project'));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, 'stale_provider');
  assert.equal(seen[0].method, 'PUT');
  assert.equal(seen[0].url, '/projects/my%20project/voice');
  assert.deepEqual(JSON.parse(seen[0].body), { voiceId: 'kore', voiceName: 'Kore', provider: 'gemini', revision: 3 });

  seen.length = 0;
  const unstamped = await PUT(new Request('http://web/x', { method: 'PUT', headers: { cookie }, body: JSON.stringify({ voiceId: 'kore' }) }), ctx('alpha'));
  assert.equal(unstamped.status, 400);
  assert.equal(seen.length, 0, 'an unstamped set never reaches messaging');
});

test('reset forwards provider and revision; without them → 400', async () => {
  const { DELETE } = await import('../app/api/messaging/voices/projects/[id]/route');
  seen.length = 0;
  reply = () => json(200, { ok: true, projectId: 'alpha', effective: { id: 'kore', name: 'Kore' }, source: 'builtin' });
  const ok = await DELETE(new Request('http://web/x?provider=gemini&revision=2', { method: 'DELETE', headers: { cookie } }), ctx('alpha'));
  assert.equal(ok.status, 200);
  assert.equal(seen[0].url, '/projects/alpha/voice?provider=gemini&revision=2');
  const bad = await DELETE(new Request('http://web/x?provider=gemini', { method: 'DELETE', headers: { cookie } }), ctx('alpha'));
  assert.equal(bad.status, 400);
});

test('preview: audio passes through as audio; JSON errors keep their status', async () => {
  const { POST } = await import('../app/api/messaging/voices/preview/route');
  seen.length = 0;
  reply = () => ({ status: 200, type: 'audio/mpeg', body: Buffer.from([0xff, 0xfb, 1, 2, 3]) });
  const ok = await POST(new Request('http://web/x', { method: 'POST', headers: { cookie }, body: JSON.stringify({ voiceId: 'kore', voiceName: 'Kore', provider: 'gemini', revision: 0 }) }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [0xff, 0xfb, 1, 2, 3]);
  assert.deepEqual(JSON.parse(seen[0].body), { voiceId: 'kore', voiceName: 'Kore', provider: 'gemini', revision: 0 });

  reply = () => json(409, { ok: false, error: 'stale_provider', message: 'out of date' });
  const stale = await POST(new Request('http://web/x', { method: 'POST', headers: { cookie }, body: JSON.stringify({ voiceId: 'kore', provider: 'gemini', revision: 0 }) }));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, 'stale_provider');

  seen.length = 0;
  const unstamped = await POST(new Request('http://web/x', { method: 'POST', headers: { cookie }, body: JSON.stringify({ voiceId: 'kore' }) }));
  assert.equal(unstamped.status, 400);
  assert.equal(seen.length, 0);
});

test('write and preview routes re-check the session themselves (defence in depth); a project id ending in .js works when signed in', async () => {
  const { PUT, DELETE } = await import('../app/api/messaging/voices/projects/[id]/route');
  const { POST } = await import('../app/api/messaging/voices/preview/route');
  const body = JSON.stringify({ voiceId: 'kore', voiceName: 'Kore', provider: 'gemini', revision: 0 });
  seen.length = 0;
  for (const headers of [{}, { cookie: 'sly_session=forged.token' }] as Array<Record<string, string>>) {
    assert.equal((await PUT(new Request('http://web/x', { method: 'PUT', headers, body }), ctx('Next.js'))).status, 401);
    assert.equal((await DELETE(new Request('http://web/x?provider=gemini&revision=0', { method: 'DELETE', headers }), ctx('Next.js'))).status, 401);
    assert.equal((await POST(new Request('http://web/x', { method: 'POST', headers, body }))).status, 401);
  }
  assert.equal(seen.length, 0, 'nothing reaches messaging without a session');

  reply = () => json(200, { ok: true, projectId: 'next-js', effective: { id: 'kore', name: 'Kore' }, source: 'project' });
  const ok = await PUT(new Request('http://web/x', { method: 'PUT', headers: { cookie }, body }), ctx('Next.js'));
  assert.equal(ok.status, 200);
  assert.equal(seen[0].url, '/projects/Next.js/voice');
});

test('voice design proxy: session first, free checks, stamp + mp3 sample forwarded; discard only designed ids', async () => {
  const design = await import('../app/api/messaging/voices/design/route');
  const discard = await import('../app/api/messaging/voices/design/[id]/route');
  const body = JSON.stringify({ description: 'warm narrator', name: 'Isla', gender: 'female', language: 'en-AU', revision: 2 });
  seen.length = 0;
  assert.equal((await design.POST(new Request('http://web/x', { method: 'POST', body }))).status, 401);
  assert.equal((await design.POST(new Request('http://web/x', { method: 'POST', headers: { cookie }, body: JSON.stringify({ name: 'Isla', revision: 2 }) }))).status, 400);
  assert.equal((await design.POST(new Request('http://web/x', { method: 'POST', headers: { cookie }, body: JSON.stringify({ description: 'd', name: 'Isla' }) }))).status, 400, 'no stamp, no paid call');
  assert.equal((await design.POST(new Request('http://web/x', { method: 'POST', headers: { cookie }, body: JSON.stringify({ description: 'd', name: 'Isla', revision: 2, gender: 'robot' }) }))).status, 400);
  assert.equal(seen.length, 0, 'nothing reached messaging');

  reply = () => json(200, { ok: true, voice: { id: 'voice_ab12', name: 'Isla', expiresAt: null }, sample: { contentType: 'audio/mpeg', data: 'AAAA' } });
  const ok = await design.POST(new Request('http://web/x', { method: 'POST', headers: { cookie }, body }));
  assert.equal(ok.status, 200);
  assert.equal(seen[0].url, '/voices/design');
  assert.deepEqual(JSON.parse(seen[0].body), { description: 'warm narrator', name: 'Isla', revision: 2, returnSample: 'mp3', gender: 'female', language: 'en-AU' });

  reply = () => json(409, { ok: false, error: 'stale_provider', message: 'changed' });
  assert.equal((await design.POST(new Request('http://web/x', { method: 'POST', headers: { cookie }, body }))).status, 409);

  seen.length = 0;
  assert.equal((await discard.DELETE(new Request('http://web/x', { method: 'DELETE' }), ctx('voice_ab12'))).status, 401);
  assert.equal((await discard.DELETE(new Request('http://web/x', { method: 'DELETE', headers: { cookie } }), ctx('kore'))).status, 400, 'library voices cannot be discarded');
  assert.equal(seen.length, 0);
  reply = () => json(200, { ok: true, id: 'voice_ab12', recipeKept: true, usedBy: [] });
  const gone = await discard.DELETE(new Request('http://web/x', { method: 'DELETE', headers: { cookie } }), ctx('voice_ab12'));
  assert.equal(gone.status, 200);
  assert.equal(seen[0].method, 'DELETE');
  assert.equal(seen[0].url, '/voices/voice_ab12');
});

test('voice clone proxy: session first, free checks, recordings + stamp + mp3 sample forwarded unchanged', async () => {
  const clone = await import('../app/api/messaging/voices/clone/route');
  const good = { name: 'Greg', locale: 'en-AU', sample: 'U0FNUExF', consent: 'Q09OU0VOVA==', revision: 4 };
  const post = (b: unknown, withCookie = true) => clone.POST(new Request('http://web/x', { method: 'POST', headers: withCookie ? { cookie } : {}, body: JSON.stringify(b) }));
  seen.length = 0;
  assert.equal((await post(good, false)).status, 401);
  assert.equal((await post({ ...good, name: '' })).status, 400);
  assert.equal((await post({ ...good, consent: undefined })).status, 400);
  assert.equal((await post({ ...good, revision: undefined })).status, 400, 'no stamp, no paid call');
  assert.equal((await post({ ...good, locale: 'en-NZ' })).status, 400, 'a locale Google has no statement for');
  assert.equal((await post({ ...good, sample: 'A'.repeat(6 * 1024 * 1024) })).status, 413);
  assert.equal(seen.length, 0, 'nothing reached messaging');

  reply = () => json(200, { ok: true, voice: { id: 'voice_c1', name: 'Greg', expiresAt: null }, sample: null, warnings: [] });
  const ok = await post(good);
  assert.equal(ok.status, 200);
  assert.equal(seen[0].url, '/voices/clone');
  assert.deepEqual(JSON.parse(seen[0].body), { name: 'Greg', sample: 'U0FNUExF', consent: 'Q09OU0VOVA==', revision: 4, returnSample: 'mp3', locale: 'en-AU' });

  reply = () => json(422, { ok: false, error: 'clone_consent_failed', message: "Google couldn't confirm the consent recording." });
  const refused = await post(good);
  assert.equal(refused.status, 422);
  assert.equal(((await refused.json()) as { error: string }).error, 'clone_consent_failed');
});

test('install default proxy: session first, stamp required, body forwarded to /tts/default-voice', async () => {
  const { PUT } = await import('../app/api/messaging/voices/default/route');
  const put = (b: unknown, withCookie = true) => PUT(new Request('http://web/x', { method: 'PUT', headers: withCookie ? { cookie } : {}, body: JSON.stringify(b) }));
  seen.length = 0;
  assert.equal((await put({ voiceId: 'en-us-zuri', provider: 'gemini', revision: 2 }, false)).status, 401);
  assert.equal((await put({ provider: 'gemini', revision: 2 })).status, 400);
  assert.equal((await put({ voiceId: 'en-us-zuri' })).status, 400, 'no stamp, no change');
  assert.equal(seen.length, 0);
  reply = () => json(200, { ok: true, effective: { id: 'en-us-zuri', name: 'Zuri' }, source: 'inherited' });
  const ok = await put({ voiceId: ' en-us-zuri ', voiceName: 'Zuri', provider: 'gemini', revision: 2, extra: 'dropped' });
  assert.equal(ok.status, 200);
  assert.equal(seen[0].method, 'PUT');
  assert.equal(seen[0].url, '/tts/default-voice');
  assert.deepEqual(JSON.parse(seen[0].body), { voiceId: 'en-us-zuri', voiceName: 'Zuri', provider: 'gemini', revision: 2 });
});
