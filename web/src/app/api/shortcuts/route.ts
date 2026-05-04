/**
 * Quick-launch Shortcuts API — workspace-wide tag map.
 *
 * GET: returns `{ projectId → { projectName, projectTag } }` for every project
 * in the registry. Used by the ShortcutsConfigModal for live tag-uniqueness
 * preview while the user types.
 */

import { NextResponse } from 'next/server';
import { loadAllShortcuts } from '@/lib/shortcuts';

export async function GET() {
  try {
    const all = await loadAllShortcuts();
    const tags: Record<string, { projectName: string; projectTag: string }> = {};
    for (const entry of all) {
      tags[entry.projectId] = {
        projectName: entry.projectName,
        projectTag: entry.file.projectTag || '',
      };
    }
    return NextResponse.json({ tags });
  } catch (err) {
    console.error('Failed to load shortcuts tag map:', err);
    return NextResponse.json({ tags: {} });
  }
}
