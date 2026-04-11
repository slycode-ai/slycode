import { useEffect, useRef } from 'react';

interface KeyboardShortcutOptions {
  onEscape?: () => void;
  onNumberKey?: (n: number) => void; // 1-10 (0 key maps to 10)
  enabled?: boolean;
}

export function useKeyboardShortcuts({ onEscape, onNumberKey, enabled = true }: KeyboardShortcutOptions): void {
  // Use refs to avoid re-attaching listener when callbacks change
  const onEscapeRef = useRef(onEscape);
  const onNumberKeyRef = useRef(onNumberKey);

  useEffect(() => {
    onEscapeRef.current = onEscape;
    onNumberKeyRef.current = onNumberKey;
  });

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Input guard: ignore when typing in form elements
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      // Modifier guard: ignore when modifier keys are held
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
        return;
      }

      if (e.key === 'Escape' && onEscapeRef.current) {
        onEscapeRef.current();
        return;
      }

      if (onNumberKeyRef.current && e.key >= '0' && e.key <= '9') {
        const n = e.key === '0' ? 10 : parseInt(e.key, 10);
        e.preventDefault();
        onNumberKeyRef.current(n);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}
