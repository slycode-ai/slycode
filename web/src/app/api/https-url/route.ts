import { NextResponse } from 'next/server';
import { readWorkspaceEnvKey } from '@/lib/workspace-env';

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
  const url = process.env[key] || readWorkspaceEnvKey(key);
  return NextResponse.json({ url: url && /^https:\/\/[^\s"']+$/i.test(url) ? url : null });
}
