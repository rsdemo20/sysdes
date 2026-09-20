/**
 * How many ports a block has, where they sit, and which one a line uses.
 *
 * All of it is layout, so the tests below also stand as the statement that
 * adding a port changes nothing about what the canvas says: a document with
 * ports still validates, and its semantic half is untouched.
 */
import { describe, expect, it } from "vitest";
import {
  ADD_BUTTON_STEP,
  LINE_REACH,
  addButtonShift,
  addPort,
  defaultPorts,
  movePort,
  nearestSide,
  orientationOf,
  portOfEdge,
  portStyle,
  portsOf,
  turnPorts,
} from "../src/editor/ports";
import { validateDocument } from "../src/model/validate";
import { createMixedDocument } from "../src/model/fixtures";
import type { CanvasDocument } from "../src/model/types";

const RECT = { x: 100, y: 100, width: 200, height: 100 };

describe("the ports of a block", () => {
  it("starts with one port on the left and two on the right", () => {
    const ports = defaultPorts();
    expect(ports.filter((port) => port.side === "left")).toHaveLength(1);
    expect(ports.filter((port) => port.side === "right")).toHaveLength(2);
    // None of them is an input or an output: a line may start or end at any.
    expect(Object.keys(ports[0]).sort()).toEqual(["id", "offset", "side"]);
  });

  it("answers with the defaults for a document that stored none", () => {
    const document = createMixedDocument();
    expect(portsOf(document.layout, "hld-orders")).toHaveLength(3);
  });

  it("spreads a side evenly when one more port is added", () => {
    const ports = addPort(defaultPorts(), "right");
    const right = ports.filter((port) => port.side === "right");
    expect(right.map((port) => port.offset)).toEqual([0.25, 0.5, 0.75]);
    expect(new Set(ports.map((port) => port.id)).size).toBe(ports.length);
  });

  it("turns every port onto the other pair of sides, and back", () => {
    const turned = turnPorts(defaultPorts());
    expect(orientationOf(turned)).toBe("vertical");
    expect(turned.map((port) => port.side)).toEqual(["top", "bottom", "bottom"]);
    // Turning twice is the arrangement it started with.
    expect(turnPorts(turned)).toEqual(defaultPorts());
  });

  it("moves one port and leaves the others alone", () => {
    const before = defaultPorts();
    const after = movePort(before, "out2", "bottom", 0.3);
    expect(after.find((port) => port.id === "out2")).toMatchObject({
      side: "bottom",
      offset: 0.3,
    });
    expect(after.find((port) => port.id === "out")).toEqual(
      before.find((port) => port.id === "out"),
    );
  });

  it("keeps a dragged port on the perimeter wherever the pointer went", () => {
    expect(nearestSide(RECT, { x: 105, y: 150 }).side).toBe("left");
    expect(nearestSide(RECT, { x: 295, y: 150 }).side).toBe("right");
    expect(nearestSide(RECT, { x: 200, y: 104 }).side).toBe("top");
    expect(nearestSide(RECT, { x: 200, y: 196 }).side).toBe("bottom");
    // Far outside the block, the offset is still clamped onto the side.
    const wild = nearestSide(RECT, { x: -900, y: 9000 });
    expect(wild.offset).toBeGreaterThanOrEqual(0);
    expect(wild.offset).toBeLessThanOrEqual(1);
  });

  it("draws a port at its place along the side", () => {
    expect(portStyle({ id: "a", side: "right", offset: 0.25 })).toEqual({
      top: "25%",
      transform: "translateY(-50%)",
    });
    expect(portStyle({ id: "b", side: "bottom", offset: 0.5 })).toEqual({
      left: "50%",
      transform: "translateX(-50%)",
    });
  });
});

describe("which port a connection uses", () => {
  const document = createMixedDocument();

  it("leaves by the last port and arrives at the first when nothing is bound", () => {
    expect(portOfEdge(document.layout, "edge-1", "hld-orders", "source")).toBe(
      "out2",
    );
    expect(portOfEdge(document.layout, "edge-1", "hld-orders", "target")).toBe("in");
  });

  it("uses the bound port once a line was drawn from one", () => {
    const layout = {
      ...document.layout,
      edgePorts: { "edge-1": { source: "out2", target: "in" } },
    };
    expect(portOfEdge(layout, "edge-1", "hld-orders", "source")).toBe("out2");
  });

  it("ignores a binding to a port the block no longer has", () => {
    const layout = {
      ...document.layout,
      edgePorts: { "edge-1": { source: "out9", target: "in" } },
    };
    expect(portOfEdge(layout, "edge-1", "hld-orders", "source")).toBe("out2");
  });
});

describe("ports as layout", () => {
  it("leave the document valid and say nothing about the design", () => {
    const document = createMixedDocument();
    const withPorts: CanvasDocument = {
      ...document,
      layout: {
        ...document.layout,
        ports: { "hld-orders": addPort(defaultPorts(), "right") },
        edgePorts: { "edge-payment-orders": { source: "out2", target: "in" } },
      },
    };
    expect(() => validateDocument(withPorts)).not.toThrow();
    // The semantic half is the same object it was: nothing about the system
    // changed because a box was drawn with another outlet.
    expect(withPorts.semantic).toBe(document.semantic);
  });
});

describe("the + that adds a port", () => {
  const side = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      side: "left" as const,
      offset: (index + 1) / (count + 1),
    }));
  // Its line runs straight out of the port, and is grabbed 10px either side.
  const clearOfLines = (count: number, length: number) => {
    const shift = addButtonShift(side(count), "left", length);
    return side(count).every(
      (port) =>
        Math.abs(port.offset * length - (length / 2 + shift)) >= LINE_REACH,
    );
  };

  it("stands at the middle of a side with no port there", () => {
    expect(addButtonShift([], "left", 90)).toBe(0);
    expect(addButtonShift(side(2), "left", 90)).toBe(0);
    expect(addButtonShift(side(4), "left", 120)).toBe(0);
  });

  it("steps about ten pixels aside from a port at the middle", () => {
    for (const count of [1, 3, 5, 7]) {
      const length = 30 * (count + 1);
      expect(Math.abs(addButtonShift(side(count), "left", length))).toBe(
        ADD_BUTTON_STEP,
      );
      expect(clearOfLines(count, length)).toBe(true);
    }
  });

  it("only looks at the side it stands on", () => {
    const right = side(1).map((port) => ({ ...port, side: "right" as const }));
    expect(addButtonShift(right, "left", 90)).toBe(0);
    expect(Math.abs(addButtonShift(right, "right", 90))).toBe(ADD_BUTTON_STEP);
  });

  it("takes the gap nearest the middle where no place is clear", () => {
    // Seven ports on a short side: lines every 10px, so nowhere is 10px clear.
    const shift = addButtonShift(side(7), "left", 80);
    expect(Math.abs(shift)).toBe(5);
  });
});
