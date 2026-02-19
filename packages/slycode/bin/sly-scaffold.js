#!/usr/bin/env node

'use strict';

/**
 * sly-scaffold — Global CLI wrapper for project scaffolding.
 * Resolves the SlyCode workspace and delegates to the scaffold script.
 */

const path = require('path');
const fs = require('fs');

const { resolveWorkspace } = require('../lib/cli/workspace');

const workspace = resolveWorkspace();
if (!workspace) {
  console.error('Error: Could not find SlyCode workspace.');
  console.error('Set SLYCODE_HOME or run from within a SlyCode project.');
  process.exit(1);
}

// Find the scaffold script
const candidates = [
  path.join(workspace, 'scripts', 'scaffold.js'),
  path.join(workspace, 'node_modules', '@slycode', 'slycode', 'dist', 'scripts', 'scaffold.js'),
];

let scaffoldScript = null;
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    scaffoldScript = candidate;
    break;
  }
}

if (!scaffoldScript) {
  console.error('Error: scaffold.js not found in workspace.');
  console.error(`Looked in: ${workspace}`);
  process.exit(1);
}

// Set working directory to workspace
process.chdir(workspace);

// Set SLYCODE_HOME for downstream tools
process.env.SLYCODE_HOME = workspace;

// Execute the scaffold script in-process
require(scaffoldScript);
