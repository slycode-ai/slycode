/**
 * Guard behaviour for stale/unknown provider ids (#0343 review): an id that is
 * no longer a placement target (e.g. a removed provider arriving from a
 * bookmarked URL or cached client) must produce a clean miss / false, never an
 * `undefined[key]` TypeError. The cli-assets routes additionally 400 on
 * supplied-but-unknown ids; these tests pin the lib layer both rely on.
 * Run with: ./bridge/node_modules/.bin/tsx --test web/src/lib/provider-paths.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderId } from './types';
import {
  isProviderId,
  getProviderAssetDir,
  getProviderAssetFilePath,
  getProviderMcpConfigPath,
  getProviderRelativeDir,
  getProviderPaths,
  isAssetTypeSupported,
} from './provider-paths';

const STALE = 'gone-provider' as ProviderId;

test('isProviderId accepts current placement targets and rejects unknown ids', () => {
  for (const id of ['claude', 'agents', 'codex']) assert.equal(isProviderId(id), true, id);
  assert.equal(isProviderId('gone-provider'), false);
  assert.equal(isProviderId(''), false);
  assert.equal(isProviderId(undefined), false);
  assert.equal(isProviderId(42), false);
});

test('path helpers tolerate a stale provider id instead of throwing', () => {
  assert.equal(getProviderAssetDir('/p', STALE, 'skill'), null);
  assert.equal(getProviderAssetFilePath('/p', STALE, 'skill', 'foo'), null);
  assert.equal(getProviderMcpConfigPath('/p', STALE), null);
  assert.equal(getProviderRelativeDir(STALE, 'skill'), null);
  assert.equal(isAssetTypeSupported(STALE, 'skill'), false);
  assert.deepEqual(getProviderPaths(STALE), { skills: null, agents: null, mcpConfig: null });
});

test('known ids still resolve their directories', () => {
  assert.equal(getProviderRelativeDir('claude', 'skill'), '.claude/skills');
  assert.equal(getProviderRelativeDir('codex', 'skill'), '.codex/skills');
  assert.equal(getProviderRelativeDir('agents', 'skill'), '.agents/skills');
  assert.equal(isAssetTypeSupported('codex', 'agent'), false, 'codex has no agents dir');
});
