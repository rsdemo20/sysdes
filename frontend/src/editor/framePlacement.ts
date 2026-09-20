/**
 * Where a diagram appears, and how big.
 *
 * A frame used to arrive at 620 by 420 with a sixty pixel stagger, which put
 * the second diagram on top of the first and left both too small to route a
 * connection in. A new frame now takes about three quarters of the visible
 * canvas and lands strictly outside everything already drawn: below when the
 * drawn area is wider than tall, to the right when it is taller than wide.
 *
 * That keeps a canvas roughly square instead of growing into one long column,
 * and it is decided by what is on the canvas rather than by the order the
 * diagrams happened to be created in.
 *
 * Landing outside matters more than landing nearby. Two overlapping frames read
 * as one confused region, and the author's first act is to drag one of them
 * away; a frame a screen down is found by scrolling, which is a smaller price.
 */
import type { CanvasDocument, Position } from "../model/types";

/** The share of the visible canvas a new diagram takes. */
export const SHARE = 0.75;
/** The clear space left between two frames. */
export const GAP = 60;
/** No smaller than this, however small the window is. */
export const MINIMUM = { width: 620, height: 420 };

function overlaps(a: Position, b: Position): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * The rectangle for a diagram that does not exist yet.
 *
 * `visible` is the canvas area in flow units -- the pane's size divided by the
 * zoom -- so the frame is three quarters of what the author can actually see,
 * not three quarters of some fixed idea of a screen.
 */
export function newFrameRect(
  document: CanvasDocument,
  visible: { width: number; height: number },
): Position {
  const size = {
    width: Math.max(MINIMUM.width, Math.round(visible.width * SHARE)),
    height: Math.max(MINIMUM.height, Math.round(visible.height * SHARE)),
  };
  const existing = Object.values(document.layout.diagramFrames);
  if (!existing.length) return { x: 40, y: 40, ...size };

  const left = Math.min(...existing.map((frame) => frame.x));
  const top = Math.min(...existing.map((frame) => frame.y));
  const right = Math.max(...existing.map((frame) => frame.x + frame.width));
  const bottom = Math.max(...existing.map((frame) => frame.y + frame.height));

  // Outside the whole drawn area, on the side that keeps it closest to square.
  // Both placements clear every frame by construction, which is why there is no
  // search here and no way for one to land on top of another.
  const drawn = { width: right - left, height: bottom - top };
  const placed: Position =
    drawn.height > drawn.width
      ? { x: right + GAP, y: top, ...size }
      : { x: left, y: bottom + GAP, ...size };
  if (existing.some((frame) => overlaps(placed, frame)))
    throw new Error("a new frame must never land on an existing one");
  return placed;
}
