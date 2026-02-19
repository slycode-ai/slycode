import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { resolveWorkspace, getStateDir } from './workspace';
import { unlinkClis } from '../platform/symlinks';

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

export async function uninstall(_args: string[]): Promise<void> {
  const workspace = resolveWorkspace();
  const stateDir = getStateDir();

  console.log('SlyCode Uninstall');
  console.log('=================');
  console.log('');
  console.log('This will:');
  console.log('  - Stop any running services');
  console.log('  - Remove system services (if installed)');
  console.log('  - Remove global CLI links (slycode, sly-kanban, sly-messaging, sly-scaffold)');
  console.log(`  - Remove state directory (~/.slycode)`);
  console.log('');
  console.log('Note: ~/.slycode contains the workspace pointer used by global CLI commands.');
  console.log('Removing it means global commands won\'t find your workspace until you');
  console.log('re-run create-slycode or set the SLYCODE_HOME environment variable.');
  console.log('');
  if (workspace) {
    console.log(`Your workspace at ${workspace} will NOT be removed.`);
    console.log('Your skills, commands, kanban data, and other files are preserved.');
  }
  console.log('');

  const ok = await confirm('Continue with uninstall?');
  if (!ok) {
    console.log('Cancelled.');
    return;
  }

  console.log('');

  // 1. Stop services
  try {
    const { stop } = await import('./stop');
    await stop([]);
  } catch {
    // May fail if nothing is running
  }

  // 2. Remove system services
  try {
    const { service } = await import('./service');
    await service(['remove']);
  } catch {
    // May fail if not installed
  }

  // 3. Remove global CLI links
  try {
    unlinkClis();
  } catch {
    console.log('  Could not remove CLI links (may not be installed)');
  }

  // 4. Remove state directory
  if (fs.existsSync(stateDir)) {
    fs.rmSync(stateDir, { recursive: true, force: true });
    console.log(`  \u2713 Removed ${stateDir}`);
  }

  console.log('');
  console.log('SlyCode uninstalled.');
  if (workspace) {
    console.log(`Your workspace at ${workspace} is intact.`);
    console.log(`To fully remove, delete the workspace: rm -rf ${workspace}`);
  }
}
