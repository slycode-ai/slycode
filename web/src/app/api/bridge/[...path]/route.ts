import { NextRequest, NextResponse } from 'next/server';

// Prevent Next.js from caching or deduplicating SSE stream requests
export const dynamic = 'force-dynamic';

import { getBridgeUrl } from '@/lib/paths';
import { bridgeUnavailablePayload, describeBridgeFetchError } from '@/lib/bridge-proxy-errors';

/** 503 + Retry-After: the bridge is not listening (starting/restarting). Card #0363. */
function bridgeUnavailable(err: unknown): NextResponse {
  const p = bridgeUnavailablePayload(err);
  return NextResponse.json(p.body, { status: p.status, headers: p.headers });
}

const BRIDGE_URL = getBridgeUrl();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const targetPath = path.join('/');
  const url = `${BRIDGE_URL}/${targetPath}${request.nextUrl.search}`;

  // Check if this is an SSE stream request
  if (targetPath.endsWith('/stream')) {
    const streamId = `stream-${Date.now().toString(36)}`;

    // Use a per-request AbortController so each SSE stream is fully independent.
    // Propagate client disconnect from request.signal to our local controller.
    const streamAbort = new AbortController();
    request.signal.addEventListener('abort', () => {
      console.log(`[SSE-PROXY] ${streamId} CLIENT_ABORT → ${targetPath}`);
      streamAbort.abort();
    }, { once: true });

    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'text/event-stream' },
        signal: streamAbort.signal,
      });

      if (!response.ok) {
        console.log(`[SSE-PROXY] ${streamId} BRIDGE_ERROR status=${response.status} → ${targetPath}`);
        const data = await response.json().catch(() => ({ error: `Bridge responded ${response.status}` }));
        return NextResponse.json(data, { status: response.status });
      }
      // Logged only once the bridge has accepted the stream, so a bridge outage
      // costs one warning line per attempt instead of OPEN + a stack dump.
      console.log(`[SSE-PROXY] ${streamId} OPEN → ${targetPath}`);

      // Stream the SSE response — each proxy connection is fully independent
      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body?.getReader();
          if (!reader) {
            controller.close();
            return;
          }

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                console.log(`[SSE-PROXY] ${streamId} BRIDGE_DONE (reader finished) → ${targetPath}`);
                break;
              }
              controller.enqueue(value);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes('abort')) {
              console.log(`[SSE-PROXY] ${streamId} READ_ERROR → ${targetPath}: ${msg}`);
            }
          } finally {
            reader.cancel().catch(() => {});
            try { controller.close(); } catch { /* already closed */ }
          }
        },
        cancel() {
          console.log(`[SSE-PROXY] ${streamId} CANCEL → ${targetPath}`);
          streamAbort.abort();
          response.body?.cancel().catch(() => {});
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return new Response(null, { status: 499 });
      }
      // One line, no stack (card #0363): the browser's connection manager
      // retries with backoff, so this repeats until the bridge is listening.
      console.warn(`[SSE-PROXY] ${streamId} bridge unavailable (${describeBridgeFetchError(err)}) → ${targetPath} — client will retry`);
      return bridgeUnavailable(err);
    }
  }

  // Regular GET request
  try {
    const res = await fetch(url);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return bridgeUnavailable(err);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const targetPath = path.join('/');
  const url = `${BRIDGE_URL}/${targetPath}`;

  try {
    const contentType = request.headers.get('content-type') || '';

    // Multipart requests (e.g., image uploads) — stream body through as-is
    if (contentType.includes('multipart/form-data')) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: request.body,
        // @ts-expect-error — duplex required for streaming request bodies in Node fetch
        duplex: 'half',
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    }

    // Handle empty body gracefully (e.g., /sessions/stop-all)
    let body = {};
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 0) {
      body = await request.json();
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return bridgeUnavailable(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const targetPath = path.join('/');
  const url = `${BRIDGE_URL}/${targetPath}${request.nextUrl.search}`;

  try {
    const res = await fetch(url, { method: 'DELETE' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return bridgeUnavailable(err);
  }
}

// PUT — idempotent state writes (feature 086: PUT /speaker { enabled }).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const targetPath = path.join('/');
  const url = `${BRIDGE_URL}/${targetPath}`;
  try {
    const body = await request.text();
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { error: text || `Bridge responded ${res.status}` }; }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return bridgeUnavailable(err);
  }
}
