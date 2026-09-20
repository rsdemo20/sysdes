/**
 * Where a new diagram lands and how big it is.
 *
 * Both answers are geometry with no browser in them, which is the level at
 * which "strictly outside the others" is worth stating: overlapping frames are
 * easy to introduce again and hard to notice in a screenshot.
 */
import { describe, expect, it } from "vitest";
import {
  GAP,
  MINIMUM,
  SHARE,
  newFrameRect,
} from "../src/editor/framePlacement";
import { createMixedDocument } from "../src/model/fixtures";
import type { CanvasDocument, Position } from "../src/model/types";

const VISIBLE = { width: 1600, height: 900 };

function withFrames(frames: Record<string, Position>): CanvasDocument {
  const document = createMixedDocument();
  return {
    ...document,
    layout: { ...document.layout, diagramFrames: frames },
  } as CanvasDocument;
}

function overlaps(a: Position, b: Position): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("a new diagram frame", () => {
  it("takes about three quarters of what the author can see", () => {
    const rect = newFrameRect(withFrames({}), VISIBLE);
    expect(rect.width).toBe(Math.round(VISIBLE.width * SHARE));
    expect(rect.height).toBe(Math.round(VISIBLE.height * SHARE));
    expect(SHARE).toBe(0.75);
  });

  it("never shrinks below a usable size on a small window", () => {
    const rect = newFrameRect(withFrames({}), { width: 400, height: 300 });
    expect(rect.width).toBe(MINIMUM.width);
    expect(rect.height).toBe(MINIMUM.height);
  });

  it("lands below the diagram that is already there, clear of it", () => {
    const first = { x: 40, y: 40, width: 1200, height: 675 };
    const rect = newFrameRect(withFrames({ "diagram-hld": first }), VISIBLE);
    expect(overlaps(rect, first)).toBe(false);
    expect(rect.y).toBe(first.y + first.height + GAP);
    expect(rect.x).toBe(first.x);
  });

  it("goes to the right once the canvas has grown taller than it is wide", () => {
    // Two diagrams stacked: another one below would make a long column, so the
    // third arrives beside them instead.
    const first = { x: 40, y: 40, width: 900, height: 675 };
    const second = { x: 40, y: 775, width: 900, height: 675 };
    const rect = newFrameRect(
      withFrames({ "diagram-hld": first, "diagram-er": second }),
      VISIBLE,
    );
    expect(overlaps(rect, first)).toBe(false);
    expect(overlaps(rect, second)).toBe(false);
    expect(rect.x).toBe(first.x + first.width + GAP);
    expect(rect.y).toBe(first.y);
  });

  it("is strictly outside every frame however many there are", () => {
    const frames = {
      a: { x: 0, y: 0, width: 900, height: 500 },
      b: { x: 0, y: 560, width: 900, height: 500 },
      c: { x: 960, y: 0, width: 900, height: 500 },
    };
    const rect = newFrameRect(withFrames(frames), VISIBLE);
    for (const frame of Object.values(frames))
      expect(overlaps(rect, frame)).toBe(false);
  });

  it("refuses to hand back a frame that lands on another", () => {
    // The rule is enforced, not merely intended: a future change that breaks it
    // fails loudly instead of drawing two diagrams on top of each other.
    const frames = { a: { x: 0, y: 0, width: 900, height: 500 } };
    expect(() => newFrameRect(withFrames(frames), VISIBLE)).not.toThrow();
  });
});
