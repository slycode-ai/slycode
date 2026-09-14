import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';
import { parseAreaIndex } from '@/lib/area-index';

export async function GET() {
  const repoRoot = getSlycodeRoot();
  // context-priming may live under .claude/ or, in workspaces without one
  // (pure Codex/OpenCode projects), under .agents/ — first existing wins.
  // Mirrors AREA_INDEX_CANDIDATES in scripts/kanban.js.
  const candidateRefDirs = ['.claude', '.agents', '.opencode'].map(dir =>
    path.join(repoRoot, dir, 'skills', 'context-priming', 'references'),
  );
  let refDir = candidateRefDirs[0];
  for (const dir of candidateRefDirs) {
    try { await fs.access(path.join(dir, 'area-index.md')); refDir = dir; break; } catch { /* next */ }
  }
  const areaIndexPath = path.join(refDir, 'area-index.md');

  // The index is canonical — LOCKSTEP with `sly-kanban areas` (#0355).
  // No areas/ directory scan; a missing index means zero areas.
  let areas: string[] = [];
  try {
    areas = parseAreaIndex(await fs.readFile(areaIndexPath, 'utf-8'));
  } catch {
    // area-index.md not found
  }

  return NextResponse.json({ areas });
}
