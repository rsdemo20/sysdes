/**
 * Which viewport moves count as edits.
 *
 * A canvas that opened dirty refused every plain switch to another canvas: it
 * asked what to do with changes the user never made. The cause was the
 * placement a canvas gets as it opens, reported back like a pan and recorded as
 * one. These pin the distinction at the store, where it is decided.
 */
import { describe, expect, test } from "vitest";
import { EditorStore } from "../src/editor/EditorStore";
import { createMixedDocument } from "../src/model/fixtures";

function watched() {
  const store = new EditorStore(createMixedDocument());
  let edits = 0;
  store.onEdit = () => {
    edits += 1;
  };
  return { store, edits: () => edits };
}

describe("viewport moves", () => {
  test("a move the application makes is not an edit", () => {
    const { store, edits } = watched();
    store.setViewport({ x: -40, y: -10, zoom: 0.8 }, false);
    expect(edits()).toBe(0);
  });

  test("it still updates the document, so later blocks see the real zoom", () => {
    const { store } = watched();
    store.setViewport({ x: -40, y: -10, zoom: 0.8 }, false);
    expect(store.getSnapshot().layout.viewport.zoom).toBe(0.8);
  });

  test("a move the user makes is an edit, as before", () => {
    const { store, edits } = watched();
    store.setViewport({ x: 120, y: 30, zoom: 1.2 });
    expect(edits()).toBe(1);
  });

  test("neither kind becomes a step in the undo history", () => {
    const { store } = watched();
    store.setViewport({ x: -40, y: -10, zoom: 0.8 }, false);
    store.setViewport({ x: 120, y: 30, zoom: 1.2 });
    expect(store.canUndo).toBe(false);
  });
});
