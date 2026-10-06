/**
 * OpenAI STT path (card #0368): whisper-1 → gpt-transcribe.
 *
 *   ./bridge/node_modules/.bin/tsx --test messaging/src/stt.test.ts
 *
 * The SDK is pointed at a local server via OPENAI_BASE_URL — no network, no real key.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transcribeAudio } from './stt.js';
let server;
let lastBody = '';
let reply = { status: 200, body: {} };
before(async () => {
    server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            lastBody = Buffer.concat(chunks).toString('latin1');
            res.writeHead(reply.status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(reply.body));
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => { server.close(); });
const config = {
    backend: 'openai',
    openaiApiKey: 'test-key',
    whisperCliPath: '',
    whisperModelPath: '',
    awsTranscribeRegion: '',
    awsTranscribeLanguage: 'en-AU',
    awsTranscribeS3Bucket: '',
};
function tempVoiceNote() {
    const p = path.join(os.tmpdir(), `stt_test_${Date.now()}_${Math.random().toString(36).slice(2)}.ogg`);
    fs.writeFileSync(p, Buffer.from('OggS fake opus'));
    return p;
}
test('sends gpt-transcribe and returns plain text; extra languages field ignored', async () => {
    reply = { status: 200, body: { text: 'Move card 368 to testing.', languages: [{ code: 'en' }] } };
    const file = tempVoiceNote();
    const text = await transcribeAudio(file, config);
    assert.equal(text, 'Move card 368 to testing.');
    assert.match(lastBody, /name="model"\r\n\r\ngpt-transcribe\r\n/);
    assert.doesNotMatch(lastBody, /whisper-1/);
    assert.match(lastBody, /filename="stt_test_[^"]+\.ogg"/);
    assert.equal(fs.existsSync(file), false, 'temp voice file is removed');
});
test('API error still throws and still cleans up the temp file', async () => {
    reply = { status: 400, body: { error: { message: 'Invalid file format.', type: 'invalid_request_error' } } };
    const file = tempVoiceNote();
    await assert.rejects(transcribeAudio(file, config), /Invalid file format/);
    assert.equal(fs.existsSync(file), false);
});
//# sourceMappingURL=stt.test.js.map