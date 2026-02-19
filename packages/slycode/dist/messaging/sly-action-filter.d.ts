import type { SlyActionsFile, SlyActionConfig, NavigationTarget, KanbanCard, Project } from './types.js';
export declare class SlyActionFilter {
    private actionsFile;
    private cacheTimestamp;
    loadActions(): SlyActionsFile;
    filterActions(terminalClass: string, placement?: 'startup' | 'toolbar', cardType?: string): Record<string, SlyActionConfig>;
    resolveTemplate(prompt: string, context: {
        card?: KanbanCard;
        project?: Project;
        stage?: string;
        projectPath?: string;
    }): string;
    /**
     * Build the card context header — same output as web's CONTEXT_TEMPLATES.card.
     * Always includes checklist, notes, and problems sections for information density.
     */
    buildCardContextHeader(context: {
        card: KanbanCard;
        project?: Project;
        stage?: string;
        projectPath?: string;
    }): string;
    /**
     * Build the project context block for project-scoped terminals.
     */
    buildProjectContext(context: {
        project?: Project;
        projectPath?: string;
    }): string;
    /**
     * Build the global context block for the SlyCode management terminal.
     */
    buildGlobalContext(projectPath?: string): string;
    /**
     * Build prompt by resolving template variables (including opt-in context blocks).
     * Context is injected via {{cardContext}}, {{projectContext}}, {{globalContext}} in the action prompt.
     */
    buildFullPrompt(actionPrompt: string, context: {
        card?: KanbanCard;
        project?: Project;
        stage?: string;
        projectPath?: string;
        terminalClass?: string;
    }): string;
    getTerminalClass(target: NavigationTarget): string;
}
