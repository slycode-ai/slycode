/**
 * CLI flag parsing (feature 087 fix loop): a valued flag whose "value" is
 * another flag (`voice design … --name --set`) must fail before ANY network
 * call — no health probe, no paid design. Runs the real CLI in a child
 * process with HOME pointing at a scratch dir whose cached messaging port is
 * a stub server that records every request.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const requests: string[] = [];
let server: http.Server;
let home: string;

before(async () => {
  server = http.createServer((req, res) => { requests.push(`${req.method} ${req.url}`); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-flags-'));
  fs.mkdirSync(path.join(home, '.slycode'));
  fs.writeFileSync(path.join(home, '.slycode', 'messaging-port'), String((server.address() as AddressInfo).port));
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(home, { recursive: true, force: true });
});

function cli(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--import', 'tsx', path.join('src', 'cli.ts'), ...args], {
      env: { ...process.env, HOME: home, SLYCODE_SESSION: '' }, windowsHide: true, timeout: 30_000,
    }, (err, _stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stderr }));
  });
}

test('a valued flag followed by another flag fails before any network call', async () => {
  const cases: Array<[string[], RegExp]> = [
    [['voice', 'design', 'a calm narrator', '--name', '--set'], /--name requires a value \(got the flag --set\)/],
    [['voice', 'design', 'a calm narrator', '--name', 'Isla', '--gender', '--set'], /--gender requires a value/],
    [['voice', 'design', '--recreate', '--set'], /--recreate requires a value/],
    [['voice', 'set', 'kore', '--project', '--provider', 'gemini'], /--project requires a value/],
    [['voices', 'warm', '--gender', '--custom'], /--gender requires a value/],
    [['generate', 'hello', '--voice-id', '--format', 'mp3'], /--voice-id requires a value/],
    [['voice', 'design', 'a calm narrator', '--name'], /--name requires a value$/m],
    [['voice', 'clone', '--sample', '--consent', 'b.wav'], /--sample requires a value/],
    [['voice', 'clone', '--name', 'Greg'], /needs two recordings of the same person/],
    [['voice', 'clone', '--sample', 'a.wav', '--consent', 'b.wav'], /give the voice a name/],
    [['voice', 'clone', '--sample', 'a.wav', '--consent', 'b.wav', '--name', 'G', '--project', 'x'], /--project only applies with --set/],
    [['voice', 'clone', '--sample', '/nope/a.wav', '--consent', '/nope/b.wav', '--name', 'G'], /can't read the voice sample/],
    [['voice', 'consent-text', '--locale', 'xx-YY'], /isn't a consent language Google supports/],
  ];
  for (const [args, message] of cases) {
    const r = await cli(args);
    assert.equal(r.code, 1, `${args.join(' ')} should exit 1`);
    assert.match(r.stderr, message, args.join(' '));
  }
  assert.deepEqual(requests, [], 'no request reached the service, not even a health probe');
});

test('voice consent-text prints the statement to read, offline', async () => {
  const out = await new Promise<string>((resolve) => {
    execFile(process.execPath, ['--import', 'tsx', path.join('src', 'cli.ts'), 'voice', 'consent-text', '--locale', 'en-au'], {
      env: { ...process.env, HOME: home }, windowsHide: true, timeout: 30_000,
    }, (_err, stdout) => resolve(stdout));
  });
  assert.match(out, /English \(Australia\), en-AU/);
  assert.match(out, /I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model\./);
});
