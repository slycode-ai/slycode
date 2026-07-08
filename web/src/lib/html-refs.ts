import type { KanbanCard } from './types';

/**
 * Merge a legacy singular ref with its list field (feature 072/074 pattern).
 *
 * Cards historically carried a single ref string (`html_ref`, `design_ref`, …);
 * those fields are now lists (`html_refs`, `design_refs`, …), with legacy data
 * folded in on the next CLI write. Until that write happens, readers must see
 * both. The legacy ref sorts first (it was "the" attachment), deduped against
 * the list.
 */
export function mergeRefs(legacy: string | undefined, list: string[] | undefined): string[] {
  const refs = Array.isArray(list) ? list : [];
  if (legacy && !refs.includes(legacy)) {
    return [legacy, ...refs];
  }
  return refs;
}

/**
 * Read-time normalization for HTML attachment refs (feature 072).
 */
export function getHtmlRefs(card: Pick<KanbanCard, 'html_ref' | 'html_refs'>): string[] {
  return mergeRefs(card.html_ref, card.html_refs);
}
