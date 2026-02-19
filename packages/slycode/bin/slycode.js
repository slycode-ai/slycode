#!/usr/bin/env node

'use strict';

// Check Node version
const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`SlyCode requires Node.js >= 20.0.0 (current: ${process.version})`);
  console.error('Please upgrade Node.js: https://nodejs.org/');
  process.exit(1);
}

const { main } = require('../lib/cli/index');
main(process.argv.slice(2)).catch((err) => {
  console.error('Fatal error:', err.message || err);
  process.exit(1);
});
