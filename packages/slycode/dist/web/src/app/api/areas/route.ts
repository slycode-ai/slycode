import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';

export async function GET() {
  const repoRoot = getSlycodeRoot();
  const areaIndexPath = path.join(repoRoot, '.claude', 'skills', 'context-priming', 'references', 'area-index.md');
  const areasDir = path.join(repoRoot, '.claude', 'skills', 'context-priming', 'references', 'areas');

  const areas: string[] = [];

  try {
    // Parse area names from area-index.md
    const content = await fs.readFile(areaIndexPath, 'utf-8');
    const areaPattern = /^###\s+(\S+)/gm;
    let match;
    while ((match = areaPattern.exec(content)) !== null) {
      const area = match[1];
      if (area && !areas.includes(area)) {
        areas.push(area);
      }
    }
  } catch {
    // area-index.md not found, continue to check areas directory
  }

  try {
    // Also scan areas directory for .md files
    const files = await fs.readdir(areasDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const areaName = file.replace('.md', '');
        if (!areas.includes(areaName)) {
          areas.push(areaName);
        }
      }
    }
  } catch {
    // areas directory not found
  }

  return NextResponse.json({
    areas: areas.sort(),
  });
}
