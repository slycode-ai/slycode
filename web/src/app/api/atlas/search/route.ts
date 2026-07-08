/**
 * GET /api/atlas/search?projectId=<id>&q=<query>[&max=200][&regex=1][&case=1]
 *
 * Code search for Code Mode, backed by the bundled @vscode/ripgrep binary
 * (design decision: zero external dependencies). Parses `rg --json` events
 * into { file, line, text, submatches } results, capped server-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { rgPath } from '@vscode/ripgrep';
import { resolveProject, AtlasPathError } from '@/lib/atlas/fs-utils';

export const dynamic = 'force-dynamic';

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
  /** [start, end) column offsets of matches within text */
  spans: Array<[number, number]>;
}

const MAX_RESULTS_CAP = 500;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const project = await resolveProject(searchParams.get('projectId'));
    const q = searchParams.get('q');
    if (!q || q.length < 2) {
      return NextResponse.json({ error: 'q required (min 2 chars)' }, { status: 400 });
    }
    const max = Math.min(parseInt(searchParams.get('max') ?? '200', 10) || 200, MAX_RESULTS_CAP);
    const useRegex = searchParams.get('regex') === '1';
    const caseSensitive = searchParams.get('case') === '1';

    const args = [
      '--json',
      '--max-count', '20',            // per-file cap
      '--max-filesize', '1M',
      '--max-columns', '400',
      '--hidden',                      // dotfiles are first-class in Code Mode
      '--glob', '!.git/**',
      '--glob', '!node_modules/**',
    ];
    if (!caseSensitive) args.push('--smart-case');
    if (!useRegex) args.push('--fixed-strings');
    args.push('--', q, '.');

    const matches = await runRipgrep(project.root, args, max);
    return NextResponse.json({ matches, truncated: matches.length >= max });
  } catch (error) {
    if (error instanceof AtlasPathError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[atlas/search] failed:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}

function runRipgrep(cwd: string, args: string[], max: number): Promise<SearchMatch[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      rgPath,
      args,
      { cwd, windowsHide: true, timeout: 15000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        // rg exits 1 on "no matches" — that's a valid empty result.
        if (error && (error as { code?: number | string }).code !== 1 && !stdout) {
          reject(error);
          return;
        }
        const matches: SearchMatch[] = [];
        for (const line of stdout.split('\n')) {
          if (matches.length >= max) break;
          if (!line) continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type !== 'match') continue;
          const d = event.data;
          const text: string = d.lines?.text ?? '';
          matches.push({
            file: String(d.path?.text ?? '').replace(/\\/g, '/').replace(/^\.\//, ''),
            line: d.line_number ?? 0,
            text: text.replace(/[\r\n]+$/, ''),
            spans: (d.submatches ?? []).map((s: { start: number; end: number }) => [s.start, s.end] as [number, number]),
          });
        }
        resolve(matches);
      },
    );
    child.on('error', reject);
  });
}
