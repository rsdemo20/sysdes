/**
 * The status line's wording, checked without a browser.
 *
 * The canvas reports an id and nothing else, so everything a reader sees at the
 * top of the screen is decided here: what kind of object it is, what it is
 * called and which diagram it belongs to.
 */
import { describe, expect, it } from "vitest";
import { createMixedDocument } from "../src/model/fixtures";
import { describeObject, statusLine } from "../src/editor/hoverStatus";
import type { CanvasDocument } from "../src/model/types";

const document: CanvasDocument = createMixedDocument();

function firstOf(type: "hld" | "er" | "sequence"): string {
  const diagram = document.semantic.diagrams.find((d) => d.type === type)!;
  if (diagram.type === "hld") return diagram.nodes[0].id;
  if (diagram.type === "er") return diagram.entities[0].id;
  return diagram.participants[0].id;
}

describe("the object under the cursor", () => {
  it("names an HLD block by its kind, its label and its diagram", () => {
    const status = describeObject(document, firstOf("hld"), "ru");
    expect(status).not.toBeNull();
    expect(status!.diagram).toBeTruthy();
    expect(statusLine(status!)).toBe(
      `${status!.kind} · ${status!.label} · ${status!.diagram}`,
    );
  });

  it("distinguishes an entity from a participant", () => {
    const entity = describeObject(document, firstOf("er"), "ru")!;
    const participant = describeObject(document, firstOf("sequence"), "ru")!;
    expect(entity.kind).toBe("Сущность");
    expect(participant.kind).toBe("Участник");
  });

  it("answers in the locale it is asked in", () => {
    const id = firstOf("er");
    expect(describeObject(document, id, "en")!.kind).toBe("Entity");
  });

  it("describes a free note by its own text, since it has no label", () => {
    const note = {
      id: "note-status",
      text: "  Черновик\nо порядке обхода  ",
      diagramIds: [],
      originTemplateObjectId: null,
    };
    const withNote: CanvasDocument = {
      ...document,
      semantic: { ...document.semantic, notes: [note] },
    };
    const status = describeObject(withNote, "note-status", "ru")!;
    expect(status.label).toBe("Черновик о порядке обхода");
    expect(status.diagram).toBeNull();
  });

  it("keeps the line to one line", () => {
    const note = {
      id: "note-long",
      text: "я".repeat(300),
      diagramIds: [],
      originTemplateObjectId: null,
    };
    const withNote: CanvasDocument = {
      ...document,
      semantic: { ...document.semantic, notes: [note] },
    };
    const status = describeObject(withNote, "note-long", "ru")!;
    expect(status.label).toHaveLength(80);
    expect(status.label.endsWith("…")).toBe(true);
  });

  it("says nothing about an id that is not on the canvas", () => {
    expect(describeObject(document, "hld-nowhere", "ru")).toBeNull();
  });
});
