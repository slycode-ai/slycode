/**
 * The part of the page a person can actually see (#0376). On phones the
 * on-screen keyboard and the browser's toolbars cover the layout viewport
 * without resizing it, so `100vh` and `innerHeight` overstate the room and a
 * panel sized from them runs out of sight. `window.visualViewport` reports
 * the visible rectangle; this turns it into the numbers sheets and popovers
 * need, in layout-viewport pixels (what `position: fixed` uses).
 */

/** Below this width, or on a touch-first device, the voice tools open as sheets. */
export const VOICE_SHEET_QUERY = '(max-width: 639px), (pointer: coarse)';

/** Share of the visible height a bottom sheet may take. */
export const BOTTOM_SHEET_SHARE = 0.85;

export interface VisibleViewport {
  /** Top of the visible area (the visual viewport scrolls over the layout one). */
  top: number;
  height: number;
  /** Layout-viewport space hidden below the visible area (keyboard, toolbars). */
  bottomInset: number;
}

interface ViewportSource {
  innerHeight: number;
  visualViewport?: { height: number; offsetTop: number } | null;
}

export function visibleViewport(win: ViewportSource): VisibleViewport {
  const vv = win.visualViewport;
  if (!vv || !(vv.height > 0)) return { top: 0, height: win.innerHeight, bottomInset: 0 };
  const top = Math.max(0, Math.round(vv.offsetTop));
  const height = Math.max(0, Math.round(Math.min(vv.height, win.innerHeight - top)));
  return { top, height, bottomInset: Math.max(0, win.innerHeight - top - height) };
}

/** Bottom edge of the visible area: the height an anchored popover may use. */
export function visibleBottom(win: ViewportSource): number {
  const v = visibleViewport(win);
  return v.top + v.height;
}

/** Height cap for a bottom sheet in the visible area. */
export function bottomSheetMaxHeight(v: VisibleViewport): number {
  return Math.floor(v.height * BOTTOM_SHEET_SHARE);
}

/**
 * Whether focusing a text field on open is helpful. With a mouse it saves a
 * click; on a touch screen it throws up the keyboard over the panel.
 */
export function hasFinePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
}
