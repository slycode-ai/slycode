#!/usr/bin/env node

'use strict';

const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  console.error(`create-slycode requires Node.js >= 20.0.0 (current: ${process.version})`);
  console.error('Please upgrade Node.js: https://nodejs.org/');
  process.exit(1);
}

const { main } = require('../lib/index');
main(process.argv.slice(2)).catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
