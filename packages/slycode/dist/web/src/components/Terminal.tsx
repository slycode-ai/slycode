'use client';

import { useEffect, useRef, forwardRef, useImperativeHandle, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { connectionManager } from '@/lib/connection-manager';
import '@xterm/xterm/css/xterm.css';

export interface TerminalHandle {
  focus: () => void;
  sendInput: (data: string) => void;
}

interface TerminalProps {
  sessionName: string;
  bridgeUrl?: string;
  tintColor?: string;
  onConnectionChange?: (connected: boolean) => void;
  onSessionExit?: (code: number, output?: string) => void;
  onReady?: (handle: TerminalHandle) => void;
  onImagePaste?: (file: File) => void;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  {
    sessionName,
    bridgeUrl = '/api/bridge',
    tintColor,
    onConnectionChange,
    onSessionExit,
    onReady,
    onImagePaste,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  // Track original dimensions from server for proper restore
  const originalDimsRef = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
  // Loading state for restore
  const [isRestoring, setIsRestoring] = useState(true);
  // Track if we're reconnecting (distinct from initial restore)
  const [isReconnecting, setIsReconnecting] = useState(false);
  // Track previous session to reset restoring state on session change
  const [prevSession, setPrevSession] = useState(sessionName);
  // Track if we've ever connected
  const hasConnectedRef = useRef(false);

  // Reset restoring state when session changes (during render, not in effect)
  if (prevSession !== sessionName) {
    setPrevSession(sessionName);
    setIsRestoring(true);
  }

  // Store callbacks in refs to avoid re-triggering effects
  const onConnectionChangeRef = useRef(onConnectionChange);
  const onSessionExitRef = useRef(onSessionExit);
  const onReadyRef = useRef(onReady);
  const onImagePasteRef = useRef(onImagePaste);

  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange;
    onSessionExitRef.current = onSessionExit;
    onReadyRef.current = onReady;
    onImagePasteRef.current = onImagePaste;
  }, [onConnectionChange, onSessionExit, onReady, onImagePaste]);

  // Expose focus and sendInput methods
  useImperativeHandle(ref, () => ({
    focus: () => {
      terminalRef.current?.focus();
    },
    sendInput: (data: string) => {
      fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      }).catch(() => {
        // Silently ignore — network error
      });
    },
  }), [bridgeUrl, sessionName]);

  useEffect(() => {
    if (!containerRef.current) return;

    // AbortController for fire-and-forget fetch calls (input, resize)
    const fetchAbort = new AbortController();

    // Detect theme for terminal background
    const isDark = document.documentElement.classList.contains('dark');
    const termBg = isDark ? '#1a1a1a' : '#222228';

    // Create terminal
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: termBg,
        foreground: '#e0e0e0',
        cursor: '#00bfff',
        cursorAccent: termBg,
        selectionBackground: 'rgba(0, 191, 255, 0.2)',
      },
    });
    terminalRef.current = terminal;

    // Add fit addon
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);

    // Add web links addon
    terminal.loadAddon(new WebLinksAddon());

    // Open terminal in container
    terminal.open(containerRef.current);

    // Intercept Ctrl+V via xterm's custom key handler — this fires before
    // xterm processes the key, regardless of which internal element has focus.
    // The previous DOM keydown listener on the container could miss events when
    // xterm's internal textarea was focused (e.g. after crash/reconnect).
    const pasteText = (text: string) => {
      // Wrap in bracketed paste sequences so the receiving application
      // treats the input as a single pasted block (not individual keypresses).
      // This matches xterm's native paste behavior and prevents multi-line
      // content from being interpreted as separate Enter presses.
      const wrapped = `\x1b[200~${text}\x1b[201~`;
      fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: wrapped }),
        signal: fetchAbort.signal,
      }).catch(() => {});
    };

    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Shift+Enter → send CSI u escape sequence for "insert newline" instead
      // of xterm's default \r (which submits). CLI tools like Claude Code,
      // Codex, and Gemini interpret \x1b[13;2u as newline insertion.
      // Must return false for ALL event types (keydown, keypress) to prevent
      // xterm from sending \r via the keypress path.
      if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.type === 'keydown') {
          pasteText('\x1b[13;2u');
        }
        return false;
      }

      if (e.type !== 'keydown') return true;

      // Ctrl+C / Cmd+C — copy selected text (selection-aware).
      // When text is selected, copy to clipboard and suppress ^C.
      // When nothing is selected, pass through so xterm sends SIGINT.
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
        const selection = terminal.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
          terminal.clearSelection();
          e.preventDefault();
          return false;
        }
        return true;
      }

      if (!((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.shiftKey)) return true;

      // Read clipboard for images, fall back to text
      navigator.clipboard.read().then(async (items) => {
        for (const item of items) {
          const imageType = item.types.find(t => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            const file = new File([blob], 'clipboard-image.png', { type: imageType });
            onImagePasteRef.current?.(file);
            return;
          }
        }
        // No image — paste text manually
        try {
          const text = await navigator.clipboard.readText();
          if (text) pasteText(text);
        } catch {
          // Clipboard text read failed
        }
      }).catch(async () => {
        // clipboard.read() not supported — try text-only fallback
        try {
          const text = await navigator.clipboard.readText();
          if (text) pasteText(text);
        } catch {
          // All clipboard access failed
        }
      });

      // Prevent browser from firing native paste event (which xterm handles
      // via a separate paste listener, causing double delivery through onData)
      e.preventDefault();
      return false;
    });

    fitAddon.fit();

    // Mobile touch scroll — xterm's .xterm-viewport (scrollable) is a sibling
    // of .xterm-screen (canvas), not an ancestor. The browser can't find a
    // scrollable ancestor from the canvas touch target, so native touch-to-scroll
    // doesn't work. We handle it manually via terminal.scrollLines().
    let touchStartY: number | null = null;
    let touchAccumulator = 0;
    const LINE_HEIGHT = Math.ceil((terminal.options.fontSize ?? 14) * (terminal.options.lineHeight ?? 1));

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        touchAccumulator = 0;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartY === null || e.touches.length !== 1) return;
      const currentY = e.touches[0].clientY;
      const deltaY = touchStartY - currentY; // positive = scroll down
      touchStartY = currentY;

      touchAccumulator += deltaY;
      const lines = Math.trunc(touchAccumulator / LINE_HEIGHT);
      if (lines !== 0) {
        terminal.scrollLines(lines);
        touchAccumulator -= lines * LINE_HEIGHT;
      }

      e.preventDefault(); // Prevent page from scrolling
    };

    const handleTouchEnd = () => {
      touchStartY = null;
      touchAccumulator = 0;
    };

    const container = containerRef.current;
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });

    // Notify parent that terminal is ready with handle
    const handle: TerminalHandle = {
      focus: () => terminal.focus(),
      sendInput: (data: string) => {
        fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data }),
          signal: fetchAbort.signal,
        }).catch(() => {
          // Silently ignore — aborted or network error
        });
      },
    };
    onReadyRef.current?.(handle);

    // Handle user input - send via POST
    terminal.onData((data) => {
      fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
        signal: fetchAbort.signal,
      }).catch(() => {
        // Silently ignore — aborted or network error
      });
    });

    // Handle resize — guarded by visibility to prevent background tabs from
    // resizing the PTY (which disrupts the active tab's terminal).
    // suppressResizePost: set during dimension broadcast handling to prevent
    // ResizeObserver → sendResize echo loop when adapting to another tab's resize.
    let suppressResizePost = false;

    const sendResize = () => {
      // Guard: only send resize if this tab is visible — background tabs
      // and hidden containers (zero-size) should never resize the PTY
      if (document.visibilityState !== 'visible') return;
      if (suppressResizePost) return;

      fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/resize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: terminal.cols, rows: terminal.rows }),
        signal: fetchAbort.signal,
      }).catch(() => {
        // Silently ignore — aborted or network error
      });
    };

    // Debounced resize — prevents feedback loop on mobile where
    // fitAddon.fit() triggers layout changes that re-fire ResizeObserver.
    // Uses 150ms timeout so layout fully settles before re-measuring.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        fitAddon.fit();
        sendResize();
      }, 150);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // Connect to SSE stream using ConnectionManager for automatic reconnection
    const streamUrl = `${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/stream`;

    const connectionId = connectionManager.createManagedEventSource(streamUrl, {
      onOpen: () => {
        const isReconnect = hasConnectedRef.current;
        // Connection opened - if we were reconnecting, show success
        if (isReconnect) {
          setIsReconnecting(false);
          terminal.write('\r\n\x1b[32mReconnected\x1b[0m\r\n');
        }
        hasConnectedRef.current = true;
        onConnectionChangeRef.current?.(true);
        // On initial connect, send resize so PTY matches our viewport.
        // On reconnect, skip — the dimensions SSE event provides current PTY
        // size, and the restore flow's fitAddon.fit() will trigger the
        // ResizeObserver if our container genuinely differs (which sends
        // resize via the observer path, not this reconnect path).
        if (!isReconnect) {
          setTimeout(sendResize, 100);
        }
      },

      onError: () => {
        // ConnectionManager handles reconnection - show reconnecting state
        if (hasConnectedRef.current) {
          setIsReconnecting(true);
          onConnectionChangeRef.current?.(false);
          terminal.write('\r\n\x1b[33mConnection lost - reconnecting...\x1b[0m\r\n');
        }
      },

      connected: () => {
        // SSE 'connected' event from bridge - don't write message, let restore handle content
      },

      dimensions: (event: MessageEvent) => {
        try {
          const dims = JSON.parse(event.data);
          originalDimsRef.current = { cols: dims.cols, rows: dims.rows };
        } catch {
          // Ignore parse errors
        }
      },

      restore: (event: MessageEvent) => {
        try {
          const { state } = JSON.parse(event.data);
          if (state) {
            // Resize to original dimensions first (state was captured at these dimensions)
            terminal.resize(originalDimsRef.current.cols, originalDimsRef.current.rows);
            // Write the serialized state
            terminal.write(state);
            // Now fit to current container size and notify server
            fitAddon.fit();
            sendResize();
          }
          setIsRestoring(false);
          setIsReconnecting(false);
        } catch {
          // Ignore parse errors
          setIsRestoring(false);
          setIsReconnecting(false);
        }
      },

      resize: (event: MessageEvent) => {
        // Dimension broadcast from bridge — another tab resized the PTY.
        // Adapt our xterm to match, but suppress the ResizeObserver from
        // sending a resize POST back (which would create an echo loop).
        try {
          const { cols, rows } = JSON.parse(event.data);
          if (cols && rows && (cols !== terminal.cols || rows !== terminal.rows)) {
            suppressResizePost = true;
            terminal.resize(cols, rows);
            suppressResizePost = false;
          }
        } catch {
          // Ignore parse errors
        }
      },

      output: (event: MessageEvent) => {
        setIsRestoring(false);
        setIsReconnecting(false);
        try {
          const msg = JSON.parse(event.data);
          terminal.write(msg.data);
        } catch {
          terminal.write(event.data);
        }
      },

      exit: (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data);
          terminal.write(`\r\n\x1b[33mSession exited (code: ${msg.code})\x1b[0m\r\n`);
          onSessionExitRef.current?.(msg.code, msg.output);
        } catch {
          terminal.write('\r\n\x1b[33mSession exited\x1b[0m\r\n');
        }
      },

      error: (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data);
          terminal.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
        } catch {
          // Generic error
        }
      },
    });

    connectionIdRef.current = connectionId;

    return () => {
      fetchAbort.abort();
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      if (connectionIdRef.current) {
        connectionManager.closeConnection(connectionIdRef.current);
        connectionIdRef.current = null;
      }
      terminal.dispose();
    };
  }, [sessionName, bridgeUrl]);

  return (
    <div className="relative h-full w-full touch-none bg-[#222228] dark:bg-[#1a1a1a]">
      <div
        ref={containerRef}
        className="h-full w-full px-3 py-2"
      />
      {/* Subtle noise + vignette + lane color overlay */}
      <div
        className="pointer-events-none absolute inset-0 terminal-texture"
        style={tintColor ? { '--terminal-tint': tintColor } as React.CSSProperties : undefined}
      />
      {isRestoring && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#222228] dark:bg-[#1a1a1a]">
          <div className="flex flex-col items-center gap-2 text-void-500">
            <svg className="h-6 w-6 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm">Restoring session...</span>
          </div>
        </div>
      )}
      {isReconnecting && !isRestoring && (
        <div className="absolute bottom-2 right-2 flex items-center gap-2 rounded bg-amber-900/80 px-2 py-1 text-xs text-amber-200">
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Reconnecting...</span>
        </div>
      )}
    </div>
  );
});
