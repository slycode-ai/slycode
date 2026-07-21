/**
 * Code Mode file access — the editor escape hatch (feature 076).
 *
 * GET  /api/atlas/file?projectId=<id>&path=<repo-relative>   → content
 * PUT  /api/atlas/file  { projectId, path, content,
 *                         baseMtimeMs?, force? }              → save
 *
 * Conflict guard: when the client sends `baseMtimeMs` (the mtime it loaded)
 * and the file on disk has a different mtime, the save is refused with 409
 * `{ error: 'conflict', mtimeMs }` unless `force: true` — the editor prompts
 * reload-or-overwrite instead of silently clobbering a concurrent agent
 * write. Omitting `baseMtimeMs` keeps the old unconditional-write behavior.
 *
 * Deliberately broader than /api/file (which serves whitelisted doc types):
 * ANY file inside the project root is readable/writable — dotfiles and .env
 * included, per the design decision. Containment (never escaping the project
 * root) is the single guard; binaries and oversized files are refused.
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import {
  resolveProject,
  containedPath,
  looksBinary,
  MAX_FILE_BYTES,
  AtlasPathError,
} from '@/lib/atlas/fs-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const project = await resolveProject(searchParams.get('projectId'));
    const relPath = searchParams.get('path');
    if (!relPath) return NextResponse.json({ error: 'path required' }, { status: 400 });
    const abs = containedPath(project.root, relPath);

    const stat = await fs.stat(abs);
    if (!stat.isFile()) return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    if (stat.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'file_too_large', maxBytes: MAX_FILE_BYTES }, { status: 413 });
    }
    const buf = await fs.readFile(abs);
    if (looksBinary(buf)) {
      return NextResponse.json({ error: 'binary_file' }, { status: 415 });
    }
    return NextResponse.json({
      path: relPath.replace(/\\/g, '/'),
      content: buf.toString('utf-8'),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      language: languageFromExt(path.extname(abs).toLowerCase()),
    });
  } catch (error) {
    return errorResponse(error, 'read');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const project = await resolveProject(body.projectId ?? null);
    const relPath: string | undefined = body.path;
    const content: string | undefined = body.content;
    if (!relPath || typeof content !== 'string') {
      return NextResponse.json({ error: 'path and content required' }, { status: 400 });
    }
    if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'file_too_large', maxBytes: MAX_FILE_BYTES }, { status: 413 });
    }
    const abs = containedPath(project.root, relPath);

    // Only save over existing files — the editor opens files, it doesn't create them.
    let st;
    try {
      st = await fs.stat(abs);
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (!st.isFile()) return NextResponse.json({ error: 'Not a file' }, { status: 400 });

    const baseMtimeMs = typeof body.baseMtimeMs === 'number' ? body.baseMtimeMs : undefined;
    if (baseMtimeMs !== undefined && body.force !== true && st.mtimeMs !== baseMtimeMs) {
      return NextResponse.json({ error: 'conflict', mtimeMs: st.mtimeMs }, { status: 409 });
    }

    // Atomic-ish: temp + rename in the same directory.
    const tmp = abs + `.slycode-tmp-${process.pid}`;
    await fs.writeFile(tmp, content, 'utf-8');
    await fs.rename(tmp, abs);
    const stat = await fs.stat(abs);
    return NextResponse.json({ ok: true, mtimeMs: stat.mtimeMs, size: stat.size });
  } catch (error) {
    return errorResponse(error, 'write');
  }
}

function errorResponse(error: unknown, op: string) {
  if (error instanceof AtlasPathError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return NextResponse.json({ error: 'File not found' }, { status: 404 });
  console.error(`[atlas/file] ${op} failed:`, error);
  return NextResponse.json({ error: `Failed to ${op} file` }, { status: 500 });
}

/** Monaco language id from extension — keep to what we actually highlight. */
function languageFromExt(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.json': 'json', '.md': 'markdown', '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.html': 'html', '.htm': 'html', '.xml': 'xml', '.svg': 'xml',
    '.py': 'python', '.sh': 'shell', '.bash': 'shell', '.yml': 'yaml', '.yaml': 'yaml',
    '.toml': 'ini', '.env': 'ini', '.sql': 'sql', '.rs': 'rust', '.go': 'go',
    '.java': 'java', '.kt': 'kotlin', '.cs': 'csharp', '.c': 'c', '.h': 'c', '.cpp': 'cpp',
    '.ps1': 'powershell', '.bat': 'bat', '.cmd': 'bat', '.dockerfile': 'dockerfile',
  };
  return map[ext] ?? 'plaintext';
}
