/**
 * The task on the canvas: where its three panels stand, and what editing them
 * does to the document.
 *
 * The panels are layout; what is written in them is the task itself, which the
 * evaluation reads. Both halves are checked, and every edit is also checked to
 * leave a document the server would accept.
 */
import { describe, expect, it } from "vitest";
import {
  CONTEXT_SECTIONS,
  MAX_ACCEPTANCE_CRITERIA,
  PANEL_GAP,
  defaultPanelRects,
  panelRectOf,
  parameterValue,
  sectionOfPanel,
  panelId,
} from "../src/editor/contextPanels";
import { EditorStore } from "../src/editor/EditorStore";
import { createMixedDocument } from "../src/model/fixtures";
import { validateDocument } from "../src/model/validate";
import type { CanvasDocument } from "../src/model/types";

describe("where the task panels stand", () => {
  it("stands in one column left of every diagram, top to bottom in order", () => {
    const document = createMixedDocument();
    const rects = defaultPanelRects(document);
    const leftmost = Math.min(
      ...Object.values(document.layout.diagramFrames).map((frame) => frame.x),
    );
    const ordered = CONTEXT_SECTIONS.map((section) => rects[section.id]);
    expect(ordered.map((rect) => rect.x)).toEqual([
      ordered[0].x,
      ordered[0].x,
      ordered[0].x,
    ]);
    expect(ordered[0].x + ordered[0].width + PANEL_GAP).toBeLessThanOrEqual(
      leftmost,
    );
    for (let i = 1; i < ordered.length; i++)
      expect(ordered[i].y).toBeGreaterThanOrEqual(
        ordered[i - 1].y + ordered[i - 1].height,
      );
  });

  it("grows with the items it holds", () => {
    const document = createMixedDocument();
    const before = defaultPanelRects(document).requirements.height;
    const store = new EditorStore(document);
    for (let i = 0; i < 6; i++) store.addContextItem("requirements");
    expect(
      defaultPanelRects(store.getSnapshot()).requirements.height,
    ).toBeGreaterThan(before);
  });

  it("stays where the author moved it", () => {
    const store = new EditorStore(createMixedDocument());
    const moved = { x: -900, y: 40, width: 300, height: 220 };
    const semantic = store.getSnapshot().semantic;
    store.moveContextPanel("criteria", moved);
    const document = store.getSnapshot();
    expect(panelRectOf(document, "criteria")).toEqual(moved);
    // Only the panel that moved is fixed; the others keep their defaults.
    expect(document.layout.contextPanels).toEqual({ criteria: moved });
    expect(document.semantic).toBe(semantic);
    expect(() => validateDocument(document)).not.toThrow();
  });

  it("names its nodes so the canvas can tell a panel from an object", () => {
    for (const section of CONTEXT_SECTIONS)
      expect(sectionOfPanel(panelId(section.id))).toBe(section.id);
    expect(sectionOfPanel("hld-orders")).toBeNull();
  });

  it("is refused for a panel that does not exist", () => {
    const document = createMixedDocument();
    const broken = {
      ...document,
      layout: {
        ...document.layout,
        contextPanels: { sidebar: { x: 0, y: 0, width: 10, height: 10 } },
      },
    } as unknown as CanvasDocument;
    expect(() => validateDocument(broken)).toThrow();
  });
});

describe("editing the task in place", () => {
  it("adds an item of each kind that is valid as it stands", () => {
    const store = new EditorStore(createMixedDocument());
    for (const kind of [
      "assumptions",
      "constraints",
      "requirements",
      "technicalParameters",
      "acceptanceCriteria",
    ] as const) {
      const before = store.getSnapshot().semantic.context[kind].length;
      const id = store.addContextItem(kind);
      const items = store.getSnapshot().semantic.context[kind];
      expect(items).toHaveLength(before + 1);
      expect(items.at(-1)!.id).toBe(id);
    }
    expect(() => validateDocument(store.getSnapshot())).not.toThrow();
  });

  it("writes the text of an item, and a criterion's condition", () => {
    const store = new EditorStore(createMixedDocument());
    const requirement = store.addContextItem("requirements");
    const criterion = store.addContextItem("acceptanceCriteria");
    store.commit([
      { objectId: requirement, field: "text", value: "Платёж проходит за 2 с" },
      {
        objectId: criterion,
        field: "condition.statement",
        value: "Повтор не создаёт второй платёж",
      },
    ]);
    const context = store.getSnapshot().semantic.context;
    expect(context.requirements.at(-1)!.text).toBe("Платёж проходит за 2 с");
    expect(context.acceptanceCriteria.at(-1)!.condition).toEqual({
      kind: "boolean",
      statement: "Повтор не создаёт второй платёж",
      expected: null,
    });
    expect(() => validateDocument(store.getSnapshot())).not.toThrow();
  });

  it("reads a key figure's value as a number when it is one", () => {
    expect(parameterValue("400")).toBe(400);
    expect(parameterValue("2,5")).toBe(2.5);
    expect(parameterValue("около тысячи")).toBe("около тысячи");
    expect(parameterValue("  ")).toBeNull();

    const store = new EditorStore(createMixedDocument());
    const parameter = store.addContextItem("technicalParameters");
    store.commit([{ objectId: parameter, field: "value", value: "5000" }]);
    expect(
      store.getSnapshot().semantic.context.technicalParameters.at(-1)!.value,
    ).toBe(5000);
    expect(() => validateDocument(store.getSnapshot())).not.toThrow();
  });

  it("takes a removed requirement out of the criteria that checked it", () => {
    const document = createMixedDocument();
    document.semantic.context.requirements.push({
      id: "req-latency",
      text: "Ответ за 500 мс",
      kind: "nonfunctional",
      priority: "must",
      diagramIds: [],
      originTemplateObjectId: null,
    });
    document.semantic.context.acceptanceCriteria.push({
      id: "accept-latency",
      text: "p95 не больше 500 мс",
      requirementRefs: ["req-latency"],
      priority: "must",
      condition: { kind: "boolean", statement: "", expected: null },
      verificationMethod: "",
      diagramIds: [],
      originTemplateObjectId: null,
    });
    const store = new EditorStore(document);
    store.removeContextItem("req-latency");
    const context = store.getSnapshot().semantic.context;
    expect(context.requirements.some((r) => r.id === "req-latency")).toBe(
      false,
    );
    expect(
      context.acceptanceCriteria.find((c) => c.id === "accept-latency")!
        .requirementRefs,
    ).toEqual([]);
    expect(() => validateDocument(store.getSnapshot())).not.toThrow();
  });

  it("knows the evaluation's limit on criteria", () => {
    expect(MAX_ACCEPTANCE_CRITERIA).toBe(8);
  });
});
