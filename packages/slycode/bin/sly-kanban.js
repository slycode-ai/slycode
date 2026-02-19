#!/usr/bin/env node

'use strict';

/**
 * sly-kanban — Global CLI wrapper for kanban management.
 * Resolves the SlyCode workspace and delegates to the kanban script.
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

// Find the kanban script
const candidates = [
  path.join(workspace, 'scripts', 'kanban.js'),
  path.join(workspace, 'node_modules', '@slycode', 'slycode', 'dist', 'scripts', 'kanban.js'),
];

let kanbanScript = null;
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    kanbanScript = candidate;
    break;
  }
}

if (!kanbanScript) {
  console.error('Error: kanban.js not found in workspace.');
  console.error(`Looked in: ${workspace}`);
  process.exit(1);
}

// Set working directory to workspace so kanban.js can find its files
process.chdir(workspace);

// Set SLYCODE_HOME for downstream tools
process.env.SLYCODE_HOME = workspace;

// Execute the kanban script in-process
require(kanbanScript);
