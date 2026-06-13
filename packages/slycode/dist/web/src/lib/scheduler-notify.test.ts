/**
 * Regression test for the automation error-notification sink.
 *
 * scheduler.ts:701 once built `sly-messaging send "${msg}"` and ran it through
 * /bin/sh via execSync, escaping only double-quotes — so $(), backticks and
 * backslashes in a card title or failed-subprocess error string reached the
 * shell. The fix passes the message as a single literal argv element to
 * execFileSync (no shell). This test asserts that shape can't regress.
 *
 * Self-contained node:test script (matches scheduler.test.ts). Run via the tsx
 * binary in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/scheduler-notify.test.ts
 *
 * Exits 0 on success, 1 on any assertion failure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildErrorNotificationArgs } from './scheduler';

test('message is a single literal argv element, not a shell string', () => {
  const evilTitle = 'Build $(touch /tmp/pwned) `id`';
  const evilError = 'failed; rm -rf ~ && echo "owned"';
  const { command, args } = buildErrorNotificationArgs(evilTitle, evilError, 'sess-1');

  assert.equal(command, 'sly-messaging');
  // Exactly: ['send', <one message string>] — no extra split-out tokens.
  assert.equal(args.length, 2);
  assert.equal(args[0], 'send');
  // The metacharacters survive verbatim inside the single message element,
  // which is exactly what makes them inert (they are data, not shell syntax).
  assert.ok(args[1].includes('$(touch /tmp/pwned)'));
  assert.ok(args[1].includes('rm -rf ~'));
  assert.ok(args[1].includes('Build'));
});

test('argv delivery is injection-proof at the exec layer (principle check)', () => {
  // Demonstrates the property the fix relies on: a metachar payload passed as
  // an argv element is treated as literal data, never executed. printf echoes
  // its argument unchanged — if a shell were involved, $(...) would expand.
  const payload = '$(echo INJECTED) `echo INJECTED`';
  const out = execFileSync('printf', ['%s', payload], { encoding: 'utf-8' });
  assert.equal(out, payload);
  assert.ok(!out.includes('INJECTED\n') && out === payload, 'payload must not be executed');
});
