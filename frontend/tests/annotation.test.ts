/**
 * Where an annotation lands, and how its leader finds the block.
 *
 * Both are pure geometry, so they are worth pinning here rather than only in a
 * browser: the rules are easy to state and easy to break by accident.
 */
import { describe, expect, it } from "vitest";
import {
  GAP,
  occupiedRects,
  placeAnnotation,
} from "../src/editor/annotationPlacement";
import { leaderColour, leaderHandles } from "../src/editor/annotationLeader";
import { createMixedDocument } from "../src/model/fixtures";
import type { CanvasDocument } from "../src/model/types";

const SIZE = { width: 280, height: 95 };

function emptyCanvasWith(positions: CanvasDocument["layout"]["objectPositions"]) {
  const document = createMixedDocument();
  return {
    ...document,
    semantic: { ...document.semantic, annotations: [] },
    layout: {
      ...document.layout,
      objectPositions: positions,
      annotationOffsets: {},
    },
  } as CanvasDocument;
}

describe("placing a new annotation", () => {
  it("puts it beside the block, ten pixels away", () => {
    const document = emptyCanvasWith({
      block: { x: 100, y: 100, width: 220, height: 112 },
    });
    const placed = placeAnnotation(document, "block", SIZE);
    // Immediately to the right, on the same row: dx is the block's width plus
    // the gap, so the visible distance between them is exactly the gap.
    expect(placed).toEqual({ dx: 220 + GAP, dy: 0, ...SIZE });
    expect(GAP).toBe(10);
  });

  it("steps aside rather than landing on something", () => {
    const document = emptyCanvasWith({
      block: { x: 100, y: 100, width: 220, height: 112 },
      // The place to the right is taken; below is free.
      neighbour: { x: 100 + 220 + GAP, y: 100, width: 200, height: 100 },
    });
    const placed = placeAnnotation(document, "block", SIZE);
    expect(placed.dy).toBe(112 + GAP);
    expect(placed.dx).toBe(0);
  });

  it("counts annotations already on the canvas as occupied", () => {
    const document = createMixedDocument();
    const taken = occupiedRects(document);
    expect(taken.length).toBeGreaterThan(
      Object.keys(document.layout.objectPositions).length - 1,
    );
    const owner = document.semantic.annotations[0].ownerObjectId;
    const placed = placeAnnotation(document, owner, SIZE);
    const rect = {
      x: document.layout.objectPositions[owner].x + placed.dx,
      y: document.layout.objectPositions[owner].y + placed.dy,
      ...SIZE,
    };
    for (const other of taken)
      expect(
        rect.x < other.x + other.width &&
          other.x < rect.x + rect.width &&
          rect.y < other.y + other.height &&
          other.y < rect.y + rect.height,
      ).toBe(false);
  });

  it("still answers for a block that has no position at all", () => {
    const document = emptyCanvasWith({});
    expect(placeAnnotation(document, "nowhere", SIZE).dx).toBe(GAP);
  });
});

describe("the leader line", () => {
  const owner = { x: 100, y: 100, width: 220, height: 112 };

  it("leaves from the side that faces the block", () => {
    expect(leaderHandles({ x: 400, y: 100, ...SIZE }, owner)).toEqual({
      source: "lead-out-left",
      target: "lead-in-right",
    });
    expect(leaderHandles({ x: -300, y: 100, ...SIZE }, owner)).toEqual({
      source: "lead-out-right",
      target: "lead-in-left",
    });
    expect(leaderHandles({ x: 100, y: 400, ...SIZE }, owner)).toEqual({
      source: "lead-out-top",
      target: "lead-in-bottom",
    });
    expect(leaderHandles({ x: 100, y: -200, ...SIZE }, owner)).toEqual({
      source: "lead-out-bottom",
      target: "lead-in-top",
    });
  });

  it("gives each annotation a colour of its own that never changes", () => {
    expect(leaderColour("annotation-a")).toBe(leaderColour("annotation-a"));
    expect(leaderColour("annotation-a")).not.toBe(leaderColour("annotation-b"));
    expect(leaderColour("annotation-a")).toMatch(/^hsl\(\d+, 45%, 58%\)$/);
  });
});
