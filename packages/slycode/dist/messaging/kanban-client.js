import fs from 'fs';
import path from 'path';
const STAGES = ['backlog', 'design', 'implementation', 'testing', 'done'];
const EMPTY_BOARD = {
    project_id: '',
    stages: { backlog: [], design: [], implementation: [], testing: [], done: [] },
    last_updated: '',
};
export class KanbanClient {
    projects;
    constructor(projects) {
        this.projects = projects;
    }
    updateProjects(projects) {
        this.projects = projects;
    }
    getKanbanPath(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project?.path)
            return null;
        return path.join(project.path, 'documentation', 'kanban.json');
    }
    getBoard(projectId) {
        const filePath = this.getKanbanPath(projectId);
        if (!filePath)
            return { ...EMPTY_BOARD, project_id: projectId };
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return data;
        }
        catch {
            return { ...EMPTY_BOARD, project_id: projectId };
        }
    }
    getCard(projectId, cardId) {
        const board = this.getBoard(projectId);
        for (const stage of STAGES) {
            const card = board.stages[stage]?.find(c => c.id === cardId);
            if (card)
                return { card, stage };
        }
        return null;
    }
    getCardsByStage(projectId, stage) {
        const board = this.getBoard(projectId);
        const cards = board.stages[stage] || [];
        return cards.filter(c => !c.archived && !c.automation)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    /** Get all automation cards across all stages for a project. */
    getAutomationCards(projectId) {
        const board = this.getBoard(projectId);
        const results = [];
        for (const stage of STAGES) {
            for (const card of board.stages[stage] || []) {
                if (!card.archived && card.automation) {
                    results.push(card);
                }
            }
        }
        return results;
    }
    getAllStages() {
        return [...STAGES];
    }
    /** Search cards across one or more projects. Title matches score higher than description. */
    searchCards(projectIds, query, maxResults = 5) {
        const lowerQuery = query.toLowerCase();
        const results = [];
        for (const projectId of projectIds) {
            const board = this.getBoard(projectId);
            for (const stage of STAGES) {
                for (const card of board.stages[stage] || []) {
                    let score = 0;
                    if (card.title.toLowerCase().includes(lowerQuery))
                        score += 2;
                    if (card.description?.toLowerCase().includes(lowerQuery))
                        score += 1;
                    if (score === 0)
                        continue;
                    if (card.archived)
                        score -= 1;
                    results.push({ card, stage, score, projectId });
                }
            }
        }
        results.sort((a, b) => {
            if (b.score !== a.score)
                return b.score - a.score;
            return (b.card.updated_at || '').localeCompare(a.card.updated_at || '');
        });
        return results.slice(0, maxResults);
    }
    /** Get all cards across one or more projects (includes archived, excludes automations). */
    getAllCards(projectIds) {
        const results = [];
        for (const projectId of projectIds) {
            const board = this.getBoard(projectId);
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
//# sourceMappingURL=kanban-client.js.map