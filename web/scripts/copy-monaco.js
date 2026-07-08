#!/usr/bin/env node
/**
 * Copy Monaco's AMD distribution into public/ so the Code Mode editor can
 * self-host it (no CDN — deployed installs must work offline). Runs from
 * predev/prebuild. Idempotent: skips when the installed version already
 * matches public/monaco/.version.
 */

const fs = require('fs');
const path = require('path');

const webRoot = path.join(__dirname, '..');
const src = path.join(webRoot, 'node_modules', 'monaco-editor', 'min', 'vs');
const destRoot = path.join(webRoot, 'public', 'monaco');
const dest = path.join(destRoot, 'vs');
const versionFile = path.join(destRoot, '.version');

if (!fs.existsSync(src)) {
  console.error('[copy-monaco] monaco-editor not installed — run npm install first');
  process.exit(0); // don't break unrelated dev flows
}

const version = JSON.parse(
  fs.readFileSync(path.join(webRoot, 'node_modules', 'monaco-editor', 'package.json'), 'utf-8'),
).version;

if (fs.existsSync(versionFile) && fs.readFileSync(versionFile, 'utf-8').trim() === version && fs.existsSync(dest)) {
  process.exit(0);
}

fs.rmSync(destRoot, { recursive: true, force: true });
fs.mkdirSync(destRoot, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
fs.writeFileSync(versionFile, version);
console.log(`[copy-monaco] copied monaco-editor@${version} → public/monaco/vs`);
