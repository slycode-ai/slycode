import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function getWorkspaceRoot() {
    if (process.env.SLYCODE_HOME)
        return process.env.SLYCODE_HOME;
    return path.resolve(__dirname, '..', '..');
}
/**
 * Parse YAML frontmatter from an action .md file.
 * Lightweight parser — handles the fields we need without a full YAML library.
 */
function parseActionMd(content) {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)/);
    if (!match)
        return null;
    const yamlStr = match[1];
    const body = (match[2] || '').trim();
    const frontmatter = {};
    let currentKey = null;
    let currentMap = null;
    let currentArray = null;
    for (const line of yamlStr.split('\n')) {
        if (line.startsWith('  ')) {
            const trimmed = line.trim();
            if (currentArray !== null && trimmed.startsWith('- ')) {
                let value = trimmed.slice(2).trim();
                value = stripQuotes(value);
                currentArray.push(value);
                continue;
            }
            if (currentMap !== null) {
                const colonIdx = trimmed.indexOf(':');
                if (colonIdx !== -1) {
                    const key = trimmed.slice(0, colonIdx).trim();
                    const val = trimmed.slice(colonIdx + 1).trim();
                    currentMap[key] = Number(val);
                    continue;
                }
            }
            continue;
        }
        // Flush previous collection
        if (currentKey && currentMap) {
            frontmatter[currentKey] = currentMap;
            currentMap = null;
            currentKey = null;
        }
        if (currentKey && currentArray) {
            frontmatter[currentKey] = currentArray;
            currentArray = null;
            currentKey = null;
        }
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        const rawValue = line.slice(colonIdx + 1).trim();
        if (!rawValue) {
            currentKey = key;
            if (key === 'classes') {
                currentMap = {};
            }
            else {
                currentArray = [];
            }
            continue;
        }
        frontmatter[key] = stripQuotes(rawValue);
    }
    if (currentKey && currentMap)
        frontmatter[currentKey] = currentMap;
    if (currentKey && currentArray)
        frontmatter[currentKey] = currentArray;
    return { frontmatter, body };
}
function stripQuotes(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
/**
 * Scan store/actions/*.md and assemble into the SlyActionsFile shape.
 */
function scanActionsFromStore() {
    const actionsDir = path.join(getWorkspaceRoot(), 'store', 'actions');
    const commands = {};
    const classMap = {};
    if (!fs.existsSync(actionsDir)) {
        return { commands: {}, classAssignments: {} };
    }
    let entries;
    try {
        entries = fs.readdirSync(actionsDir).filter(f => f.endsWith('.md'));
    }
    catch {
        return { commands: {}, classAssignments: {} };
    }
    for (const entry of entries) {
        try {
            const content = fs.readFileSync(path.join(actionsDir, entry), 'utf-8');
            const parsed = parseActionMd(content);
            if (!parsed)
                continue;
            const fm = parsed.frontmatter;
            const name = String(fm.name || entry.replace(/\.md$/, ''));
            commands[name] = {
                label: String(fm.label || ''),
                description: String(fm.description || ''),
                group: String(fm.group || ''),
                placement: String(fm.placement || 'both'),
                prompt: parsed.body,
                scope: String(fm.scope || 'global'),
                projects: Array.isArray(fm.projects) ? fm.projects.map(String) : [],
                cardTypes: Array.isArray(fm.cardTypes) ? fm.cardTypes.map(String) : undefined,
            };
            // Build class map for classAssignments
            const classes = (typeof fm.classes === 'object' && fm.classes !== null && !Array.isArray(fm.classes))
                ? fm.classes
                : {};
            for (const [cls, priority] of Object.entries(classes)) {
                if (!classMap[cls])
                    classMap[cls] = [];
                classMap[cls].push({ name, priority });
            }
        }
        catch {
            // Skip unreadable files
        }
    }
    // Assemble classAssignments sorted by priority
    const classAssignments = {};
    for (const [cls, items] of Object.entries(classMap)) {
        items.sort((a, b) => {
            if (a.priority !== b.priority)
                return a.priority - b.priority;
            return a.name.localeCompare(b.name);
        });
        classAssignments[cls] = items.map(e => e.name);
    }
    return { commands, classAssignments };
}
const CACHE_MAX_AGE_MS = 30_000; // 30 seconds
export class SlyActionFilter {
    actionsFile = null;
    cacheTimestamp = 0;
    loadActions() {
        const now = Date.now();
        if (this.actionsFile && (now - this.cacheTimestamp) < CACHE_MAX_AGE_MS) {
            return this.actionsFile;
        }
        this.actionsFile = scanActionsFromStore();
        this.cacheTimestamp = now;
        return this.actionsFile;
    }
    filterActions(terminalClass, placement, cardType) {
        const file = this.loadActions();
        const result = {};
        // Get ordered command IDs from classAssignments
        const assignedIds = file.classAssignments[terminalClass] || [];
        for (const key of assignedIds) {
            const action = file.commands[key];
            if (!action)
                continue;
            // Filter by placement if specified
            if (placement && action.placement !== 'both' && action.placement !== placement) {
                continue;
            }
            // Filter by card type (if action specifies cardTypes, card must match)
            if (action.cardTypes && action.cardTypes.length > 0) {
                if (!cardType || !action.cardTypes.includes(cardType)) {
                    continue;
                }
            }
            result[key] = action;
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
    /**
     * Build the card context header — same output as web's CONTEXT_TEMPLATES.card.
     * Always includes checklist, notes, and problems sections for information density.
     */
    buildCardContextHeader(context) {
        const { card, project, stage, projectPath } = context;
        const lines = [];
        lines.push(`Project: ${project?.name || 'unknown'} (${projectPath || ''})`);
        lines.push('');
        lines.push(`Card: ${card.title} [${card.id}]`);
        lines.push(`Type: ${card.type} | Priority: ${card.priority} | Stage: ${stage || 'unknown'}`);
        if (card.description)
            lines.push(`Description: ${card.description}`);
        if (card.areas?.length)
            lines.push(`Areas: ${card.areas.join(', ')}`);
        if (card.design_ref)
            lines.push(`Design Doc: ${card.design_ref}`);
        if (card.feature_ref)
            lines.push(`Feature Spec: ${card.feature_ref}`);
        // Checklist summary (always shown)
        const checklist = card.checklist || [];
        if (checklist.length > 0) {
            const checked = checklist.filter(i => i.done).length;
            lines.push(`Checklist: ${checked}/${checklist.length} checked`);
        }
        else {
            lines.push('Checklist: none');
        }
        // Notes count (always shown)
        const notesCount = card.agentNotes?.length ?? 0;
        lines.push(`Notes: ${notesCount}`);
        // Problems summary (always shown) + detail lines
        const unresolved = (card.problems || []).filter(p => !p.resolved_at);
        const resolvedCount = (card.problems || []).length - unresolved.length;
        if (unresolved.length > 0 || resolvedCount > 0) {
            const parts = [];
            if (unresolved.length > 0)
                parts.push(`${unresolved.length} unresolved`);
            if (resolvedCount > 0)
                parts.push(`${resolvedCount} resolved`);
            lines.push(`Problems: ${parts.join(', ')}`);
            const maxProblems = 10;
            const display = unresolved.slice(0, maxProblems);
            for (const p of display) {
                const desc = p.description.length > 100 ? p.description.slice(0, 97) + '...' : p.description;
                lines.push(`  - [${p.id}] ${p.severity}: ${desc}`);
            }
            if (unresolved.length > maxProblems) {
                lines.push(`  - ... and ${unresolved.length - maxProblems} more`);
            }
        }
        else {
            lines.push('Problems: none');
        }
        return lines.join('\n');
    }
    /**
     * Build the project context block for project-scoped terminals.
     */
    buildProjectContext(context) {
        const name = context.project?.name || 'unknown';
        const lines = [`Project: ${name} (${context.projectPath || ''})`];
        if (context.project?.description)
            lines.push(`Description: ${context.project.description}`);
        lines.push('');
        lines.push('This is a project-scoped terminal. Use it for:');
        lines.push('- Codebase exploration and analysis');
        lines.push('- Creating and triaging backlog cards');
        lines.push('- Organising and prioritising cards across stages');
        lines.push('- Updating context priming references');
        lines.push('- Project-level debugging and investigation');
        return lines.join('\n');
    }
    /**
     * Build the global context block for the SlyCode management terminal.
     */
    buildGlobalContext(projectPath) {
        const lines = [
            'SlyCode Management Terminal',
            `Workspace: ${projectPath || 'unknown'}`,
            '',
            'This is the management terminal for your SlyCode environment. Use it for cross-project searches, questions, and general workspace operations.',
        ];
        return lines.join('\n');
    }
    /**
     * Build prompt by resolving template variables (including opt-in context blocks).
     * Context is injected via {{cardContext}}, {{projectContext}}, {{globalContext}} in the action prompt.
     */
    buildFullPrompt(actionPrompt, context) {
        // Pre-render context blocks
        let resolved = actionPrompt;
        if (context.card) {
            const cardCtx = this.buildCardContextHeader({
                card: context.card,
                project: context.project,
                stage: context.stage,
                projectPath: context.projectPath,
            });
            resolved = resolved.replace(/\{\{cardContext\}\}/g, cardCtx);
        }
        // Project context for project-terminal
        const projectCtx = this.buildProjectContext({
            project: context.project,
            projectPath: context.projectPath,
        });
        resolved = resolved.replace(/\{\{projectContext\}\}/g, projectCtx);
        // Global context for global-terminal
        const globalCtx = this.buildGlobalContext(context.projectPath);
        resolved = resolved.replace(/\{\{globalContext\}\}/g, globalCtx);
        // Resolve remaining field-level variables
        resolved = this.resolveTemplate(resolved, context);
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
//# sourceMappingURL=sly-action-filter.js.map