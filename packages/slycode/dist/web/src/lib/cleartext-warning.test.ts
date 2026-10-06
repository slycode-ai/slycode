/**
 * Tests for the SLYCODE_CLEARTEXT_WARNING switch.
 * Run: ./bridge/node_modules/.bin/tsx --test web/src/lib/cleartext-warning.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isOffValue, isCleartextWarningDisabled } from './cleartext-warning';

function withWorkspace(envFile: string | null, processValue: string | undefined, fn: () => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleartext-'));
  if (envFile !== null) fs.writeFileSync(path.join(dir, '.env'), envFile);
  const saved = { home: process.env.SLYCODE_HOME, value: process.env.SLYCODE_CLEARTEXT_WARNING };
  process.env.SLYCODE_HOME = dir;
  if (processValue === undefined) delete process.env.SLYCODE_CLEARTEXT_WARNING;
  else process.env.SLYCODE_CLEARTEXT_WARNING = processValue;
  try { fn(); } finally {
    if (saved.home === undefined) delete process.env.SLYCODE_HOME; else process.env.SLYCODE_HOME = saved.home;
    if (saved.value === undefined) delete process.env.SLYCODE_CLEARTEXT_WARNING; else process.env.SLYCODE_CLEARTEXT_WARNING = saved.value;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('off values', () => {
  for (const v of ['off', 'OFF', ' Off ', '0', 'false']) assert.equal(isOffValue(v), true, v);
  for (const v of [undefined, null, '', 'on', '1', 'true']) assert.equal(isOffValue(v), false, String(v));
});

test('warning is on by default (no env, no .env)', () => {
  withWorkspace(null, undefined, () => assert.equal(isCleartextWarningDisabled(), false));
});

test('workspace .env can turn it off', () => {
  withWorkspace('# comment\nSLYCODE_CLEARTEXT_WARNING=off\n', undefined, () => assert.equal(isCleartextWarningDisabled(), true));
});

test('process env wins over the workspace .env', () => {
  withWorkspace('SLYCODE_CLEARTEXT_WARNING=off\n', 'on', () => assert.equal(isCleartextWarningDisabled(), false));
  withWorkspace('SLYCODE_CLEARTEXT_WARNING=on\n', 'off', () => assert.equal(isCleartextWarningDisabled(), true));
});
