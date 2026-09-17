import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';

export const dynamic = 'force-dynamic';

/**
 * The HTTPS address the setup wizard recorded for this deployment, if any
 * (card #0356). The plain-HTTP starvation banner offers it as the way out:
 * HTTPS negotiates HTTP/2, which multiplexes every stream over one
 * connection and so has no 6-per-host cap.
 *
 * Reads HTTPS_PROD_URL in production and HTTPS_DEV_URL otherwise, from the
 * process env first and the workspace .env second (dev does not export the
 * wizard's keys). Returns { url: null } when nothing usable is configured —
 * the banner then falls back to generic wording. Unauthenticated-safe: the
 * tailnet hostname is not a secret and the route reveals nothing else.
 */
export async function GET() {
  const key = process.env.NODE_ENV === 'production' ? 'HTTPS_PROD_URL' : 'HTTPS_DEV_URL';
  const url = process.env[key] || readEnvKey(key);
  return NextResponse.json({ url: url && /^https:\/\/[^\s"']+$/i.test(url) ? url : null });
}

function readEnvKey(key: string): string | null {
  try {
    const content = readFileSync(path.join(getSlycodeRoot(), '.env'), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      if (trimmed.slice(0, eq).trim() !== key) continue;
      return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '') || null;
    }
  } catch { /* no .env */ }
  return null;
}
