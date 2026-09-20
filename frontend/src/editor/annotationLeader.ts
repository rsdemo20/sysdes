/**
 * The colour of the thin dashed line from an annotation to its block.
 *
 * The line is not part of the design: it carries no protocol, no direction and
 * no meaning a reviewer should read. It exists only so the eye can tell which
 * block a note belongs to, which is why it is dashed, thin, and never drawn in
 * the palette the diagram's own connections use.
 *
 * Each annotation gets its own hue, derived from its id so it never changes,
 * because several notes around one cluster of blocks are only distinguishable
 * if their lines are. The saturation and lightness stay fixed and muted: the
 * colour is there to separate lines from each other, not to draw attention.
 */

/** A stable hue in [0, 360) for this annotation. */
function hueOf(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1)
    hash = (hash * 31 + id.charCodeAt(index)) % 360;
  // Skip the range where the line would read as one of the diagram's own
  // connections, which are slate blue.
  return (hash + 20) % 360;
}

export function leaderColour(annotationId: string): string {
  return `hsl(${hueOf(annotationId)}, 45%, 58%)`;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Which sides the leader should leave from and arrive at.
 *
 * The shortest visible line is the one that reads as a pointer rather than as
 * routing, so the sides are chosen by where the annotation actually sits: the
 * dominant gap decides the axis, and the line crosses it.
 */
export function leaderHandles(
  annotation: Rect,
  owner: Rect,
): { source: string; target: string } {
  const right = annotation.x - (owner.x + owner.width);
  const left = owner.x - (annotation.x + annotation.width);
  const below = annotation.y - (owner.y + owner.height);
  const above = owner.y - (annotation.y + annotation.height);
  const horizontal = Math.max(right, left);
  const vertical = Math.max(below, above);

  if (horizontal >= vertical)
    return right >= left
      ? { source: "lead-out-left", target: "lead-in-right" }
      : { source: "lead-out-right", target: "lead-in-left" };
  return below >= above
    ? { source: "lead-out-top", target: "lead-in-bottom" }
    : { source: "lead-out-bottom", target: "lead-in-top" };
}
