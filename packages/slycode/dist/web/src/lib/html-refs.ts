import type { KanbanCard } from './types';

/**
 * Read-time normalization for HTML attachment refs (feature 072).
 *
 * Cards historically carried a single `html_ref` string; the field is now a
 * list (`html_refs`), with legacy data folded in on the next CLI write. Until
 * that write happens, readers must see both. Legacy ref sorts first (it was
 * "the" attachment), deduped against the list.
 */
export function getHtmlRefs(card: Pick<KanbanCard, 'html_ref' | 'html_refs'>): string[] {
  const refs = Array.isArray(card.html_refs) ? card.html_refs : [];
  if (card.html_ref && !refs.includes(card.html_ref)) {
    return [card.html_ref, ...refs];
  }
  return refs;
}
