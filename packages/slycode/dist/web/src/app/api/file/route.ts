import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { loadRegistry } from '@/lib/registry';
import { getSlycodeRoot } from '@/lib/paths';

// =============================================================================
// Security Restrictions
// Expand these lists as new use cases arise.
// =============================================================================

// Paths must start with one of these prefixes
const ALLOWED_PATH_PREFIXES = [
  'documentation/',
  'designs/',
  'features/',
  '.claude/',
  '.codex/',
  '.agents/',
  '.gemini/',
  'store/',
  'updates/',
];

// Only these file extensions can be served
const ALLOWED_EXTENSIONS = [
  '.md',
  '.json',
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('path');
  const projectId = searchParams.get('projectId');

  if (!filePath) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }

  // Normalize to forward slashes so prefix checks and regexes work on all OSes.
  // path.join/resolve later will produce OS-native separators for fs access.
  const posixPath = filePath.replace(/\\/g, '/');

  // Security: only allow reading from approved directories
  if (!ALLOWED_PATH_PREFIXES.some(prefix => posixPath.startsWith(prefix))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Security: only allow approved file extensions
  const ext = path.extname(posixPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 403 });
  }

  // Check for directory traversal (on the already-forward-slash-normalized string)
  if (posixPath.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Resolve base directory: master repo root, or a specific project's path
  let baseDir: string;
  if (projectId) {
    const registry = await loadRegistry();
    const project = registry.projects.find(p => p.id === projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    baseDir = project.path;
  } else {
    baseDir = getSlycodeRoot();
  }

  // Dot-prefixed config dirs and root-level dirs are relative to base directly; others go through documentation/
  const isDirectPath = /^\.(claude|codex|agents|gemini)/.test(posixPath) || /^(store|updates)\//.test(posixPath);
  const fullPath = isDirectPath
    ? path.join(baseDir, posixPath)
    : path.join(baseDir, 'documentation', posixPath.replace(/^documentation\//, ''));

  // Security: verify resolved path stays within the project directory
  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(baseDir);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  try {
    const content = await fs.readFile(resolvedPath, 'utf-8');

    return NextResponse.json({
      path: filePath,
      content,
      type: ext === '.md' ? 'markdown' : ext === '.json' ? 'json' : 'text',
    });
  } catch (error) {
    console.error('Failed to read file:', error);
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
