'use client';

/**
 * Atlas terminal — the ask-the-codebase side panel (feature 076, Phase 2/3).
 *
 * Embeds the live provider CLI session ({sessionKey}:{provider}:atlas) via
 * ClaudeTerminalPanel, side-by-side with the code (terminals want vertical
 * space — design decision from mockup v2 review). The chrome matches Code
 * Mode; the content is the CLI's own output (no API control).
 *
 * Reports its current provider upward so ✦ Explain can address the right
 * session via verified submit.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { getActionsForClass } from '@/lib/sly-actions';
import { useSlyActionsConfig } from '@/hooks/useSlyActionsConfig';
import { computeSessionKey } from '@/lib/session-keys';
import { useVoice } from '@/contexts/VoiceContext';
import type { TerminalHandle } from '@/lib/types';
import { ClaudeTerminalPanel, type TerminalContext } from '../ClaudeTerminalPanel';

interface AtlasTerminalProps {
  projectId: string;
  projectName: string;
  projectPath: string;
  onClose: () => void;
  onProviderChange: (provider: string) => void;
}

export function AtlasTerminal({ projectId, projectName, projectPath, onClose, onProviderChange }: AtlasTerminalProps) {
  const actionsConfig = useSlyActionsConfig();
  const [provider, setProvider] = useState('claude');
  // Destructure the STABLE callbacks — the context VALUE object is recreated
  // on every voice-state render, and depending on it made this effect's
  // cleanup unregister the handle the moment recording started (worked once,
  // then dead: submit found no target, the shortcut gate never re-armed).
  const { registerTerminal, unregisterTerminal, setHasFieldFocus } = useVoice();
  const voiceId = `atlas-${projectId}`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [termHandle, setTermHandle] = useState<TerminalHandle | null>(null);

  useEffect(() => {
    if (!termHandle) return;
    registerTerminal(voiceId, termHandle);
    // Self-heal: if focus already sits inside this panel, arm the gate.
    if (rootRef.current?.contains(document.activeElement)) setHasFieldFocus(true);
    return () => unregisterTerminal(voiceId);
  }, [termHandle, voiceId, registerTerminal, unregisterTerminal, setHasFieldFocus]);

  useEffect(() => {
    fetch('/api/providers')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        const p = data?.defaults?.global?.provider;
        if (p) { setProvider(p); onProviderChange(p); }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionKey = computeSessionKey(projectPath);
  const sessionName = `${sessionKey}:atlas`;

  const actions = getActionsForClass(actionsConfig.commands, actionsConfig.classAssignments, 'atlas', { projectId });

  // Delivered on bare Start — the context object below only reaches the agent
  // via action templates, and the atlas class has none, so THIS is the real
  // briefing channel for hand-started ask-the-codebase sessions.
  const startupPrompt = [
    `You are the ATLAS TERMINAL for ${projectName} (${projectPath}) — the ask-the-codebase session inside SlyCode's Code Mode.`,
    `Before answering questions, load the atlas skill: read .claude/skills/atlas/SKILL.md (fall back to store/skills/atlas/SKILL.md).`,
    `RULE — SHOW, DON'T TELL: when the user asks to see/show/find code or locations, present results IN THE VIEW via sly-atlas — \`deck\` for multiple results, \`navigate\` for one, \`highlight\` for a range — never only a path list in this terminal.`,
    `Acknowledge briefly and wait for the user's first question.`,
  ].join('\n');

  const terminalContext: TerminalContext = useMemo(() => ({
    projectContext: [
      `Project: ${projectName} (${projectPath})`,
      '',
      'This is the ATLAS TERMINAL — the ask-the-codebase session inside Code Mode.',
      '',
      "RULE — SHOW, DON'T TELL: whenever the user asks to see/show/find code or",
      'locations ("show me…", "where is…", "find all…"), you MUST present the',
      'results in the Code Mode view via sly-atlas — never as a plain list in',
      'this terminal:',
      '  sly-atlas deck --file <json>                multiple results → clickable location cards',
      '  sly-atlas navigate <file[:line]>            single result → jump the code panel there',
      '  sly-atlas highlight <file:line-end> --note  a range worth reading, with your note',
      'A one-line terminal summary alongside is fine; the deck/navigate is mandatory.',
      'Atlas artifacts are managed via the atlas skill (sly-atlas status / write-node).',
    ].join('\n'),
    project: { name: projectName, description: 'Code Mode atlas terminal' },
    projectPath,
  }), [projectName, projectPath]);

  // Deliberate dark well in BOTH themes — the CLI body is always dark, so the
  // chrome matches it with fixed colors instead of theme tokens. A light
  // header over a black body read as an unthemed iframe in light mode.
  return (
    <div ref={rootRef} className="flex h-full w-full flex-col bg-[#222228] dark:bg-[#1a1a1a]">
      <div className="flex items-center gap-2.5 border-b border-white/10 bg-[#1a1a20] px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#46d7c2]">Atlas Terminal</span>
        <span className="truncate font-mono text-[10px] text-[#6b7484]">ask the codebase · can drive the view</span>
        <button onClick={onClose} className="ml-auto font-mono text-[12px] text-[#6b7484] hover:text-[#e2e8f0]" title="Close panel">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ClaudeTerminalPanel
          sessionName={sessionName}
          cwd={projectPath}
          actionsConfig={actionsConfig}
          actions={actions}
          context={terminalContext}
          initialProvider={provider}
          tintColor="rgba(70, 215, 194, 0.08)"
          voiceTerminalId={voiceId}
          defaultStartupPrompt={startupPrompt}
          onProviderChange={p => { setProvider(p); onProviderChange(p); }}
          onTerminalReady={setTermHandle}
        />
      </div>
    </div>
  );
}
