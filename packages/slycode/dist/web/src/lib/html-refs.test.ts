/**
 * Tests for getHtmlRefs — read-time normalization of HTML attachment refs
 * (feature 072: legacy single html_ref + html_refs list).
 *
 * The web/ package doesn't ship a configured test runner, so this file is a
 * self-contained script (same convention as input-queue.test.ts):
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/html-refs.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHtmlRefs } from './html-refs';

test('neither field → empty list', () => {
  assert.deepEqual(getHtmlRefs({}), []);
});

test('legacy html_ref only → one-item list', () => {
  assert.deepEqual(getHtmlRefs({ html_ref: 'documentation/designs/a.html' }), [
    'documentation/designs/a.html',
  ]);
});

test('html_refs only → list as-is', () => {
  assert.deepEqual(
    getHtmlRefs({ html_refs: ['documentation/designs/a.html', 'documentation/designs/b.html'] }),
    ['documentation/designs/a.html', 'documentation/designs/b.html']
  );
});

test('both fields → legacy first, then list', () => {
  assert.deepEqual(
    getHtmlRefs({
      html_ref: 'documentation/designs/legacy.html',
      html_refs: ['documentation/designs/a.html'],
    }),
    ['documentation/designs/legacy.html', 'documentation/designs/a.html']
  );
});

test('both fields with duplicate → deduped, list order preserved', () => {
  assert.deepEqual(
    getHtmlRefs({
      html_ref: 'documentation/designs/a.html',
      html_refs: ['documentation/designs/a.html', 'documentation/designs/b.html'],
    }),
    ['documentation/designs/a.html', 'documentation/designs/b.html']
  );
});

test('malformed html_refs (non-array) tolerated', () => {
  assert.deepEqual(
    getHtmlRefs({
      html_ref: 'documentation/designs/a.html',
      // Simulates hand-edited kanban.json
      html_refs: 'documentation/designs/b.html' as unknown as string[],
    }),
    ['documentation/designs/a.html']
  );
});
