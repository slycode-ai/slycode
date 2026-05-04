'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { Shortcut, ShortcutsFile, KanbanCard, KanbanStages, ProviderId } from '@/lib/types';

/**
 * Suggest a project tag from the project's display name.
 *   - 1 word    → first 3 letters, lowercased
 *   - 2+ words  → acronym of word initials, lowercased, capped at 6 chars
 *
 * Words are split on whitespace, hyphens, underscores, AND camelCase
 * boundaries — so "SlyCode" reads as ["Sly", "Code"] (two words → "sc").
 */
function inferProjectTag(name: string): string {
  if (!name) return '';
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s\-_]+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].toLowerCase().slice(0, 3);
  return words.map((w) => w[0]).join('').toLowerCase().slice(0, 6);
}

interface ShortcutsConfigModalProps {
  onClose: () => void;
  projectId: string;
  projectName: string;
}

interface TagMap {
  [projectId: string]: { projectName: string; projectTag: string };
}

interface ShortcutDraft extends Shortcut {
  /** Local-only id so React keys stay stable across re-renders. */
  _key: string;
}

const PROVIDERS: Array<{ id: string; label: string }> = [
  { id: '', label: 'Default' },
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini' },
];

function generateLabel(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  // 1 letter + 3 alphanumerics so the result always has at least one letter.
  const head = chars[Math.floor(Math.random() * chars.length)];
  const tail = Array.from({ length: 3 })
    .map(() => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)])
    .join('');
  return head + tail;
}

function withKeys(file: ShortcutsFile): ShortcutDraft[] {
  return file.shortcuts.map((s, i) => ({ ...s, _key: `${s.label}-${i}` }));
}

function stripKeys(drafts: ShortcutDraft[]): Shortcut[] {
  return drafts.map(({ _key, ...rest }) => rest);
}

export function ShortcutsConfigModal({ onClose, projectId, projectName }: ShortcutsConfigModalProps) {
  const router = useRouter();
  const inferredTag = useMemo(() => inferProjectTag(projectName), [projectName]);
  const [tag, setTag] = useState('');
  const [drafts, setDrafts] = useState<ShortcutDraft[]>([]);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [tagMap, setTagMap] = useState<TagMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [labelErrors, setLabelErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [botName, setBotName] = useState('');
  // Per-row collapsed state. Defaults to collapsed for an existing shortcut on
  // first render (so the list reads as a tidy stack); newly-added rows start
  // expanded so the user can fill them in.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Origin for building full copyable URLs. Falls back to '' until mount so we
  // don't render a stale value on server-rendered HTML (this is a client
  // component, but useState initialiser still runs once before useEffect).
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  // Initial load: project shortcuts, workspace tag map, kanban cards
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [shortcutsRes, tagsRes, kanbanRes] = await Promise.all([
          fetch(`/api/shortcuts/${encodeURIComponent(projectId)}`),
          fetch('/api/shortcuts'),
          fetch(`/api/kanban?projectId=${encodeURIComponent(projectId)}`),
        ]);
        if (cancelled) return;
        if (shortcutsRes.ok) {
          const file = (await shortcutsRes.json()) as ShortcutsFile;
          // Pre-fill with the inferred tag when the project has none yet —
          // user can edit before saving. Saved tag wins if present.
          setTag(file.projectTag || inferredTag);
          const initialDrafts = withKeys(file);
          setDrafts(initialDrafts);
          // Existing shortcuts start collapsed for a tidy list.
          setCollapsed(new Set(initialDrafts.map((d) => d._key)));
        }
        if (tagsRes.ok) {
          const data = (await tagsRes.json()) as { tags: TagMap };
          setTagMap(data.tags || {});
        }
        if (kanbanRes.ok) {
          const board = (await kanbanRes.json()) as { stages?: KanbanStages };
          if (board?.stages) {
            const all: KanbanCard[] = [];
            (['backlog', 'design', 'implementation', 'testing', 'done'] as const).forEach((s) => {
              for (const c of board.stages?.[s] ?? []) {
                if (!c.archived) all.push(c);
              }
            });
            // Newest-activity-first: most users will be wiring shortcuts to
            // cards they've touched recently. Falls back to created_at when
            // updated_at is missing.
            all.sort((a, b) => {
              const av = a.updated_at || a.created_at || '';
              const bv = b.updated_at || b.created_at || '';
              return bv.localeCompare(av);
            });
            setCards(all);
          }
        }
      } catch (err) {
        console.error('Shortcuts modal load failed:', err);
        setError('Failed to load shortcuts.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    // Bot name for the Telegram deeplink — best-effort from /api/settings or env.
    fetch('/api/settings')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.telegramBotName) setBotName(d.telegramBotName); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, inferredTag]);

  // Live tag uniqueness preview as user types
  const liveTagError = useMemo(() => {
    const t = tag.trim().toLowerCase();
    if (!t) return null;
    if (!/^[a-z0-9]{1,6}$/.test(t)) return 'Tag must be 1–6 lowercase alphanumeric characters.';
    for (const [pid, entry] of Object.entries(tagMap)) {
      if (pid === projectId) continue;
      if (entry.projectTag && entry.projectTag.toLowerCase() === t) {
        return `Tag "${t}" is already used by project "${entry.projectName}".`;
      }
    }
    return null;
  }, [tag, tagMap, projectId]);

  // Per-row label validation
  const validateLocalLabel = useCallback((draft: ShortcutDraft, others: ShortcutDraft[]): string | null => {
    const l = draft.label.trim().toLowerCase();
    if (!l) return 'Label required.';
    if (!/^[a-z0-9]{1,50}$/.test(l)) return 'Lowercase alphanumeric only.';
    if (l === 'global') return '"global" is reserved.';
    if (/^[0-9]+$/.test(l)) return 'Must contain a letter.';
    for (const o of others) {
      if (o._key === draft._key) continue;
      if (o.label.trim().toLowerCase() === l) return 'Duplicate label.';
    }
    return null;
  }, []);

  useEffect(() => {
    const errs: Record<string, string> = {};
    for (const d of drafts) {
      const e = validateLocalLabel(d, drafts);
      if (e) errs[d._key] = e;
      if (!d.cardId) errs[d._key] = errs[d._key] || 'Card required.';
    }
    setLabelErrors(errs);
  }, [drafts, validateLocalLabel]);

  const updateDraft = useCallback((key: string, patch: Partial<Shortcut>) => {
    setDrafts((prev) => prev.map((d) => d._key === key ? { ...d, ...patch } : d));
  }, []);

  const removeDraft = useCallback((key: string) => {
    setDrafts((prev) => prev.filter((d) => d._key !== key));
  }, []);

  const addDraft = useCallback(() => {
    setDrafts((prev) => {
      // Generate a label that doesn't collide with existing ones in this list.
      let label = generateLabel();
      const existing = new Set(prev.map((d) => d.label.toLowerCase()));
      let attempts = 0;
      while (existing.has(label) && attempts < 20) {
        label = generateLabel();
        attempts += 1;
      }
      return [
        ...prev,
        { _key: `new-${Date.now()}-${prev.length}`, label, cardId: '', preferExistingSession: false },
      ];
    });
    // The newly-added draft is not in the collapsed set, so it renders
    // expanded by default — matches the "fill in your new shortcut" intent.
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setTagError(null);
    try {
      const body: ShortcutsFile = { projectTag: tag.trim().toLowerCase(), shortcuts: stripKeys(drafts) };
      const res = await fetch(`/api/shortcuts/${encodeURIComponent(projectId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = (data?.error as string) || `Save failed (${res.status})`;
        if (data?.field === 'projectTag') {
          setTagError(message);
        } else {
          setError(message);
        }
        return;
      }
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 1500);
    } catch (err) {
      console.error(err);
      setError('Save failed. Check the network and try again.');
    } finally {
      setSaving(false);
    }
  }, [drafts, tag, projectId]);

  const hasErrors = !!liveTagError || Object.keys(labelErrors).length > 0;
  // Worked-examples block always shows something useful: the current tag if
  // typed, else the inferred default, else a generic placeholder.
  const exampleTag = (tag.trim().toLowerCase() || inferredTag || 'tag');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex h-[90vh] w-[90vw] max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-(--shadow-overlay) dark:bg-void-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-void-200 px-6 py-4 dark:border-void-700">
          <div>
            <h2 className="text-lg font-semibold text-void-900 dark:text-void-50">Quick-launch Shortcuts</h2>
            <p className="text-xs text-void-500 dark:text-void-400">Project: {projectName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-void-500 hover:bg-void-100 hover:text-void-800 dark:text-void-400 dark:hover:bg-void-800 dark:hover:text-void-200"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-void-800 dark:text-void-200">
          {loading ? (
            <div className="text-center text-void-500">Loading…</div>
          ) : (
            <>
              {/* Project tag */}
              <section className="mb-6">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-void-500 dark:text-void-400">Project tag</label>
                <input
                  value={tag}
                  onChange={(e) => setTag(e.target.value.toLowerCase())}
                  placeholder={inferredTag || 'cm'}
                  maxLength={6}
                  className={`w-32 rounded-md border bg-white px-2 py-1.5 font-mono text-sm dark:bg-void-800 ${
                    liveTagError || tagError
                      ? 'border-red-400 focus:outline-none focus:ring-2 focus:ring-red-300'
                      : 'border-void-300 focus:border-neon-blue-400 focus:outline-none focus:ring-2 focus:ring-neon-blue-200 dark:border-void-700'
                  }`}
                />
                {(liveTagError || tagError) && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{liveTagError || tagError}</p>
                )}
                <p className="mt-2 text-xs text-void-500 dark:text-void-400">
                  1–6 lowercase alphanumeric. Must be unique across all projects.
                </p>
                <div className="mt-3 rounded-md border border-void-200 bg-void-50 px-3 py-2 text-xs dark:border-void-700 dark:bg-void-800/50">
                  <p className="font-medium text-void-700 dark:text-void-200">Examples with tag <span className="font-mono">{exampleTag}</span>:</p>
                  <ul className="mt-1 space-y-0.5 text-void-600 dark:text-void-400">
                    <li>Project terminal → <span className="font-mono">{exampleTag}</span> (Telegram) or <span className="font-mono">/project/{projectId}/{exampleTag}</span> (web — opens with terminal expanded)</li>
                    <li>Card #5 → <span className="font-mono">{exampleTag}-5</span> (Telegram) or <span className="font-mono">/project/{projectId}/5</span> (web)</li>
                    <li>Saved shortcut <span className="font-mono">grog</span> → <span className="font-mono">{exampleTag}-grog</span> or <span className="font-mono">/project/{projectId}/grog</span></li>
                    <li>Reserved <span className="font-mono">global</span> → <span className="font-mono">global</span> (Telegram) or <span className="font-mono">/global</span> (web)</li>
                  </ul>
                </div>
              </section>

              {/* Shortcuts list */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-void-500 dark:text-void-400">Saved shortcuts</h3>
                  <button
                    onClick={addDraft}
                    className="rounded-md border border-neon-blue-400/40 bg-neon-blue-400/10 px-2.5 py-1 text-xs font-medium text-neon-blue-500 hover:bg-neon-blue-400/20"
                  >
                    + Add shortcut
                  </button>
                </div>
                {drafts.length === 0 ? (
                  <p className="rounded-md border border-dashed border-void-300 px-3 py-4 text-center text-xs text-void-500 dark:border-void-700 dark:text-void-400">
                    No shortcuts yet. Click “Add shortcut” to create one.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {drafts.map((d) => {
                      const labelErr = labelErrors[d._key];
                      const labelLower = d.label.trim().toLowerCase();
                      const tagLower = tag.trim().toLowerCase();
                      const tgUrl = botName && tagLower && labelLower
                        ? `https://t.me/${botName}?start=${tagLower}-${labelLower}`
                        : null;
                      // Full URL when origin is known (client-side after mount).
                      // Otherwise fall back to the relative path so the user
                      // still sees something useful before hydration.
                      const webRelPath = labelLower ? `/project/${projectId}/${labelLower}` : null;
                      const webUrl = webRelPath ? `${origin}${webRelPath}` : null;
                      const isCollapsed = collapsed.has(d._key);
                      const card = cards.find((c) => c.id === d.cardId);
                      const cardLabel = card
                        ? `${card.number ? `#${card.number} ` : ''}${card.title}`
                        : (d.cardId ? '(unknown card)' : '(no card)');

                      const toggleCollapse = () => {
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(d._key)) next.delete(d._key);
                          else next.add(d._key);
                          return next;
                        });
                      };

                      const runShortcut = () => {
                        if (!d.cardId || labelErr) return;
                        // Close the modal first so the underlying card surface
                        // is visible.
                        onClose();
                        // Build the resolved query-param URL the token route
                        // would have redirected to, and SPA-navigate via
                        // router.push — no full page reload, just searchParams
                        // update. ProjectKanban consumes the params and the
                        // existing pendingShortcut firing path takes over.
                        const sp = new URLSearchParams();
                        sp.set('card', d.cardId);
                        if (d.prompt) sp.set('prompt', d.prompt);
                        if (d.provider) sp.set('provider', d.provider);
                        if (d.preferExistingSession) sp.set('preferExisting', '1');
                        router.push(`/project/${encodeURIComponent(projectId)}?${sp.toString()}`);
                      };

                      return (
                        <div
                          key={d._key}
                          className={`rounded-md border bg-void-50 dark:bg-void-800/40 ${
                            labelErr ? 'border-red-400/60' : 'border-void-200 dark:border-void-700'
                          }`}
                        >
                          {/* Collapsed-row header — always rendered, doubles as the
                              toggle when collapsed and the title bar when expanded. */}
                          <div className="flex items-center gap-2 px-3 py-2">
                            <button
                              type="button"
                              onClick={toggleCollapse}
                              className="flex flex-1 items-center gap-2 text-left text-sm text-void-700 hover:text-neon-blue-500 dark:text-void-200"
                              title={isCollapsed ? 'Expand' : 'Collapse'}
                            >
                              <svg
                                className={`h-3 w-3 flex-shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className="font-mono text-neon-blue-500">
                                {d.label || '(unnamed)'}
                              </span>
                              <span className="truncate text-void-500 dark:text-void-400">→ {cardLabel}</span>
                              {d.prompt && (
                                <span className="hidden text-[11px] text-void-400 sm:inline" title={d.prompt}>
                                  · prompt set
                                </span>
                              )}
                              {d.provider && (
                                <span className="hidden rounded-sm bg-void-200 px-1 text-[10px] uppercase text-void-700 sm:inline dark:bg-void-700 dark:text-void-300">
                                  {d.provider}
                                </span>
                              )}
                            </button>

                            {/* Copy buttons in the header so they're visible
                                whether the row is collapsed or expanded. */}
                            {webUrl && !labelErr && (
                              <CopyChip label="Web" value={webUrl} title={`Copy web link: ${webUrl}`} />
                            )}
                            {tgUrl && !labelErr && (
                              <CopyChip label="TG" value={tgUrl} title={`Copy Telegram link: ${tgUrl}`} />
                            )}
                            {/* Run + delete buttons. Run is visible whenever the
                                shortcut is fully addressable (label + card). */}
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); runShortcut(); }}
                              disabled={!webRelPath || !!labelErr || !d.cardId}
                              className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40 dark:text-emerald-400"
                              title="Run shortcut now"
                            >
                              ▶ Run
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); removeDraft(d._key); }}
                              className="rounded-md p-1 text-void-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40"
                              aria-label="Delete shortcut"
                              title="Delete"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>

                          {/* Expanded body */}
                          {!isCollapsed && (
                            <div className="border-t border-void-200 px-3 py-3 dark:border-void-700">
                              <div className="grid gap-2 sm:grid-cols-2">
                                {/* Label */}
                                <div>
                                  <label className="block text-[10px] font-semibold uppercase text-void-500">Label</label>
                                  <input
                                    value={d.label}
                                    onChange={(e) => updateDraft(d._key, { label: e.target.value.toLowerCase() })}
                                    className={`w-full rounded-md border bg-white px-2 py-1 font-mono text-sm dark:bg-void-900 ${
                                      labelErr ? 'border-red-400' : 'border-void-300 dark:border-void-700'
                                    }`}
                                  />
                                  {labelErr && <p className="mt-0.5 text-[11px] text-red-600 dark:text-red-400">{labelErr}</p>}
                                </div>
                                {/* Card picker */}
                                <div>
                                  <label className="block text-[10px] font-semibold uppercase text-void-500">Card</label>
                                  <select
                                    value={d.cardId}
                                    onChange={(e) => updateDraft(d._key, { cardId: e.target.value })}
                                    className="w-full truncate rounded-md border border-void-300 bg-white px-2 py-1 text-sm dark:border-void-700 dark:bg-void-900"
                                  >
                                    <option value="">— pick a card —</option>
                                    {cards.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.number ? `#${c.number} ` : ''}{c.title}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                {/* Provider */}
                                <div>
                                  <label className="block text-[10px] font-semibold uppercase text-void-500">Provider (optional)</label>
                                  <select
                                    value={d.provider || ''}
                                    onChange={(e) => updateDraft(d._key, { provider: (e.target.value || undefined) as ProviderId | undefined })}
                                    className="w-full rounded-md border border-void-300 bg-white px-2 py-1 text-sm dark:border-void-700 dark:bg-void-900"
                                  >
                                    {PROVIDERS.map((p) => (
                                      <option key={p.id} value={p.id}>{p.label}</option>
                                    ))}
                                  </select>
                                </div>
                                {/* Prefer existing toggle */}
                                <div className="flex items-end">
                                  <label className="flex items-center gap-2 text-xs text-void-700 dark:text-void-300">
                                    <input
                                      type="checkbox"
                                      checked={!!d.preferExistingSession}
                                      onChange={(e) => updateDraft(d._key, { preferExistingSession: e.target.checked })}
                                      className="rounded border-void-400"
                                    />
                                    Prefer existing session if any
                                  </label>
                                </div>
                                {/* Prompt */}
                                <div className="sm:col-span-2">
                                  <label className="block text-[10px] font-semibold uppercase text-void-500">Starter prompt (optional)</label>
                                  <textarea
                                    value={d.prompt || ''}
                                    onChange={(e) => updateDraft(d._key, { prompt: e.target.value })}
                                    rows={2}
                                    className="w-full resize-y rounded-md border border-void-300 bg-white px-2 py-1 text-sm dark:border-void-700 dark:bg-void-900"
                                    placeholder="Fired against the chosen provider when the shortcut opens."
                                  />
                                </div>
                              </div>

                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {error && (
                <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700/40 dark:bg-red-900/20 dark:text-red-300">
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-void-200 px-6 py-3 dark:border-void-700">
          <span className="text-xs text-void-500">
            {savedAt ? 'Saved.' : ''}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-void-300 px-3 py-1.5 text-sm text-void-700 hover:bg-void-100 dark:border-void-600 dark:text-void-200 dark:hover:bg-void-800"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving || hasErrors}
              className="rounded-md bg-neon-blue-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-neon-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact copy button used in both the collapsed row header and the expanded
 * body. Shows a small label like "Web" or "TG" plus a clipboard icon; the
 * full URL lives in the title (tooltip) and goes to the clipboard on click.
 */
function CopyChip({ label, value, title }: { label: string; value: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        // The button can sit inside a clickable header (the collapse toggle).
        // Stop propagation so clicking copy doesn't also collapse/expand.
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => { /* clipboard unavailable */ },
        );
      }}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
        copied
          ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-600 dark:text-emerald-400'
          : 'border-void-300 bg-white text-void-600 hover:border-neon-blue-400 hover:bg-neon-blue-400/10 hover:text-neon-blue-500 dark:border-void-700 dark:bg-void-900 dark:text-void-300'
      }`}
      title={title || `Copy: ${value}`}
    >
      {/* Icon flips between clipboard and check; label stays fixed so the
          button width doesn't change on click (avoids layout shift in the
          collapsed row header where space is tight). */}
      {copied ? (
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}
