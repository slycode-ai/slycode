import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import type { KanbanBoard, KanbanStages, KanbanCard, KanbanStage, ChangedCard } from '@/lib/types';
import { getNextRun } from '@/lib/scheduler';
import { appendEvent } from '@/lib/event-log';
import {
  getKanbanPath,
  getArchiveDir,
  getTieredBackupPath,
  getLegacyBackupPaths,
  ProjectResolutionError,
  BACKUP_TIERS,
  type BackupTier,
} from '@/lib/kanban-paths';

// Number of versions to keep per tier
const VERSIONS_PER_TIER = 3;

const EMPTY_STAGES: KanbanStages = {
  backlog: [],
  design: [],
  implementation: [],
  testing: [],
  done: [],
};

/**
 * Count total cards across all stages
 */
function countCards(stages: KanbanStages): number {
  return (
    (stages.backlog?.length || 0) +
    (stages.design?.length || 0) +
    (stages.implementation?.length || 0) +
    (stages.testing?.length || 0) +
    (stages.done?.length || 0)
  );
}

/**
 * Normalize order values in a stage to be evenly spaced (10, 20, 30...)
 * This prevents chaos from building up when inserting between values
 */
function normalizeOrder(cards: KanbanCard[]): KanbanCard[] {
  if (!Array.isArray(cards)) return [];
  // Sort by current order first
  const sorted = [...cards].sort((a, b) => a.order - b.order);
  // Reassign order values with gaps of 10
  return sorted.map((card, index) => ({
    ...card,
    order: (index + 1) * 10,
  }));
}

/**
 * Normalize all stages in the kanban board
 */
function normalizeStages(stages: KanbanStages): KanbanStages {
  return {
    backlog: normalizeOrder(stages.backlog || []),
    design: normalizeOrder(stages.design || []),
    implementation: normalizeOrder(stages.implementation || []),
    testing: normalizeOrder(stages.testing || []),
    done: normalizeOrder(stages.done || []),
  };
}

/**
 * Get file modification time, returns null if file doesn't exist
 */
async function getFileMtime(filePath: string): Promise<Date | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime;
  } catch {
    return null;
  }
}

/**
 * Rotate versions within a tier: delete oldest, shift others, write new to _001
 */
async function rotateTierVersions(
  projectId: string,
  tier: BackupTier,
  content: string
): Promise<void> {
  // Delete oldest version if it exists
  try {
    const oldestPath = await getTieredBackupPath(projectId, tier, VERSIONS_PER_TIER);
    await fs.unlink(oldestPath);
  } catch {
    // Doesn't exist, that's fine
  }

  // Rotate existing versions: _002 -> _003, _001 -> _002
  for (let i = VERSIONS_PER_TIER - 1; i >= 1; i--) {
    const oldPath = await getTieredBackupPath(projectId, tier, i);
    const newPath = await getTieredBackupPath(projectId, tier, i + 1);
    try {
      await fs.rename(oldPath, newPath);
    } catch {
      // Doesn't exist, skip
    }
  }

  // Write new content to _001
  const newestPath = await getTieredBackupPath(projectId, tier, 1);
  await fs.writeFile(newestPath, content);
}

/**
 * Update tiered backups based on time thresholds.
 * Each tier keeps VERSIONS_PER_TIER rolling versions, updated when threshold passes.
 *
 * - hourly: updated at most once per hour (keeps 3 versions = ~3 hours history)
 * - daily: updated at most once per 24 hours (keeps 3 versions = ~3 days history)
 * - weekly: updated at most once per 7 days (keeps 3 versions = ~3 weeks history)
 */
async function updateTieredBackups(projectId: string, kanbanPath: string): Promise<void> {
  try {
    // Check if current file exists and has content
    let currentContent: string;
    try {
      currentContent = await fs.readFile(kanbanPath, 'utf-8');
      const currentData = JSON.parse(currentContent);
      // Don't backup if current file is empty
      if (countCards(currentData.stages || {}) === 0) {
        return;
      }
    } catch {
      // No current file to backup
      return;
    }

    const now = Date.now();
    const archiveDir = await getArchiveDir(projectId);

    // Ensure archive directory exists
    await fs.mkdir(archiveDir, { recursive: true });

    // Check and update each tier if threshold has passed
    for (const [tier, thresholdMs] of Object.entries(BACKUP_TIERS)) {
      const typedTier = tier as BackupTier;
      // Check mtime of most recent version (_001)
      const latestBackupPath = await getTieredBackupPath(projectId, typedTier, 1);
      const mtime = await getFileMtime(latestBackupPath);

      // Rotate and write new version if file doesn't exist or threshold has passed
      if (!mtime || (now - mtime.getTime()) >= thresholdMs) {
        await rotateTierVersions(projectId, typedTier, currentContent);
      }
    }
  } catch (error) {
    console.error('Failed to update tiered backups:', error);
    // Don't fail the save if backup fails
  }
}

/**
 * Clean up old backup files from previous systems.
 * - Old numbered backups: kanban_001.json, kanban_002.json, etc.
 * - Old single-file tiered backups: kanban_hourly.json (without version number)
 */
async function cleanupLegacyBackups(projectId: string): Promise<void> {
  try {
    const legacyFiles = await getLegacyBackupPaths(projectId);

    for (const legacyPath of legacyFiles) {
      try {
        await fs.unlink(legacyPath);
        console.log(`Cleaned up legacy backup: ${legacyPath}`);
      } catch {
        // File doesn't exist, that's fine
      }
    }
  } catch (error) {
    console.error('Failed to cleanup legacy backups:', error);
    // Don't fail the operation if cleanup fails
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  try {
    const kanbanPath = await getKanbanPath(projectId);

    try {
      const content = await fs.readFile(kanbanPath, 'utf-8');
      const data = JSON.parse(content) as KanbanBoard;

      // Compute nextRun dynamically — single source of truth for timezone
      for (const stageCards of Object.values(data.stages)) {
        for (const card of stageCards as KanbanCard[]) {
          if (card.automation?.enabled && card.automation.schedule && card.automation.scheduleType === 'recurring') {
            const next = getNextRun(card.automation.schedule, 'recurring');
            if (next) card.automation.nextRun = next.toISOString();
          }
        }
      }

      return NextResponse.json(data);
    } catch {
      // File doesn't exist or is invalid - return empty board
      return NextResponse.json({
        project_id: projectId,
        stages: EMPTY_STAGES,
        last_updated: new Date().toISOString(),
      });
    }
  } catch (error) {
    if (error instanceof ProjectResolutionError) {
      return NextResponse.json(
        { error: error.message },
        { status: 404 }
      );
    }
    console.error('Failed to get kanban:', error);
    return NextResponse.json({ error: 'Failed to load kanban' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, stages: incomingStages, changedCardIds, changedCards } = body as {
      projectId: string;
      stages: KanbanStages;
      changedCardIds?: string[];
      changedCards?: ChangedCard[];
    };
    let stages = incomingStages;

    if (!projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }

    if (!stages || typeof stages !== 'object') {
      return NextResponse.json({ error: 'stages must be an object' }, { status: 400 });
    }

    // Resolve the kanban path (validates project exists)
    let kanbanPath: string;
    try {
      kanbanPath = await getKanbanPath(projectId);
    } catch (error) {
      if (error instanceof ProjectResolutionError) {
        return NextResponse.json(
          { error: error.message },
          { status: 404 }
        );
      }
      throw error;
    }

    // Count cards in incoming data
    const incomingCardCount = countCards(stages);

    // If incoming data has no cards, check if we're about to wipe existing data
    if (incomingCardCount === 0) {
      try {
        const existingContent = await fs.readFile(kanbanPath, 'utf-8');
        const existingData = JSON.parse(existingContent) as KanbanBoard;
        const existingCardCount = countCards(existingData.stages || {});

        // SAFETY: Refuse to save empty stages if there are existing cards
        if (existingCardCount > 0) {
          console.warn(`BLOCKED: Attempted to save empty kanban (would wipe ${existingCardCount} cards)`);
          return NextResponse.json(
            { error: 'Refusing to save empty kanban - would delete existing cards' },
            { status: 400 }
          );
        }
      } catch {
        // No existing file, allow creating empty kanban
      }
    }

    // Update tiered backups (hourly/daily/weekly) based on time thresholds
    await updateTieredBackups(projectId, kanbanPath);

    // Clean up old numbered backups from previous system (one-time migration)
    await cleanupLegacyBackups(projectId);

    // Type-aware merge: changedCards carries per-card operation types (move/edit/create/delete).
    // For "move" cards, preserve disk content and overlay only positional fields.
    // For "edit"/"create" cards, use the frontend version fully.
    // Falls back to changedCardIds (untyped) for backward compatibility — treats all as "edit".
    const effectiveChangedIds = changedCards?.map((c) => c.id) ?? changedCardIds;
    if (effectiveChangedIds && effectiveChangedIds.length > 0) {
      try {
        const currentContent = await fs.readFile(kanbanPath, 'utf-8');
        const currentData = JSON.parse(currentContent) as KanbanBoard;
        const diskStages = currentData.stages || EMPTY_STAGES;

        // Build type lookup: cardId → change type (default "edit" for backward compat)
        const changeTypeMap = new Map<string, string>();
        if (changedCards) {
          for (const cc of changedCards) {
            changeTypeMap.set(cc.id, cc.type);
          }
        }

        // Build disk card lookup for move operations
        const diskCardMap = new Map<string, KanbanCard>();
        for (const [, cards] of Object.entries(diskStages) as [KanbanStage, KanbanCard[]][]) {
          for (const card of cards || []) {
            diskCardMap.set(card.id, card);
          }
        }

        // Build lookup of changed cards from frontend payload
        const changedCardMap = new Map<string, { card: KanbanCard; stage: KanbanStage }>();
        for (const [stage, cards] of Object.entries(stages) as [KanbanStage, KanbanCard[]][]) {
          for (const card of cards || []) {
            if (effectiveChangedIds.includes(card.id)) {
              const changeType = changeTypeMap.get(card.id) || 'edit';
              let mergedCard: KanbanCard;

              if (changeType === 'move') {
                // Move: preserve disk content, overlay only positional fields
                const diskCard = diskCardMap.get(card.id);
                if (!diskCard) {
                  // Card deleted on disk during pending move — drop silently
                  continue;
                }
                // Detect stage change vs disk: status must be auto-cleared on
                // cross-stage moves, mirroring the CLI `move` behavior. Without
                // this, the client's optimistic clear is silently restored from
                // disk on the next read.
                let sourceStage: KanbanStage | null = null;
                for (const s of Object.keys(diskStages) as KanbanStage[]) {
                  if ((diskStages[s] || []).some((c) => c.id === card.id)) {
                    sourceStage = s;
                    break;
                  }
                }
                const stageChanged = sourceStage !== null && sourceStage !== (stage as KanbanStage);
                mergedCard = {
                  ...diskCard,
                  order: card.order,
                  updated_at: card.updated_at,
                  last_modified_by: 'web',
                };
                if (stageChanged && mergedCard.status) {
                  delete mergedCard.status;
                }
              } else {
                // Edit/create: use frontend version fully
                mergedCard = { ...card, last_modified_by: 'web' };
              }

              changedCardMap.set(card.id, { card: mergedCard, stage: stage as KanbanStage });
            }
          }
        }

        // Start with disk state, apply only changed cards
        const mergedStages: KanbanStages = {
          backlog: [...(diskStages.backlog || [])],
          design: [...(diskStages.design || [])],
          implementation: [...(diskStages.implementation || [])],
          testing: [...(diskStages.testing || [])],
          done: [...(diskStages.done || [])],
        };

        // Remove changed cards from their current disk positions
        for (const cardId of effectiveChangedIds) {
          for (const stage of Object.keys(mergedStages) as KanbanStage[]) {
            mergedStages[stage] = mergedStages[stage].filter((c) => c.id !== cardId);
          }
        }

        // Re-add changed cards to their target stages (absent = deleted)
        for (const [, { card, stage }] of changedCardMap) {
          mergedStages[stage] = [...mergedStages[stage], card];
        }

        stages = mergedStages;
      } catch {
        // No existing file on disk — fall through to full overwrite
      }
    }

    // Normalize order values to prevent chaos
    const normalizedStages = normalizeStages(stages);

    const data: KanbanBoard = {
      project_id: projectId,
      stages: normalizedStages,
      last_updated: new Date().toISOString(),
    };

    // Load old data for event detection
    let oldStages: KanbanStages | null = null;
    try {
      const oldContent = await fs.readFile(kanbanPath, 'utf-8');
      const oldData = JSON.parse(oldContent) as KanbanBoard;
      oldStages = oldData.stages;
    } catch {
      // No existing file
    }

    await fs.mkdir(path.dirname(kanbanPath), { recursive: true });
    await fs.writeFile(kanbanPath, JSON.stringify(data, null, 2));

    // Emit events for card changes (compare old vs new stage membership)
    if (oldStages) {
      const oldCardMap = new Map<string, { card: KanbanCard; stage: KanbanStage }>();
      for (const [stage, cards] of Object.entries(oldStages) as [KanbanStage, KanbanCard[]][]) {
        for (const card of cards || []) {
          oldCardMap.set(card.id, { card, stage });
        }
      }

      const source = changedCardIds ? 'web' : undefined;

      for (const [stage, cards] of Object.entries(normalizedStages) as [KanbanStage, KanbanCard[]][]) {
        for (const card of cards || []) {
          const old = oldCardMap.get(card.id);
          try {
            if (!old) {
              // New card
              appendEvent({
                type: 'card_created',
                project: projectId,
                card: card.id,
                detail: `Card '${card.title}' created in ${stage}`,
                ...(source && { source }),
                timestamp: new Date().toISOString(),
              });
            } else if (old.stage !== stage) {
              // Moved between stages
              appendEvent({
                type: 'card_moved',
                project: projectId,
                card: card.id,
                detail: `Card '${card.title}' moved from ${old.stage} to ${stage}`,
                ...(source && { source }),
                timestamp: new Date().toISOString(),
              });
            } else if (changedCardIds?.includes(card.id)) {
              // Updated in place (only emit for explicitly changed cards to avoid noise)
              appendEvent({
                type: 'card_updated',
                project: projectId,
                card: card.id,
                detail: `Card '${card.title}' updated`,
                source: 'web',
                timestamp: new Date().toISOString(),
              });
            }
          } catch {
            // Non-critical
          }
        }
      }
    }

    return NextResponse.json({ success: true, last_updated: data.last_updated, stages: normalizedStages });
  } catch (error) {
    console.error('Failed to save kanban:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
