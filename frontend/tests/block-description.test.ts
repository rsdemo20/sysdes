/**
 * A block's second line: its description, written into the block's properties.
 *
 * Unlike a block's placement or its text style this is design -- what the
 * component is responsible for is exactly what a reviewer reads -- so it goes
 * through the same text commit as the title and lands in the semantic half.
 */
import { describe, expect, it } from "vitest";
import { applyCommand, CommandError } from "../src/model/commands";
import { createMixedDocument } from "../src/model/fixtures";
import { validateDocument } from "../src/model/validate";
import type { CanvasDocument } from "../src/model/types";

function hldOf(document: CanvasDocument) {
  const diagram = document.semantic.diagrams.find((d) => d.type === "hld");
  if (diagram?.type !== "hld") throw new Error("expected an HLD diagram");
  return diagram;
}

describe("a block's description", () => {
  it("is written into the block's properties and nowhere else", () => {
    const document = createMixedDocument();
    const block = hldOf(document).nodes[0];
    const next = applyCommand(document, {
      type: "text.commit",
      objectId: block.id,
      field: "properties.responsibility",
      value: "Принимает события оплаты",
    });
    const edited = hldOf(next).nodes.find((node) => node.id === block.id)!;
    expect(edited.properties.responsibility).toBe("Принимает события оплаты");
    expect(edited.label).toBe(block.label);
    // The other properties are the block's own and stay as they were.
    expect({ ...edited.properties, responsibility: null }).toEqual({
      ...block.properties,
      responsibility: null,
    });
    expect(() => validateDocument(next)).not.toThrow();
  });

  it("is stored as unknown, not as an empty string, once emptied", () => {
    const document = createMixedDocument();
    const block = hldOf(document).nodes[0];
    const written = applyCommand(document, {
      type: "text.commit",
      objectId: block.id,
      field: "properties.technology",
      value: "PostgreSQL",
    });
    const emptied = applyCommand(written, {
      type: "text.commit",
      objectId: block.id,
      field: "properties.technology",
      value: "",
    });
    expect(
      hldOf(emptied).nodes.find((node) => node.id === block.id)!.properties
        .technology,
    ).toBeNull();
    expect(() => validateDocument(emptied)).not.toThrow();
  });

  it("is refused on an object that has no properties to hold it", () => {
    const document = createMixedDocument();
    expect(() =>
      applyCommand(document, {
        type: "text.commit",
        objectId: "er-event-order",
        field: "properties.responsibility",
        value: "Связь сущностей",
      }),
    ).toThrow(CommandError);
  });
});
