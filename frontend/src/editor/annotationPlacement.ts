/**
 * Where a new annotation lands.
 *
 * An annotation belongs to one block and says something about it, so it has to
 * appear beside that block -- close enough that the connection is obvious
 * before the leader line is even followed. It also has to land on free space:
 * an annotation dropped on top of a block hides the very thing it describes,
 * and the author then spends their first move dragging it away.
 *
 * The search is deliberately simple and predictable: try the right side first,
 * then below, then left, then above, then step down the right side. An author
 * who adds three annotations to one block should be able to guess where the
 * third one will be.
 */
import type { CanvasDocument, Position } from "../model/types";

/** The gap between a block and its annotation, in canvas units. */
export const GAP = 10;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Everything already drawn that a new annotation must not cover. */
export function occupiedRects(document: CanvasDocument): Rect[] {
  const taken: Rect[] = Object.entries(document.layout.objectPositions).map(
    ([, rect]) => rect as Position,
  );
  for (const annotation of document.semantic.annotations) {
    const offset = document.layout.annotationOffsets[annotation.id];
    const owner = document.layout.objectPositions[annotation.ownerObjectId];
    if (!offset || !owner) continue;
    taken.push({
      x: owner.x + offset.dx,
      y: owner.y + offset.dy,
      width: offset.width,
      height: offset.height,
    });
  }
  return taken;
}

/**
 * An offset from the owner, in the form `annotationOffsets` stores.
 *
 * Returns the first candidate that touches nothing. If a canvas is so crowded
 * that nothing is free, the last candidate is used rather than refusing to add
 * the annotation: the author can move it, and not adding it at all would be a
 * worse answer to a full canvas.
 */
export function placeAnnotation(
  document: CanvasDocument,
  ownerObjectId: string,
  size: { width: number; height: number },
): { dx: number; dy: number; width: number; height: number } {
  const owner = document.layout.objectPositions[ownerObjectId];
  const fallback = { dx: GAP, dy: GAP, ...size };
  if (!owner) return fallback;

  const taken = occupiedRects(document);
  const candidates: Array<{ dx: number; dy: number }> = [
    { dx: owner.width + GAP, dy: 0 },
    { dx: 0, dy: owner.height + GAP },
    { dx: -size.width - GAP, dy: 0 },
    { dx: 0, dy: -size.height - GAP },
    { dx: owner.width + GAP, dy: owner.height + GAP },
    { dx: -size.width - GAP, dy: owner.height + GAP },
  ];
  // Then straight down the right side, which is where the eye looks next.
  for (let step = 1; step <= 8; step += 1)
    candidates.push({
      dx: owner.width + GAP,
      dy: step * (size.height + GAP),
    });

  for (const candidate of candidates) {
    const rect = {
      x: owner.x + candidate.dx,
      y: owner.y + candidate.dy,
      width: size.width,
      height: size.height,
    };
    if (!taken.some((other) => overlaps(rect, other)))
      return { ...candidate, ...size };
  }
  return { ...candidates[candidates.length - 1], ...size };
}
