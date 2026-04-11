import { getProject, loadRegistry } from '@/lib/registry';
import { ProjectView } from '@/components/ProjectView';
import { ProjectPageClient } from '@/components/ProjectPageClient';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { id } = await params;
  const project = await getProject(id);

  if (!project) {
    notFound();
  }

  const projectPath = project.path;

  return (
    <ProjectPageClient
      projectId={project.id}
      projectName={project.name}
      projectDescription={project.description}
      projectPath={projectPath}
    >
      {/* Header and Kanban Board */}
      <ProjectView project={project} projectPath={projectPath} />
    </ProjectPageClient>
  );
}

// Generate static params for all projects
export async function generateStaticParams() {
  const registry = await loadRegistry();
  return registry.projects.map((project) => ({
    id: project.id,
  }));
}
