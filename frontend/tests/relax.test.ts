/**
 * Making room when a block grows.
 *
 * The rules worth pinning are the ones an author would notice if they broke:
 * the block they resized stays exactly where they put it, a neighbour is pushed
 * further in the direction it already lay rather than by the shortest distance,
 * and nothing is dragged back when a block shrinks.
 */
import { describe, expect, it } from "vitest";
import { GAP, makeRoom } from "../src/editor/relax";
import { createMixedDocument } from "../src/model/fixtures";
import type { CanvasDocument } from "../src/model/types";

function canvasWith(
  positions: CanvasDocument["layout"]["objectPositions"],
): CanvasDocument {
  const document = createMixedDocument();
  const hld = document.semantic.diagrams.find((d) => d.type === "hld")!;
  if (hld.type !== "hld") throw new Error("expected an HLD diagram");
  return {
    ...document,
    semantic: {
      ...document.semantic,
      annotations: [],
      diagrams: [
        {
          ...hld,
          nodes: Object.keys(positions).map((id) => ({
            id,
            label: id,
            kind: "service" as const,
            properties: {},
            originTemplateObjectId: null,
          })),
          edges: [],
        },
      ],
    },
    layout: {
      ...document.layout,
      objectPositions: positions,
      annotationOffsets: {},
      diagramFrames: { [hld.id]: { x: 0, y: 0, width: 2000, height: 2000 } },
    },
  } as CanvasDocument;
}

describe("making room around a resized block", () => {
  it("pushes the neighbour it grew into, and never itself", () => {
    const document = canvasWith({
      grown: { x: 100, y: 100, width: 400, height: 120 },
      right: { x: 300, y: 100, width: 200, height: 120 },
    });
    const after = makeRoom(document, "grown");
    expect(after.layout.objectPositions.grown).toEqual(
      document.layout.objectPositions.grown,
    );
    expect(after.layout.objectPositions.right.x).toBe(100 + 400 + GAP);
    expect(after.layout.objectPositions.right.y).toBe(100);
  });

  it("moves a neighbour further in the direction it already lay", () => {
    // Directly above and overlapping: it goes up, not sideways.
    const document = canvasWith({
      grown: { x: 100, y: 100, width: 200, height: 200 },
      above: { x: 100, y: 60, width: 200, height: 60 },
    });
    const after = makeRoom(document, "grown");
    expect(after.layout.objectPositions.above.x).toBe(100);
    expect(after.layout.objectPositions.above.y).toBe(100 - GAP - 60);
  });

  it("keeps a row a row instead of pushing by the shortest distance", () => {
    // Shoving this neighbour downwards would have been a smaller move and a
    // worse answer: the two blocks were side by side and should stay so.
    const document = canvasWith({
      grown: { x: 100, y: 100, width: 400, height: 120 },
      right: { x: 300, y: 100, width: 200, height: 120 },
    });
    const after = makeRoom(document, "grown");
    expect(after.layout.objectPositions.right.y).toBe(100);
  });

  it("leaves a canvas alone when nothing is in the way", () => {
    const document = canvasWith({
      grown: { x: 100, y: 100, width: 200, height: 120 },
      far: { x: 900, y: 900, width: 200, height: 120 },
    });
    expect(makeRoom(document, "grown")).toBe(document);
  });

  it("grows the frame to hold what moved", () => {
    const document = canvasWith({
      grown: { x: 100, y: 100, width: 400, height: 120 },
      right: { x: 300, y: 100, width: 200, height: 120 },
    });
    const small = {
      ...document,
      layout: {
        ...document.layout,
        diagramFrames: { "diagram-hld": { x: 0, y: 0, width: 560, height: 400 } },
      },
    } as CanvasDocument;
    const after = makeRoom(small, "grown");
    const frame = after.layout.diagramFrames["diagram-hld"];
    const moved = after.layout.objectPositions.right;
    expect(frame.width).toBeGreaterThanOrEqual(moved.x + moved.width - frame.x);
  });

  it("moves an annotation the block has grown over", () => {
    const base = createMixedDocument();
    const annotation = base.semantic.annotations[0];
    const owner = annotation.ownerObjectId;
    const covered: CanvasDocument = {
      ...base,
      layout: {
        ...base.layout,
        objectPositions: {
          ...base.layout.objectPositions,
          [owner]: { ...base.layout.objectPositions[owner], width: 600, height: 400 },
        },
        annotationOffsets: {
          ...base.layout.annotationOffsets,
          // Sitting inside the block after it grew.
          [annotation.id]: { dx: 20, dy: 20, width: 280, height: 95 },
        },
      },
    };
    const after = makeRoom(covered, owner);
    const offset = after.layout.annotationOffsets[annotation.id];
    const block = after.layout.objectPositions[owner];
    const rect = { x: block.x + offset.dx, y: block.y + offset.dy, ...offset };
    const inside =
      rect.x < block.x + block.width &&
      block.x < rect.x + offset.width &&
      rect.y < block.y + block.height &&
      block.y < rect.y + offset.height;
    expect(inside).toBe(false);
  });

  it("says nothing about a block it cannot find", () => {
    const document = canvasWith({ a: { x: 0, y: 0, width: 100, height: 100 } });
    expect(makeRoom(document, "not-here")).toBe(document);
  });
});
