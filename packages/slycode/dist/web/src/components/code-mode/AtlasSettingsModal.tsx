'use client';

/**
 * Atlas settings modal (feature 076) — configure the nightly refresh from the
 * UI instead of editing documentation/atlas/config.json: enabled toggle, cron
 * schedule (with human-readable preview), provider override, run-now.
 */

import { useEffect, useState } from 'react';
import { cronToHumanReadable } from '@/lib/cron-utils';
import { relTime } from './AtlasMap';

interface ModelOption { id: string; label?: string }
interface ProviderOption { id: string; name?: string; models: ModelOption[] }

interface AtlasSettingsModalProps {
  projectId: string;
  onClose: () => void;
  onRunRefresh: () => void;
  refreshBusy: boolean;
}

export function AtlasSettingsModal({ projectId, onClose, onRunRefresh, refreshBusy }: AtlasSettingsModalProps) {
  const [enabled, setEnabled] = useState(false);
  const [schedule, setSchedule] = useState('0 3 * * *');
  const [provider, setProvider] = useState<string>(''); // '' = global default
  const [model, setModel] = useState<string>('');       // '' = default for the effective provider
  const [customModel, setCustomModel] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [globalDefault, setGlobalDefault] = useState<string>('claude');
  const [globalModel, setGlobalModel] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/atlas/refresh?projectId=${encodeURIComponent(projectId)}`).then(r => r.json()).catch(() => null),
      fetch('/api/providers').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([cfg, prov]) => {
      if (cancelled) return;
      const provList: ProviderOption[] = prov?.providers
        ? Object.entries(prov.providers).map(([id, p]) => {
            const def = p as { name?: string; model?: { available?: Array<{ id: string; label?: string }> } };
            return { id, name: def.name, models: def.model?.available ?? [] };
          })
        : [];
      if (cfg?.config) {
        setEnabled(!!cfg.config.enabled);
        setSchedule(cfg.config.schedule ?? '0 3 * * *');
        setProvider(cfg.config.provider ?? '');
        const m: string = cfg.config.model ?? '';
        setModel(m);
        // Config carries a model id that isn't in any configured list → show
        // it via the Custom input (same convention as the global default UI).
        const effectiveProv = cfg.config.provider || prov?.defaults?.global?.provider || 'claude';
        const known = provList.find(x => x.id === effectiveProv)?.models.some(x => x.id === m) ?? false;
        setCustomModel(!!m && !known);
        setLastRun(cfg.config.last_run ?? null);
      }
      setProviders(provList);
      if (prov?.defaults?.global?.provider) setGlobalDefault(prov.defaults.global.provider);
      if (typeof prov?.defaults?.global?.model === 'string') setGlobalModel(prov.defaults.global.model);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  const cronPreview = (() => {
    if (!schedule.trim() || schedule.trim().split(/\s+/).length < 5) return null;
    try {
      const human = cronToHumanReadable(schedule.trim(), 'recurring', '');
      return human || null;
    } catch {
      return null;
    }
  })();

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/atlas/refresh', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, enabled, schedule, provider: provider || null, model: model || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNotice('Saved.');
      setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      setNotice(`Save failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="code-mode fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-(--cm-line2) bg-(--cm-panel) shadow-[0_16px_60px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2 border-b border-(--cm-line) bg-(--cm-panel2) px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-(--cm-atlas)">⚙ Atlas settings</span>
          <button onClick={onClose} className="ml-auto font-mono text-[13px] text-(--cm-faint) hover:text-(--cm-text)">✕</button>
        </div>

        {!loaded ? (
          <p className="p-5 font-mono text-[12px] text-(--cm-faint)">loading…</p>
        ) : (
          <div className="flex flex-col gap-4 p-4">
            {/* Enabled */}
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-[13px] font-semibold text-(--cm-text)">Nightly refresh</span>
                <span className="block text-[11.5px] text-(--cm-muted)">
                  The scheduler starts the Atlas terminal and runs the refresh + coverage crawl.
                </span>
              </span>
              <button
                onClick={() => setEnabled(v => !v)}
                className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
                  enabled ? 'border-(--cm-atlas) bg-(--cm-atlas-dim)' : 'border-(--cm-line2) bg-(--cm-bg2)'
                }`}
                role="switch"
                aria-checked={enabled}
              >
                <span
                  className={`absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all ${
                    enabled ? 'left-[22px] bg-(--cm-atlas)' : 'left-0.5 bg-(--cm-faint)'
                  }`}
                  style={{ height: 18, width: 18 }}
                />
              </button>
            </label>

            {/* Schedule */}
            <label className="block">
              <span className="mb-1 block text-[13px] font-semibold text-(--cm-text)">Schedule (cron)</span>
              <input
                value={schedule}
                onChange={e => setSchedule(e.target.value)}
                spellCheck={false}
                className="w-full rounded-md border border-(--cm-line2) bg-(--cm-bg2) px-2.5 py-1.5 font-mono text-[12.5px] text-(--cm-text) outline-none focus:border-(--cm-atlas)"
              />
              <span className={`mt-1 block font-mono text-[10.5px] ${cronPreview ? 'text-(--cm-muted)' : 'text-(--cm-stale)'}`}>
                {cronPreview ?? 'invalid cron expression'}
              </span>
            </label>

            {/* Provider + model (mirrors the global-default picker, feature 073) */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold text-(--cm-text)">Provider</span>
                <select
                  value={provider}
                  onChange={e => { setProvider(e.target.value); setModel(''); setCustomModel(false); }}
                  className="w-full rounded-md border border-(--cm-line2) bg-(--cm-bg2) px-2.5 py-1.5 font-mono text-[12.5px] text-(--cm-text) outline-none focus:border-(--cm-atlas)"
                >
                  <option value="">Global default ({globalDefault})</option>
                  {providers.map(p => (
                    <option key={p.id} value={p.id}>{p.name ?? p.id}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold text-(--cm-text)">Model</span>
                {customModel ? (
                  <span className="flex gap-1.5">
                    <input
                      value={model}
                      onChange={e => setModel(e.target.value)}
                      placeholder="model id"
                      spellCheck={false}
                      className="w-full min-w-0 rounded-md border border-(--cm-line2) bg-(--cm-bg2) px-2.5 py-1.5 font-mono text-[12.5px] text-(--cm-text) outline-none focus:border-(--cm-atlas)"
                    />
                    <button
                      onClick={() => { setCustomModel(false); setModel(''); }}
                      title="Back to the configured list"
                      className="shrink-0 font-mono text-[11px] text-(--cm-faint) hover:text-(--cm-text)"
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <select
                    value={model}
                    onChange={e => {
                      if (e.target.value === '__custom__') { setCustomModel(true); setModel(''); }
                      else setModel(e.target.value);
                    }}
                    className="w-full rounded-md border border-(--cm-line2) bg-(--cm-bg2) px-2.5 py-1.5 font-mono text-[12.5px] text-(--cm-text) outline-none focus:border-(--cm-atlas)"
                  >
                    <option value="">
                      {provider === '' && globalModel ? `Default (${globalModel})` : 'Provider default'}
                    </option>
                    {(providers.find(p => p.id === (provider || globalDefault))?.models ?? []).map(m => (
                      <option key={m.id} value={m.id}>{m.label ?? m.id}</option>
                    ))}
                    <option value="__custom__">Custom…</option>
                  </select>
                )}
              </label>
            </div>

            {/* Meta + actions */}
            <div className="flex items-center gap-2 border-t border-(--cm-line) pt-3">
              <span className="font-mono text-[10.5px] text-(--cm-faint)">
                {lastRun ? `last run ${relTime(lastRun)}` : 'never run'}
              </span>
              {notice && <span className="font-mono text-[10.5px] text-(--cm-atlas)">{notice}</span>}
              <span className="ml-auto flex gap-2">
                <button
                  onClick={onRunRefresh}
                  disabled={refreshBusy}
                  className="rounded-md border border-(--cm-line2) px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-(--cm-muted) hover:border-(--cm-atlas) hover:text-(--cm-atlas) disabled:opacity-50"
                >
                  {refreshBusy ? 'starting…' : 'Run now'}
                </button>
                <button
                  onClick={save}
                  disabled={saving || !cronPreview}
                  className="rounded-md border border-(--cm-atlas) bg-(--cm-atlas-dim) px-4 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-(--cm-atlas) hover:brightness-110 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
