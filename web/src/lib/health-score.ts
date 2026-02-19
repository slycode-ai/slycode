/**
 * Health Score Calculator — pluggable scoring function for project health
 *
 * Score is 0-100 where 100 is perfect health.
 * Level: green (>= 80), amber (>= 50), red (< 50)
 *
 * Each factor is a penalty that reduces the score from 100.
 * Weights are tunable — adjust DEFAULT_WEIGHTS to change what matters.
 */

import type {
  HealthScore,
  HealthFactor,
  HealthLevel,
  ProjectWithBacklog,
  ProjectAssets,
} from './types';

// ============================================================================
// Weight Configuration
// ============================================================================

export interface HealthWeights {
  /** Weight for outdated assets (skills, commands, agents behind master) */
  outdatedAssets: number;
  /** Weight for stale cards (not updated in N days) */
  staleCards: number;
  /** Weight for unresolved problems (weighted by severity) */
  unresolvedProblems: number;
  /** Weight for missing CLAUDE.md */
  missingClaudeMd: number;
  /** Weight for non-compliant frontmatter on local assets */
  nonCompliantFrontmatter: number;
}

export const DEFAULT_WEIGHTS: HealthWeights = {
  outdatedAssets: 0.30,
  staleCards: 0.15,
  unresolvedProblems: 0.25,
  missingClaudeMd: 0.10,
  nonCompliantFrontmatter: 0.20,
};

// How many days without update before a card is considered "stale"
const STALE_THRESHOLD_DAYS = 14;

// ============================================================================
// Score Calculation
// ============================================================================

function scoreToLevel(score: number): HealthLevel {
  if (score >= 80) return 'green';
  if (score >= 50) return 'amber';
  return 'red';
}

/**
 * Calculate health score for a project.
 *
 * This is a pure function — takes data in, returns score out.
 * No side effects, easy to test and tweak.
 *
 * @param project - Project with backlog data
 * @param outdatedCount - Number of outdated assets from CLI assets scan
 * @param totalAssetCount - Total number of assets deployed to this project
 * @param nonCompliantCount - Number of assets with invalid frontmatter
 * @param weights - Optional custom weights (defaults to DEFAULT_WEIGHTS)
 */
export function calculateHealthScore(
  project: ProjectWithBacklog,
  outdatedCount: number = 0,
  totalAssetCount: number = 0,
  nonCompliantCount: number = 0,
  weights: HealthWeights = DEFAULT_WEIGHTS,
): HealthScore {
  const factors: HealthFactor[] = [];

  // 1. Outdated assets penalty
  const outdatedMax = Math.max(totalAssetCount, 1);
  factors.push({
    name: 'Outdated Assets',
    weight: weights.outdatedAssets,
    value: outdatedCount,
    maxValue: outdatedMax,
  });

  // 2. Stale cards penalty
  const now = Date.now();
  const allCards = [
    ...project.backlog,
  ];
  // Count cards from kanban stages if available (backlog items have status)
  const staleCount = allCards.filter(card => {
    const updatedAt = new Date(card.created_at).getTime();
    const daysSinceUpdate = (now - updatedAt) / (1000 * 60 * 60 * 24);
    return daysSinceUpdate > STALE_THRESHOLD_DAYS && card.status !== 'done';
  }).length;
  const staleMax = Math.max(allCards.length, 1);
  factors.push({
    name: 'Stale Cards',
    weight: weights.staleCards,
    value: staleCount,
    maxValue: staleMax,
  });

  // 3. Unresolved problems penalty
  // Problems come from kanban cards — we don't have direct access here
  // but we can check the backlog item count as a proxy
  // For now, use 0 — this will be enriched when we have kanban card data
  factors.push({
    name: 'Unresolved Problems',
    weight: weights.unresolvedProblems,
    value: 0,
    maxValue: 1,
  });

  // 4. Missing CLAUDE.md penalty
  factors.push({
    name: 'Missing CLAUDE.md',
    weight: weights.missingClaudeMd,
    value: project.hasClaudeMd ? 0 : 1,
    maxValue: 1,
  });

  // 5. Non-compliant frontmatter penalty
  const fmMax = Math.max(totalAssetCount, 1);
  factors.push({
    name: 'Non-compliant Frontmatter',
    weight: weights.nonCompliantFrontmatter,
    value: nonCompliantCount,
    maxValue: fmMax,
  });

  // Calculate weighted score (100 = perfect, penalties reduce it)
  let totalPenalty = 0;
  for (const factor of factors) {
    const penaltyRatio = factor.maxValue > 0 ? factor.value / factor.maxValue : 0;
    totalPenalty += Math.min(penaltyRatio, 1) * factor.weight;
  }

  const score = Math.round(Math.max(0, (1 - totalPenalty) * 100));
  const level = scoreToLevel(score);

  return { score, level, factors };
}

/**
 * Calculate health with asset data from ProjectAssets.
 * Convenience wrapper that extracts counts from the assets.
 */
export function calculateHealthFromAssets(
  project: ProjectWithBacklog,
  projectAssets?: ProjectAssets,
  outdatedCount: number = 0,
  weights?: HealthWeights,
): HealthScore {
  if (!projectAssets) {
    return calculateHealthScore(project, 0, 0, 0, weights);
  }

  const allAssets = [
    ...projectAssets.skills,
    ...projectAssets.agents,
  ];
  const totalCount = allAssets.length;
  const nonCompliant = allAssets.filter(a => !a.isValid).length;

  return calculateHealthScore(project, outdatedCount, totalCount, nonCompliant, weights);
}
