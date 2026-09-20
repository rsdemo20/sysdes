/**
 * Where the canvas looks when it opens.
 *
 * The zoom is checked against React Flow's own fit, so a canvas with diagrams
 * provably opens at the zoom it always did; the position is checked against the
 * complaint -- the task panels of a canvas with no diagrams opened in the middle
 * of the screen.
 */
import { describe, expect, it } from "vitest";
import { getViewportForBounds } from "@xyflow/react";
import {
  INITIAL_VIEW,
  contentBounds,
  paddingPixels,
  topLeftViewport,
} from "../src/editor/initialViewport";

const { padding, minZoom, maxZoom } = INITIAL_VIEW;
const screenLeft = (bounds: { x: number }, view: { x: number; zoom: number }) =>
  bounds.x * view.zoom + view.x;
const screenTop = (bounds: { y: number }, view: { y: number; zoom: number }) =>
  bounds.y * view.zoom + view.y;

describe("opening the canvas", () => {
  it("keeps the zoom React Flow's own fit would choose", () => {
    const cases: Array<
      [{ x: number; y: number; width: number; height: number }, number, number]
    > = [
      [{ x: -418, y: 10, width: 3128, height: 2178 }, 1110, 776],
      [{ x: -388, y: 0, width: 340, height: 700 }, 1270, 800],
      [{ x: 0, y: 0, width: 100, height: 60 }, 1110, 776],
    ];
    for (const [bounds, width, height] of cases) {
      const ours = topLeftViewport(bounds, width, height);
      const theirs = getViewportForBounds(
        bounds,
        width,
        height,
        minZoom,
        maxZoom,
        padding,
      );
      expect(ours.zoom).toBeCloseTo(theirs.zoom, 10);
    }
  });

  it("sets a canvas holding only its task against the left edge", () => {
    // The three panels alone, as on a Custom canvas or one started from a card
    // that opens no schema.
    const panels = { x: -388, y: 0, width: 340, height: 700 };
    const view = topLeftViewport(panels, 1110, 776);
    expect(screenLeft(panels, view)).toBe(paddingPixels(1110, padding));
    expect(screenTop(panels, view)).toBe(paddingPixels(776, padding));

    // The centred fit this replaces put the same column mid-screen.
    const centred = getViewportForBounds(
      panels,
      1110,
      776,
      minZoom,
      maxZoom,
      padding,
    );
    expect(screenLeft(panels, centred)).toBeGreaterThan(1110 / 3);
  });

  it("sets a canvas with diagrams against the same corner", () => {
    const content = { x: -418, y: 10, width: 3128, height: 2178 };
    const view = topLeftViewport(content, 1270, 800);
    expect(screenLeft(content, view)).toBe(paddingPixels(1270, padding));
    expect(screenTop(content, view)).toBe(paddingPixels(800, padding));
    // Everything still fits.
    expect(content.width * view.zoom).toBeLessThanOrEqual(1270);
    expect(content.height * view.zoom).toBeLessThanOrEqual(800);
  });

  it("measures what is drawn from positions and sizes, and nothing from nothing", () => {
    expect(contentBounds([])).toBeNull();
    expect(
      contentBounds([
        { position: { x: -388, y: 0 }, width: 340, height: 200 },
        { position: { x: 10, y: 30 }, width: 1272, height: 1148 },
        { position: { x: 5, y: 5 } },
      ]),
    ).toEqual({ x: -388, y: 0, width: 1670, height: 1178 });
  });
});
