'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getProviderColor } from '@/lib/provider-colors';

interface ProviderInfo {
  id: string;
  displayName: string;
  permissions: { label: string; default: boolean };
  model?: { available?: { id: string; label: string; description?: string }[] };
}

interface GlobalDefault {
  provider: string;
  skipPermissions: boolean;
  model?: string;
}

/**
 * Workspace default session config (feature 073). One place to set the
 * default provider + model + permission mode used by every session start
 * (terminal panels, sly actions, quick-launch, messaging). Changes save
 * immediately. Custom model ids are free text — typos fail at next session
 * start and are corrected here.
 */
export function DefaultProviderConfig({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<Record<string, ProviderInfo>>({});
  const [def, setDef] = useState<GlobalDefault | null>(null);
  // True while this project has no default of its own and shows the
  // inherited last-set (global) value. Cleared on first save.
  const [inherited, setInherited] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customDraft, setCustomDraft] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customInputRef = useRef<HTMLInputElement>(null);

  // Load providers + this project's default (falling back to the last-set global)
  useEffect(() => {
    fetch('/api/providers')
      .then(res => (res.ok ? res.json() : null))
      .then((data: { providers: Record<string, ProviderInfo>; defaults?: { global?: GlobalDefault; projects?: Record<string, GlobalDefault> } } | null) => {
        if (!data?.providers) return;
        setProviders(data.providers);
        const own = data.defaults?.projects?.[projectId];
        const resolved = own ?? data.defaults?.global;
        if (resolved) {
          setDef(resolved);
          setInherited(!own);
        }
      })
      .catch(() => { /* providers.json unavailable — control stays inert */ });
  }, [projectId]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!buttonRef.current?.contains(t) && !popoverRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); }, []);

  const persist = useCallback((next: GlobalDefault) => {
    setDef(next);
    setInherited(false);
    const body: GlobalDefault = { provider: next.provider, skipPermissions: next.skipPermissions };
    if (next.model) body.model = next.model;
    // Saves THIS project's default; the server mirrors it to `global` so
    // projects without their own default inherit the last-set value.
    fetch('/api/providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaults: { projects: { [projectId]: body } } }),
    })
      .then(res => {
        setSaveState(res.ok ? 'saved' : 'error');
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 1800);
      })
      .catch(() => setSaveState('error'));
  }, [projectId]);

  const currentProvider = def ? providers[def.provider] : undefined;
  const models = currentProvider?.model?.available ?? [];
  const modelInList = !!def?.model && models.some(m => m.id === def.model);
  const isCustomModel = !!def?.model && !modelInList;
  const dotColor = def ? getProviderColor(def.provider).dot : undefined;

  const commitCustom = () => {
    if (!def) return;
    const trimmed = customDraft.trim();
    setCustomMode(false);
    if (trimmed === (def.model ?? '')) return;
    // Empty input deletes the custom id — back to the provider's own default.
    persist({ ...def, model: trimmed || undefined });
  };

  return (
    <div className="relative hidden sm:block">
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        title="Default provider & model"
        className={`relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border p-2 transition-all ${
          open
            ? 'border-neon-blue-400/50 bg-neon-blue-400/10 text-neon-blue-400'
            : 'border-void-200/40 bg-transparent text-void-500 hover:border-neon-blue-400/40 hover:bg-neon-blue-400/5 hover:text-neon-blue-400 dark:border-void-700/40 dark:text-void-400 dark:hover:border-neon-blue-400/40 dark:hover:bg-neon-blue-400/5 dark:hover:text-neon-blue-400'
        }`}
      >
        {/* CPU/chip icon — the session engine */}
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 5h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2zm3 5h4v4h-4v-4z" />
        </svg>
        {/* Current default provider, at a glance */}
        {dotColor && (
          <span
            className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: dotColor, boxShadow: `0 0 4px ${dotColor}` }}
          />
        )}
      </button>

      {open && def && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-void-200/60 bg-void-50 p-3 shadow-(--shadow-overlay) dark:border-void-600 dark:bg-void-800"
        >
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-void-500">
              Project default{inherited ? ' · inherited' : ''}
            </span>
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

          {/* Provider pills */}
          <div className="flex gap-1">
            {Object.values(providers).map(p => {
              const colors = getProviderColor(p.id);
              const active = def.provider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    if (active) return;
                    // Model is provider-specific — switching provider resets
                    // to that provider's own CLI default.
                    setCustomMode(false);
                    persist({ provider: p.id, skipPermissions: providers[p.id]?.permissions.default ?? true });
                  }}
                  className="flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-all"
                  style={active
                    ? { borderColor: colors.border, backgroundColor: colors.bg, color: colors.color }
                    : { borderColor: 'transparent', color: 'var(--color-void-400, #9ca3af)' }}
                >
                  {p.displayName.replace(/ (Code|CLI)$/, '')}
                </button>
              );
            })}
          </div>

          {/* Model — known list + free-text custom entry */}
          <div className="mt-3">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-void-500">Model</span>
            {customMode ? (
              <input
                ref={customInputRef}
                value={customDraft}
                onChange={e => setCustomDraft(e.target.value)}
                onBlur={commitCustom}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitCustom();
                  if (e.key === 'Escape') { e.stopPropagation(); setCustomMode(false); }
                }}
                placeholder="model id, e.g. claude-fable-5"
                spellCheck={false}
                className="w-full rounded border border-neon-blue-400/40 bg-void-100 px-2 py-1.5 font-mono text-xs text-void-900 outline-none placeholder:text-void-500 dark:bg-void-900 dark:text-void-200"
              />
            ) : (
              <select
                value={isCustomModel ? def.model : (def.model ?? '')}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '__custom__') {
                    setCustomDraft(isCustomModel ? def.model! : '');
                    setCustomMode(true);
                    setTimeout(() => customInputRef.current?.focus(), 0);
                    return;
                  }
                  persist({ ...def, model: v || undefined });
                }}
                className="w-full rounded border border-void-300 bg-void-100 px-2 py-1.5 text-xs text-void-900 dark:border-void-600 dark:bg-void-900 dark:text-void-300"
              >
                <option value="">Provider default</option>
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
                {isCustomModel && <option value={def.model}>{def.model} (custom)</option>}
                <option value="__custom__">Custom…</option>
              </select>
            )}
            {isCustomModel && !customMode && (
              <p className="mt-1 text-[10px] leading-snug text-void-500">
                Custom id — edit via Custom… (clear to delete), or pick Provider default.
              </p>
            )}
          </div>

          {/* Permissions */}
          <label className="mt-3 flex cursor-pointer items-center gap-1.5 text-xs text-void-500">
            <input
              type="checkbox"
              checked={def.skipPermissions}
              onChange={e => persist({ ...def, skipPermissions: e.target.checked })}
              className="rounded border-void-600"
            />
            {currentProvider?.permissions.label || 'Skip permissions'}
          </label>

          <p className="mt-2 border-t border-void-200/60 pt-2 text-[10px] leading-snug text-void-500 dark:border-void-700/60">
            {inherited
              ? 'Showing the last-set default — saving any change pins it to this project.'
              : 'Used by every new session in this project. Pick a different provider at start time without changing this.'}
          </p>
        </div>
      )}
    </div>
  );
}
