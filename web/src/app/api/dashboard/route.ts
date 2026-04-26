import { NextResponse } from 'next/server';
import { loadDashboardData } from '@/lib/registry';
import { getBridgeUrl } from '@/lib/paths';
import { sumProjectActivityCounts } from '@/lib/session-keys';

export const dynamic = 'force-dynamic';

const BRIDGE_URL = getBridgeUrl();

async function getBridgeSessions(): Promise<Record<string, number>> {
  try {
    const resp = await fetch(`${BRIDGE_URL}/stats`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return {};
    const data = await resp.json() as { sessions: Array<{ name: string; status?: string; isActive?: boolean }> };
    const sessions = data.sessions || [];
    const counts: Record<string, number> = {};
    for (const s of sessions) {
      // Only count sessions with sustained recent output (not just running/idle)
      if (s.isActive) {
        const group = s.name.split(':')[0];
        counts[group] = (counts[group] || 0) + 1;
      }
    }
    return counts;
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const data = await loadDashboardData();

    // Enrich with bridge session counts (external service, can't do in registry.ts)
    const bridgeSessions = await getBridgeSessions();
    for (const project of data.projects) {
      if (!project.accessible) continue;
      // Sum across canonical sessionKey + legacy id aliases. Without this,
      // projects where registry.id differs from sessionKey would show zero
      // even when sessions are active.
      project.activeSessions = sumProjectActivityCounts(project, bridgeSessions);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Failed to load dashboard data:', error);
    return NextResponse.json(
      { error: 'Failed to load dashboard data' },
      { status: 500 }
    );
  }
}
