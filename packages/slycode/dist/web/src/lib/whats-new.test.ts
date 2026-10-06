import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareVersions, findEntry, formatReleaseDate, latestEntry, pickEntry, resolveContentUrl, shortVersion,
  splashAllowedOnPath, validateEntry,
  type WhatsNewEntry,
} from './whats-new';
import {
  loadEntries, readInstalledVersion, readWhatsNewState, resolveWhatsNewAsset, whatsNewStatePath, writeWhatsNewSeen,
} from './whats-new.server';
import { DISCORD_INVITE_URL } from './community-links';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function entry(version: string): WhatsNewEntry {
  return { version, date: '2026-10-06', headline: 'h', intro: 'i', highlights: [] };
}

function rawEntry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '0.5.0',
    date: '2026-10-06',
    headline: 'Headline',
    intro: 'Intro.',
    highlights: [
      { icon: 'palette', title: 'One', body: 'Body one.' },
      { icon: 'zap', title: 'Two', body: 'Body two.' },
    ],
    ...over,
  };
}

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whats-new-'));
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

test('pickEntry: nothing to show without entries or when every entry is newer than installed', () => {
  assert.equal(pickEntry([], '0.5.0', '0.4.10'), null);
  assert.equal(pickEntry([entry('0.6.0')], '0.5.0', '0.4.10'), null);
});

test('pickEntry: an update onto a version with content shows it', () => {
  assert.equal(pickEntry([entry('0.5.0')], '0.5.0', '0.4.10')?.version, '0.5.0');
});

test('pickEntry: skipped patch releases still show the minor release notes', () => {
  assert.equal(pickEntry([entry('0.5.0')], '0.5.2', '0.4.10')?.version, '0.5.0');
});

test('pickEntry: a later patch without content never repeats seen notes', () => {
  assert.equal(pickEntry([entry('0.5.0')], '0.5.1', '0.5.1'), null);
  assert.equal(pickEntry([entry('0.5.0')], '0.5.1', '0.5.0'), null);
});

test('pickEntry: missing lastSeen (install from before the feature) shows the newest entry at or below installed', () => {
  assert.equal(pickEntry([entry('0.4.0'), entry('0.5.0'), entry('0.6.0')], '0.5.3', null)?.version, '0.5.0');
});

test('pickEntry: two unseen entries show only the newest', () => {
  assert.equal(pickEntry([entry('0.5.0'), entry('0.6.0')], '0.6.0', '0.4.10')?.version, '0.6.0');
});

test('pickEntry: unknown installed version shows nothing; garbage lastSeen reads as missing', () => {
  assert.equal(pickEntry([entry('0.5.0')], null, null), null);
  assert.equal(pickEntry([entry('0.5.0')], '0.5.0', 'garbage')?.version, '0.5.0');
});

test('latestEntry / findEntry / compareVersions / shortVersion', () => {
  assert.equal(latestEntry([entry('0.5.0'), entry('0.4.9')], '0.5.0')?.version, '0.5.0');
  assert.equal(latestEntry([entry('0.6.0')], '0.5.0'), null);
  assert.equal(findEntry([entry('0.5.0')], '0.5')?.version, '0.5.0');
  assert.equal(findEntry([entry('0.5.0')], '0.5.1'), null);
  assert.equal(compareVersions('0.4.10', '0.4.9'), 1, 'numeric, not lexical');
  assert.equal(compareVersions('0.5.0', 'x'), null);
  assert.equal(shortVersion('0.5.0'), '0.5');
  assert.equal(shortVersion('0.5.2'), '0.5.2');
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('validateEntry: a minimal valid entry passes', () => {
  const r = validateEntry(rawEntry());
  assert.ok(r.ok);
  assert.equal(r.entry.highlights.length, 2);
});

test('validateEntry: missing required fields and bad dates fail', () => {
  for (const key of ['version', 'date', 'headline', 'intro']) {
    const r = validateEntry(rawEntry({ [key]: undefined }));
    assert.equal(r.ok, false, `${key} missing`);
  }
  assert.equal(validateEntry(rawEntry({ date: '2026-13-01' })).ok, false);
  assert.equal(validateEntry(rawEntry({ date: '2026-10-xx' })).ok, true, 'day placeholder allowed');
  assert.equal(validateEntry(rawEntry({ version: 'next' })).ok, false);
  assert.equal(validateEntry(null).ok, false);
});

test('validateEntry: 1 or 5 highlights fail; 4 pass', () => {
  const h = { icon: 'zap', title: 't', body: 'b' };
  assert.equal(validateEntry(rawEntry({ highlights: [h] })).ok, false);
  assert.equal(validateEntry(rawEntry({ highlights: [h, h, h, h, h] })).ok, false);
  assert.equal(validateEntry(rawEntry({ highlights: [h, h, h, h] })).ok, true);
});

test('validateEntry: an unknown icon falls back to sparkles', () => {
  const r = validateEntry(rawEntry({ highlights: [{ icon: 'rocket', title: 't', body: 'b' }, { icon: 'zap', title: 't', body: 'b' }] }));
  assert.ok(r.ok);
  assert.equal(r.entry.highlights[0].icon, 'sparkles');
});

test('validateEntry: over-length text fails', () => {
  assert.equal(validateEntry(rawEntry({ headline: 'x'.repeat(61) })).ok, false);
  assert.equal(validateEntry(rawEntry({ highlights: [{ icon: 'zap', title: 't', body: 'x'.repeat(181) }, { icon: 'zap', title: 't', body: 'b' }] })).ok, false);
});

test('validateEntry: CTA url must be https or a named link; named links resolve', () => {
  const cta = { title: 'Say hi', body: 'Body', label: 'Join' };
  assert.equal(validateEntry(rawEntry({ cta: { ...cta, url: 'http://example.com' } })).ok, false);
  assert.equal(validateEntry(rawEntry({ cta: { ...cta, url: 'javascript:alert(1)' } })).ok, false);
  assert.equal(validateEntry(rawEntry({ cta: { ...cta, url: 'nope' } })).ok, false);
  const named = validateEntry(rawEntry({ cta: { ...cta, url: 'discord' } }));
  assert.ok(named.ok);
  assert.equal(named.entry.cta?.url, DISCORD_INVITE_URL);
  assert.equal(resolveContentUrl('https://slycode.ai/docs'), 'https://slycode.ai/docs');
});

test('validateEntry: image must be a plain allowed file name', () => {
  assert.equal(validateEntry(rawEntry({ image: '../secret.png' })).ok, false);
  assert.equal(validateEntry(rawEntry({ image: 'hero.gif' })).ok, false);
  assert.equal(validateEntry(rawEntry({ image: '0.5.0-hero.webp' })).ok, true);
});

// ---------------------------------------------------------------------------
// fs side
// ---------------------------------------------------------------------------

test('loadEntries: skips invalid JSON, failed validation and version/filename mismatch', () => {
  const root = scratch();
  const dir = path.join(root, 'data', 'whats-new');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '0.5.0.json'), JSON.stringify(rawEntry()));
  fs.writeFileSync(path.join(dir, '0.6.0.json'), JSON.stringify(rawEntry()));
  fs.writeFileSync(path.join(dir, '0.7.0.json'), '{ not json');
  fs.writeFileSync(path.join(dir, '0.8.0.json'), JSON.stringify(rawEntry({ version: '0.8.0', headline: '' })));
  const warnings: string[] = [];
  const entries = loadEntries(root, m => warnings.push(m));
  assert.deepEqual(entries.map(e => e.version), ['0.5.0']);
  assert.equal(warnings.length, 3);
});

test('loadEntries: prod package templates win over dev data/', () => {
  const root = scratch();
  const prod = path.join(root, 'node_modules', '@slycode', 'slycode', 'templates', 'whats-new');
  const dev = path.join(root, 'data', 'whats-new');
  fs.mkdirSync(prod, { recursive: true });
  fs.mkdirSync(dev, { recursive: true });
  fs.writeFileSync(path.join(prod, '0.6.0.json'), JSON.stringify(rawEntry({ version: '0.6.0' })));
  fs.writeFileSync(path.join(dev, '0.5.0.json'), JSON.stringify(rawEntry()));
  assert.deepEqual(loadEntries(root).map(e => e.version), ['0.6.0']);
  assert.deepEqual(loadEntries(scratch()), [], 'no content folder at all');
});

test('state file: missing or corrupt reads as never seen; write round-trips', async () => {
  const root = scratch();
  assert.equal(readWhatsNewState(root).lastSeenVersion, null);
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(whatsNewStatePath(root), '{ corrupt');
  assert.equal(readWhatsNewState(root).lastSeenVersion, null);
  await writeWhatsNewSeen('0.5.0', root);
  assert.equal(readWhatsNewState(root).lastSeenVersion, '0.5.0');
  assert.deepEqual(fs.readdirSync(path.join(root, 'data')), ['whats-new-state.json'], 'no temp files left behind');
});

test('readInstalledVersion: installed package first, then the dev package', () => {
  const root = scratch();
  assert.equal(readInstalledVersion(root), null);
  fs.mkdirSync(path.join(root, 'packages', 'slycode'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'slycode', 'package.json'), '{"version":"0.4.10"}');
  assert.equal(readInstalledVersion(root), '0.4.10');
  fs.mkdirSync(path.join(root, 'node_modules', '@slycode', 'slycode'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', '@slycode', 'slycode', 'package.json'), '{"version":"0.5.0"}');
  assert.equal(readInstalledVersion(root), '0.5.0');
});

test('resolveWhatsNewAsset: only existing allowlisted files in the content folder', () => {
  const root = scratch();
  const dir = path.join(root, 'data', 'whats-new');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'hero.webp'), 'x');
  fs.writeFileSync(path.join(root, 'data', 'secret.png'), 'x');
  assert.equal(resolveWhatsNewAsset('hero.webp', root), path.join(dir, 'hero.webp'));
  assert.equal(resolveWhatsNewAsset('missing.webp', root), null);
  assert.equal(resolveWhatsNewAsset('../secret.png', root), null);
  assert.equal(resolveWhatsNewAsset('/etc/passwd', root), null);
  assert.equal(resolveWhatsNewAsset('0.5.0.json', root), null);
});

// ---------------------------------------------------------------------------
// Shipped content
// ---------------------------------------------------------------------------

test('shipped content: every data/whats-new file validates and matches its file name', () => {
  const dir = path.join(REPO_ROOT, 'data', 'whats-new');
  const files = fs.readdirSync(dir).filter(n => n.endsWith('.json'));
  assert.ok(files.length > 0);
  const warnings: string[] = [];
  const devOnlyRoot = scratch();
  fs.mkdirSync(path.join(devOnlyRoot, 'data'), { recursive: true });
  fs.cpSync(dir, path.join(devOnlyRoot, 'data', 'whats-new'), { recursive: true });
  assert.equal(loadEntries(devOnlyRoot, m => warnings.push(m)).length, files.length, warnings.join('\n'));
});

test('shipped content: no em or en dashes (launch voice rule)', () => {
  const dir = path.join(REPO_ROOT, 'data', 'whats-new');
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
    const raw = fs.readFileSync(path.join(dir, name), 'utf-8');
    assert.ok(!/[–—]/.test(raw), `${name} contains an em or en dash`);
  }
});

test('the Discord invite lives in one place: community-links.ts', () => {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(tsx?|json)$/.test(ent.name) && /discord\.gg\//.test(fs.readFileSync(p, 'utf-8'))) hits.push(path.relative(REPO_ROOT, p));
    }
  };
  walk(path.join(REPO_ROOT, 'web', 'src'));
  walk(path.join(REPO_ROOT, 'data', 'whats-new'));
  assert.deepEqual(hits.filter(h => !h.endsWith('community-links.ts') && !h.endsWith('whats-new.test.ts')), []);
});

test('splashAllowedOnPath: never on login, setup or the single-document viewer windows', () => {
  for (const p of ['/', '/project/claude-master', '/global']) assert.equal(splashAllowedOnPath(p), true, p);
  for (const p of ['/login', '/setup', '/doc-viewer/x/y.md', '/html-viewer/a']) assert.equal(splashAllowedOnPath(p), false, p);
  assert.equal(splashAllowedOnPath('/logins'), true);
});

test('formatReleaseDate: full date, or month and year for a placeholder day', () => {
  assert.equal(formatReleaseDate('2026-10-06'), '6 October 2026');
  assert.equal(formatReleaseDate('2026-10-xx'), 'October 2026');
});
