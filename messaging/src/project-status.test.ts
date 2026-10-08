/**
 * Telegram project lists honour project status (card #0381).
 *
 *   cd messaging && npx tsx --test src/project-status.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectStatus, pickerProjects, heldCount, statusSuffix } from './project-status.js';

const ps = [
  { id: 'a' }, { id: 'p', status: 'paused' }, { id: 'c', status: 'complete' },
  { id: 'x', status: 'archived' }, { id: 'u', status: 'bogus' },
];

test('absent/unknown status reads as active (lockstep with web + CLI)', () => {
  assert.equal(projectStatus({}), 'active');
  assert.equal(projectStatus({ status: 'bogus' }), 'active');
  assert.equal(projectStatus({ status: 'archived' }), 'archived');
});

test('picker: active only by default; held behind the button; archived never', () => {
  assert.deepEqual(pickerProjects(ps, false).map(p => p.id), ['a', 'u']);
  assert.deepEqual(pickerProjects(ps, true).map(p => p.id), ['a', 'p', 'c', 'u']);
  assert.equal(heldCount(ps), 2);
});

test('status suffix', () => {
  assert.equal(statusSuffix({}), '');
  assert.equal(statusSuffix({ status: 'paused' }), ' (paused)');
});
