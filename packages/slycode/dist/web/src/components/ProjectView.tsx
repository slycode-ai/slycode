'use client';

import { useState, useRef, useCallback, Suspense } from 'react';
import type { ProjectWithBacklog } from '@/lib/types';
import { ProjectHeader } from './ProjectHeader';
import { ProjectKanban } from './ProjectKanban';

interface ProjectViewProps {
  project: ProjectWithBacklog;
  projectPath?: string;
}

export function ProjectView({ project, projectPath }: ProjectViewProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [showAutomations, setShowAutomations] = useState(false);
  const [hasActiveAutomations, setHasActiveAutomations] = useState(false);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

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
        onRefresh={handleRefresh}
      />
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
    </>
  );
}
