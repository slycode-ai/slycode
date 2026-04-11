import { NextRequest } from 'next/server';
import { watch, type FSWatcher } from 'fs';
import {
  getWatchPath,
  ProjectResolutionError,
} from '@/lib/kanban-paths';

// Prevent Next.js from caching SSE stream responses
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  // Create a readable stream for SSE
  const encoder = new TextEncoder();
  let watcher: FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let isClosed = false;

  // Resolve the watch path before starting the stream
  let watchPath: string;
  try {
    watchPath = await getWatchPath(projectId);
  } catch (error) {
    if (error instanceof ProjectResolutionError) {
      // Return error as SSE event, then close
      const errorStream = new ReadableStream({
        start(controller) {
          const errorMsg = `event: error\ndata: ${JSON.stringify({ message: error.message, code: error.code })}\n\n`;
          controller.enqueue(encoder.encode(errorMsg));
          controller.close();
        },
      });
      return new Response(errorStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }
    throw error;
  }

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected message
      const connectMsg = `event: connected\ndata: ${JSON.stringify({ projectId: projectId || 'all' })}\n\n`;
      controller.enqueue(encoder.encode(connectMsg));

      try {
        // Watch the resolved path
        // For specific projects, watch the kanban.json file
        // For "all", watch the documentation directory recursively
        watcher = watch(watchPath, { recursive: !projectId }, (eventType, filename) => {
          if (isClosed) return;

          // For directory watch, only care about kanban*.json files
          if (!projectId && filename && !filename.match(/^kanban.*\.json$/)) {
            return;
          }

          // Debounce rapid changes
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          debounceTimer = setTimeout(() => {
            if (isClosed) return;

            const updateMsg = `event: update\ndata: ${JSON.stringify({
              projectId: projectId || 'all',
              timestamp: new Date().toISOString(),
              file: filename || 'kanban.json',
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

      // Send keepalive every 30 seconds
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
