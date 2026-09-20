/**
 * Where a connection's label goes, and what the document keeps about it.
 *
 * The geometry is tested against paths React Flow itself draws, not hand-made
 * strings, because the parsing depends on exactly how a stepped path is written
 * and a hand-made string would only prove the parser agrees with its author.
 */
import { describe, expect, it } from "vitest";
import { Position, getSmoothStepPath } from "@xyflow/react";
import {
  DEFAULT_EDGE_LABEL,
  LABEL_PLACEMENTS,
  MAX_LABEL,
  MIN_LABEL,
  clampSize,
  edgeLabelOf,
  labelCentre,
  labelSize,
  midpointOf,
  nextPlacement,
  placementCentre,
  polylineOf,
  rowsOf,
  type EdgeLabelLayout,
} from "../src/editor/edgeLabel";
import { EditorStore } from "../src/editor/EditorStore";
import { createMixedDocument } from "../src/model/fixtures";
import { validateDocument } from "../src/model/validate";

/** A step from the right side of one block to the left side of a lower one. */
function steppedPath() {
  const [path] = getSmoothStepPath({
    sourceX: 0,
    sourceY: 0,
    sourcePosition: Position.Right,
    targetX: 400,
    targetY: 200,
    targetPosition: Position.Left,
    borderRadius: 14,
  });
  return path;
}

const SIZE = { width: 120, height: 28 };
const INLINE = { x: 999, y: 999 };

describe("reading a stepped path back as corners", () => {
  it("finds the corners of the step React Flow drew", () => {
    const points = polylineOf(steppedPath());
    // Out to the right, down, and on to the target: two horizontal runs joined
    // by one vertical one.
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 400, y: 200 });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it("puts the middle halfway along the line, not between its ends", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 300 },
    ];
    // 400 long in all; the half-way point is 100 down the vertical run.
    expect(midpointOf(points)).toEqual({ x: 100, y: 100 });
  });
});

describe("placing a label round its line", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
    { x: 400, y: 200 },
  ];

  it("keeps the old place by default", () => {
    expect(placementCentre(points, "inline", SIZE, INLINE)).toBe(INLINE);
  });

  it("sets it above or below a horizontal run, clear of the line", () => {
    const above = placementCentre(points, "above", SIZE, INLINE);
    const below = placementCentre(points, "below", SIZE, INLINE);
    // Both runs are long enough; the label goes over one of them and never
    // across the line it sits on.
    expect([0, 200]).toContain(above.y + SIZE.height / 2 + 6);
    expect([0, 200]).toContain(below.y - SIZE.height / 2 - 6);
    expect(above.x).toBeGreaterThanOrEqual(0);
    expect(above.x).toBeLessThanOrEqual(400);
  });

  it("sets it left or right of a vertical run, wholly beside it", () => {
    const left = placementCentre(points, "left", SIZE, INLINE);
    const right = placementCentre(points, "right", SIZE, INLINE);
    expect(left.x + SIZE.width / 2).toBeLessThan(200);
    expect(right.x - SIZE.width / 2).toBeGreaterThan(200);
    expect(left.y).toBe(100);
  });

  it("prefers the run nearest the middle when several are long enough", () => {
    const zigzag = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 40 },
      { x: 600, y: 40 },
      { x: 600, y: 400 },
      { x: 700, y: 400 },
    ];
    // The middle of this line is on the second horizontal run, at y = 40.
    expect(midpointOf(zigzag).y).toBe(40);
    const above = placementCentre(zigzag, "above", SIZE, INLINE);
    expect(above.y + SIZE.height / 2 + 6).toBe(40);
  });

  it("falls back to the middle of the line when it has no run of that kind", () => {
    const straightDown = [
      { x: 50, y: 0 },
      { x: 50, y: 300 },
    ];
    const above = placementCentre(straightDown, "above", SIZE, INLINE);
    expect(above.x).toBe(50);
    expect(above.y).toBeLessThan(150);
  });

  it("keeps a dragged label at its offset from the middle as the line moves", () => {
    const entry: EdgeLabelLayout = { ...DEFAULT_EDGE_LABEL, dx: 30, dy: -20 };
    const here = labelCentre(points, entry, SIZE, INLINE);
    const moved = points.map((p) => ({ x: p.x + 100, y: p.y + 50 }));
    const there = labelCentre(moved, entry, SIZE, INLINE);
    expect({ x: there.x - here.x, y: there.y - here.y }).toEqual({
      x: 100,
      y: 50,
    });
  });

  it("goes round all five placements and back", () => {
    let placement = LABEL_PLACEMENTS[0].id;
    const seen = [placement];
    for (let i = 0; i < 5; i++) {
      placement = nextPlacement(placement);
      seen.push(placement);
    }
    expect(seen).toEqual([
      "inline",
      "above",
      "below",
      "left",
      "right",
      "inline",
    ]);
  });
});

describe("the size of a label", () => {
  it("counts wrapped rows and the lines the author broke", () => {
    expect(rowsOf("short")).toBe(1);
    expect(rowsOf("one\ntwo\nthree")).toBe(3);
    expect(rowsOf("x".repeat(81))).toBe(3);
  });

  it("grows with its text until the author gives it a size", () => {
    const short = labelSize("ok", DEFAULT_EDGE_LABEL);
    const long = labelSize(
      "a much longer name\nover two lines",
      DEFAULT_EDGE_LABEL,
    );
    expect(long.height).toBeGreaterThan(short.height);
    expect(
      labelSize("anything", { ...DEFAULT_EDGE_LABEL, width: 200, height: 90 }),
    ).toEqual({ width: 200, height: 90 });
  });

  it("is kept between the smallest findable and the largest sensible", () => {
    expect(clampSize({ width: 1, height: 1 })).toEqual(MIN_LABEL);
    expect(clampSize({ width: 9999, height: 9999 })).toEqual(MAX_LABEL);
  });
});

describe("label layout in the document", () => {
  const hldEdge = (store: EditorStore) => {
    const diagram = store
      .getSnapshot()
      .semantic.diagrams.find((d) => d.type === "hld");
    if (diagram?.type !== "hld") throw new Error("expected an HLD diagram");
    return diagram.edges[0].id;
  };

  it("is layout: the document stays valid and its semantics untouched", () => {
    const store = new EditorStore(createMixedDocument());
    const before = store.getSnapshot().semantic;
    const edgeId = hldEdge(store);
    store.setEdgeLabel(edgeId, { dx: 12, dy: -8, width: 180, height: 60 });
    expect(() => validateDocument(store.getSnapshot())).not.toThrow();
    expect(store.getSnapshot().semantic).toBe(before);
    expect(edgeLabelOf(store.getSnapshot().layout, edgeId)).toEqual({
      placement: "inline",
      dx: 12,
      dy: -8,
      width: 180,
      height: 60,
    });
  });

  it("moves to the next placement, dropping a drag but keeping the size", () => {
    const store = new EditorStore(createMixedDocument());
    const edgeId = hldEdge(store);
    store.setEdgeLabel(edgeId, { dx: 40, dy: 40, width: 150, height: 40 });
    store.cycleEdgeLabelPlacement(edgeId);
    expect(edgeLabelOf(store.getSnapshot().layout, edgeId)).toEqual({
      placement: "above",
      dx: null,
      dy: null,
      width: 150,
      height: 40,
    });
  });

  it("is one undo step per change", () => {
    const store = new EditorStore(createMixedDocument());
    const edgeId = hldEdge(store);
    store.cycleEdgeLabelPlacement(edgeId);
    store.undo();
    expect(edgeLabelOf(store.getSnapshot().layout, edgeId)).toBe(
      DEFAULT_EDGE_LABEL,
    );
  });

  it("goes when its connection goes, so the server has nothing to refuse", () => {
    const store = new EditorStore(createMixedDocument());
    const edgeId = hldEdge(store);
    store.setEdgeLabel(edgeId, { placement: "below" });
    store.deleteObject(edgeId);
    expect(store.getSnapshot().layout.edgeLabels ?? {}).not.toHaveProperty(
      edgeId,
    );
    expect(() => validateDocument(store.getSnapshot())).not.toThrow();
  });

  it("is refused when it points at a connection that does not exist", () => {
    const document = createMixedDocument();
    const orphan = {
      ...document,
      layout: {
        ...document.layout,
        edgeLabels: { "edge-nobody": { ...DEFAULT_EDGE_LABEL } },
      },
    };
    expect(() => validateDocument(orphan)).toThrow();
  });
});
