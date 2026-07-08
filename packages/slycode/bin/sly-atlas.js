#!/usr/bin/env node

'use strict';

/**
 * sly-atlas — Global CLI wrapper for Codebase Atlas management (Code Mode).
 * Resolves the SlyCode workspace and delegates to the atlas script.
 */

const path = require('path');
const fs = require('fs');

// Resolve workspace using the same logic as the main CLI
const { resolveWorkspace } = require('../lib/cli/workspace');

const workspace = resolveWorkspace();
if (!workspace) {
  console.error('Error: Could not find SlyCode workspace.');
  console.error('Set SLYCODE_HOME or run from within a SlyCode project.');
  process.exit(1);
}

// Find the atlas script
const candidates = [
  path.join(workspace, 'scripts', 'atlas.js'),
  path.join(workspace, 'node_modules', '@slycode', 'slycode', 'dist', 'scripts', 'atlas.js'),
];

let atlasScript = null;
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    atlasScript = candidate;
    break;
  }
}

if (!atlasScript) {
  console.error('Error: atlas.js not found in workspace.');
  console.error(`Looked in: ${workspace}`);
  process.exit(1);
}

// Set SLYCODE_HOME for downstream tools
// NOTE: Do not process.chdir(workspace) here — CLI tools should operate on the
// project the user is standing in. The wrapper's job is to locate the script;
// the script's job is to locate its data via CWD-based resolution.
process.env.SLYCODE_HOME = workspace;

// Execute the atlas script in-process
require(atlasScript);
