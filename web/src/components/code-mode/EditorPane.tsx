'use client';

/**
 * Code Mode — Monaco editor pane (feature 076, Phase 1).
 *
 * The escape hatch: open/edit/save any project file (dotfiles and .env
 * included). Monaco is SELF-HOSTED from /public/monaco/vs (copy-monaco.js) —
 * no CDN, deployed installs work offline. Multi-file via Monaco's model
 * registry (`path` prop); tabs + dirty tracking here; save = PUT
 * /api/atlas/file (Ctrl+S or button). Blame footer shows the current line's
 * last commit when toggled.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import type { editor as MonacoEditorNS } from 'monaco-editor';
import { useVoice } from '@/contexts/VoiceContext';
import type { BlameLine, OpenTarget } from './types';

// Self-host Monaco (module-level, once).
loader.config({ paths: { vs: '/monaco/vs' } });

interface FileState {
  content: string;      // last loaded/saved content
  language: string;
  mtimeMs: number;
  dirty: boolean;
  error?: string;
}

interface EditorPaneProps {
  projectId: string;
  openFiles: string[];
  /** null while another scene is shown — pane stays mounted to keep models */
  active: OpenTarget | null;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  /** ✦ Explain selection → Atlas terminal (Phase 3) */
  onExplain?: (path: string, startLine: number, endLine: number, code: string) => void;
}

export function EditorPane({ projectId, openFiles, active, onSelectFile, onCloseFile, onExplain }: EditorPaneProps) {
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [blame, setBlame] = useState<{ path: string; lines: BlameLine[] } | null>(null);
  const [blameOn, setBlameOn] = useState(false);
  const [cursorLine, setCursorLine] = useState(1);
  const [isDark, setIsDark] = useState(true);
  const [hasSelection, setHasSelection] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<MonacoEditorNS.IEditorDecorationsCollection | null>(null);
  const activePath = active?.path ?? openFiles[openFiles.length - 1];

  // Voice-into-the-file: the editor registers as a pseudo-terminal so the
  // voice hotkey (focus inside the data-terminal-id wrapper) inserts the
  // transcript at the Monaco cursor. Terminal auto-submit sends '\r' after
  // the text — meaningless in a file, so it's filtered.
  const { registerTerminal, unregisterTerminal } = useVoice();
  const editorVoiceId = `editor-${projectId}`;
  useEffect(() => {
    registerTerminal(editorVoiceId, {
      sendInput: (text: string) => {
        if (text === '\r' || text === '\n' || text === '\r\n') return;
        const ed = editorRef.current;
        if (!ed) return;
        const sel = ed.getSelection();
        const pos = ed.getPosition();
        const range = sel ?? (pos
          ? { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }
          : { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 });
        ed.executeEdits('voice', [{ range, text, forceMoveMarkers: true }]);
        ed.focus();
      },
    });
    return () => unregisterTerminal(editorVoiceId);
  }, [editorVoiceId, registerTerminal, unregisterTerminal]);

  // Track app theme (`dark` class on <html>) so Monaco follows the toggle.
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  // Load content for any open file we haven't fetched yet.
  useEffect(() => {
    for (const path of openFiles) {
      if (files[path]) continue;
      setFiles(prev => ({ ...prev, [path]: { content: '', language: 'plaintext', mtimeMs: 0, dirty: false } }));
      fetch(`/api/atlas/file?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`)
        .then(async r => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
          setFiles(prev => ({
            ...prev,
            [path]: { content: data.content, language: data.language, mtimeMs: data.mtimeMs, dirty: false },
          }));
        })
        .catch(e => {
          setFiles(prev => ({
            ...prev,
            [path]: { content: '', language: 'plaintext', mtimeMs: 0, dirty: false, error: String(e.message ?? e) },
          }));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiles, projectId]);

  // Reveal requested line + apply AI highlight when the target carries them.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const line = active?.line ?? active?.highlight?.line;
    if (line) {
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    }
    decorationsRef.current?.clear();
    setAiNote(null);
    const hl = active?.highlight;
    if (hl) {
      const end = hl.endLine ?? hl.line;
      decorationsRef.current = ed.createDecorationsCollection([
        {
          range: { startLineNumber: hl.line, startColumn: 1, endLineNumber: end, endColumn: 1 },
          options: { isWholeLine: true, className: 'cm-ai-highlight', linesDecorationsClassName: 'cm-ai-highlight-gutter' },
        },
      ]);
      if (hl.note) setAiNote(hl.note);
    }
  }, [active]);

  const save = useCallback(async (path: string) => {
    const model = editorRef.current?.getModel();
    if (!model || saving) return;
    const content = model.getValue();
    setSaving(true);
    try {
      const res = await fetch('/api/atlas/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, path, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setFiles(prev => ({
        ...prev,
        [path]: { ...prev[path], content, dirty: false, mtimeMs: data.mtimeMs },
      }));
      flashNotice(`saved ${path.split('/').pop()}`);
    } catch (e) {
      flashNotice(`save failed: ${String((e as Error).message ?? e)}`);
    } finally {
      setSaving(false);
    }
  }, [projectId, saving]);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  };

  const toggleBlame = useCallback(async () => {
    if (blameOn) {
      setBlameOn(false);
      return;
    }
    if (!activePath) return;
    try {
      const res = await fetch(`/api/atlas/git?projectId=${encodeURIComponent(projectId)}&op=blame&path=${encodeURIComponent(activePath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBlame({ path: activePath, lines: data.lines });
      setBlameOn(true);
    } catch {
      flashNotice('blame unavailable (untracked file?)');
    }
  }, [activePath, blameOn, projectId]);

  const current = activePath ? files[activePath] : undefined;
  const blameForLine = useMemo(() => {
    if (!blameOn || !blame || blame.path !== activePath) return null;
    return blame.lines.find(l => l.line === cursorLine) ?? null;
  }, [blameOn, blame, activePath, cursorLine]);

  if (!activePath) return null;

  return (
    <div className="flex h-full flex-col bg-(--cm-code-bg)">
      {/* Tabs */}
      <div className="flex items-center overflow-x-auto border-b border-(--cm-line) bg-(--cm-panel)">
        {openFiles.map(path => {
          const st = files[path];
          const isActive = path === activePath;
          return (
            <span
              key={path}
              // Middle-click anywhere on the tab closes it (VS Code muscle memory).
              // mousedown (not auxclick) so we also suppress autoscroll.
              onMouseDown={e => {
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseFile(path);
                }
              }}
              className={`group flex shrink-0 items-center border-r border-(--cm-line) font-mono text-[11.5px] ${
                isActive ? 'bg-(--cm-code-bg) text-(--cm-text)' : 'text-(--cm-muted) hover:text-(--cm-text)'
              }`}
            >
              <button onClick={() => onSelectFile(path)} className="px-3 py-1.5" title={path}>
                {st?.dirty ? <span className="mr-1 text-(--cm-stale)">●</span> : null}
                {path.split('/').pop()}
              </button>
              <button
                onClick={() => onCloseFile(path)}
                className="pr-2 text-(--cm-faint) opacity-0 hover:text-(--cm-text) group-hover:opacity-100"
                title="Close"
              >
                ✕
              </button>
            </span>
          );
        })}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 px-2">
          {notice && <span className="font-mono text-[10.5px] text-(--cm-atlas)">{notice}</span>}
          {hasSelection && onExplain && (
            <button
              onClick={() => {
                const ed = editorRef.current;
                const sel = ed?.getSelection();
                const model = ed?.getModel();
                if (!ed || !sel || !model || sel.isEmpty()) return;
                onExplain(activePath, sel.startLineNumber, sel.endLineNumber, model.getValueInRange(sel));
              }}
              className="rounded-full border border-(--cm-atlas) bg-(--cm-atlas-dim) px-2.5 py-0.5 font-mono text-[10px] text-(--cm-atlas) hover:brightness-110"
              title="Explain the selected code in the Atlas terminal"
            >
              ✦ Explain selection
            </button>
          )}
          <button
            onClick={toggleBlame}
            className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
              blameOn ? 'border-(--cm-atlas) text-(--cm-atlas)' : 'border-(--cm-line) text-(--cm-muted) hover:border-(--cm-atlas) hover:text-(--cm-atlas)'
            }`}
          >
            Blame
          </button>
          <button
            onClick={() => save(activePath)}
            disabled={saving || !current?.dirty}
            className="rounded border border-(--cm-line) px-2 py-0.5 font-mono text-[10px] text-(--cm-muted) enabled:hover:border-(--cm-atlas) enabled:hover:text-(--cm-atlas) disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </span>
      </div>

      {/* AI highlight note (from `sly-atlas highlight`) */}
      {aiNote && (
        <div className="flex items-start gap-2 border-b border-(--cm-atlas) bg-(--cm-atlas-dim) px-3 py-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-(--cm-atlas)">✦ atlas</span>
          <p className="min-w-0 flex-1 text-[12px] leading-snug text-(--cm-text)">{aiNote}</p>
          <button onClick={() => { setAiNote(null); decorationsRef.current?.clear(); }} className="font-mono text-[11px] text-(--cm-faint) hover:text-(--cm-text)">✕</button>
        </div>
      )}

      {/* Editor — data-terminal-id makes it a voice focus target */}
      <div className="min-h-0 flex-1" data-terminal-id={editorVoiceId}>
        {current?.error ? (
          <p className="p-4 font-mono text-[12px] text-(--cm-stale)">{current.error}</p>
        ) : (
          <Editor
            path={`slycode://${projectId}/${activePath}`}
            language={current?.language ?? 'plaintext'}
            value={current?.content ?? ''}
            theme={isDark ? 'slycode-dark' : 'slycode-light'}
            beforeMount={defineThemes}
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              editor.onDidChangeCursorPosition(e => setCursorLine(e.position.lineNumber));
              editor.onDidChangeCursorSelection(e => setHasSelection(!e.selection.isEmpty()));
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                const uri = editor.getModel()?.uri.toString() ?? '';
                const path = uri.split(`slycode://${projectId}/`)[1];
                if (path) save(decodeURIComponent(path).replace(/^\//, ''));
              });
              if (active?.line) {
                editor.revealLineInCenter(active.line);
                editor.setPosition({ lineNumber: active.line, column: 1 });
              }
            }}
            onChange={value => {
              if (value === undefined) return;
              setFiles(prev => {
                const st = prev[activePath];
                if (!st) return prev;
                const dirty = value !== st.content;
                if (dirty === st.dirty) return prev;
                return { ...prev, [activePath]: { ...st, dirty } };
              });
            }}
            options={{
              fontSize: 13,
              fontFamily: 'var(--font-mono, "JetBrains Mono"), ui-monospace, monospace',
              minimap: { enabled: true, scale: 1 },
              scrollBeyondLastLine: false,
              renderWhitespace: 'none',
              automaticLayout: true,
              fixedOverflowWidgets: true,
              multiCursorModifier: 'ctrlCmd',
            }}
          />
        )}
      </div>

      {/* Blame footer */}
      {blameOn && (
        <div className="border-t border-(--cm-line) bg-(--cm-panel) px-3 py-1 font-mono text-[10.5px] text-(--cm-muted)">
          {blameForLine ? (
            <>
              <span className="text-(--cm-atlas)">{blameForLine.shortHash}</span> · {blameForLine.author} ·{' '}
              {new Date(blameForLine.date).toLocaleDateString()} · {blameForLine.summary}
            </>
          ) : (
            <span className="text-(--cm-faint)">line {cursorLine}: no blame data (unsaved or untracked)</span>
          )}
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defineThemes(monaco: any) {
  // Highlighting ONLY — no language services (design decision: the editor is
  // an escape hatch, not an IDE). Monaco's built-in TS worker validates files
  // in isolation (no jsx setting, no module resolution), which paints bogus
  // red squiggles over every .tsx file and import. Mute all validators; the
  // monarch tokenizers keep full syntax coloring.
  monaco.languages.typescript?.typescriptDefaults?.setDiagnosticsOptions({
    noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true,
  });
  monaco.languages.typescript?.javascriptDefaults?.setDiagnosticsOptions({
    noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true,
  });
  monaco.languages.json?.jsonDefaults?.setDiagnosticsOptions({ validate: false });
  for (const l of ['css', 'scss', 'less'] as const) {
    monaco.languages.css?.[`${l}Defaults`]?.setOptions({ validate: false });
  }
  monaco.languages.html?.htmlDefaults?.setOptions({ validate: false });

  monaco.editor.defineTheme('slycode-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5c6675', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c792ea' },
      { token: 'string', foreground: '8fd3a7' },
      { token: 'identifier', foreground: 'd7dee8' },
      { token: 'type', foreground: 'e8b64a' },
      { token: 'number', foreground: '79b8ff' },
    ],
    colors: {
      'editor.background': '#0c0f16',
      'editor.lineHighlightBackground': '#12161f',
      'editorLineNumber.foreground': '#5c6675',
      'editorCursor.foreground': '#46d7c2',
      'editor.selectionBackground': '#46d7c23a',
    },
  });
  monaco.editor.defineTheme('slycode-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '939dae', fontStyle: 'italic' },
      { token: 'keyword', foreground: '7c3aed' },
      { token: 'string', foreground: '177a4c' },
      { token: 'type', foreground: 'a16207' },
      { token: 'number', foreground: '0b64c2' },
    ],
    colors: {
      'editor.background': '#fbfcfe',
      'editor.lineHighlightBackground': '#eff2f6',
      'editorLineNumber.foreground': '#8a94a6',
      'editorCursor.foreground': '#0d9488',
      'editor.selectionBackground': '#0d948826',
    },
  });
}
