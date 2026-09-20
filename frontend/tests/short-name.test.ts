/**
 * The short handle a block answers to.
 *
 * Two properties matter and neither is obvious from the code: a name is never
 * reused while another block still holds it, and a name never moves from one
 * block to another. The second is what makes it safe to write "qu3" in an
 * annotation and still mean the same block tomorrow.
 */
import { describe, expect, it } from "vitest";
import { nextShortName, shortNameOf } from "../src/editor/shortName";
import { presetById } from "../src/editor/palette";
import { validateDocument } from "../src/model/validate";
import { createMixedDocument } from "../src/model/fixtures";
import type { CanvasDocument, Diagram, HldNode } from "../src/model/types";

function hldDiagram(nodes: HldNode[]): Diagram {
  return {
    id: "diagram-hld",
    type: "hld",
    title: "Компоненты",
    nodes,
    edges: [],
    originTemplateObjectId: null,
  };
}

function node(id: string, shortName?: string | null): HldNode {
  return {
    id,
    label: id,
    kind: "queue",
    shortName,
    properties: {},
    originTemplateObjectId: null,
  };
}

describe("short names", () => {
  it("numbers a block by its position on the diagram", () => {
    const diagram = hldDiagram([node("a", "svc1"), node("b", "qu2")]);
    expect(nextShortName(diagram, "gw")).toBe("gw3");
  });

  it("starts at one on a diagram that does not exist yet", () => {
    expect(nextShortName(undefined, "qu")).toBe("qu1");
  });

  it("never reuses a number a surviving block still holds", () => {
    // Blocks two and three were deleted; the next one must not become qu2 and
    // collide with nothing, nor gw2 and clash with a name somebody wrote down.
    const diagram = hldDiagram([node("a", "svc1"), node("d", "qu4")]);
    expect(nextShortName(diagram, "lb")).toBe("lb5");
  });

  it("derives a name for a block that never stored one", () => {
    const diagram = hldDiagram([node("a"), node("b")]);
    expect(shortNameOf(diagram, "b")).toBe("qu2");
    expect(shortNameOf(diagram, "missing")).toBeNull();
  });

  it("keeps a stored name in preference to a derived one", () => {
    const diagram = hldDiagram([node("a"), node("b", "gw7")]);
    expect(shortNameOf(diagram, "b")).toBe("gw7");
  });

  it("uses the prefix the palette gave the preset", () => {
    const queue = presetById("hld-queue");
    expect(nextShortName(hldDiagram([]), queue.prefix)).toBe("qu1");
  });

  it("passes the contract, and two blocks may not share a name", () => {
    const document = createMixedDocument();
    const diagram = document.semantic.diagrams.find((d) => d.type === "hld")!;
    if (diagram.type !== "hld") throw new Error("expected an HLD diagram");
    diagram.nodes[0].shortName = "qu1";
    expect(() => validateDocument(document)).not.toThrow();

    diagram.nodes[1].shortName = "qu1";
    expect(() => validateDocument(document as CanvasDocument)).toThrow(
      /short name/i,
    );
  });
});
