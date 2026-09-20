/**
 * Where a connection's label sits.
 *
 * A label belongs to its line, so it stays on the line: every candidate is a
 * point along the run between the two blocks, and the label is centred there.
 * That is the whole of the magnet -- move a block and the label follows,
 * because it was never anywhere else.
 *
 * The middle is the first choice, since that is where a reader looks for the
 * name of a connection. It is not always free: two blocks near each other put
 * the middle inside a third, and parallel connections put two labels on the
 * same spot. So the search steps outward from the middle and takes the first
 * place nothing else occupies, and the last resort is the middle anyway --
 * a label slightly in the way beats a label somewhere unrelated.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How far along the run to try, in order. */
const STEPS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];
/**
 * How far to one side of the run to try, in order.
 *
 * Sliding along the line is not always enough: a label is wider than most gaps
 * between blocks, so stepping a little off the line finds room that stepping
 * along it never will. It is still the same line's label -- it moves with it --
 * and a short offset reads as "beside this connection", not as "somewhere".
 */
const ASIDE = [0, -26, 26, -52, 52];
/** What a short label roughly occupies. */
export const LABEL = { width: 150, height: 26 };

function centre(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * A point on the run between two blocks, clear of `obstacles` where possible.
 *
 * `obstacles` are the rectangles a label must not cover: the blocks on the
 * diagram and the labels already placed.
 */
export function labelSpot(
  source: Rect,
  target: Rect,
  obstacles: Rect[],
  size: { width: number; height: number } = LABEL,
): { x: number; y: number } {
  const from = centre(source);
  const to = centre(target);
  const run = { x: to.x - from.x, y: to.y - from.y };
  const length = Math.hypot(run.x, run.y) || 1;
  // The unit normal, so an offset is measured across the line rather than in
  // whichever direction the canvas happens to call up.
  const normal = { x: -run.y / length, y: run.x / length };
  for (const aside of ASIDE)
    for (const step of STEPS) {
      const point = {
        x: from.x + run.x * step + normal.x * aside,
        y: from.y + run.y * step + normal.y * aside,
      };
      const rect = {
        x: point.x - size.width / 2,
        y: point.y - size.height / 2,
        ...size,
      };
      if (!obstacles.some((other) => overlaps(rect, other))) return point;
    }
  return {
    x: from.x + (to.x - from.x) * 0.5,
    y: from.y + (to.y - from.y) * 0.5,
  };
}
