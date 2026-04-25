import { NextResponse } from 'next/server';
import { loadRegistry, saveRegistry } from '@/lib/registry';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { getSlycodeRoot, getPackageDir, expandTilde } from '@/lib/paths';
import { ensureProjectSessionKey } from '@/lib/session-keys';
import type { Project } from '@/lib/types';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';

function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * GET /api/projects - List all projects
 */
export async function GET() {
  try {
    const registry = await loadRegistry();
    return NextResponse.json(registry.projects);
  } catch (error) {
    console.error('Failed to load projects:', error);
    return NextResponse.json(
      { error: 'Failed to load projects' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects - Create a new project with scaffolding
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, path: projectPath, tags, scaffoldConfig, providers } = body;

    if (!name || !projectPath) {
      return NextResponse.json(
        { error: 'name and path are required' },
        { status: 400 }
      );
    }

    // Resolve tilde and validate absolute path
    const expanded = expandTilde(projectPath);
    if (!path.isAbsolute(expanded)) {
      return NextResponse.json(
        { error: 'Please enter an absolute path (e.g. ~/Dev/myproject or /home/user/Dev/myproject)' },
        { status: 400 }
      );
    }
    const resolvedPath = path.resolve(expanded);

    const registry = await loadRegistry();
    const projectId = toKebabCase(name);

    // Check for duplicate by ID or path
    if (registry.projects.some((p) => p.id === projectId)) {
      return NextResponse.json(
        { error: `Project with id '${projectId}' already exists` },
        { status: 409 }
      );
    }
    if (registry.projects.some((p) => p.path === resolvedPath)) {
      const existing = registry.projects.find((p) => p.path === resolvedPath);
      return NextResponse.json(
        { error: `This directory is already registered as '${existing?.name}'` },
        { status: 409 }
      );
    }

    // Run scaffold script
    const scaffoldScript = path.join(getPackageDir(), 'scripts', 'scaffold.js');
    const args = [
      scaffoldScript,
      'create',
      '--path', resolvedPath,
      '--name', name,
      '--id', projectId,
    ];
    if (description) {
      args.push('--description', description);
    }
    if (providers && Array.isArray(providers) && providers.length > 0) {
      args.push('--providers', providers.join(','));
    }
    if (scaffoldConfig) {
      args.push('--config', JSON.stringify(scaffoldConfig));
    }

    const { stdout, stderr } = await execFileAsync('node', args, {
      timeout: 30000,
      windowsHide: true,
    });

    let scaffoldResult;
    try {
      scaffoldResult = JSON.parse(stdout);
    } catch {
      return NextResponse.json(
        { error: 'Scaffold script returned invalid output', details: stdout, stderr },
        { status: 500 }
      );
    }

    if (!scaffoldResult.success) {
      return NextResponse.json(
        { error: 'Scaffolding failed', details: scaffoldResult },
        { status: 500 }
      );
    }

    // Add to registry. Compute sessionKey + aliases up front so the entry is
    // complete on first write — loadRegistry() would backfill on next read,
    // but callers using the POST response immediately need the canonical key.
    const newProject: Project = {
      id: projectId,
      name,
      description: description || '',
      path: resolvedPath,
      hasClaudeMd: true,
      masterCompliant: true,
      areas: [] as string[],
      tags: tags || [],
    };
    ensureProjectSessionKey(newProject);

    registry.projects.push(newProject);
    registry.lastUpdated = new Date().toISOString();
    await saveRegistry(registry);

    return NextResponse.json({
      project: newProject,
      scaffold: scaffoldResult,
    }, { status: 201 });
  } catch (error) {
    console.error('Failed to create project:', error);
    return NextResponse.json(
      { error: 'Failed to create project', details: String(error) },
      { status: 500 }
    );
  }
}
