import type { CommandsFile, CommandConfig, NavigationTarget, KanbanCard, Project } from './types.js';
export declare class CommandFilter {
    private commands;
    loadCommands(): CommandsFile;
    filterCommands(terminalClass: string, sessionState: string, cardType?: string): Record<string, CommandConfig>;
    resolveTemplate(prompt: string, context: {
        card?: KanbanCard;
        project?: Project;
        stage?: string;
        projectPath?: string;
    }): string;
    getTerminalClass(target: NavigationTarget): string;
}
