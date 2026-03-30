import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { getPackageDir, expandTilde } from '@/lib/paths';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/analyze - Analyze a directory for scaffolding
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { path: targetPath, providers } = body;

    if (!targetPath) {
      return NextResponse.json(
        { error: 'path is required' },
        { status: 400 }
      );
    }

    // Expand tilde and validate absolute path
    const expanded = expandTilde(targetPath);
    if (!path.isAbsolute(expanded)) {
      return NextResponse.json(
        { error: 'Please enter an absolute path (e.g. ~/Dev/myproject or /home/user/Dev/myproject)' },
        { status: 400 }
      );
    }
    const resolvedPath = path.resolve(expanded);

    const scaffoldScript = path.join(getPackageDir(), 'scripts', 'scaffold.js');
    const args = [
      scaffoldScript,
      'analyze',
      '--path', resolvedPath,
      '--json',
    ];
    if (providers && Array.isArray(providers) && providers.length > 0) {
      args.push('--providers', providers.join(','));
    }

    const { stdout } = await execFileAsync('node', args, {
      timeout: 10000,
      windowsHide: true,
    });

    const report = JSON.parse(stdout);
    return NextResponse.json(report);
  } catch (error) {
    console.error('Failed to analyze directory:', error);
    return NextResponse.json(
      { error: 'Failed to analyze directory', details: String(error) },
      { status: 500 }
    );
  }
}
