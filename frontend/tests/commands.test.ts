import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyCommand, CommandError } from "../src/model/commands";
import { History } from "../src/model/history";
import { validateDocument } from "../src/model/validate";
import type { CanvasDocument } from "../src/model/types";

const load = (): CanvasDocument =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../contracts/examples/canvas-document.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );

const hld = (document: CanvasDocument) => {
  const diagram = document.semantic.diagrams.find((d) => d.type === "hld");
  if (!diagram || diagram.type !== "hld") throw new Error("no HLD diagram");
  return diagram;
};
const sequence = (document: CanvasDocument) => {
  const diagram = document.semantic.diagrams.find((d) => d.type === "sequence");
  if (!diagram || diagram.type !== "sequence")
    throw new Error("no sequence diagram");
  return diagram;
};

describe("commands are pure and share structure", () => {
  test("applying a command never mutates the input document", () => {
    const document = load();
    const before = JSON.stringify(document);
    const node = hld(document).nodes[0];
    applyCommand(document, {
      type: "text.commit",
      objectId: node.id,
      field: "label",
      value: "Renamed",
    });
    expect(JSON.stringify(document)).toBe(before);
  });

  test("untouched diagrams keep their identity so renderers can skip them", () => {
    const document = load();
    const node = hld(document).nodes[0];
    const next = applyCommand(document, {
      type: "text.commit",
      objectId: node.id,
      field: "label",
      value: "Renamed",
    });
    expect(next).not.toBe(document);
    for (const diagram of document.semantic.diagrams) {
      const same = next.semantic.diagrams.find((d) => d.id === diagram.id);
      if (diagram.type === "hld") expect(same).not.toBe(diagram);
      else expect(same).toBe(diagram);
    }
    expect(next.layout).toBe(document.layout);
  });

  test("a move changes layout only and leaves semantics identical", () => {
    const document = load();
    const node = hld(document).nodes[0];
    const next = applyCommand(document, {
      type: "object.move",
      objectId: node.id,
      position: { x: 11, y: 22, width: 180, height: 90 },
    });
    expect(next.semantic).toBe(document.semantic);
    expect(next.layout.objectPositions[node.id]).toEqual({
      x: 11,
      y: 22,
      width: 180,
      height: 90,
    });
  });
});

describe("cascading delete", () => {
  test("deleting an HLD node removes its edges, annotations and layout in one command", () => {
    const document = load();
    const diagram = hld(document);
    const target = diagram.edges[0].sourceId;
    expect(
      diagram.edges.some((e) => e.sourceId === target || e.targetId === target),
    ).toBe(true);

    const next = applyCommand(document, {
      type: "object.delete",
      objectId: target,
    });
    const nextDiagram = hld(next);
    expect(nextDiagram.nodes.some((n) => n.id === target)).toBe(false);
    expect(
      nextDiagram.edges.some(
        (e) => e.sourceId === target || e.targetId === target,
      ),
    ).toBe(false);
    expect(
      next.semantic.annotations.some((a) => a.ownerObjectId === target),
    ).toBe(false);
    expect(next.layout.objectPositions[target]).toBeUndefined();
    expect(() => validateDocument(next)).not.toThrow();
  });

  test("deleting a sequence participant renumbers messages and drops orphan returns", () => {
    const document = load();
    const diagram = sequence(document);
    const target = diagram.messages[0].sourceId;
    const next = applyCommand(document, {
      type: "object.delete",
      objectId: target,
    });
    const nextDiagram = sequence(next);
    expect(nextDiagram.participants.some((p) => p.id === target)).toBe(false);
    expect(
      nextDiagram.messages.some(
        (m) => m.sourceId === target || m.targetId === target,
      ),
    ).toBe(false);
    const orders = nextDiagram.messages
      .map((m) => m.order)
      .sort((a, b) => a - b);
    expect(orders).toEqual(orders.map((_, i) => i + 1));
    expect(() => validateDocument(next)).not.toThrow();
  });

  test("deleting an ER entity removes relationships that pointed at it", () => {
    const document = load();
    const er = document.semantic.diagrams.find((d) => d.type === "er");
    if (!er || er.type !== "er") throw new Error("no ER diagram");
    const target = er.relationships[0]?.targetEntityId ?? er.entities[0].id;
    const next = applyCommand(document, {
      type: "object.delete",
      objectId: target,
    });
    const nextEr = next.semantic.diagrams.find((d) => d.id === er.id);
    if (!nextEr || nextEr.type !== "er") throw new Error("diagram lost");
    expect(nextEr.entities.some((e) => e.id === target)).toBe(false);
    expect(
      nextEr.relationships.some(
        (r) => r.sourceEntityId === target || r.targetEntityId === target,
      ),
    ).toBe(false);
    expect(() => validateDocument(next)).not.toThrow();
  });

  test("deleting an unknown id is refused instead of silently doing nothing", () => {
    expect(() =>
      applyCommand(load(), { type: "object.delete", objectId: "nope" }),
    ).toThrow(CommandError);
  });
});

describe("connect and reorder keep the document valid", () => {
  test("a new HLD edge between existing nodes is accepted", () => {
    const document = load();
    const diagram = hld(document);
    const next = applyCommand(document, {
      type: "edge.connect",
      diagramId: diagram.id,
      edgeId: "hld-edge-new",
      sourceId: diagram.nodes[0].id,
      targetId: diagram.nodes[1].id,
      label: "new link",
    });
    expect(hld(next).edges.some((e) => e.id === "hld-edge-new")).toBe(true);
    expect(() => validateDocument(next)).not.toThrow();
  });

  test("connecting to a node outside the diagram is refused", () => {
    const document = load();
    expect(() =>
      applyCommand(document, {
        type: "edge.connect",
        diagramId: hld(document).id,
        edgeId: "hld-edge-bad",
        sourceId: hld(document).nodes[0].id,
        targetId: "does-not-exist",
        label: "bad",
      }),
    ).toThrow(CommandError);
  });

  test("reorder swaps neighbours and refuses to put a return before its request", () => {
    const document = load();
    const diagram = sequence(document);
    const ordered = [...diagram.messages].sort((a, b) => a.order - b.order);
    const returnMessage = ordered.find((m) => m.kind === "return");
    if (!returnMessage) throw new Error("fixture has no return message");

    // The fixture is a single request/response pair, so a legal swap needs a
    // third message that is not tied to the return.
    const extended: CanvasDocument = {
      ...document,
      semantic: {
        ...document.semantic,
        diagrams: document.semantic.diagrams.map((d) =>
          d.id === diagram.id && d.type === "sequence"
            ? {
                ...d,
                messages: [
                  ...d.messages,
                  {
                    id: "message-audit",
                    sourceId: d.participants[0].id,
                    targetId: d.participants[1].id,
                    order: d.messages.length + 1,
                    kind: "async" as const,
                    label: "Publish audit event",
                    replyToMessageId: null,
                    originTemplateObjectId: null,
                  },
                ],
              }
            : d,
        ),
      },
    };
    expect(() => validateDocument(extended)).not.toThrow();

    const moved = applyCommand(extended, {
      type: "message.reorder",
      messageId: returnMessage.id,
      delta: 1,
    });
    expect(() => validateDocument(moved)).not.toThrow();
    const movedReturn = sequence(moved).messages.find(
      (m) => m.id === returnMessage.id,
    );
    expect(movedReturn?.order).toBe(returnMessage.order + 1);

    // Moving the return back across its own request must be refused.
    expect(() =>
      applyCommand(extended, {
        type: "message.reorder",
        messageId: returnMessage.id,
        delta: -1,
      }),
    ).toThrow(CommandError);
  });
});

describe("history is a bounded ring of immutable snapshots", () => {
  test("undo reverses a cascading delete in a single step", () => {
    const document = load();
    const history = new History(document);
    const target = hld(document).edges[0].sourceId;
    history.commit(
      applyCommand(history.current, {
        type: "object.delete",
        objectId: target,
      }),
    );
    expect(hld(history.current).nodes.some((n) => n.id === target)).toBe(false);

    expect(history.canUndo).toBe(true);
    history.undo();
    expect(history.current).toBe(document);
    expect(hld(history.current).nodes.some((n) => n.id === target)).toBe(true);

    history.redo();
    expect(hld(history.current).nodes.some((n) => n.id === target)).toBe(false);
  });

  test("a new command after undo drops the redo tail", () => {
    const document = load();
    const history = new History(document);
    const node = hld(document).nodes[0];
    history.commit(
      applyCommand(history.current, {
        type: "text.commit",
        objectId: node.id,
        field: "label",
        value: "one",
      }),
    );
    history.undo();
    expect(history.canRedo).toBe(true);
    history.commit(
      applyCommand(history.current, {
        type: "text.commit",
        objectId: node.id,
        field: "label",
        value: "two",
      }),
    );
    expect(history.canRedo).toBe(false);
    expect(hld(history.current).nodes[0].label).toBe("two");
  });

  test("the ring keeps a bounded number of steps and never blocks new edits", () => {
    const document = load();
    const history = new History(document, 5);
    const node = hld(document).nodes[0];
    for (let i = 0; i < 20; i++)
      history.commit(
        applyCommand(history.current, {
          type: "text.commit",
          objectId: node.id,
          field: "label",
          value: `value-${i}`,
        }),
      );
    expect(history.size).toBeLessThanOrEqual(6);
    let undone = 0;
    while (history.canUndo) {
      history.undo();
      undone++;
    }
    expect(undone).toBe(5);
    expect(hld(history.current).nodes[0].label).toBe("value-14");
  });
});
