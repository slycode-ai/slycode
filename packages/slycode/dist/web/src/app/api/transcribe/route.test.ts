/**
 * /api/transcribe OpenAI path (card #0368): whisper-1 → gpt-transcribe.
 *
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/app/api/transcribe/route.test.ts
 *
 * Run from web/ so tsx picks up the @/ path alias. The SDK is pointed at a local
 * server via OPENAI_BASE_URL, and SLYCODE_HOME at an empty temp dir so the real
 * .env is never read.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let server: http.Server;
let lastBody = '';
let reply: { status: number; body: unknown } = { status: 200, body: {} };
let POST: (request: Request) => Promise<Response>;

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      lastBody = Buffer.concat(chunks).toString('latin1');
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.STT_BACKEND = 'openai';
  process.env.SLYCODE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'transcribe-route-test-'));
  ({ POST } = await import('./route'));
});

after(() => { server.close(); });

function recording(type = 'audio/webm;codecs=opus'): Request {
  const form = new FormData();
  form.append('audio', new Blob([Buffer.from('webm fake opus')], { type }), 'blob');
  return new Request('http://localhost/api/transcribe', { method: 'POST', body: form });
}

test('sends gpt-transcribe and returns { text } unchanged', async () => {
  reply = { status: 200, body: { text: 'open card 368', languages: [{ code: 'en' }] } };

  const res = await POST(recording());

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: 'open card 368' });
  assert.match(lastBody, /name="model"\r\n\r\ngpt-transcribe\r\n/);
  assert.doesNotMatch(lastBody, /whisper-1/);
  assert.match(lastBody, /filename="recording\.webm"/);
});

test('upstream error still maps to 502 { error }', async () => {
  reply = { status: 400, body: { error: { message: 'Invalid file format.', type: 'invalid_request_error' } } };

  const res = await POST(recording('audio/mp4'));

  assert.equal(res.status, 502);
  const body = await res.json() as { error: string };
  assert.match(body.error, /Invalid file format/);
  assert.match(lastBody, /filename="recording\.mp4"/);
});
