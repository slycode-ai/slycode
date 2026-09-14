/**
 * Stopwatch glyph for scheduled sends (card #0352).
 *
 * A circle with a crown at 12 o'clock and ONE hand. When `pointAt` is given
 * (an ISO time), the hand points at that wall-clock hour in the viewer's local
 * zone — the button literally shows when the next send fires. Without it the
 * hand rests at 2 o'clock.
 */
export function StopwatchGlyph({ pointAt, className = 'h-3.5 w-3.5' }: { pointAt?: string | null; className?: string }) {
  let angle = 60; // 2 o'clock at rest
  if (pointAt) {
    const d = new Date(pointAt);
    if (!isNaN(d.getTime())) angle = ((d.getHours() % 12) + d.getMinutes() / 60) * 30;
  }
  const rad = (angle - 90) * (Math.PI / 180);
  const cx = 12, cy = 13.5, len = 5;
  const hx = (cx + Math.cos(rad) * len).toFixed(2);
  const hy = (cy + Math.sin(rad) * len).toFixed(2);
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx={cx} cy={cy} r="7.5" />
      <path d="M10 2.5h4M12 2.5v3.5" />
      <path d="M17.5 8l1.5-1.5" />
      <path d={`M${cx} ${cy}L${hx} ${hy}`} />
    </svg>
  );
}
