/**
 * Where an anchored popover goes and how tall it may be (Voice Settings,
 * #0369): below the anchor when there is enough room (or at least as much as
 * above), otherwise above it. The height cap is the room on the chosen side,
 * so the popover never runs off the viewport; its body scrolls inside.
 */
export const POPOVER_GAP = 8;
export const POPOVER_MARGIN = 12;
/** Below is preferred while it offers at least this much height. */
export const POPOVER_COMFORT_HEIGHT = 360;

export interface AnchorRect { top: number; bottom: number; right: number }

export type PopoverPlacement =
  | { side: 'below'; top: number; right: number; maxHeight: number }
  | { side: 'above'; bottom: number; right: number; maxHeight: number };

export function placePopover(anchor: AnchorRect, viewport: { width: number; height: number }): PopoverPlacement {
  const right = Math.max(POPOVER_MARGIN, viewport.width - anchor.right);
  const below = viewport.height - anchor.bottom - POPOVER_GAP - POPOVER_MARGIN;
  const above = anchor.top - POPOVER_GAP - POPOVER_MARGIN;
  if (below >= POPOVER_COMFORT_HEIGHT || below >= above) {
    return { side: 'below', top: anchor.bottom + POPOVER_GAP, right, maxHeight: Math.max(0, Math.floor(below)) };
  }
  return { side: 'above', bottom: viewport.height - anchor.top + POPOVER_GAP, right, maxHeight: Math.max(0, Math.floor(above)) };
}
