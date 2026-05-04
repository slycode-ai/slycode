'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KanbanCard } from '@/lib/types';
import type {
  Questionnaire,
  QuestionnaireItem,
  AnswerableItem,
} from '@/lib/questionnaire';

interface IndexItem {
  ref: string;
  name?: string;
  title?: string;
  status?: string;
  answered?: number;
  answerable?: number;
  requiredMissing?: number;
  error?: string;
}

interface QuestionnaireTabProps {
  card: KanbanCard;
  projectId: string;
  /** Called when Submit succeeds — parent uses this to switch back to terminal tab. */
  onSubmitSuccess?: () => void;
  /** Currently-selected terminal session name (for submit delivery). */
  activeSessionName?: string;
  /** Provider for session creation if no session exists. */
  activeProvider?: string;
  /** Working directory for session creation if no session exists. */
  cwd?: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function QuestionnaireTab({
  card,
  projectId,
  onSubmitSuccess,
  activeSessionName,
  activeProvider,
  cwd,
}: QuestionnaireTabProps) {
  const refs = useMemo(() => card.questionnaire_refs || [], [card.questionnaire_refs]);

  const [indexItems, setIndexItems] = useState<IndexItem[] | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitToast, setSubmitToast] = useState<string | null>(null);
  const [missingHighlight, setMissingHighlight] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Fetch index whenever the card's refs change.
  useEffect(() => {
    let cancelled = false;
    if (refs.length === 0) {
      setIndexItems([]);
      return;
    }
    setIndexError(null);
    fetch(`/api/questionnaire/${encodeURIComponent(projectId)}?cardId=${encodeURIComponent(card.id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load index (${res.status})`);
        const data = await res.json();
        if (!cancelled) setIndexItems(data.items || []);
      })
      .catch((err) => {
        if (!cancelled) setIndexError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, card.id, refs]);

  // Auto-select if there's exactly one questionnaire.
  useEffect(() => {
    if (selectedName) return;
    if (indexItems && indexItems.length === 1 && indexItems[0].name) {
      setSelectedName(indexItems[0].name);
    }
  }, [indexItems, selectedName]);

  // Fetch the selected questionnaire.
  useEffect(() => {
    if (!selectedName) {
      setQuestionnaire(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    fetch(`/api/questionnaire/${encodeURIComponent(projectId)}/${encodeURIComponent(selectedName)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!cancelled) setQuestionnaire(data.questionnaire);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedName]);

  // Patch one answer (debounced via component-local delay timers).
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const patchAnswer = useCallback(
    (itemId: string, value: unknown) => {
      if (!selectedName) return;
      setSaveState('saving');
      setSaveError(null);
      fetch(
        `/api/questionnaire/${encodeURIComponent(projectId)}/${encodeURIComponent(selectedName)}/answer`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId, value }),
        }
      )
        .then(async (res) => {
          if (res.status === 409) {
            // Schema mismatch — re-fetch
            const data = await res.json().catch(() => ({}));
            setSaveError('Schema changed — reloading');
            setTimeout(() => {
              setQuestionnaire(null);
              setSaveState('idle');
              fetch(`/api/questionnaire/${encodeURIComponent(projectId)}/${encodeURIComponent(selectedName)}`)
                .then((r) => r.json())
                .then((d) => setQuestionnaire(d.questionnaire || null))
                .catch(() => {});
            }, 500);
            return;
          }
          if (!res.ok) {
            const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(body.error || `HTTP ${res.status}`);
          }
          setSaveState('saved');
          setSaveError(null);
          // Auto-fade back to idle after a moment.
          setTimeout(() => setSaveState((cur) => (cur === 'saved' ? 'idle' : cur)), 1500);
        })
        .catch((err) => {
          setSaveState('failed');
          setSaveError(err instanceof Error ? err.message : String(err));
        });
    },
    [projectId, selectedName]
  );

  const updateAnswer = useCallback(
    (itemId: string, value: unknown, debounceMs = 0) => {
      // Optimistic local update.
      setQuestionnaire((prev) => {
        if (!prev) return prev;
        const idx = prev.items.findIndex((it) => isAnswerable(it) && it.id === itemId);
        if (idx === -1) return prev;
        const nextItems = prev.items.slice();
        nextItems[idx] = { ...(nextItems[idx] as AnswerableItem), answer: value } as QuestionnaireItem;
        return { ...prev, items: nextItems };
      });

      // Schedule the patch.
      if (debounceTimers.current[itemId]) clearTimeout(debounceTimers.current[itemId]);
      if (debounceMs > 0) {
        debounceTimers.current[itemId] = setTimeout(() => patchAnswer(itemId, value), debounceMs);
      } else {
        patchAnswer(itemId, value);
      }
    },
    [patchAnswer]
  );

  // Submit the questionnaire.
  const handleSubmit = useCallback(async () => {
    if (!questionnaire || !selectedName) return;
    if (!activeSessionName) {
      setSubmitToast('No active terminal session — open the Terminal tab first to start one.');
      return;
    }
    setSubmitting(true);
    setSubmitToast(null);
    try {
      const res = await fetch(
        `/api/questionnaire/${encodeURIComponent(projectId)}/${encodeURIComponent(selectedName)}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionName: activeSessionName,
            provider: activeProvider,
            cwd,
          }),
        }
      );
      const data = await res.json().catch(() => ({} as { error?: string; warning?: string }));
      if (!res.ok) {
        setSubmitToast((data as { error?: string }).error || `Submit failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      const warning = (data as { warning?: string }).warning;
      // Refresh the questionnaire to reflect the new submitted_at / count.
      try {
        const refreshed = await fetch(
          `/api/questionnaire/${encodeURIComponent(projectId)}/${encodeURIComponent(selectedName)}`
        ).then((r) => r.json());
        if (refreshed?.questionnaire) setQuestionnaire(refreshed.questionnaire);
      } catch {
        // ignore
      }
      if (warning) setSubmitToast(`Submitted with warning: ${warning}`);
      else setSubmitToast(null);
      onSubmitSuccess?.();
    } catch (err) {
      setSubmitToast(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [questionnaire, selectedName, activeSessionName, activeProvider, cwd, projectId, onSubmitSuccess]);

  const counts = useMemo(() => (questionnaire ? computeCounts(questionnaire) : null), [questionnaire]);

  const handleDisabledSubmitClick = useCallback(() => {
    if (!questionnaire) return;
    const firstMissing = questionnaire.items.find((it) => isAnswerable(it) && it.required && !isAnswerFilled(it)) as
      | AnswerableItem
      | undefined;
    if (firstMissing) {
      const node = itemRefs.current[firstMissing.id];
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setMissingHighlight(firstMissing.id);
        setTimeout(() => setMissingHighlight(null), 1500);
      }
    }
  }, [questionnaire]);

  // ------ Empty state ------
  if (refs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-void-500 dark:text-void-400">
        <div>
          <p className="mb-2 font-medium">No questionnaires attached.</p>
          <p className="text-xs opacity-70">
            Agents attach questionnaires via{' '}
            <code className="rounded bg-void-100 px-1.5 py-0.5 font-mono text-xs dark:bg-void-800">
              sly-kanban update {card.id} --questionnaire-ref documentation/questionnaires/NNN_name.json
            </code>
            .
          </p>
        </div>
      </div>
    );
  }

  // ------ Index view (only when more than one and none selected) ------
  if (!selectedName) {
    return (
      <div className="space-y-3 p-4">
        {indexError && (
          <div className="rounded-md border border-red-300/50 bg-red-50/50 p-3 text-sm text-red-700 dark:border-red-700/50 dark:bg-red-950/30 dark:text-red-300">
            {indexError}
          </div>
        )}
        {!indexItems && !indexError && (
          <div className="text-center text-sm text-void-500 dark:text-void-400">Loading…</div>
        )}
        {indexItems && indexItems.length === 0 && (
          <div className="text-center text-sm text-void-500 dark:text-void-400">No questionnaires found.</div>
        )}
        {indexItems && indexItems.map((item) => (
          <button
            key={item.ref}
            onClick={() => item.name && setSelectedName(item.name)}
            disabled={!item.name}
            className="block w-full rounded-lg border border-void-200/60 bg-white/40 p-4 text-left backdrop-blur-sm transition-all hover:border-neon-blue-400/50 hover:bg-neon-blue-400/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-void-700/50 dark:bg-void-900/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-void-900 dark:text-void-100">
                  {item.title || item.name || item.ref}
                </div>
                {item.title && item.name && (
                  <div className="mt-0.5 font-mono text-xs text-void-500 dark:text-void-400">
                    {item.name}
                  </div>
                )}
                {item.error && (
                  <div className="mt-1 text-xs text-red-600 dark:text-red-400">{item.error}</div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {item.status && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      item.status === 'submitted'
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        : 'bg-void-100 text-void-600 dark:bg-void-800 dark:text-void-400'
                    }`}
                  >
                    {item.status}
                  </span>
                )}
                {item.answerable !== undefined && (
                  <span className="font-mono text-xs text-void-500 dark:text-void-400">
                    {item.answered ?? 0} / {item.answerable} answered
                  </span>
                )}
                {item.requiredMissing !== undefined && item.requiredMissing > 0 && (
                  <span className="font-mono text-xs text-amber-600 dark:text-amber-400">
                    {item.requiredMissing} required missing
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    );
  }

  // ------ Form view ------
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-void-200/60 px-4 py-2 dark:border-void-700/40">
        <div className="min-w-0">
          {indexItems && indexItems.length > 1 && (
            <button
              onClick={() => setSelectedName(null)}
              className="mb-1.5 flex items-center gap-1 text-xs text-neon-blue-500 hover:text-neon-blue-400"
            >
              <span aria-hidden>←</span> All questionnaires
            </button>
          )}
          <div className="text-sm font-medium text-void-900 dark:text-void-100">
            {questionnaire?.title || selectedName}
          </div>
        </div>
        <SaveStatusBadge state={saveState} error={saveError} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loadError && (
          <div className="rounded-md border border-red-300/50 bg-red-50/50 p-3 text-sm text-red-700 dark:border-red-700/50 dark:bg-red-950/30 dark:text-red-300">
            {loadError}
          </div>
        )}
        {!questionnaire && !loadError && (
          <div className="text-center text-sm text-void-500 dark:text-void-400">Loading…</div>
        )}
        {questionnaire && (
          <>
            {questionnaire.intro && (
              <p className="mb-3 whitespace-pre-wrap text-xs text-void-600 dark:text-void-400">
                {questionnaire.intro}
              </p>
            )}
            <div className="space-y-2">
              {questionnaire.items.map((item, idx) => (
                <ItemControl
                  key={isAnswerable(item) ? item.id : `exp-${idx}`}
                  item={item}
                  highlight={isAnswerable(item) && missingHighlight === item.id}
                  onChange={(value, debounce) => isAnswerable(item) && updateAnswer(item.id, value, debounce ?? 0)}
                  containerRef={(el) => {
                    if (isAnswerable(item)) itemRefs.current[item.id] = el;
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {questionnaire && counts && (
        <div className="border-t border-void-200/60 px-4 py-2 dark:border-void-700/40">
          {submitToast && (
            <div className="mb-2 rounded-md border border-amber-300/50 bg-amber-50/50 p-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300">
              {submitToast}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-void-500 dark:text-void-400">
              <span className="font-mono">
                {counts.answered} / {counts.answerable} answered
              </span>
              {counts.requiredMissing > 0 && (
                <span className="ml-2 font-mono text-amber-600 dark:text-amber-400">
                  · {counts.requiredMissing} required missing
                </span>
              )}
              {questionnaire.submission_count > 0 && questionnaire.submitted_at && (
                <span className="ml-2 text-[10px] opacity-70">
                  · submitted {questionnaire.submission_count}× (last:{' '}
                  {new Date(questionnaire.submitted_at).toLocaleString()})
                </span>
              )}
            </div>
            <div onClick={submitDisabled() ? handleDisabledSubmitClick : undefined}>
              <button
                onClick={handleSubmit}
                disabled={submitDisabled()}
                className="rounded-lg border border-neon-blue-400/40 bg-neon-blue-400/15 px-4 py-2 text-sm font-medium text-neon-blue-400 transition-all hover:bg-neon-blue-400/25 hover:shadow-[0_0_12px_rgba(0,191,255,0.3)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
              >
                {submitting
                  ? 'Submitting…'
                  : counts.requiredMissing > 0
                  ? `Submit (${counts.requiredMissing} required missing)`
                  : 'Submit to terminal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function submitDisabled(): boolean {
    if (!questionnaire || !counts) return true;
    if (submitting) return true;
    if (counts.requiredMissing > 0) return true;
    if (saveState === 'saving' || saveState === 'failed') return true;
    return false;
  }
}

// ===========================================================================
// Save-status badge
// ===========================================================================

function SaveStatusBadge({ state, error }: { state: SaveState; error: string | null }) {
  if (state === 'idle') return null;
  if (state === 'saving') {
    return (
      <span className="text-xs text-void-500 dark:text-void-400">Saving…</span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
    );
  }
  return (
    <span className="text-xs text-red-600 dark:text-red-400" title={error || ''}>
      Save failed
    </span>
  );
}

// ===========================================================================
// Per-type input controls
// ===========================================================================

function ItemControl({
  item,
  highlight,
  onChange,
  containerRef,
}: {
  item: QuestionnaireItem;
  highlight?: boolean;
  onChange: (value: unknown, debounceMs?: number) => void;
  containerRef?: (el: HTMLDivElement | null) => void;
}) {
  if (item.type === 'exposition') {
    return (
      <div className="rounded-md bg-void-50/60 px-3 py-2 text-xs italic text-void-600 dark:bg-void-900/40 dark:text-void-400">
        <p className="whitespace-pre-wrap">{item.text}</p>
      </div>
    );
  }

  const wrapperClass = `rounded-md border px-3 py-2.5 transition-all ${
    highlight
      ? 'border-amber-400/80 bg-amber-50/40 dark:border-amber-500/60 dark:bg-amber-950/20 ring-2 ring-amber-400/50'
      : 'border-void-200/60 bg-white/30 dark:border-void-700/40 dark:bg-void-900/30'
  }`;

  return (
    <div ref={containerRef} className={wrapperClass}>
      <label className="mb-1.5 block text-sm font-medium text-void-900 dark:text-void-100">
        {item.question}
        {item.required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {renderInput(item, onChange)}
    </div>
  );
}

function renderInput(item: AnswerableItem, onChange: (v: unknown, debounceMs?: number) => void) {
  switch (item.type) {
    case 'free_text':
      return (
        <textarea
          data-voice-target
          value={item.answer ?? ''}
          onChange={(e) => onChange(e.target.value || null, 500)}
          rows={2}
          className="w-full rounded-md border border-void-200/60 bg-white/50 px-2.5 py-1.5 text-sm text-void-900 outline-none focus:border-neon-blue-400 dark:border-void-700/50 dark:bg-void-900/40 dark:text-void-100"
          placeholder="Type your answer…"
        />
      );

    case 'single_choice':
      return <SingleChoiceInput item={item} onChange={onChange} />;

    case 'multi_choice':
      return <MultiChoiceInput item={item} onChange={onChange} />;

    case 'boolean':
      return (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onChange(true)}
            className={`min-w-[64px] rounded-md border px-3 py-1.5 text-sm transition-all ${
              item.answer === true
                ? 'border-neon-blue-400/50 bg-neon-blue-400/15 text-neon-blue-400'
                : 'border-void-200/60 bg-white/30 text-void-600 hover:border-neon-blue-400/30 dark:border-void-700/40 dark:bg-void-900/30 dark:text-void-400'
            }`}
          >
            Yes
          </button>
          <button
            onClick={() => onChange(false)}
            className={`min-w-[64px] rounded-md border px-3 py-1.5 text-sm transition-all ${
              item.answer === false
                ? 'border-neon-blue-400/50 bg-neon-blue-400/15 text-neon-blue-400'
                : 'border-void-200/60 bg-white/30 text-void-600 hover:border-neon-blue-400/30 dark:border-void-700/40 dark:bg-void-900/30 dark:text-void-400'
            }`}
          >
            No
          </button>
          {item.answer !== null && (
            <button
              onClick={() => onChange(null)}
              className="rounded-md border border-void-200/60 bg-transparent px-2 py-1.5 text-xs text-void-500 hover:bg-void-50 dark:border-void-700/40 dark:text-void-400 dark:hover:bg-void-900"
              title="Clear"
            >
              ✕
            </button>
          )}
        </div>
      );

    case 'scale': {
      const range: number[] = [];
      for (let n = item.min; n <= item.max; n += item.step ?? 1) range.push(n);
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {range.map((n) => (
            <button
              key={n}
              onClick={() => onChange(n)}
              className={`min-w-[36px] rounded-md border px-2.5 py-1.5 text-sm transition-all ${
                item.answer === n
                  ? 'border-neon-blue-400/50 bg-neon-blue-400/15 text-neon-blue-400'
                  : 'border-void-200/60 bg-white/30 text-void-600 hover:border-neon-blue-400/30 dark:border-void-700/40 dark:bg-void-900/30 dark:text-void-400'
              }`}
            >
              {n}
            </button>
          ))}
          {item.answer !== null && (
            <button
              onClick={() => onChange(null)}
              className="rounded-md border border-void-200/60 bg-transparent px-2 py-1.5 text-xs text-void-500 hover:bg-void-50 dark:border-void-700/40 dark:text-void-400 dark:hover:bg-void-900"
              title="Clear"
            >
              ✕
            </button>
          )}
        </div>
      );
    }

    case 'number':
      return (
        <input
          data-voice-target
          type="number"
          value={item.answer ?? ''}
          min={item.min}
          max={item.max}
          step={item.step}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') onChange(null, 300);
            else {
              const n = Number(v);
              if (Number.isFinite(n)) onChange(n, 300);
            }
          }}
          className="w-28 rounded-md border border-void-200/60 bg-white/50 px-2.5 py-1.5 text-sm text-void-900 outline-none focus:border-neon-blue-400 dark:border-void-700/50 dark:bg-void-900/40 dark:text-void-100"
        />
      );
  }
}

function SingleChoiceInput({
  item,
  onChange,
}: {
  item: import('@/lib/questionnaire').SingleChoiceItem;
  onChange: (v: unknown, debounceMs?: number) => void;
}) {
  const isOther = typeof item.answer === 'string' && item.answer.startsWith('Other:');
  const otherText = isOther ? (item.answer as string).slice('Other:'.length).trimStart() : '';

  return (
    <div className="space-y-1">
      {item.options.map((opt) => (
        <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm text-void-700 dark:text-void-300">
          <input
            type="radio"
            name={item.id}
            checked={item.answer === opt}
            onChange={() => onChange(opt)}
            className="accent-neon-blue-400"
          />
          {opt}
        </label>
      ))}
      {item.allow_other && (
        <div className="space-y-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-void-700 dark:text-void-300">
            <input
              type="radio"
              name={item.id}
              checked={isOther}
              onChange={() => onChange('Other:')}
              className="accent-neon-blue-400"
            />
            Other
          </label>
          {isOther && (
            <input
              data-voice-target
              type="text"
              value={otherText}
              onChange={(e) => onChange(`Other: ${e.target.value}`, 500)}
              placeholder="Specify…"
              className="ml-6 w-full max-w-md rounded-md border border-void-200/60 bg-white/50 px-2.5 py-1 text-sm text-void-900 outline-none focus:border-neon-blue-400 dark:border-void-700/50 dark:bg-void-900/40 dark:text-void-100"
            />
          )}
        </div>
      )}
      {item.answer !== null && (
        <button
          onClick={() => onChange(null)}
          className="text-xs text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-300"
          title="Clear selection"
        >
          Clear
        </button>
      )}
    </div>
  );
}

function MultiChoiceInput({
  item,
  onChange,
}: {
  item: import('@/lib/questionnaire').MultiChoiceItem;
  onChange: (v: unknown, debounceMs?: number) => void;
}) {
  const current = item.answer || [];
  const otherEntry = current.find((v) => v.startsWith('Other:'));
  const otherText = otherEntry ? otherEntry.slice('Other:'.length).trimStart() : '';
  const isOther = !!otherEntry;

  function toggleOption(opt: string) {
    const has = current.includes(opt);
    const next = has ? current.filter((v) => v !== opt) : [...current, opt];
    onChange(next.length === 0 ? null : next);
  }
  function toggleOther() {
    if (isOther) {
      const next = current.filter((v) => !v.startsWith('Other:'));
      onChange(next.length === 0 ? null : next);
    } else {
      onChange([...current, 'Other:']);
    }
  }
  function setOtherText(text: string) {
    const next = current.filter((v) => !v.startsWith('Other:'));
    next.push(`Other: ${text}`);
    onChange(next, 500);
  }

  return (
    <div className="space-y-1">
      {item.options.map((opt) => (
        <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm text-void-700 dark:text-void-300">
          <input
            type="checkbox"
            checked={current.includes(opt)}
            onChange={() => toggleOption(opt)}
            className="accent-neon-blue-400"
          />
          {opt}
        </label>
      ))}
      {item.allow_other && (
        <div className="space-y-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-void-700 dark:text-void-300">
            <input
              type="checkbox"
              checked={isOther}
              onChange={toggleOther}
              className="accent-neon-blue-400"
            />
            Other
          </label>
          {isOther && (
            <input
              data-voice-target
              type="text"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder="Specify…"
              className="ml-6 w-full max-w-md rounded-md border border-void-200/60 bg-white/50 px-2.5 py-1 text-sm text-void-900 outline-none focus:border-neon-blue-400 dark:border-void-700/50 dark:bg-void-900/40 dark:text-void-100"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Helpers (local copies — keep in sync with the lib)
// ===========================================================================

function isAnswerable(item: QuestionnaireItem): item is AnswerableItem {
  return item.type !== 'exposition';
}

function isAnswerFilled(item: AnswerableItem): boolean {
  if (item.answer === null || item.answer === undefined) return false;
  switch (item.type) {
    case 'free_text':
    case 'single_choice':
      return typeof item.answer === 'string' && item.answer.trim().length > 0;
    case 'multi_choice':
      return Array.isArray(item.answer) && item.answer.length > 0;
    case 'boolean':
      return item.answer === true || item.answer === false;
    case 'scale':
    case 'number':
      return typeof item.answer === 'number' && Number.isFinite(item.answer);
  }
}

function computeCounts(q: Questionnaire) {
  let answered = 0;
  let answerable = 0;
  let requiredMissing = 0;
  for (const item of q.items) {
    if (!isAnswerable(item)) continue;
    answerable++;
    const filled = isAnswerFilled(item);
    if (filled) answered++;
    if (item.required && !filled) requiredMissing++;
  }
  return { answered, answerable, requiredMissing };
}
