#!/usr/bin/env node

/**
 * SlyCode Export Script
 *
 * Reads the export manifest (export.config.js) and copies curated files
 * from the dev repo to the public repo.
 *
 * Usage:
 *   node build/export.js              # Export to default target
 *   node build/export.js --dry-run    # Show what would be exported
 *   node build/export.js --target /path/to/public-repo
 *   node build/export.js --verbose    # List every file operation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────────────────────

const DEV_ROOT = path.resolve(__dirname, '..');
const config = require('./export.config.js');

// ── Arg parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const targetIdx = args.indexOf('--target');
const targetArg = targetIdx !== -1 ? args[targetIdx + 1] : null;
const PUB_ROOT = path.resolve(DEV_ROOT, targetArg || config.defaultTarget);

// ── Colors ──────────────────────────────────────────────────────────────

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

// ── Glob matching ───────────────────────────────────────────────────────

/**
 * Simple glob matcher supporting ** and * patterns.
 * No external dependencies needed — the pattern set is small and well-defined.
 */
function matchesGlob(filePath, pattern) {
  // Normalize separators
  const normalized = filePath.replace(/\\/g, '/');
  const parts = pattern.replace(/\\/g, '/');

  // Convert glob to regex using placeholders to avoid ** and * interfering
  const regexStr = parts
    .replace(/\./g, '\\.')                      // Escape dots
    .replace(/\*\*\//g, '\0DSTAR_SLASH\0')      // Placeholder for **/
    .replace(/\*\*/g, '\0DSTAR\0')              // Placeholder for **
    .replace(/\*/g, '[^/]*')                     // * matches within a segment
    .replace(/\0DSTAR_SLASH\0/g, '(.+/)?')      // **/ matches any path segments
    .replace(/\0DSTAR\0/g, '.*');                // ** matches anything

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(normalized);
}

function isExcluded(relativePath) {
  return config.exclude.some((pattern) => matchesGlob(relativePath, pattern));
}

// ── Preserve checking ───────────────────────────────────────────────────

function isPreserved(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  return config.preserve.some((p) => {
    const pNorm = p.replace(/\\/g, '/');
    // Directory preserve (ends with /)
    if (pNorm.endsWith('/')) {
      return normalized === pNorm.slice(0, -1) || normalized.startsWith(pNorm);
    }
    // Exact file match
    return normalized === pNorm;
  });
}

// ── Directory walking ───────────────────────────────────────────────────

function walkDir(dir, relativeTo) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(relativeTo, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, relativeTo));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

// ── File hashing ────────────────────────────────────────────────────────

function fileHash(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(data).digest('hex');
}

function filesAreSame(a, b) {
  try {
    const statA = fs.statSync(a);
    const statB = fs.statSync(b);
    if (statA.size !== statB.size) return false;
    return fileHash(a) === fileHash(b);
  } catch {
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  console.log('');
  console.log(c.bold('SlyCode Export Pipeline'));
  console.log('');
  console.log(`  Dev repo:    ${DEV_ROOT}`);
  console.log(`  Public repo: ${PUB_ROOT}`);
  if (dryRun) console.log(c.yellow('  Mode: DRY RUN (no files will be modified)'));
  console.log('');

  // ── Validate public repo ──────────────────────────────────────────

  if (!fs.existsSync(PUB_ROOT)) {
    console.error(c.red(`Error: Public repo not found at ${PUB_ROOT}`));
    console.error(`  Clone it first: git clone https://github.com/slycode-ai/slycode.git ${PUB_ROOT}`);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(PUB_ROOT, '.git'))) {
    console.error(c.red(`Error: ${PUB_ROOT} is not a git repository`));
    process.exit(1);
  }

  // ── Phase 1: Inventory existing public repo files ─────────────────

  const existingFiles = new Set();
  const allPubFiles = walkDir(PUB_ROOT, PUB_ROOT);
  for (const f of allPubFiles) {
    if (!isPreserved(f)) {
      existingFiles.add(f);
    }
  }

  // ── Phase 2: Resolve manifest to concrete file list ───────────────

  const filesToCopy = []; // { from: absolute, to: absolute, relDest: string }

  for (const mapping of config.mappings) {
    const srcPath = path.resolve(DEV_ROOT, mapping.src);

    if (!fs.existsSync(srcPath)) {
      console.warn(c.yellow(`  Warning: Source not found, skipping: ${mapping.src}`));
      continue;
    }

    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      // Recursive directory copy
      const files = walkDir(srcPath, srcPath);
      for (const relFile of files) {
        const fullRelPath = path.join(mapping.src, relFile).replace(/\\/g, '/');
        if (isExcluded(fullRelPath) || isExcluded(relFile)) continue;

        const destRel = path.join(mapping.dest, relFile).replace(/\\/g, '/');
        filesToCopy.push({
          from: path.join(srcPath, relFile),
          to: path.join(PUB_ROOT, destRel),
          relDest: destRel,
        });
      }
    } else {
      // Single file copy
      const destRel = mapping.dest.replace(/\\/g, '/');
      filesToCopy.push({
        from: srcPath,
        to: path.join(PUB_ROOT, destRel),
        relDest: destRel,
      });
    }
  }

  // ── Phase 3: Compute diff ─────────────────────────────────────────

  const destSet = new Set(filesToCopy.map((f) => f.relDest));

  const toDelete = [];
  for (const existing of existingFiles) {
    if (!destSet.has(existing)) {
      toDelete.push(existing);
    }
  }

  const toAdd = [];
  const toUpdate = [];
  const unchanged = [];

  for (const file of filesToCopy) {
    if (!existingFiles.has(file.relDest)) {
      toAdd.push(file);
    } else if (!filesAreSame(file.from, file.to)) {
      toUpdate.push(file);
    } else {
      unchanged.push(file);
    }
  }

  // ── Phase 4: Print summary ────────────────────────────────────────

  console.log(c.bold('Export summary:'));
  console.log(`  ${c.green(`+ ${toAdd.length} files to add`)}`);
  console.log(`  ${c.cyan(`~ ${toUpdate.length} files to update`)}`);
  console.log(`  ${c.red(`- ${toDelete.length} files to delete`)}`);
  console.log(`  ${c.dim(`= ${unchanged.length} files unchanged`)}`);
  console.log(`  ${c.dim(`  ${config.preserve.length} preserved paths`)}`);
  console.log('');

  if (verbose || dryRun) {
    if (toAdd.length > 0) {
      console.log(c.green('  Files to add:'));
      for (const f of toAdd) console.log(`    + ${f.relDest}`);
      console.log('');
    }
    if (toUpdate.length > 0) {
      console.log(c.cyan('  Files to update:'));
      for (const f of toUpdate) console.log(`    ~ ${f.relDest}`);
      console.log('');
    }
    if (toDelete.length > 0) {
      console.log(c.red('  Files to delete:'));
      for (const f of toDelete) console.log(`    - ${f}`);
      console.log('');
    }
  }

  if (dryRun) {
    console.log(c.yellow('Dry run complete. No files were modified.'));
    process.exit(0);
  }

  // ── Phase 5: Execute ──────────────────────────────────────────────

  // Delete files no longer in manifest
  for (const relPath of toDelete) {
    const fullPath = path.join(PUB_ROOT, relPath);
    fs.unlinkSync(fullPath);
    if (verbose) console.log(`  ${c.red('deleted')} ${relPath}`);
  }

  // Clean up empty directories after deletion
  if (toDelete.length > 0) {
    cleanEmptyDirs(PUB_ROOT);
  }

  // Copy new and updated files
  let totalBytes = 0;
  for (const file of [...toAdd, ...toUpdate]) {
    const dir = path.dirname(file.to);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(file.from, file.to);
    totalBytes += fs.statSync(file.from).size;
    if (verbose) {
      const label = toAdd.includes(file) ? c.green('added') : c.cyan('updated');
      console.log(`  ${label} ${file.relDest}`);
    }
  }

  console.log('');
  console.log(c.green(c.bold('Export complete.')));
  console.log(`  ${toAdd.length + toUpdate.length} files written (${formatBytes(totalBytes)})`);
  console.log(`  ${toDelete.length} files removed`);
  console.log('');
}

// ── Helpers ─────────────────────────────────────────────────────────────

function cleanEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(PUB_ROOT, fullPath).replace(/\\/g, '/');

      // Don't touch preserved directories
      if (isPreserved(relPath) || isPreserved(relPath + '/')) continue;

      cleanEmptyDirs(fullPath);

      // Remove if now empty
      try {
        const remaining = fs.readdirSync(fullPath);
        if (remaining.length === 0) {
          fs.rmdirSync(fullPath);
        }
      } catch {
        // Directory might have been removed already
      }
    }
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Run ─────────────────────────────────────────────────────────────────

try {
  main();
} catch (err) {
  console.error(c.red(`Export failed: ${err.message}`));
  if (verbose) console.error(err.stack);
  process.exit(1);
}
