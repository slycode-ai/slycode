/**
 * Tests for mergeMcpFile — per-server MCP import merge
 * (card-1784368804712: import must never clobber the workspace .mcp.json).
 *
 * The web/ package doesn't ship a configured test runner, so this file is a
 * self-contained script. Run via the tsx binary that lives in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/mcp-merge.test.ts
 *
 * Exits 0 on success, 1 on any assertion failure. Keep it lightweight —
 * node:test/node:assert only, no framework deps.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mergeMcpFile } from './mcp-common';

let dir: string;
let srcPath: string;
let dstPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-merge-test-'));
  srcPath = path.join(dir, 'source', '.mcp.json');
  dstPath = path.join(dir, 'workspace', '.mcp.json');
  fs.mkdirSync(path.dirname(srcPath), { recursive: true });
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeJson(p: string, value: unknown): void {
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

test('import adds new servers while preserving existing ones', () => {
  writeJson(srcPath, { mcpServers: { c: { command: 'run-c' } } });
  writeJson(dstPath, { mcpServers: { a: { command: 'run-a' }, b: { command: 'run-b' } } });

  const result = mergeMcpFile(srcPath, dstPath);

  assert.deepEqual(result, { imported: ['c'], skipped: [] });
  const dst = readJson(dstPath);
  assert.deepEqual(Object.keys(dst.mcpServers as object).sort(), ['a', 'b', 'c']);
  assert.deepEqual((dst.mcpServers as Record<string, unknown>).a, { command: 'run-a' });
});

test('duplicate server names are skipped, not overwritten', () => {
  writeJson(srcPath, { mcpServers: { a: { command: 'DIFFERENT' }, c: { command: 'run-c' } } });
  writeJson(dstPath, { mcpServers: { a: { command: 'run-a' } } });

  const result = mergeMcpFile(srcPath, dstPath);

  assert.deepEqual(result, { imported: ['c'], skipped: ['a'] });
  const dst = readJson(dstPath);
  assert.deepEqual(
    (dst.mcpServers as Record<string, unknown>).a,
    { command: 'run-a' },
    'existing entry must win',
  );
});

test('unrelated top-level keys in the destination survive', () => {
  writeJson(srcPath, { mcpServers: { c: { command: 'run-c' } } });
  writeJson(dstPath, { mcpServers: { a: { command: 'run-a' } }, someOtherSetting: { nested: true } });

  mergeMcpFile(srcPath, dstPath);

  const dst = readJson(dstPath);
  assert.deepEqual(dst.someOtherSetting, { nested: true });
});

test('corrupt destination JSON errors and leaves the file untouched', () => {
  const corrupt = '{ "mcpServers": { broken';
  writeJson(srcPath, { mcpServers: { c: { command: 'run-c' } } });
  fs.writeFileSync(dstPath, corrupt);

  assert.throws(() => mergeMcpFile(srcPath, dstPath), /refusing to overwrite/);
  assert.equal(fs.readFileSync(dstPath, 'utf-8'), corrupt, 'corrupt file must not be clobbered');
});

test('corrupt source JSON errors without touching the destination', () => {
  fs.writeFileSync(srcPath, 'not json');
  writeJson(dstPath, { mcpServers: { a: { command: 'run-a' } } });
  const before = fs.readFileSync(dstPath, 'utf-8');

  assert.throws(() => mergeMcpFile(srcPath, dstPath), /not valid JSON/);
  assert.equal(fs.readFileSync(dstPath, 'utf-8'), before);
});

test('missing destination is created with the source servers', () => {
  writeJson(srcPath, { mcpServers: { c: { command: 'run-c' } } });
  fs.rmSync(path.dirname(dstPath), { recursive: true, force: true });

  const result = mergeMcpFile(srcPath, dstPath);

  assert.deepEqual(result, { imported: ['c'], skipped: [] });
  assert.deepEqual(readJson(dstPath), { mcpServers: { c: { command: 'run-c' } } });
});

test('source without mcpServers is a no-op merge that still writes a valid destination', () => {
  writeJson(srcPath, {});
  writeJson(dstPath, { mcpServers: { a: { command: 'run-a' } } });

  const result = mergeMcpFile(srcPath, dstPath);

  assert.deepEqual(result, { imported: [], skipped: [] });
  assert.deepEqual(Object.keys(readJson(dstPath).mcpServers as object), ['a']);
});
