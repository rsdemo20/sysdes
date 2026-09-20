import { expect, it } from "vitest";
import { EditorStore } from "../src/editor/EditorStore";
import { createMixedDocument } from "../src/model/fixtures";
it("does not reorder a return before its request", () => {
  const s = new EditorStore(createMixedDocument());
  s.reorderMessage("message-response", -1);
  const seq = s
    .getSnapshot()
    .semantic.diagrams.find((d) => d.type === "sequence");
  expect(
    seq?.type === "sequence" &&
      seq.messages.find((m) => m.id === "message-response")?.order,
  ).toBe(2);
});
it("validates all drafts before a custom commit", async () => {
  const s = new EditorStore(createMixedDocument());
  let changes = 0;
  s.register("name", {
    read: () => ({ objectId: "name", field: "label", value: "new" }),
    wait: async () => {},
    isComposing: () => false,
    apply: () => {
      changes++;
    },
    acknowledge: () => {},
  });
  s.register("bad", {
    read: () => {
      throw new Error("invalid");
    },
    wait: async () => {},
    isComposing: () => false,
    acknowledge: () => {},
  });
  await expect(s.flush()).rejects.toThrow("invalid");
  expect(changes).toBe(0);
});
