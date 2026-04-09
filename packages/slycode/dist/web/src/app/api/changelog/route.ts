import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';
import type { ChangelogVersion } from '@/lib/types';

/**
 * GET /api/changelog
 *
 * Returns the changelog as a JSON array of ChangelogVersion entries,
 * ordered newest-first.
 *
 * Path resolution:
 *   Prod: <workspace>/node_modules/@slycode/slycode/templates/changelog.json
 *   Dev:  <workspace>/data/changelog.json
 *
 * Returns an empty array on missing/malformed file (graceful degradation).
 */
export async function GET() {
  const root = getSlycodeRoot();

  const candidatePaths = [
    // Prod: shipped inside the package templates
    path.join(root, 'node_modules', '@slycode', 'slycode', 'templates', 'changelog.json'),
    // Dev: source of truth at data/
    path.join(root, 'data', 'changelog.json'),
  ];

  for (const p of candidatePaths) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, 'utf-8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) {
        // Malformed shape — fall through to empty
        continue;
      }
      return NextResponse.json(data as ChangelogVersion[]);
    } catch {
      // Malformed JSON — fall through to next candidate or empty
    }
  }

  return NextResponse.json([] as ChangelogVersion[]);
}
