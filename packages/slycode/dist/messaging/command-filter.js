import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_FILE = path.join(__dirname, '..', '..', 'data', 'commands.json');
export class CommandFilter {
    commands = null;
    loadCommands() {
        // Reload fresh each time — commands.json may be edited
        const data = JSON.parse(fs.readFileSync(COMMANDS_FILE, 'utf-8'));
        this.commands = data;
        return this.commands;
    }
    filterCommands(terminalClass, sessionState, cardType) {
        const file = this.loadCommands();
        const result = {};
        for (const [key, cmd] of Object.entries(file.commands)) {
            // Filter by terminal class
            if (cmd.visibleIn.classes.length > 0 && !cmd.visibleIn.classes.includes(terminalClass)) {
                continue;
            }
            // Filter by session state ('any' matches all)
            if (cmd.sessionState !== 'any' && cmd.sessionState !== sessionState) {
                continue;
            }
            // Filter by card type (if command specifies cardTypes, card must match)
            if (cmd.cardTypes && cmd.cardTypes.length > 0) {
                if (!cardType || !cmd.cardTypes.includes(cardType)) {
                    continue;
                }
            }
            result[key] = cmd;
        }
        return result;
    }
    resolveTemplate(prompt, context) {
        let resolved = prompt;
        if (context.card) {
            resolved = resolved.replace(/\{\{card\.id\}\}/g, context.card.id);
            resolved = resolved.replace(/\{\{card\.title\}\}/g, context.card.title);
            resolved = resolved.replace(/\{\{card\.type\}\}/g, context.card.type);
            resolved = resolved.replace(/\{\{card\.priority\}\}/g, context.card.priority);
            resolved = resolved.replace(/\{\{card\.description\}\}/g, context.card.description || '');
            resolved = resolved.replace(/\{\{card\.areas\}\}/g, (context.card.areas || []).join(', '));
            resolved = resolved.replace(/\{\{card\.design_ref\}\}/g, context.card.design_ref || '');
            resolved = resolved.replace(/\{\{card\.feature_ref\}\}/g, context.card.feature_ref || '');
        }
        if (context.project) {
            resolved = resolved.replace(/\{\{project\.name\}\}/g, context.project.name);
            resolved = resolved.replace(/\{\{project\.description\}\}/g, context.project.description || '');
        }
        if (context.stage) {
            resolved = resolved.replace(/\{\{stage\}\}/g, context.stage);
        }
        if (context.projectPath) {
            resolved = resolved.replace(/\{\{projectPath\}\}/g, context.projectPath);
        }
        return resolved;
    }
    getTerminalClass(target) {
        switch (target.type) {
            case 'global':
                return 'global-terminal';
            case 'project':
                return 'project-terminal';
            case 'card':
                return target.stage || 'implementation';
        }
    }
}
//# sourceMappingURL=command-filter.js.map