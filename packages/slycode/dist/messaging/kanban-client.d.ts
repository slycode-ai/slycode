import type { Project, KanbanBoard, KanbanCard } from './types.js';
export declare class KanbanClient {
    private projects;
    constructor(projects: Project[]);
    updateProjects(projects: Project[]): void;
    getKanbanPath(projectId: string): string | null;
    getBoard(projectId: string): KanbanBoard;
    getCard(projectId: string, cardId: string): {
        card: KanbanCard;
        stage: string;
    } | null;
    getCardsByStage(projectId: string, stage: string): KanbanCard[];
    /** Get all automation cards across all stages for a project. */
    getAutomationCards(projectId: string): KanbanCard[];
    getAllStages(): string[];
    /** Search cards across one or more projects. Title matches score higher than description. */
    searchCards(projectIds: string[], query: string, maxResults?: number): Array<{
        card: KanbanCard;
        stage: string;
        score: number;
        projectId: string;
    }>;
    /** Get all cards across one or more projects (includes archived, excludes automations). */
    getAllCards(projectIds: string[]): Array<{
        card: KanbanCard;
        stage: string;
        projectId: string;
    }>;
}
