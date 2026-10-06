import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolveWhatsNewAsset } from '@/lib/whats-new.server';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** GET /api/whats-new/asset/<name> — an optional release image from the whats-new folder (allowlisted names only). */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const file = resolveWhatsNewAsset(name);
  if (!file) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const ext = path.extname(file).toLowerCase();
  return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
    headers: {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      // SVG is served as an image only; never let it run script if opened directly.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
