/**
 * What's new (feature #0379), fs side: where release content lives, the
 * per-install "seen" state and the installed version.
 *
 * Seen state is per install, not per browser: data/whats-new-state.json
 * (gitignored machine state, like provider-prefs.json). create-slycode seeds it
 * with the installed version so a fresh install never shows a splash; an
 * install with no file predates the feature and gets the current release's.
 */
import fs from 'fs';
import path from 'path';
import { getSlycodeRoot } from './paths';
import { atomicWriteFile } from './atomic-write';
import { IMAGE_NAME_RE, validateEntry, type WhatsNewEntry } from './whats-new';

export interface WhatsNewState {
  lastSeenVersion: string | null;
}

/** Content folders, prod first: templates in the installed package, then dev source. */
export function whatsNewDirs(root = getSlycodeRoot()): string[] {
  return [
    path.join(root, 'node_modules', '@slycode', 'slycode', 'templates', 'whats-new'),
    path.join(root, 'data', 'whats-new'),
  ];
}

/** The first content folder that exists, or null. */
export function whatsNewDir(root = getSlycodeRoot()): string | null {
  return whatsNewDirs(root).find(d => fs.existsSync(d)) ?? null;
}

/**
 * Every valid entry in the content folder. Invalid files (bad JSON, failed
 * validation, version not matching the file name) are skipped with one warning.
 */
export function loadEntries(root = getSlycodeRoot(), warn: (msg: string) => void = m => console.warn(m)): WhatsNewEntry[] {
  const dir = whatsNewDir(root);
  if (!dir) return [];
  const out: WhatsNewEntry[] = [];
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    try {
      const result = validateEntry(JSON.parse(fs.readFileSync(file, 'utf-8')));
      if (!result.ok) { warn(`[whats-new] ${name} skipped: ${result.errors.join('; ')}`); continue; }
      if (`${result.entry.version}.json` !== name) { warn(`[whats-new] ${name} skipped: version "${result.entry.version}" does not match the file name`); continue; }
      out.push(result.entry);
    } catch (err) {
      warn(`[whats-new] ${name} skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

export function whatsNewStatePath(root = getSlycodeRoot()): string {
  return path.join(root, 'data', 'whats-new-state.json');
}

/** A missing or unreadable state file reads as "never seen anything". */
export function readWhatsNewState(root = getSlycodeRoot()): WhatsNewState {
  try {
    const parsed = JSON.parse(fs.readFileSync(whatsNewStatePath(root), 'utf-8'));
    return { lastSeenVersion: typeof parsed?.lastSeenVersion === 'string' ? parsed.lastSeenVersion : null };
  } catch {
    return { lastSeenVersion: null };
  }
}

export async function writeWhatsNewSeen(version: string, root = getSlycodeRoot()): Promise<void> {
  const file = whatsNewStatePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, JSON.stringify({ lastSeenVersion: version, seenAt: new Date().toISOString() }, null, 2) + '\n');
}

/** Installed SlyCode version, read the same way as /api/version-check. Null when unknown. */
export function readInstalledVersion(root = getSlycodeRoot()): string | null {
  for (const p of [
    path.join(root, 'node_modules', '@slycode', 'slycode', 'package.json'),
    path.join(root, 'packages', 'slycode', 'package.json'), // dev
  ]) {
    try {
      const v = JSON.parse(fs.readFileSync(p, 'utf-8')).version;
      if (typeof v === 'string' && v) return v;
    } catch { /* try the next */ }
  }
  return null;
}

/** Absolute path of a content image, or null if the name is not allowed or the file is missing. */
export function resolveWhatsNewAsset(name: string, root = getSlycodeRoot()): string | null {
  if (!IMAGE_NAME_RE.test(name)) return null;
  const dir = whatsNewDir(root);
  if (!dir) return null;
  const file = path.join(dir, name);
  if (path.dirname(file) !== dir) return null;
  try {
    return fs.lstatSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}
