/**
 * Making room after a block changes size.
 *
 * Growing a block used to make it overlap whatever was beside it, and cover its
 * own annotation, leaving the author to tidy up by hand -- which is the moment
 * they stop resizing blocks at all. A block that grows now pushes its
 * neighbours out of the way and its annotation follows to free space.
 *
 * Two rules keep the result predictable. A neighbour is pushed away from the
 * resized block, in the direction it already lies: the block to the right moves
 * further right and the row survives, where pushing by the shortest distance
 * would have sent it downwards and broken the row for no reason the author
 * could see. And nothing is ever pulled back: shrinking a block leaves
 * everything where it was, because tidying nobody asked for is as annoying as
 * no tidying at all.
 */
import type { CanvasDocument, Diagram, Position } from "../model/types";
import { placeAnnotation } from "./annotationPlacement";

/** Clear space left between two blocks that had to be separated. */
export const GAP = 24;
/** Rounds of pushing, so a shove can travel through a row of blocks. */
const ROUNDS = 4;

function overlaps(a: Position, b: Position): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function blocksOf(diagram: Diagram): Array<{ id: string }> {
  if (diagram.type === "hld") return diagram.nodes;
  if (diagram.type === "er") return diagram.entities;
  return diagram.participants;
}

/**
 * Which way a neighbour lies, judged against the block as it was.
 *
 * Against the block as it is now, a wide enough growth swallows the neighbour's
 * centre and the answer flips: a block in the row to the right suddenly counts
 * as lying above, and gets thrown over the top of a block it was beside. The
 * arrangement the author built is the one before the resize, so that is the one
 * the direction is read from.
 */
function direction(
  reference: Position,
  mover: Position,
): "right" | "left" | "down" | "up" {
  const dx = mover.x + mover.width / 2 - (reference.x + reference.width / 2);
  const dy = mover.y + mover.height / 2 - (reference.y + reference.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

/** The move that clears `mover` of `fixed`, the given way. */
function shove(
  fixed: Position,
  mover: Position,
  way: "right" | "left" | "down" | "up",
): { x: number; y: number } {
  if (way === "right") return { x: fixed.x + fixed.width + GAP - mover.x, y: 0 };
  if (way === "left") return { x: fixed.x - GAP - (mover.x + mover.width), y: 0 };
  if (way === "down") return { x: 0, y: fixed.y + fixed.height + GAP - mover.y };
  return { x: 0, y: fixed.y - GAP - (mover.y + mover.height) };
}

/**
 * The document with room made around `blockId`.
 *
 * Neighbours on the same diagram are pushed clear, the frame grows to hold
 * whatever moved, and any annotation of the resized block that it now covers is
 * placed again beside it.
 */
export function makeRoom(
  document: CanvasDocument,
  blockId: string,
  /** The block as it was before the resize, if this follows one. */
  before?: Position,
): CanvasDocument {
  const diagram = document.semantic.diagrams.find((item) =>
    blocksOf(item).some((block) => block.id === blockId),
  );
  const anchor = document.layout.objectPositions[blockId];
  if (!diagram || !anchor) return document;

  const positions = { ...document.layout.objectPositions };
  const neighbours = blocksOf(diagram)
    .map((block) => block.id)
    .filter((id) => id !== blockId && positions[id]);

  // The resized block never moves: the author put it where they want it.
  const reference = before ?? anchor;
  const fixed = new Set([blockId]);
  let moved = false;
  for (let round = 0; round < ROUNDS; round += 1) {
    let settled = true;
    for (const id of neighbours) {
      for (const other of [blockId, ...neighbours]) {
        if (other === id || !fixed.has(other)) continue;
        if (!overlaps(positions[other], positions[id])) continue;
        const push = shove(
          positions[other],
          positions[id],
          direction(other === blockId ? reference : positions[other], positions[id]),
        );
        positions[id] = {
          ...positions[id],
          x: positions[id].x + push.x,
          y: positions[id].y + push.y,
        };
        settled = false;
        moved = true;
      }
      fixed.add(id);
    }
    if (settled) break;
  }

  let next: CanvasDocument =
    moved
      ? {
          ...document,
          layout: { ...document.layout, objectPositions: positions },
        }
      : document;

  // The frame has to hold what it now contains.
  const frame = next.layout.diagramFrames[diagram.id];
  if (frame) {
    const members = [blockId, ...neighbours].map((id) => positions[id]);
    const right = Math.max(...members.map((rect) => rect.x + rect.width)) + 45;
    const bottom = Math.max(...members.map((rect) => rect.y + rect.height)) + 45;
    if (right > frame.x + frame.width || bottom > frame.y + frame.height)
      next = {
        ...next,
        layout: {
          ...next.layout,
          diagramFrames: {
            ...next.layout.diagramFrames,
            [diagram.id]: {
              ...frame,
              width: Math.max(frame.width, right - frame.x),
              height: Math.max(frame.height, bottom - frame.y),
            },
          },
        },
      };
  }

  // An annotation the block has grown over is placed beside it again.
  const offsets = { ...next.layout.annotationOffsets };
  let annotationMoved = false;
  for (const annotation of next.semantic.annotations) {
    if (annotation.ownerObjectId !== blockId) continue;
    const offset = offsets[annotation.id];
    if (!offset) continue;
    const rect = {
      x: anchor.x + offset.dx,
      y: anchor.y + offset.dy,
      width: offset.width,
      height: offset.height,
    };
    if (!overlaps(rect, positions[blockId])) continue;
    offsets[annotation.id] = placeAnnotation(next, blockId, {
      width: offset.width,
      height: offset.height,
    });
    annotationMoved = true;
  }
  return annotationMoved
    ? { ...next, layout: { ...next.layout, annotationOffsets: offsets } }
    : next;
}
