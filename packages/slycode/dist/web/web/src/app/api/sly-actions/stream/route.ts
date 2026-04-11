import { NextRequest } from 'next/server';
import { watch, type FSWatcher } from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';

function getActionsDir(): string {
  return path.join(getSlycodeRoot(), 'store', 'actions');
}

export async function GET(_request: NextRequest) {
  const encoder = new TextEncoder();
  let watcher: FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let isClosed = false;

  const stream = new ReadableStream({
    start(controller) {
      const connectMsg = `event: connected\ndata: ${JSON.stringify({ file: 'store/actions/' })}\n\n`;
      controller.enqueue(encoder.encode(connectMsg));

      const watchPath = getActionsDir();

      try {
        // Watch the directory for any file changes
        watcher = watch(watchPath, { recursive: false }, (_eventType, _filename) => {
          if (isClosed) return;

          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          debounceTimer = setTimeout(() => {
            if (isClosed) return;

            const updateMsg = `event: update\ndata: ${JSON.stringify({
              timestamp: new Date().toISOString(),
              file: 'store/actions/',
            })}\n\n`;

            try {
              controller.enqueue(encoder.encode(updateMsg));
            } catch {
              // Controller may be closed
            }
          }, 500);
        });

        watcher.on('error', (err) => {
          if (isClosed) return;
          const errorMsg = `event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`;
          try {
            controller.enqueue(encoder.encode(errorMsg));
          } catch {
            // Controller may be closed
          }
        });
      } catch {
        const errorMsg = `event: error\ndata: ${JSON.stringify({ message: 'Failed to start file watcher' })}\n\n`;
        controller.enqueue(encoder.encode(errorMsg));
      }

      const keepaliveInterval = setInterval(() => {
        if (isClosed) {
          clearInterval(keepaliveInterval);
          return;
        }
        try {
          controller.enqueue(encoder.encode('event: heartbeat\ndata: {}\n\n'));
        } catch {
          clearInterval(keepaliveInterval);
        }
      }, 30000);
    },

    cancel() {
      isClosed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      if (watcher) {
        watcher.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
