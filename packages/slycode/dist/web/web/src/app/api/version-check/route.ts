import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';

export async function GET() {
  const root = getSlycodeRoot();

  // Read installed version
  let current = '0.0.0';
  const pkgPaths = [
    path.join(root, 'node_modules', '@slycode', 'slycode', 'package.json'),
    path.join(root, 'packages', 'slycode', 'package.json'), // dev mode
  ];
  for (const p of pkgPaths) {
    if (existsSync(p)) {
      try {
        current = JSON.parse(readFileSync(p, 'utf-8')).version || '0.0.0';
        break;
      } catch { /* ignore */ }
    }
  }

  // Check latest on npm
  let latest: string | null = null;
  try {
    latest = execSync('npm view @slycode/slycode version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim() || null;
  } catch {
    // npm unreachable or timeout
  }

  const updateAvailable = !!(latest && latest !== current);

  return NextResponse.json({ current, latest, updateAvailable });
}
