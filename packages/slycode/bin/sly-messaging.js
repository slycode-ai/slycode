#!/usr/bin/env node

'use strict';

/**
 * sly-messaging — Global CLI wrapper for messaging.
 * Resolves the SlyCode workspace and delegates to the messaging CLI.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const { resolveWorkspace } = require('../lib/cli/workspace');

const workspace = resolveWorkspace();
if (!workspace) {
  console.error('Error: Could not find SlyCode workspace.');
  console.error('Set SLYCODE_HOME or run from within a SlyCode project.');
  process.exit(1);
}

// Find the messaging CLI (compiled JS)
const candidates = [
  path.join(workspace, 'messaging', 'dist', 'cli.js'),
  path.join(workspace, 'node_modules', '@slycode', 'slycode', 'dist', 'messaging', 'cli.js'),
];

let cliScript = null;
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    cliScript = candidate;
    break;
  }
}

if (!cliScript) {
  console.error('Error: messaging CLI not found in workspace.');
  console.error(`Looked in: ${workspace}`);
  process.exit(1);
}

// Spawn as a child process (messaging CLI uses ESM imports)
const child = spawn(process.execPath, [cliScript, ...process.argv.slice(2)], {
  cwd: workspace,
  env: { ...process.env, SLYCODE_HOME: workspace },
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
