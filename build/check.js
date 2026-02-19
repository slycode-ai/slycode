#!/usr/bin/env node

/**
 * SlyCode Pre-Publish Safety Checks
 *
 * Validates the public repo after export to ensure no personal data leaked.
 * Run this before publishing to npm.
 *
 * Usage:
 *   node build/check.js                        # Check default target (../slycode)
 *   node build/check.js --target /path/to/repo  # Check specific directory
 */

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────

const DEV_ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const targetIdx = args.indexOf('--target');
const targetArg = targetIdx !== -1 ? args[targetIdx + 1] : null;
const config = require('./export.config.js');
const PUB_ROOT = path.resolve(DEV_ROOT, targetArg || config.defaultTarget);

// ── Colors ──────────────────────────────────────────────────────────────

const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const OK = c.green('OK');
const WARN = c.yellow('WARN');
const FAIL = c.red('FAIL');

// ── File walking ────────────────────────────────────────────────────────

function walkDir(dir, relativeTo, skipDirs = []) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(relativeTo, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (skipDirs.some((s) => relPath === s || relPath.startsWith(s + '/'))) continue;
      results.push(...walkDir(fullPath, relativeTo, skipDirs));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

function findFiles(pattern, cwd) {
  const allFiles = walkDir(cwd, cwd, ['node_modules', '.git']);
  const regex = globToRegex(pattern);
  return allFiles.filter((f) => regex.test(f));
}

function globToRegex(pattern) {
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '\0DSTAR_SLASH\0')
    .replace(/\*\*/g, '\0DSTAR\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0DSTAR_SLASH\0/g, '(.+/)?')
    .replace(/\0DSTAR\0/g, '.*');
  return new RegExp(`^${regexStr}$`);
}

// ── Checks ──────────────────────────────────────────────────────────────

const checks = [
  {
    name: 'No .env files',
    run() {
      const envFiles = findFiles('**/.env', PUB_ROOT)
        .concat(findFiles('**/.env.*', PUB_ROOT));
      if (envFiles.length === 0) return { status: 'ok' };
      return {
        status: 'fail',
        message: `Found ${envFiles.length} .env file(s): ${envFiles.join(', ')}`,
      };
    },
  },

  {
    name: 'No personal kanban data',
    run() {
      const kanbanFiles = findFiles('**/kanban.json', PUB_ROOT);
      for (const relPath of kanbanFiles) {
        // kanban-seed.json in templates is fine
        if (relPath.includes('kanban-seed')) continue;
        // Tutorial project kanban is intentional (pre-seeded tutorial cards)
        if (relPath.includes('templates/tutorial-project/')) continue;
        try {
          const fullPath = path.join(PUB_ROOT, relPath);
          const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
          // Check if it has actual card data
          if (content.cards && content.cards.length > 0) {
            return {
              status: 'fail',
              message: `${relPath} contains ${content.cards.length} cards — personal data!`,
            };
          }
          if (content.stages) {
            const cardCount = Object.values(content.stages).flat().length;
            if (cardCount > 0) {
              return {
                status: 'fail',
                message: `${relPath} contains ${cardCount} cards in stages — personal data!`,
              };
            }
          }
        } catch {
          // Can't parse — might be a seed template, allow it
        }
      }
      return { status: 'ok' };
    },
  },

  {
    name: 'No project registry with personal paths',
    run() {
      const registryMd = path.join(PUB_ROOT, 'projects', 'registry.md');
      if (fs.existsSync(registryMd)) {
        return { status: 'fail', message: 'projects/registry.md exists — personal project list!' };
      }

      const registryJson = path.join(PUB_ROOT, 'projects', 'registry.json');
      if (fs.existsSync(registryJson)) {
        try {
          const content = JSON.parse(fs.readFileSync(registryJson, 'utf-8'));
          const projects = content.projects || [];
          const hasPersonalPaths = projects.some(
            (p) => p.path && (p.path.includes('/home/') || p.path.includes('/Users/'))
          );
          if (hasPersonalPaths) {
            return { status: 'fail', message: 'projects/registry.json contains personal paths!' };
          }
        } catch {
          // Can't parse — allow it
        }
      }
      return { status: 'ok' };
    },
  },

  {
    name: 'No dev CLAUDE.md markers',
    run() {
      const claudePath = path.join(PUB_ROOT, 'CLAUDE.md');
      if (!fs.existsSync(claudePath)) {
        return { status: 'warn', message: 'No CLAUDE.md found in public repo' };
      }

      const content = fs.readFileSync(claudePath, 'utf-8');
      const devMarkers = [
        { text: 'ClaudeMaster', label: 'dev repo name' },
        { text: 'documentation/designs/', label: 'dev design docs path' },
        { text: 'documentation/features/', label: 'dev feature specs path' },
        { text: 'projects/registry.md', label: 'dev registry path' },
      ];

      const found = devMarkers.filter((m) => content.includes(m.text));
      if (found.length > 0) {
        return {
          status: 'fail',
          message: `CLAUDE.md contains dev markers: ${found.map((f) => f.label).join(', ')}`,
        };
      }
      return { status: 'ok' };
    },
  },

  {
    name: 'Version consistency',
    run() {
      const devPkgPath = path.join(DEV_ROOT, 'packages', 'slycode', 'package.json');
      const pubPkgPath = path.join(PUB_ROOT, 'packages', 'slycode', 'package.json');

      if (!fs.existsSync(pubPkgPath)) {
        return { status: 'warn', message: 'packages/slycode/package.json not in public repo yet' };
      }

      const devVersion = JSON.parse(fs.readFileSync(devPkgPath, 'utf-8')).version;
      const pubVersion = JSON.parse(fs.readFileSync(pubPkgPath, 'utf-8')).version;

      if (devVersion !== pubVersion) {
        return {
          status: 'fail',
          message: `Version mismatch: dev=${devVersion}, public=${pubVersion}`,
        };
      }
      return { status: 'ok', message: `v${devVersion}` };
    },
  },

  {
    name: 'Package size',
    run() {
      const pkgDir = path.join(PUB_ROOT, 'packages', 'slycode');
      if (!fs.existsSync(pkgDir)) {
        return { status: 'warn', message: 'packages/slycode/ not found in public repo' };
      }

      const size = dirSize(pkgDir);
      const sizeMB = (size / (1024 * 1024)).toFixed(1);

      if (size > 100 * 1024 * 1024) {
        return { status: 'fail', message: `${sizeMB}MB — exceeds 100MB limit!` };
      }
      if (size > 50 * 1024 * 1024) {
        return { status: 'warn', message: `${sizeMB}MB — approaching 100MB limit` };
      }
      return { status: 'ok', message: `${sizeMB}MB` };
    },
  },

  {
    name: 'No sensitive file patterns',
    run() {
      const sensitivePatterns = [
        '**/*.pem',
        '**/*.key',
        '**/credentials.json',
        '**/secrets.json',
        '**/.npmrc',  // at non-root level (root .npmrc is preserved intentionally)
      ];

      const found = [];
      for (const pattern of sensitivePatterns) {
        const matches = findFiles(pattern, PUB_ROOT);
        // Filter: root .npmrc is OK (it's preserved for publish auth)
        const filtered = matches.filter((f) => !(f === '.npmrc'));
        found.push(...filtered);
      }

      if (found.length > 0) {
        return {
          status: 'fail',
          message: `Sensitive files found: ${found.join(', ')}`,
        };
      }
      return { status: 'ok' };
    },
  },

  {
    name: 'No leaked infrastructure or internal naming',
    run() {
      // Patterns that should never appear in the public repo source files
      const leakedPatterns = [
        { pattern: /taildd104a/i, label: 'Tailscale tailnet ID' },
        { pattern: /ip-\d+-\d+-\d+-\d+\..*\.ts\.net/i, label: 'Tailscale machine hostname' },
        { pattern: /\/home\/ec2-user/g, label: 'dev machine path' },
        { pattern: /CLAUDE_MASTER_ROOT/g, label: 'legacy env var' },
        { pattern: /100\.84\.20\.78/g, label: 'Tailscale device IP' },
      ];

      // Only scan source files (not node_modules, .git, compiled .next, or packaged dist/)
      // packages/slycode/dist/ contains Next.js standalone output that bakes in build-time
      // paths (outputFileTracingRoot, turbopack.root) — this is standard Next.js behavior
      const sourceExts = ['.ts', '.tsx', '.js', '.json', '.md'];
      const skipDirs = ['node_modules', '.git', '.next', 'packages/slycode/dist'];
      const allFiles = walkDir(PUB_ROOT, PUB_ROOT, skipDirs);
      const sourceFiles = allFiles.filter((f) =>
        sourceExts.some((ext) => f.endsWith(ext)) &&
        f !== 'build/check.js' // Skip self — contains patterns as string literals
      );

      const hits = [];
      for (const relPath of sourceFiles) {
        const fullPath = path.join(PUB_ROOT, relPath);
        let content;
        try {
          content = fs.readFileSync(fullPath, 'utf-8');
        } catch {
          continue;
        }
        for (const { pattern, label } of leakedPatterns) {
          // Reset regex lastIndex for global patterns
          pattern.lastIndex = 0;
          if (pattern.test(content)) {
            hits.push(`${relPath} (${label})`);
          }
        }
      }

      if (hits.length > 0) {
        return {
          status: 'fail',
          message: `Leaked patterns found in ${hits.length} file(s):\n    ${hits.slice(0, 10).join('\n    ')}${hits.length > 10 ? `\n    ... and ${hits.length - 10} more` : ''}`,
        };
      }
      return { status: 'ok' };
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────

function dirSize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isDirectory()) {
      total += dirSize(fullPath);
    } else if (entry.isFile()) {
      total += fs.statSync(fullPath).size;
    }
  }
  return total;
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  console.log('');
  console.log(c.bold('SlyCode Pre-Publish Checks'));
  console.log('');
  console.log(`  Public repo: ${PUB_ROOT}`);
  console.log('');

  if (!fs.existsSync(PUB_ROOT)) {
    console.error(c.red(`Error: Public repo not found at ${PUB_ROOT}`));
    process.exit(1);
  }

  let failures = 0;
  let warnings = 0;

  for (const check of checks) {
    const result = check.run();
    const statusLabel =
      result.status === 'ok' ? OK :
      result.status === 'warn' ? WARN :
      FAIL;

    const suffix = result.message ? ` — ${result.message}` : '';
    console.log(`  ${statusLabel}  ${check.name}${suffix}`);

    if (result.status === 'fail') failures++;
    if (result.status === 'warn') warnings++;
  }

  console.log('');

  if (failures > 0) {
    console.log(c.red(c.bold(`${failures} check(s) FAILED. Do not publish.`)));
    process.exit(1);
  } else if (warnings > 0) {
    console.log(c.yellow(`${warnings} warning(s). Review before publishing.`));
    console.log(c.green('All critical checks passed.'));
  } else {
    console.log(c.green(c.bold('All checks passed. Safe to publish.')));
  }
  console.log('');
}

main();
