'use client';

import { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import type { BridgeStats, ProjectWithBacklog } from '@/lib/types';
import { computeSessionKey, sessionBelongsToProject } from '@/lib/session-keys';
import { ProjectHeader } from './ProjectHeader';
import { ProjectKanban } from './ProjectKanban';
import { CodeModeView } from './code-mode/CodeModeView';

interface ProjectViewProps {
  project: ProjectWithBacklog;
  projectPath?: string;
}

export function ProjectView({ project, projectPath }: ProjectViewProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);
  const [hasActiveAutomations, setHasActiveAutomations] = useState(false);
  const [codeMode, setCodeMode] = useState(false);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  // While in Code Mode, watch for board-side activity (card/global sessions —
  // NOT the atlas session, which is visible in Code Mode itself) so the Board
  // toggle can glow: "something is still busy over there".
  const [boardActive, setBoardActive] = useState(false);
  useEffect(() => {
    // No sync reset needed: the header only renders the glow while codeMode
    // is on, and the first poll after re-entry corrects any stale value.
    if (!codeMode) return;
    const projShape = {
      id: project.id,
      path: projectPath ?? '',
      sessionKey: projectPath ? computeSessionKey(projectPath) : undefined,
    };
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/bridge/stats');
        if (!res.ok || cancelled) return;
        const stats: BridgeStats = await res.json();
        const active = stats.sessions.some(s =>
          s.isActive &&
          !s.name.endsWith(':atlas') &&
          sessionBelongsToProject(s.name, projShape),
        );
        if (!cancelled) setBoardActive(active);
      } catch { /* bridge quiet */ }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [codeMode, project.id, projectPath]);

  // Deep link: /project/<id>?view=code opens straight into Code Mode.
  // window.location (not useSearchParams) so this component needs no Suspense.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'code') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCodeMode(true);
    }
  }, []);

  // Side effects (URL sync, sibling-mode resets) live in the event handler,
  // NOT inside the setState updater — updaters run during render, and
  // history.replaceState there re-enters the Router mid-render.
  const toggleCodeMode = useCallback(() => {
    const next = !codeMode;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('view', 'code');
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url.toString());
    if (next) {
      setShowArchived(false);
      setShowAutomations(false);
    }
    setCodeMode(next);
  }, [codeMode]);

  const handleRefresh = useCallback(async () => {
    await refreshRef.current?.();
  }, []);

  return (
    <>
      <ProjectHeader
        name={project.name}
        description={project.description}
        tags={project.tags}
        projectId={project.id}
        projectPath={projectPath}
        showArchived={showArchived}
        onToggleArchived={() => {
          setShowArchived(!showArchived);
          if (!showArchived) setShowAutomations(false); // exit automations when entering archived
        }}
        showAutomations={showAutomations}
        hasActiveAutomations={hasActiveAutomations}
        onToggleAutomations={() => {
          setShowAutomations(!showAutomations);
          if (!showAutomations) setShowArchived(false); // exit archived when entering automations
        }}
        onRefresh={codeMode ? undefined : handleRefresh}
        codeMode={codeMode}
        onToggleCodeMode={toggleCodeMode}
        boardActive={boardActive}
      />
      {codeMode ? (
        <CodeModeView projectId={project.id} projectName={project.name} projectPath={projectPath} />
      ) : (
        <Suspense>
          <ProjectKanban
            project={project}
            projectPath={projectPath}
            showArchived={showArchived}
            showAutomations={showAutomations}
            onActiveAutomationsChange={setHasActiveAutomations}
            onAutomationToggle={(isAuto) => {
              setShowAutomations(isAuto);
              if (isAuto) setShowArchived(false);
            }}
            onExitMode={() => {
              setShowArchived(false);
              setShowAutomations(false);
            }}
            onRefreshReady={(fn) => { refreshRef.current = fn; }}
          />
        </Suspense>
      )}
    </>
  );
}
