/**
 * Export Manifest — SlyCode Public Repo
 *
 * Explicit manifest controlling exactly what gets exported from the dev repo
 * to the public repo.
 *
 * Nothing goes public unless listed here.
 */

module.exports = {
  // Where the public repo lives relative to the dev repo root
  defaultTarget: '../slycode_package',

  // Source → destination mappings
  // Directories are copied recursively. Files are copied individually.
  mappings: [
    // npm packages
    { src: 'packages/slycode/', dest: 'packages/slycode/' },
    { src: 'packages/create-slycode/', dest: 'packages/create-slycode/' },

    // Build infrastructure (the pipeline itself ships in the public repo)
    { src: 'build/build-package.ts', dest: 'build/build-package.ts' },
    { src: 'build/publish.sh', dest: 'build/publish.sh' },
    { src: 'build/export.config.js', dest: 'build/export.config.js' },
    { src: 'build/export.js', dest: 'build/export.js' },
    { src: 'build/check.js', dest: 'build/check.js' },
    { src: 'build/store-manifest.js', dest: 'build/store-manifest.js' },
    { src: 'build/sync-updates.ts', dest: 'build/sync-updates.ts' },

    // Service source code (needed to build the packages)
    { src: 'web/', dest: 'web/' },
    { src: 'bridge/', dest: 'bridge/' },
    { src: 'messaging/', dest: 'messaging/' },

    // Standalone scripts referenced by the slycode package
    { src: 'scripts/kanban.js', dest: 'scripts/kanban.js' },
    { src: 'scripts/scaffold.js', dest: 'scripts/scaffold.js' },

    // Root files (with rename: CLAUDE.release.md becomes CLAUDE.md in public)
    { src: 'CLAUDE.release.md', dest: 'CLAUDE.md' },
    { src: 'README.md', dest: 'README.md' },
    { src: 'LICENSE', dest: 'LICENSE' },
    { src: 'LICENSING.md', dest: 'LICENSING.md' },
  ],

  // Glob patterns to exclude within mapped directories
  // Uses simple wildcard matching: ** matches any path, * matches within a segment
  //
  // IMPORTANT: packages/slycode/dist/ is a self-contained runtime bundle produced
  // by the build step. It intentionally contains node_modules/, .next/, and compiled
  // output that services need at runtime. Excludes MUST be scoped to source directories
  // (web/, bridge/, messaging/, packages/*/src/) and NOT use blanket **/ patterns that
  // would strip runtime dependencies from the packaged dist/.
  exclude: [
    // Source directory build artifacts (not needed in public repo source)
    'web/node_modules/**',
    'web/.next/**',
    'web/dist/**',
    'bridge/node_modules/**',
    'bridge/dist/**',
    'messaging/node_modules/**',
    'messaging/dist/**',
    'packages/slycode/node_modules/**',
    'packages/create-slycode/node_modules/**',

    // Environment and secrets (anywhere)
    '**/.env',
    '**/.env.*',
    '**/.env.example',

    // Runtime state and logs (anywhere)
    '**/nohup.out',
    '**/bridge-sessions.json',
    '**/bridge-config.json',
    '**/messaging-state.json',
    '**/*.log',
  ],

  // Files/dirs in the public repo that export NEVER deletes or overwrites.
  // These are created manually in the public repo and belong there.
  preserve: [
    '.git/',
    '.gitignore',
    '.npmrc',
    'node_modules/',
    'CHANGELOG.md',
    '.github/',
  ],
};
