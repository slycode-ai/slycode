// Helper truth-table tests for messaging/src/file-send.ts.
// Run with: npx tsx messaging/scripts/check-send-file.ts
//
// Exits 0 on all-pass; exits 1 with diagnostic output on first failure.

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  mediaKindFromExtension,
  resolveSendKind,
  preflightFile,
  SENSITIVE_PATH_PATTERNS,
  FileSendError,
  MAX_BYTES,
} from '../src/file-send.js';

let failures = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures++;
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function main() {
  console.log('mediaKindFromExtension');
  eq("'foo.ogg' → 'voice'",  mediaKindFromExtension('foo.ogg'),  'voice');
  eq("'foo.opus' → 'voice'", mediaKindFromExtension('foo.opus'), 'voice');
  eq("'foo.OGG' (case-insensitive) → 'voice'", mediaKindFromExtension('foo.OGG'), 'voice');
  eq("'foo.mp3' → 'audio'",  mediaKindFromExtension('foo.mp3'),  'audio');
  eq("'foo.M4A' (case-insensitive) → 'audio'", mediaKindFromExtension('foo.M4A'), 'audio');
  eq("'foo.mp4' → 'video'",  mediaKindFromExtension('foo.mp4'),  'video');
  eq("'foo.mov' → 'video'",  mediaKindFromExtension('foo.mov'),  'video');
  eq("'foo.txt' → null",     mediaKindFromExtension('foo.txt'),  null);
  eq("'foo' (no ext) → null", mediaKindFromExtension('foo'),     null);

  console.log('resolveSendKind');
  eq("(null, undefined) → null",         resolveSendKind(null, undefined),    null);
  eq("(null, 'document') → 'document'",  resolveSendKind(null, 'document'),   'document');
  eq("('voice', undefined) → 'voice'",   resolveSendKind('voice', undefined), 'voice');
  eq("('audio', undefined) → 'audio'",   resolveSendKind('audio', undefined), 'audio');
  eq("('video', undefined) → 'video'",   resolveSendKind('video', undefined), 'video');
  eq("('voice', 'document') → 'document' (override wins)", resolveSendKind('voice', 'document'), 'document');

  console.log('SENSITIVE_PATH_PATTERNS');
  const sensitiveHits = [
    '/home/x/.env',
    '/home/x/.env.production',
    '/home/x/.ssh/id_rsa',
    '/home/x/.ssh/id_ed25519.pub',
    '/home/x/.ssh/config',
    '/home/x/.aws/credentials',
    '/home/x/.netrc',
    '/proc/self/environ',
    '/dev/null',
    '/sys/class/net/eth0/address',
    '/home/x/.docker/config.json',
    '/home/x/.kube/config',
  ];
  for (const p of sensitiveHits) {
    const matched = SENSITIVE_PATH_PATTERNS.some((rx) => rx.test(p));
    check(`refuses ${p}`, matched);
  }
  const sensitiveMisses = [
    '/home/x/env-config.json',          // .env should NOT match envconfig
    '/home/x/projects/myapp/main.ts',
    '/tmp/preview.mp4',
    '/home/x/Documents/notes.txt',
  ];
  for (const p of sensitiveMisses) {
    const matched = SENSITIVE_PATH_PATTERNS.some((rx) => rx.test(p));
    check(`allows ${p}`, !matched);
  }

  console.log('preflightFile');
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'send-file-test-'));
  try {
    // missing path → file_not_found
    try {
      await preflightFile(path.join(tmpDir, 'does-not-exist.mp3'));
      check('missing path throws file_not_found', false, 'no error thrown');
    } catch (err) {
      check('missing path throws file_not_found', err instanceof FileSendError && err.code === 'file_not_found',
        err instanceof FileSendError ? `got code ${err.code}` : String(err));
    }
    // empty string → bad_request
    try {
      await preflightFile('');
      check('empty path throws bad_request', false, 'no error thrown');
    } catch (err) {
      check('empty path throws bad_request', err instanceof FileSendError && err.code === 'bad_request',
        err instanceof FileSendError ? `got code ${err.code}` : String(err));
    }
    // directory → file_unreadable
    try {
      await preflightFile(tmpDir);
      check('directory path throws file_unreadable', false, 'no error thrown');
    } catch (err) {
      check('directory path throws file_unreadable', err instanceof FileSendError && err.code === 'file_unreadable',
        err instanceof FileSendError ? `got code ${err.code}` : String(err));
    }
    // valid mp3 → returns kind 'audio'
    const mp3Path = path.join(tmpDir, 'sample.mp3');
    await fs.promises.writeFile(mp3Path, Buffer.alloc(128));
    const ok = await preflightFile(mp3Path);
    eq('valid mp3 returns kind=audio', ok.kind, 'audio');
    eq('valid mp3 returns bytes=128', ok.bytes, 128);
    check('valid mp3 returns absolute path', path.isAbsolute(ok.absolutePath));
    // unknown extension → kind null but no throw
    const txtPath = path.join(tmpDir, 'notes.txt');
    await fs.promises.writeFile(txtPath, 'hello');
    const txtRes = await preflightFile(txtPath);
    eq('unknown ext returns kind=null', txtRes.kind, null);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }

  // file_too_large is intentionally NOT exercised here (would need to write
  // a 50+MB temp file each run). MAX_BYTES is exposed so callers can verify
  // the constant; the comparison logic is one line and would itself need
  // the same fixture to test meaningfully. Spot-checking the constant:
  eq('MAX_BYTES = 50 MiB', MAX_BYTES, 50 * 1024 * 1024);

  console.log('');
  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('All checks passed.');
}

main().catch((err) => {
  console.error('UNCAUGHT:', err);
  process.exit(1);
});
