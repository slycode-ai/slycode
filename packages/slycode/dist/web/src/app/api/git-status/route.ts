/**
 * Git Status API — GET /api/git-status
 *
 * Returns uncommitted file counts for each registered project.
 * Uses `git status --porcelain` to count modified/untracked files.
 */

import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { loadRegistry } from '@/lib/registry';

export const dynamic = 'force-dynamic';

function getUncommittedCount(projectPath: string): number {
  try {
    const output = execSync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });
    // Each non-empty line = one changed file
    return output.split('\n').filter(line => line.trim().length > 0).length;
  } catch {
    return -1; // Not a git repo or error
  }
}

export async function GET() {
  try {
    const registry = await loadRegistry();

    const status: Record<string, number> = {};
    for (const project of registry.projects) {
      status[project.id] = getUncommittedCount(project.path);
    }

    return NextResponse.json(status);
  } catch (error) {
    console.error('Failed to get git status:', error);
    return NextResponse.json(
      { error: 'Failed to get git status', details: String(error) },
      { status: 500 },
    );
  }
}
