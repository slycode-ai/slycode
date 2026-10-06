import { useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query. Server render (and pre-hydration) reports
 * `false`, so layouts that depend on it start in their narrow form.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
