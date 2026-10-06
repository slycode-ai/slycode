/**
 * Tests for docViewerHref — the standalone Markdown doc viewer URL (card #0372).
 *
 *   ./bridge/node_modules/.bin/tsx --test web/src/lib/doc-refs.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docViewerHref } from './doc-refs';

test('path segments become route segments, projectId + kind in the query', () => {
  assert.equal(
    docViewerHref('documentation/designs/foo.md', 'claude-master', 'design'),
    '/doc-viewer/documentation/designs/foo.md?projectId=claude-master&kind=design'
  );
});

test('kind is optional', () => {
  assert.equal(
    docViewerHref('documentation/features/074_x.md', 'p1'),
    '/doc-viewer/documentation/features/074_x.md?projectId=p1'
  );
});

test('each segment is encoded on its own (spaces, #, ?, %) — slashes stay', () => {
  const href = docViewerHref('documentation/my docs/a#b?c%d.md', 'p 1', 'test');
  assert.equal(href, '/doc-viewer/documentation/my%20docs/a%23b%3Fc%25d.md?projectId=p+1&kind=test');
  // Round-trip: decoding each route segment restores the original ref.
  const route = href.slice('/doc-viewer/'.length, href.indexOf('?'));
  assert.equal(route.split('/').map(decodeURIComponent).join('/'), 'documentation/my docs/a#b?c%d.md');
});
