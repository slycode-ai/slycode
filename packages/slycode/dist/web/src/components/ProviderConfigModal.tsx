'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { invalidateProviders, fetchProviders } from '@/lib/use-providers';

interface Row {
  id: string;
  displayName: string;
  colorHex: string | null;
  disabled: boolean;
}

/**
 * Provider Config (feature 085 stretch): per-machine enable/disable and
 * display order for providers. Writes data/provider-prefs.json via
 * /api/providers/prefs — machine state, untouched by `slycode update`.
 * Sessions already running keep going; the prefs gate new spawns and what
 * the selectors show.
 */
export function ProviderConfigModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/providers/prefs')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('load failed'))))
      .then((data: { providers: Row[] }) => setRows(data.providers))
      .catch(() => setError('Could not load providers.'));
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const persist = useCallback((next: Row[]) => {
    setRows(next);
    setError(null);
    fetch('/api/providers/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order: next.map(r => r.id),
        disabled: next.filter(r => r.disabled).map(r => r.id),
      }),
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Save failed');
        }
        setSaveState('saved');
        // Every selector reads /api/providers — refresh the shared cache so
        // open pages pick the change up without a reload.
        invalidateProviders();
        void fetchProviders(true);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 1800);
      })
      .catch(err => {
        setSaveState('error');
        setError((err as Error).message);
      });
  }, []);

  const move = (index: number, delta: -1 | 1) => {
    if (!rows) return;
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    persist(next);
  };

  const toggle = (index: number) => {
    if (!rows) return;
    const next = rows.map((r, i) => (i === index ? { ...r, disabled: !r.disabled } : r));
    if (next.every(r => r.disabled)) {
      setError('At least one provider must stay enabled.');
      return;
    }
    persist(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-4 w-full max-w-sm rounded-lg border border-void-200/60 bg-void-50 p-4 shadow-(--shadow-overlay) dark:border-void-700 dark:bg-void-850">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-void-900 dark:text-void-100">Provider config</h3>
          <span
            aria-live="polite"
            className={`text-[10px] transition-opacity ${
              saveState === 'saved' ? 'text-emerald-400 opacity-100'
              : saveState === 'error' ? 'text-red-400 opacity-100'
              : 'opacity-0'
            }`}
          >
            {saveState === 'error' ? 'Save failed' : 'Saved'}
          </span>
        </div>

        {!rows && !error && <p className="py-4 text-center text-xs text-void-500">Loading…</p>}

        {rows && (
          <ul className="space-y-1">
            {rows.map((r, i) => (
              <li
                key={r.id}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
                  r.disabled
                    ? 'border-transparent bg-void-100/60 dark:bg-void-900/40'
                    : 'border-void-200/60 bg-white dark:border-void-700/60 dark:bg-void-800'
                }`}
              >
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{
                    backgroundColor: r.disabled ? 'transparent' : r.colorHex ?? '#00bfff',
                    border: r.disabled ? '1px solid var(--color-void-500, #6b7280)' : 'none',
                    boxShadow: r.disabled ? 'none' : `0 0 4px ${r.colorHex ?? '#00bfff'}`,
                  }}
                />
                <span className={`min-w-0 flex-1 truncate text-sm ${r.disabled ? 'text-void-500 line-through decoration-void-500/50' : 'text-void-900 dark:text-void-200'}`}>
                  {r.displayName}
                </span>
                <div className="flex items-center">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    title="Move up"
                    aria-label={`Move ${r.displayName} up`}
                    className="rounded p-1 text-void-500 hover:text-neon-blue-400 disabled:opacity-30 disabled:hover:text-void-500"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === rows.length - 1}
                    title="Move down"
                    aria-label={`Move ${r.displayName} down`}
                    className="rounded p-1 text-void-500 hover:text-neon-blue-400 disabled:opacity-30 disabled:hover:text-void-500"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                </div>
                <button
                  onClick={() => toggle(i)}
                  role="switch"
                  aria-checked={!r.disabled}
                  aria-label={`${r.disabled ? 'Enable' : 'Disable'} ${r.displayName}`}
                  className={`relative ml-1 h-4 w-7 flex-shrink-0 rounded-full transition-colors ${r.disabled ? 'bg-void-300 dark:bg-void-700' : 'bg-emerald-500/80'}`}
                >
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${r.disabled ? 'left-0.5' : 'left-3.5'}`} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="mt-2 text-[11px] leading-snug text-red-400">{error}</p>}

        <p className="mt-3 border-t border-void-200/60 pt-2 text-[10px] leading-snug text-void-500 dark:border-void-700/60">
          Applies to this machine only. Disabled providers disappear from pickers and can't start new sessions; running sessions are left alone.
        </p>
      </div>
    </div>
  );
}
