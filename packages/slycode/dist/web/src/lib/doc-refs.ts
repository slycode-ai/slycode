import type { KanbanCard } from './types';
import { mergeRefs } from './html-refs';

/**
 * Read-time fallback for the Markdown document refs (feature 074).
 *
 * Design / Feature / Test refs are now lists (`design_refs`, …). Legacy cards
 * carry a singular field (`design_ref`, …) that folds into the list on the next
 * CLI write; until then these helpers merge both (legacy first, deduped) —
 * mirroring `getHtmlRefs`.
 */
export function getDesignRefs(card: Pick<KanbanCard, 'design_ref' | 'design_refs'>): string[] {
  return mergeRefs(card.design_ref, card.design_refs);
}

export function getFeatureRefs(card: Pick<KanbanCard, 'feature_ref' | 'feature_refs'>): string[] {
  return mergeRefs(card.feature_ref, card.feature_refs);
}

export function getTestRefs(card: Pick<KanbanCard, 'test_ref' | 'test_refs'>): string[] {
  return mergeRefs(card.test_ref, card.test_refs);
}

/** Filename label for a doc ref (index list uses filename per feature 074 decision). */
export function docFileName(ref: string): string {
  const segments = ref.split('/');
  return segments[segments.length - 1] || ref;
}
