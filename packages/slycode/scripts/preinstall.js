/* eslint-disable no-console */
// Native-dependency preflight for @slycode/slycode.
//
// Runs before npm installs our dependencies. node-pty 1.2.0-beta.12 ships
// prebuilds for darwin-{arm64,x64}, win32-{arm64,x64}, linux-{arm64,x64}.
// Anyone on a platform/arch outside that matrix (musl/Alpine, FreeBSD,
// linux-armv7, etc.) still falls back to a source build via node-gyp and
// needs a C/C++ toolchain. This script detects that case and prints
// actionable, platform-specific guidance to stderr BEFORE node-gyp fails.
//
// Rules:
// - Pure Node, no third-party requires (deps not yet installed).
// - Wrap everything in try/catch and ALWAYS exit 0. A bug here must never
//   block a working install.
// - Quiet on success: when the platform has a prebuild or the toolchain is
//   plausibly complete, print nothing.
// - Warn-and-continue: if tools look missing, print the warning to stderr
//   and let node-gyp produce its own (now-explained) failure.
//
// Keep wording in sync with: packages/slycode/src/cli/doctor.ts,
// packages/slycode/README.md, scripts/setup.sh:check_build_tools().

'use strict';

const { spawnSync } = require('child_process');
const os = require('os');

const PREBUILT_PLATFORMS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'win32-arm64',
  'win32-x64',
  'linux-arm64',
  'linux-x64',
]);

function has(cmd) {
  if (process.platform === 'win32') {
    return spawnSync('where', [cmd], { stdio: 'ignore', windowsHide: true }).status === 0;
  }
  return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore', windowsHide: true }).status === 0;
}

function detectPackageManager() {
  if (has('dnf')) return { name: 'dnf', cmd: 'sudo dnf install -y gcc gcc-c++ make python3' };
  if (has('yum')) return { name: 'yum', cmd: 'sudo yum install -y gcc gcc-c++ make python3' };
  if (has('apt-get')) return { name: 'apt-get', cmd: 'sudo apt-get update && sudo apt-get install -y build-essential python3' };
  if (has('apk')) return { name: 'apk', cmd: 'sudo apk add --no-cache build-base python3' };
  if (has('pacman')) return { name: 'pacman', cmd: 'sudo pacman -S --needed base-devel python' };
  if (has('brew')) return { name: 'brew', cmd: 'xcode-select --install' };
  return null;
}

function findMissingCategories() {
  const missing = [];
  const hasC = !!process.env.CC || has('gcc') || has('clang') || has('cc');
  const hasCxx = !!process.env.CXX || has('g++') || has('clang++') || has('c++');
  const hasMake = has('make');
  const hasPython = has('python3') || has('python');
  if (!hasC) missing.push('C compiler (gcc/clang/cc, or set CC)');
  if (!hasCxx) missing.push('C++ compiler (g++/clang++/c++, or set CXX)');
  if (!hasMake) missing.push('make');
  if (!hasPython) missing.push('python3');
  return missing;
}

function main() {
  const platform = process.platform;
  const arch = process.arch;
  const key = `${platform}-${arch}`;

  if (PREBUILT_PLATFORMS.has(key)) return;

  const missing = findMissingCategories();
  if (missing.length === 0) return;

  const lines = [];
  lines.push('');
  lines.push('[slycode] Preflight: this platform requires a local C/C++ build for node-pty.');
  lines.push(`Platform: ${platform}-${arch} (no matching prebuild).`);
  lines.push(`Missing: ${missing.join(', ')}.`);
  lines.push('');

  const pm = detectPackageManager();
  if (pm) {
    lines.push(`Install with (${pm.name}):`);
    lines.push(`  ${pm.cmd}`);
  } else if (platform === 'win32') {
    lines.push('Windows: install Visual Studio Build Tools (Desktop development with C++ workload) and Python 3.');
  } else {
    lines.push("Install a C/C++ toolchain (compilers, make, python3) using your distribution's package manager.");
  }
  lines.push('');
  lines.push("Continuing install — node-pty's source build will produce its own error if the toolchain is incomplete.");
  lines.push('');

  process.stderr.write(lines.join('\n'));
}

try {
  main();
} catch (_err) {
  // Detection bugs must never block installs. Stay silent.
} finally {
  process.exit(0);
}
