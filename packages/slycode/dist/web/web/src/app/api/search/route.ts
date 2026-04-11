/**
 * Search API — GET /api/search
 *
 * Cross-project search across kanban cards.
 * Searches card titles, descriptions, problems, and checklist items.
 * Groups results by project, with contextual project first if projectId provided.
 *
 * Params: q (search term), projectId (optional, for contextual grouping)
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { loadRegistry } from '@/lib/registry';
import { getBridgeUrl } from '@/lib/paths';
import type { KanbanBoard, KanbanCard, KanbanStage, SearchResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

async function loadKanbanBoard(projectPath: string): Promise<KanbanBoard | null> {
  try {
    const kanbanPath = path.join(projectPath, 'documentation', 'kanban.json');
    const content = await fs.readFile(kanbanPath, 'utf-8');
    return JSON.parse(content) as KanbanBoard;
  } catch {
    return null;
  }
}

function searchCard(
  card: KanbanCard,
  query: string,
  stage: KanbanStage,
  projectId: string,
  projectName: string,
): SearchResult[] {
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();
  const isArchived = card.archived ?? false;

  // Search title
  if (card.title.toLowerCase().includes(lowerQuery)) {
    results.push({
      cardId: card.id,
      cardTitle: card.title,
      projectId,
      projectName,
      stage,
      matchField: 'title',
      snippet: card.title,
      isArchived,
    });
  }

  // Search description
  if (card.description?.toLowerCase().includes(lowerQuery)) {
    const idx = card.description.toLowerCase().indexOf(lowerQuery);
    const start = Math.max(0, idx - 40);
    const end = Math.min(card.description.length, idx + query.length + 40);
    const snippet = (start > 0 ? '...' : '') +
      card.description.slice(start, end) +
      (end < card.description.length ? '...' : '');

    results.push({
      cardId: card.id,
      cardTitle: card.title,
      projectId,
      projectName,
      stage,
      matchField: 'description',
      snippet,
      isArchived,
    });
  }

  // Search problems
  for (const problem of card.problems || []) {
    if (problem.description.toLowerCase().includes(lowerQuery)) {
      results.push({
        cardId: card.id,
        cardTitle: card.title,
        projectId,
        projectName,
        stage,
        matchField: 'problem',
        snippet: problem.description,
        isArchived,
      });
    }
  }

  // Search checklist items
  for (const item of card.checklist || []) {
    if (item.text.toLowerCase().includes(lowerQuery)) {
      results.push({
        cardId: card.id,
        cardTitle: card.title,
        projectId,
        projectName,
        stage,
        matchField: 'checklist',
        snippet: item.text,
        isArchived,
      });
    }
  }

  return results;
}

/**
 * Fetch active sessions from the bridge and resolve them to card SearchResults.
 * Returns cards that are currently being worked on (terminal output in last ~3s).
 */
async function getActiveSessionCards(registry: { projects: { id: string; name: string; path: string }[] }): Promise<SearchResult[]> {
  const bridgeUrl = getBridgeUrl();
  const results: SearchResult[] = [];

  try {
    const res = await fetch(`${bridgeUrl}/stats`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return results;

    const stats = await res.json() as { sessions: { name: string; status: string; isActive: boolean; lastOutputSnippet?: string }[] };
    const activeSessions = (stats.sessions || []).filter(s => s.isActive);
    if (activeSessions.length === 0) return results;

    // Parse session names: {projectId}:card:{cardId} or {projectId}:{provider}:card:{cardId}
    const sessionPattern = /^([^:]+):(?:[^:]+:)?card:(.+)$/;
    const cardLookups: { projectId: string; cardId: string; snippet?: string }[] = [];

    for (const session of activeSessions) {
      const match = session.name.match(sessionPattern);
      if (match) {
        cardLookups.push({
          projectId: match[1],
          cardId: match[2],
          snippet: session.lastOutputSnippet,
        });
      }
    }

    if (cardLookups.length === 0) return results;

    // Group by project to minimize file reads
    const byProject = new Map<string, { cardId: string; snippet?: string }[]>();
    for (const lookup of cardLookups) {
      if (!byProject.has(lookup.projectId)) byProject.set(lookup.projectId, []);
      byProject.get(lookup.projectId)!.push(lookup);
    }

    // Look up each card in its project's kanban board
    for (const [projectId, lookups] of byProject) {
      const project = registry.projects.find(p => p.id === projectId);
      if (!project) continue;

      const board = await loadKanbanBoard(project.path);
      if (!board?.stages) continue;

      const cardIds = new Set(lookups.map(l => l.cardId));
      const snippetMap = new Map(lookups.map(l => [l.cardId, l.snippet]));

      const stages = Object.entries(board.stages) as [KanbanStage, KanbanCard[]][];
      for (const [stage, cards] of stages) {
        for (const card of cards) {
          if (cardIds.has(card.id)) {
            results.push({
              cardId: card.id,
              cardTitle: card.title,
              projectId: project.id,
              projectName: project.name,
              stage,
              matchField: 'active-session',
              snippet: snippetMap.get(card.id) || 'Active session',
              isArchived: card.archived ?? false,
            });
          }
        }
      }
    }
  } catch {
    // Bridge not running or timeout — return empty
  }

  return results;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const contextProjectId = searchParams.get('projectId') || undefined;
    const mode = searchParams.get('mode');

    // Active sessions mode: return cards with active Claude sessions
    if (mode === 'active') {
      const registry = await loadRegistry();
      const results = await getActiveSessionCards(registry);
      return NextResponse.json({ results, mode: 'active' });
    }

    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'q parameter is required' },
        { status: 400 },
      );
    }

    const registry = await loadRegistry();
    const allResults: SearchResult[] = [];

    // If projectId provided, search only that project; otherwise search all
    const projectsToSearch = contextProjectId
      ? registry.projects.filter(p => p.id === contextProjectId)
      : registry.projects;

    for (const project of projectsToSearch) {
      const board = await loadKanbanBoard(project.path);
      if (!board?.stages) continue;

      const stages = Object.entries(board.stages) as [KanbanStage, KanbanCard[]][];
      for (const [stage, cards] of stages) {
        for (const card of cards) {
          const matches = searchCard(card, query.trim(), stage, project.id, project.name);
          allResults.push(...matches);
        }
      }
    }

    // Sort: context project first, then by stage priority
    const stagePriority: Record<string, number> = {
      implementation: 0,
      testing: 1,
      design: 2,
      backlog: 3,
      done: 4,
    };

    allResults.sort((a, b) => {
      // Context project first
      if (contextProjectId) {
        if (a.projectId === contextProjectId && b.projectId !== contextProjectId) return -1;
        if (b.projectId === contextProjectId && a.projectId !== contextProjectId) return 1;
      }
      // Then by stage priority
      return (stagePriority[a.stage] ?? 5) - (stagePriority[b.stage] ?? 5);
    });

    return NextResponse.json({ results: allResults, query: query.trim() });
  } catch (error) {
    console.error('Search failed:', error);
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 },
    );
  }
}
