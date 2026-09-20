/**
 * The five ways a connection can be drawn, and where its label lands.
 *
 * The mapping is the interesting part: a style is stored as what it means, so
 * every drawing has to come back as itself after a round trip.
 */
import { describe, expect, it } from "vitest";
import {
  CONNECTION_STYLES,
  styleById,
  styleOf,
} from "../src/editor/connectionStyle";
import { LABEL, labelSpot } from "../src/editor/labelSpot";

describe("how a connection is drawn", () => {
  it("offers exactly the five the author asked for, in their order", () => {
    expect(CONNECTION_STYLES.map((style) => style.id)).toEqual([
      "arrow",
      "dashed-arrow",
      "double",
      "line",
      "dashed-line",
    ]);
  });

  it("points a two-way line at both of its ends", () => {
    expect(styleById("double")).toMatchObject({
      arrowAtTarget: true,
      arrowAtSource: true,
    });
  });

  it("stores a style as what it means and reads it back the same", () => {
    for (const style of CONNECTION_STYLES) {
      const stored = {
        interaction: style.interaction,
        bidirectional: style.bidirectional ? true : null,
      };
      expect(styleOf(stored).id).toBe(style.id);
    }
  });

  it("draws a line pointing both ways whatever its interaction says", () => {
    expect(styleOf({ interaction: "async", bidirectional: true }).id).toBe(
      "double",
    );
  });

  it("falls back to a plain line rather than inventing a direction", () => {
    expect(
      styleOf({ interaction: "nonsense" as "sync", bidirectional: null }).id,
    ).toBe("line");
  });

  it("keeps arrows and dashes together with the meaning", () => {
    expect(styleById("dashed-arrow")).toMatchObject({
      interaction: "async",
      dashed: true,
      arrowAtTarget: true,
      arrowAtSource: false,
    });
    expect(styleById("line")).toMatchObject({
      arrowAtTarget: false,
      arrowAtSource: false,
      dashed: false,
    });
  });
});

describe("where a label sits", () => {
  const from = { x: 0, y: 0, width: 200, height: 100 };
  const to = { x: 600, y: 0, width: 200, height: 100 };

  it("rides the middle of the run when nothing is there", () => {
    expect(labelSpot(from, to, [])).toEqual({ x: 400, y: 50 });
  });

  it("steps along the line when the middle is taken", () => {
    const inTheWay = { x: 330, y: 20, width: 140, height: 60 };
    const spot = labelSpot(from, to, [inTheWay]);
    expect(spot.y).toBe(50);
    expect(spot.x).not.toBe(400);
    // Still on the run, not somewhere unrelated.
    expect(spot.x).toBeGreaterThan(from.x);
    expect(spot.x).toBeLessThan(to.x + to.width);
  });

  it("gives two connections between the same pair different places", () => {
    const first = labelSpot(from, to, []);
    const taken = {
      x: first.x - LABEL.width / 2,
      y: first.y - LABEL.height / 2,
      ...LABEL,
    };
    const second = labelSpot(from, to, [taken]);
    expect(second.x).not.toBe(first.x);
  });

  it("takes the middle anyway when the whole run is crowded", () => {
    const wall = { x: -1000, y: -1000, width: 4000, height: 4000 };
    expect(labelSpot(from, to, [wall])).toEqual({ x: 400, y: 50 });
  });
});
