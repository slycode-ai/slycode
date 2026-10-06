import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_STATEMENTS, consentFor, consentLocaleFor } from './consent-statements.js';
import { customVoiceFix, expiryWarning, recipeKind } from './custom-voices.js';

test('30 consent locales, unique, English the same sentence everywhere', () => {
  assert.equal(CONSENT_STATEMENTS.length, 30);
  assert.equal(new Set(CONSENT_STATEMENTS.map((c) => c.locale.toLowerCase())).size, 30);
  const english = CONSENT_STATEMENTS.filter((c) => c.locale.startsWith('en-')).map((c) => c.statement);
  assert.deepEqual(new Set(english), new Set(['I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.']));
});

test('locale lookup: exact (any case), else the language, else en-US', () => {
  assert.equal(consentFor('EN-au')?.locale, 'en-AU');
  assert.equal(consentFor('en-NZ'), null);
  assert.equal(consentLocaleFor('en-AU'), 'en-AU');
  assert.equal(consentLocaleFor('en-NZ'), 'en-US');
  assert.equal(consentLocaleFor('fr'), 'fr-FR');
  assert.equal(consentLocaleFor(null), 'en-US');
  assert.equal(consentLocaleFor('xx'), 'en-US');
});

test('a cloned voice is fixed by recording again, never by voice design --recreate', () => {
  assert.equal(recipeKind(null), null);
  assert.equal(recipeKind({ provider: 'gemini', name: 'a', description: 'd', model: 'm', createdAt: 'c' }), 'designed', 'older recipes have no type');
  assert.equal(recipeKind({ provider: 'gemini', type: 'replicated', name: 'a', description: '', model: 'm', createdAt: 'c' }), 'cloned');
  const cloned = customVoiceFix('voice_c1', 'cloned', 'alpha');
  assert.match(cloned, /clone it again from new recordings/);
  assert.match(cloned, /voice clone --sample <file\.wav> --consent <file\.wav> --recreate voice_c1 --set --project alpha/);
  assert.doesNotMatch(cloned, /voice design/);
  assert.equal(customVoiceFix('v', true), customVoiceFix('v', 'designed'), 'true still means a designed recipe');
  assert.equal(customVoiceFix('v', false), customVoiceFix('v', null));
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
  assert.match(expiryWarning("Project 'A'", { id: 'voice_c1', name: 'Greg', expiresAt: soon }, 'cloned') ?? '', /expires on .*clone it again/);
});
