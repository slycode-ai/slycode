import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-auth';
import { readInstalledVersion, writeWhatsNewSeen } from '@/lib/whats-new.server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/whats-new/seen — the splash was dismissed on this install.
 * Records the INSTALLED version (not the entry's), so later content-less
 * patches never bring older notes back. Idempotent.
 */
export async function POST(request: Request) {
  const denied = requireSession(request);
  if (denied) return denied;

  const installed = readInstalledVersion();
  if (!installed) return NextResponse.json({ error: 'installed version unknown' }, { status: 500 });
  try {
    await writeWhatsNewSeen(installed);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'write failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, lastSeenVersion: installed });
}
