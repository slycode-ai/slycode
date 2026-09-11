/**
 * Tests for the speaker-permission snapshot line (feature 086).
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/speaker-line.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSpeakerLine, fetchSpeakerState } from './speaker-line';

test('exact wording for on / off / unknown', () => {
  assert.equal(
    formatSpeakerLine('on'),
    'Speaker permission: on (snapshot; use sly-messaging speak only if the user explicitly asked this session for spoken summaries; the command checks current state)',
  );
  assert.equal(
    formatSpeakerLine('off'),
    'Speaker permission: off (snapshot; use sly-messaging speak only if the user explicitly asked this session for spoken summaries; the command checks current state)',
  );
  assert.equal(formatSpeakerLine('unknown').startsWith('Speaker permission: unknown (snapshot;'), true);
});

test('fetchSpeakerState maps bridge responses and failures', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ enabled: true }), { status: 200 })) as typeof fetch;
    assert.equal(await fetchSpeakerState('http://bridge'), 'on');
    globalThis.fetch = (async () => new Response(JSON.stringify({ enabled: false }), { status: 200 })) as typeof fetch;
    assert.equal(await fetchSpeakerState('http://bridge'), 'off');
    globalThis.fetch = (async () => new Response('nope', { status: 502 })) as typeof fetch;
    assert.equal(await fetchSpeakerState('http://bridge'), 'unknown');
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    assert.equal(await fetchSpeakerState('http://bridge'), 'unknown');
    // Timeout: fetch never resolves until aborted
    globalThis.fetch = ((_: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
    })) as unknown as typeof fetch;
    assert.equal(await fetchSpeakerState('http://bridge', 20), 'unknown');
  } finally {
    globalThis.fetch = realFetch;
  }
});
