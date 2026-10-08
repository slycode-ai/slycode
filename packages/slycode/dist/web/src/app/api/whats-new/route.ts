import { NextResponse } from 'next/server';
import { historyEntries, previewEntries, unseenEntries } from '@/lib/whats-new';
import { loadEntries, readInstalledVersion, readWhatsNewState } from '@/lib/whats-new.server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/whats-new[?preview=<version>][&previewFrom=<version>]
 *
 * What's new splash (feature #0379). All lists are newest first.
 *   pages   — releases with content newer than the last one seen and no newer than installed:
 *             the splash pages on load (empty = no splash)
 *   history — every release with content at or below installed: the footer reopen pages
 *   latest  — history[0]; null hides the footer link
 *   unseen  — pages.length > 0
 *   preview — authoring preview (see previewEntries), any version, never affects state; null when not asked
 *
 * Deliberately no `npm view` here (unlike /api/version-check): this runs on every page load.
 */
export async function GET(request: Request) {
  const entries = loadEntries();
  const installed = readInstalledVersion();
  const { lastSeenVersion } = readWhatsNewState();
  const params = new URL(request.url).searchParams;
  const pages = unseenEntries(entries, installed, lastSeenVersion);
  const history = historyEntries(entries, installed);

  return NextResponse.json({
    installed,
    pages,
    history,
    latest: history[0] ?? null,
    unseen: pages.length > 0,
    preview: previewEntries(entries, { version: params.get('preview'), from: params.get('previewFrom') }),
  });
}
