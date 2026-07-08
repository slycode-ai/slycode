import fs from 'fs';
import path from 'path';
import type { Project, KanbanBoard, KanbanCard, KanbanStages } from './types.js';

const STAGES: (keyof KanbanStages)[] = ['backlog', 'design', 'implementation', 'testing', 'done'];

const EMPTY_BOARD: KanbanBoard = {
  project_id: '',
  stages: { backlog: [], design: [], implementation: [], testing: [], done: [] },
  last_updated: '',
};

export class KanbanClient {
  private projects: Project[];

  constructor(projects: Project[]) {
    this.projects = projects;
  }

  updateProjects(projects: Project[]): void {
    this.projects = projects;
  }

  getKanbanPath(projectId: string): string | null {
    const project = this.projects.find(p => p.id === projectId);
    if (!project?.path) return null;
    return path.join(project.path, 'documentation', 'kanban.json');
  }

  getBoard(projectId: string): KanbanBoard {
    const filePath = this.getKanbanPath(projectId);
    if (!filePath) return { ...EMPTY_BOARD, project_id: projectId };

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return data as KanbanBoard;
    } catch {
      return { ...EMPTY_BOARD, project_id: projectId };
    }
  }

  /**
   * Read the cold archive board (kanban-archive.json — feature 077). Archived
   * cards live there, same stages shape as the live board. Missing/corrupt
   * file = empty, never an error. Read-only client; union-and-dedupe by id
   * with live winning (mirrors scripts/kanban.js + web/src/lib/kanban-cold.ts).
   */
  private getColdBoard(projectId: string): KanbanBoard {
    const filePath = this.getKanbanPath(projectId);
    if (!filePath) return { ...EMPTY_BOARD, project_id: projectId };
    try {
      const coldPath = path.join(path.dirname(filePath), 'kanban-archive.json');
      const data = JSON.parse(fs.readFileSync(coldPath, 'utf-8'));
      return data as KanbanBoard;
    } catch {
      return { ...EMPTY_BOARD, project_id: projectId };
    }
  }

  /** Live board unioned with the cold archive (dedupe by id, live wins). */
  private getBoardWithArchive(projectId: string): KanbanBoard {
    const live = this.getBoard(projectId);
    const cold = this.getColdBoard(projectId);
    const stages: KanbanStages = { backlog: [], design: [], implementation: [], testing: [], done: [] };
    for (const stage of STAGES) {
      const liveCards = live.stages[stage] || [];
      const liveIds = new Set(liveCards.map(c => c.id));
      stages[stage] = [...liveCards, ...(cold.stages?.[stage] || []).filter(c => c && c.id && !liveIds.has(c.id))];
    }
    return { ...live, stages };
  }

  getCard(projectId: string, cardId: string): { card: KanbanCard; stage: string } | null {
    const board = this.getBoard(projectId);
    for (const stage of STAGES) {
      const card = board.stages[stage]?.find(c => c.id === cardId);
      if (card) return { card, stage };
    }
    // Cold-storage fallback: archived cards live in kanban-archive.json.
    // Only read on a live miss so the common path stays cheap.
    const cold = this.getColdBoard(projectId);
    for (const stage of STAGES) {
      const card = cold.stages?.[stage]?.find(c => c.id === cardId);
      if (card) return { card, stage };
    }
    return null;
  }

  getCardsByStage(projectId: string, stage: string): KanbanCard[] {
    const board = this.getBoard(projectId);
    const cards = board.stages[stage as keyof KanbanStages] || [];
    return cards.filter(c => !c.archived && !c.automation)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  /** Get all automation cards across all stages for a project. */
  getAutomationCards(projectId: string): KanbanCard[] {
    const board = this.getBoard(projectId);
    const results: KanbanCard[] = [];
    for (const stage of STAGES) {
      for (const card of board.stages[stage] || []) {
        if (!card.archived && card.automation) {
          results.push(card);
        }
      }
    }
    return results;
  }

  getAllStages(): string[] {
    return [...STAGES];
  }

  /** Search cards across one or more projects. Title matches score higher than description. */
  searchCards(
    projectIds: string[],
    query: string,
    maxResults: number = 5,
  ): Array<{ card: KanbanCard; stage: string; score: number; projectId: string }> {
    const lowerQuery = query.toLowerCase();
    const results: Array<{ card: KanbanCard; stage: string; score: number; projectId: string }> = [];

    for (const projectId of projectIds) {
      // Union cold storage — archived cards remain searchable (scored lower)
      const board = this.getBoardWithArchive(projectId);
      for (const stage of STAGES) {
        for (const card of board.stages[stage] || []) {
          let score = 0;
          if (card.title.toLowerCase().includes(lowerQuery)) score += 2;
          if (card.description?.toLowerCase().includes(lowerQuery)) score += 1;
          if (score === 0) continue;
          if (card.archived) score -= 1;
          results.push({ card, stage, score, projectId });
        }
      }
    }

    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.card.updated_at || '').localeCompare(a.card.updated_at || '');
    });

    return results.slice(0, maxResults);
  }

  /** Get all cards across one or more projects (includes archived, excludes automations). */
  getAllCards(
    projectIds: string[],
  ): Array<{ card: KanbanCard; stage: string; projectId: string }> {
    const results: Array<{ card: KanbanCard; stage: string; projectId: string }> = [];

    for (const projectId of projectIds) {
      // Union cold storage — this method's contract includes archived cards
      const board = this.getBoardWithArchive(projectId);
      for (const stage of STAGES) {
        for (const card of board.stages[stage] || []) {
          if (!card.automation) {
            results.push({ card, stage, projectId });
          }
        }
      }
    }

    return results;
  }
}
