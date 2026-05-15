/**
 * Tests for decideSkillState — the pure state-decision function behind the
 * per-project skill-update toast.
 *
 * The web/ package doesn't ship a configured test runner, so this file is a
 * self-contained script. Run via the tsx binary that lives in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/skill-update-status.test.ts
 *
 * It exits 0 on success and 1 on any assertion failure, printing the failing
 * case. Keep it lightweight — node:test/node:assert only, no framework deps.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSkillState, semverGt, parseSemver } from './skill-update-status';

test('parseSemver — coerces permissive forms', () => {
  assert.deepEqual(parseSemver('1.11.0'), { major: 1, minor: 11, patch: 0 });
  assert.deepEqual(parseSemver('1.10'), { major: 1, minor: 10, patch: 0 });
  assert.deepEqual(parseSemver('2'), { major: 2, minor: 0, patch: 0 });
  assert.deepEqual(parseSemver('v1.11.0'), { major: 1, minor: 11, patch: 0 });
  assert.deepEqual(parseSemver('1.11.0-rc1'), { major: 1, minor: 11, patch: 0 });
  assert.equal(parseSemver('foo'), null);
  assert.equal(parseSemver(''), null);
  assert.equal(parseSemver(null), null);
  assert.equal(parseSemver(undefined), null);
});

test('semverGt — orders semver correctly across major/minor/patch', () => {
  assert.equal(semverGt('1.12.0', '1.11.0'), true);
  assert.equal(semverGt('1.11.0', '1.12.0'), false);
  assert.equal(semverGt('1.11.0', '1.11.0'), false);
  assert.equal(semverGt('2.0.0', '1.999.999'), true);
  assert.equal(semverGt('1.11.1', '1.11.0'), true);
  assert.equal(semverGt('1.10', '1.9'), true);     // 1.10 > 1.9 semantically
  assert.equal(semverGt('v1.12', 'v1.11'), true);
  assert.equal(semverGt('foo', '1.0.0'), false);   // unparsable → false
  assert.equal(semverGt('1.0.0', null), false);
});

test('decideSkillState — all current → none', () => {
  const r = decideSkillState({ updatesVersion: null, storeVersion: '1.11.0', projectVersion: '1.11.0' });
  assert.equal(r.state, 'none');
  assert.equal(r.latestVersion, '1.11.0');
});

test('decideSkillState — updates ahead of store → accept', () => {
  const r = decideSkillState({ updatesVersion: '1.12.0', storeVersion: '1.11.0', projectVersion: '1.11.0' });
  assert.equal(r.state, 'accept');
  assert.equal(r.latestVersion, '1.12.0');
});

test('decideSkillState — updates SAME version as store → none (content edit fires UpdatesView, not toast)', () => {
  const r = decideSkillState({ updatesVersion: '1.11.0', storeVersion: '1.11.0', projectVersion: '1.11.0' });
  assert.equal(r.state, 'none');
});

test('decideSkillState — updates OLDER than store → none', () => {
  const r = decideSkillState({ updatesVersion: '1.10.0', storeVersion: '1.11.0', projectVersion: '1.11.0' });
  assert.equal(r.state, 'none');
});

test('decideSkillState — store ahead of project → deploy', () => {
  const r = decideSkillState({ updatesVersion: null, storeVersion: '1.11.0', projectVersion: '1.10.0' });
  assert.equal(r.state, 'deploy');
  assert.equal(r.latestVersion, '1.11.0');
});

test('decideSkillState — both State A and State B → accept (precedence)', () => {
  const r = decideSkillState({ updatesVersion: '1.12.0', storeVersion: '1.11.0', projectVersion: '1.10.0' });
  assert.equal(r.state, 'accept');
  assert.equal(r.latestVersion, '1.12.0');
});

test('decideSkillState — project ahead of store → ahead (no toast)', () => {
  const r = decideSkillState({ updatesVersion: null, storeVersion: '1.11.0', projectVersion: '1.12.0' });
  assert.equal(r.state, 'ahead');
  assert.equal(r.latestVersion, '1.11.0');
});

test('decideSkillState — project missing → none', () => {
  const r = decideSkillState({ updatesVersion: null, storeVersion: '1.11.0', projectVersion: null });
  assert.equal(r.state, 'none');
});

test('decideSkillState — store missing → none', () => {
  const r = decideSkillState({ updatesVersion: null, storeVersion: null, projectVersion: '1.10.0' });
  assert.equal(r.state, 'none');
});

test('decideSkillState — both versions present but unparsable → invalidVersion', () => {
  const r = decideSkillState({ updatesVersion: null, storeVersion: 'foo', projectVersion: 'bar' });
  assert.equal(r.state, 'invalidVersion');
  assert.equal(r.latestVersion, 'foo');
});

test('decideSkillState — coerced version forms compare correctly', () => {
  // 1.10 < v1.11 → store 1.10, project v1.11 → project ahead
  const r = decideSkillState({ updatesVersion: null, storeVersion: '1.10', projectVersion: 'v1.11' });
  assert.equal(r.state, 'ahead');
});

test('decideSkillState — same version strings, parsable, no toast', () => {
  const r = decideSkillState({ updatesVersion: null, storeVersion: '1.11', projectVersion: '1.11.0' });
  assert.equal(r.state, 'none');
});

test('decideSkillState — updates accept precedence over project-ahead-of-store', () => {
  // Edge: project somehow ahead of store AND updates ahead of store. Accept wins
  // since it's the most actionable upstream change.
  const r = decideSkillState({ updatesVersion: '2.0.0', storeVersion: '1.11.0', projectVersion: '1.12.0' });
  assert.equal(r.state, 'accept');
});
