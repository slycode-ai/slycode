import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

/**
 * Claude Code transcript retention check (feature 080).
 *
 * Claude Code permanently deletes session transcripts older than
 * `cleanupPeriodDays` (default 30) at startup — resumable-looking card
 * sessions then fail with "No conversation found". This read-only endpoint
 * reports the server machine's effective setting so RetentionWarningToast can
 * warn when transcripts are at risk.
 *
 * Returns { periodDays: number | null } — null means the file or key is
 * missing and Claude's 30-day default applies.
 */
export async function GET() {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const raw = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);
    const value = settings?.cleanupPeriodDays;
    return NextResponse.json({ periodDays: typeof value === 'number' ? value : null });
  } catch {
    // Missing/unreadable settings file — Claude's default retention applies
    return NextResponse.json({ periodDays: null });
  }
}
