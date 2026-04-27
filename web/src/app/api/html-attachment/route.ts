import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { loadRegistry } from '@/lib/registry';
import { getSlycodeRoot } from '@/lib/paths';

// HTML attachments are served raw with a tightened CSP that lets common
// CDN-hosted libraries load but blocks every exfiltration vector we know about.
// Inline rendering (CardModal iframe) and the viewer route both fetch through
// here so the policy is enforced once.

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

const ALLOWED_EXTENSIONS = ['.html', '.htm'];

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  "font-src https: data:",
  "img-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get('path');
  const projectId = searchParams.get('projectId');

  if (!filePath) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }

  const posixPath = filePath.replace(/\\/g, '/');

  if (!ALLOWED_PATH_PREFIXES.some(prefix => posixPath.startsWith(prefix))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const ext = path.extname(posixPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 403 });
  }

  if (posixPath.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

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

  const isDirectPath = /^\.(claude|codex|agents|gemini)/.test(posixPath) || /^(store|updates)\//.test(posixPath);
  const fullPath = isDirectPath
    ? path.join(baseDir, posixPath)
    : path.join(baseDir, 'documentation', posixPath.replace(/^documentation\//, ''));

  const resolvedPath = path.resolve(fullPath);
  const resolvedBase = path.resolve(baseDir);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  let content: string;
  try {
    content = await fs.readFile(resolvedPath, 'utf-8');
  } catch (error) {
    console.error('Failed to read HTML attachment:', error);
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Cache-Control': 'no-store',
    },
  });
}
