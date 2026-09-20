/**
 * How one object's text is set, and a one-way connection turned round.
 *
 * Text style is layout, so the tests also stand as the statement that setting
 * it changes nothing the design says. Reversing a connection is the opposite
 * case -- it is design -- and the test for it checks that the line stays where
 * it was drawn while only its direction changes.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_STYLE,
  SCALE_STEPS,
  canScale,
  nextEmphasis,
  nextFont,
  nextScale,
  textStyleOf,
  textStyleProperties,
} from "../src/editor/textStyle";
import { EditorStore } from "../src/editor/EditorStore";
import { portOfEdge } from "../src/editor/ports";
import { createMixedDocument } from "../src/model/fixtures";
import { validateDocument } from "../src/model/validate";

const firstHld = (store: EditorStore) => {
  const diagram = store
    .getSnapshot()
    .semantic.diagrams.find((d) => d.type === "hld");
  if (diagram?.type !== "hld") throw new Error("expected an HLD diagram");
  return diagram;
};

describe("stepping through text styles", () => {
  it("steps size up and down and stops at either end", () => {
    expect(nextScale(1, 1)).toBe(1.15);
    expect(nextScale(1, -1)).toBe(0.85);
    const largest = SCALE_STEPS[SCALE_STEPS.length - 1];
    expect(nextScale(largest, 1)).toBe(largest);
    expect(canScale(largest, 1)).toBe(false);
    expect(canScale(SCALE_STEPS[0], -1)).toBe(false);
  });

  it("snaps an odd stored size onto the nearest step before moving", () => {
    expect(nextScale(1.07, 1)).toBe(1.15);
  });

  it("goes round regular, bold, italic and back", () => {
    expect(nextEmphasis("normal")).toBe("bold");
    expect(nextEmphasis("bold")).toBe("italic");
    expect(nextEmphasis("italic")).toBe("normal");
  });

  it("goes round the four typefaces and back", () => {
    let font = DEFAULT_TEXT_STYLE.font;
    const seen = [font];
    for (let i = 0; i < 4; i++) seen.push((font = nextFont(font)));
    expect(seen).toEqual(["sans", "serif", "mono", "hand", "sans"]);
  });

  it("sets nothing on an object nobody styled, and never `inherit`", () => {
    expect(textStyleProperties(DEFAULT_TEXT_STYLE)).toEqual({});
    const larger = textStyleProperties({ ...DEFAULT_TEXT_STYLE, scale: 1.3 });
    expect(larger).toEqual({ "--text-scale": "1.3" });
    const serif = textStyleProperties({ ...DEFAULT_TEXT_STYLE, font: "serif" });
    expect(String((serif as Record<string, string>)["--text-family"])).toMatch(
      /serif/,
    );
  });
});

describe("text style in the document", () => {
  it("is set per object, is layout, and keeps the document valid", () => {
    const store = new EditorStore(createMixedDocument());
    const before = store.getSnapshot().semantic;
    const diagram = firstHld(store);
    const block = diagram.nodes[0].id;
    const other = diagram.nodes[1].id;
    const edge = diagram.edges[0].id;
    const note = store.getSnapshot().semantic.notes[0]?.id;

    store.resizeText(block, 1);
    store.cycleTextEmphasis(block);
    store.cycleTextFont(edge);
    if (note) store.resizeText(note, -1);

    const layout = store.getSnapshot().layout;
    expect(textStyleOf(layout, block)).toEqual({
      scale: 1.15,
      emphasis: "bold",
      font: "sans",
    });
    expect(textStyleOf(layout, edge).font).toBe("serif");
    // Only the objects that were set carry a style.
    expect(textStyleOf(layout, other)).toBe(DEFAULT_TEXT_STYLE);
    expect(store.getSnapshot().semantic).toBe(before);
    expect(() => validateDocument(store.getSnapshot())).not.toThrow();
  });

  it("records nothing when the size is already at its limit", () => {
    const store = new EditorStore(createMixedDocument());
    const block = firstHld(store).nodes[0].id;
    for (let i = 0; i < SCALE_STEPS.length + 2; i++) store.resizeText(block, 1);
    const top = store.getSnapshot();
    store.resizeText(block, 1);
    expect(store.getSnapshot()).toBe(top);
  });

  it("goes with its object, and with everything a deleted block takes along", () => {
    const store = new EditorStore(createMixedDocument());
    const diagram = firstHld(store);
    const edge = diagram.edges[0];
    store.cycleTextEmphasis(edge.sourceId);
    store.cycleTextEmphasis(edge.id);
    store.deleteObject(edge.sourceId);
    const styles = store.getSnapshot().layout.textStyles ?? {};
    expect(styles).not.toHaveProperty(edge.sourceId);
    expect(styles).not.toHaveProperty(edge.id);
    expect(() => validateDocument(store.getSnapshot())).not.toThrow();
  });

  it("is refused when it belongs to nothing", () => {
    const document = createMixedDocument();
    expect(() =>
      validateDocument({
        ...document,
        layout: {
          ...document.layout,
          textStyles: { "block-nobody": { ...DEFAULT_TEXT_STYLE } },
        },
      }),
    ).toThrow();
  });
});

describe("turning a one-way connection round", () => {
  it("swaps its ends and keeps it drawn between the same two ports", () => {
    const store = new EditorStore(createMixedDocument());
    const edge = firstHld(store).edges[0];
    const layout = store.getSnapshot().layout;
    const sourcePort = portOfEdge(
      layout,
      edge.id,
      edge.sourceId,
      "source",
      "hld",
    );
    const targetPort = portOfEdge(
      layout,
      edge.id,
      edge.targetId,
      "target",
      "hld",
    );

    store.reverseConnection(edge.id);

    const turned = firstHld(store).edges.find((e) => e.id === edge.id)!;
    expect(turned.sourceId).toBe(edge.targetId);
    expect(turned.targetId).toBe(edge.sourceId);
    const after = store.getSnapshot().layout;
    // The block that was the target now starts the line, from the same port.
    expect(portOfEdge(after, edge.id, turned.sourceId, "source", "hld")).toBe(
      targetPort,
    );
    expect(portOfEdge(after, edge.id, turned.targetId, "target", "hld")).toBe(
      sourcePort,
    );
    expect(() => validateDocument(store.getSnapshot())).not.toThrow();
  });

  it("is one undo step, and twice is where it started", () => {
    const store = new EditorStore(createMixedDocument());
    const edge = firstHld(store).edges[0];
    store.reverseConnection(edge.id);
    store.undo();
    expect(firstHld(store).edges.find((e) => e.id === edge.id)).toEqual(edge);
    store.reverseConnection(edge.id);
    store.reverseConnection(edge.id);
    const back = firstHld(store).edges.find((e) => e.id === edge.id)!;
    expect([back.sourceId, back.targetId]).toEqual([
      edge.sourceId,
      edge.targetId,
    ]);
  });
});

describe("text style on relationship and message labels", () => {
  it("belongs to a relationship or a message like any other object", () => {
    const store = new EditorStore(createMixedDocument());
    store.cycleTextEmphasis("er-event-order");
    store.resizeText("message-webhook", 1);
    const layout = store.getSnapshot().layout;
    expect(textStyleOf(layout, "er-event-order").emphasis).toBe("bold");
    expect(textStyleOf(layout, "message-webhook").scale).toBe(1.15);
    expect(() => validateDocument(store.getSnapshot())).not.toThrow();

    // A deleted message takes its style along, and the reply that answered it.
    store.deleteObject("message-webhook");
    const styles = store.getSnapshot().layout.textStyles ?? {};
    expect(styles).not.toHaveProperty("message-webhook");
    expect(styles).toHaveProperty("er-event-order");
    expect(() => validateDocument(store.getSnapshot())).not.toThrow();
  });
});
