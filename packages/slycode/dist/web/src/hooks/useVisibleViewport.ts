import { useSyncExternalStore } from 'react';
import { visibleViewport, type VisibleViewport } from '@/lib/visible-viewport';

/**
 * The visible part of the page, kept current as the keyboard, toolbars or
 * rotation change it (#0376). Server render (and pre-hydration) reports
 * null, so callers fall back to CSS (`100dvh`).
 */
let cached: VisibleViewport | null = null;

function read(): VisibleViewport {
  const next = visibleViewport(window);
  // Same numbers → same object, so React doesn't re-render for nothing.
  if (!cached || cached.top !== next.top || cached.height !== next.height || cached.bottomInset !== next.bottomInset) {
    cached = next;
  }
  return cached;
}

function subscribe(onChange: () => void): () => void {
  const vv = window.visualViewport;
  vv?.addEventListener('resize', onChange);
  vv?.addEventListener('scroll', onChange);
  window.addEventListener('resize', onChange);
  return () => {
    vv?.removeEventListener('resize', onChange);
    vv?.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', onChange);
  };
}

export function useVisibleViewport(): VisibleViewport | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
