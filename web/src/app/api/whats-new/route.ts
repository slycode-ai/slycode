import { NextResponse } from 'next/server';
import { findEntry, latestEntry, pickEntry } from '@/lib/whats-new';
import { loadEntries, readInstalledVersion, readWhatsNewState } from '@/lib/whats-new.server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/whats-new[?preview=<version>]
 *
 * What's new splash (feature #0379).
 *   latest  — newest release notes at or below the installed version (footer reopen); null hides the link
 *   unseen  — true when `latest` has not been dismissed on this install, so the splash shows on load
 *   preview — the entry for ?preview=<version>, any version, for authoring; never affects state
 *
 * Deliberately no `npm view` here (unlike /api/version-check): this runs on every page load.
 */
export async function GET(request: Request) {
  const entries = loadEntries();
  const installed = readInstalledVersion();
  const { lastSeenVersion } = readWhatsNewState();
  const previewParam = new URL(request.url).searchParams.get('preview');

  return NextResponse.json({
    installed,
    latest: latestEntry(entries, installed),
    unseen: pickEntry(entries, installed, lastSeenVersion) !== null,
    preview: previewParam ? findEntry(entries, previewParam) : null,
  });
}
