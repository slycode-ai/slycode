/**
 * Sly Actions v4 — individual MD files with YAML frontmatter
 *
 * Each action is a standalone .md file in store/actions/ with frontmatter
 * defining metadata (version, label, group, placement, classes with priorities).
 * The prompt body is the markdown content. Class assignments are assembled
 * at runtime from per-action classes maps, sorted by priority.
 *
 * Context is injected via opt-in template variables:
 *   {{cardContext}}    — enriched card context (card terminals)
 *   {{projectContext}} — project info + role primer (project terminal)
 *   {{globalContext}}  — SlyCode management terminal primer (global terminal)
 */

import type { Placement } from './types';

// Terminal class types based on context
export type TerminalClass =
  | 'global-terminal'
  | 'project-terminal'
  | 'backlog'
  | 'design'
  | 'implementation'
  | 'testing'
  | 'done'
  | 'action-assistant';

// Command with ID attached (used by consumers after normalization)
export interface SlyActionItem {
  id: string;
  label: string;
  description: string;
  group?: string;
  cardTypes?: string[];
  placement: Placement;
  prompt: string;
  scope: 'global' | 'specific';
  projects: string[];
}

export interface SlyActionsConfig {
  version: string;
  commands: Record<string, SlyActionItem>;
  classAssignments: Record<string, string[]>;
}

/**
 * Get actions for a terminal class, ordered by classAssignments.
 * This is the primary getter — replaces getStartupActions + getActiveActions.
 */
export function getActionsForClass(
  commands: Record<string, SlyActionItem>,
  classAssignments: Record<string, string[]>,
  terminalClass: TerminalClass,
  options?: { projectId?: string; cardType?: string }
): SlyActionItem[] {
  const assignedIds = classAssignments[terminalClass] || [];

  return assignedIds
    .map(id => commands[id])
    .filter((cmd): cmd is SlyActionItem => {
      if (!cmd) return false;

      // Check project scope
      if (cmd.scope === 'specific' && cmd.projects.length > 0) {
        if (options?.projectId && !cmd.projects.includes(options.projectId)) {
          return false;
        }
      }

      // Check card type
      if (options?.cardType && cmd.cardTypes && cmd.cardTypes.length > 0) {
        if (!cmd.cardTypes.includes(options.cardType)) {
          return false;
        }
      }

      return true;
    });
}

/**
 * Simple template engine for prompt templates
 * Supports: {{var}}, {{#if var}}...{{/if}}, {{#each arr}}...{{/each}}
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  let result = template;

  // Handle {{#each array}}...{{/each}}
  result = result.replace(/\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, content) => {
    const arr = getNestedValue(context, key);
    if (Array.isArray(arr) && arr.length > 0) {
      return arr.map((item) => content.replace(/\{\{this\}\}/g, String(item))).join('');
    }
    return '';
  });

  // Handle {{#if var}}...{{/if}}
  result = result.replace(/\{\{#if\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, content) => {
    const value = getNestedValue(context, key);
    if (value && (!Array.isArray(value) || value.length > 0)) {
      return content;
    }
    return '';
  });

  // Handle {{var}} and {{obj.prop}}
  result = result.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
    const value = getNestedValue(context, key);
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    return value != null ? String(value) : '';
  });

  return result.trim();
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Build prompt by resolving template variables in the action prompt.
 * Context is opt-in via {{cardContext}}, {{projectContext}}, {{globalContext}}.
 */
export function buildPrompt(
  actionPrompt: string,
  context: Record<string, unknown>
): string {
  return renderTemplate(actionPrompt, context);
}

/**
 * Get terminal class from kanban stage
 */
export function getTerminalClassFromStage(stage: string): TerminalClass {
  const stageMap: Record<string, TerminalClass> = {
    backlog: 'backlog',
    design: 'design',
    implementation: 'implementation',
    testing: 'testing',
    done: 'done',
  };
  return stageMap[stage] || 'backlog';
}

/**
 * Normalize API response: JSON stores commands as Record<string, action>
 * — attach `id` to each item for consumer convenience.
 */
export function normalizeActionsConfig(data: Record<string, unknown>): SlyActionsConfig {
  const commands = data.commands as Record<string, unknown>;
  const normalized: Record<string, SlyActionItem> = {};

  for (const [id, action] of Object.entries(commands)) {
    normalized[id] = { ...(action as Omit<SlyActionItem, 'id'>), id };
  }

  return {
    version: data.version as string,
    commands: normalized,
    classAssignments: (data.classAssignments || {}) as Record<string, string[]>,
  };
}
