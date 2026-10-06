/**
 * Tests for the SLYCODE_SCHEDULER kill switch.
 * Run: ./bridge/node_modules/.bin/tsx --test web/src/lib/scheduler-switch.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSchedulerDisabled } from './scheduler-switch';

test('scheduler runs when SLYCODE_SCHEDULER is unset or empty', () => {
  assert.equal(isSchedulerDisabled({}), false);
  assert.equal(isSchedulerDisabled({ SLYCODE_SCHEDULER: '' }), false);
});

test('off, 0 and false disable the scheduler, case- and whitespace-insensitive', () => {
  for (const value of ['off', 'OFF', ' Off ', '0', 'false', 'FALSE']) {
    assert.equal(isSchedulerDisabled({ SLYCODE_SCHEDULER: value }), true, value);
  }
});

test('any other value leaves the scheduler on', () => {
  for (const value of ['on', '1', 'true', 'yes', 'disabled-ish']) {
    assert.equal(isSchedulerDisabled({ SLYCODE_SCHEDULER: value }), false, value);
  }
});
