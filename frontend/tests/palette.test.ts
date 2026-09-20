/**
 * Every palette preset must produce a block the contract accepts.
 *
 * The palette is the one place in the editor that invents objects out of
 * nothing, so a mistake here -- a kind that is not in the enum, a missing
 * required property -- reaches the document before any validator does. Building
 * one of everything and validating the result costs nothing and catches all of
 * that at once.
 */
import { describe, expect, it } from "vitest";
import { PRESETS, presetById, presetsOf } from "../src/editor/palette";
import { validateDocument } from "../src/model/validate";
import type { CanvasDocument, Entity, HldNode, Participant } from "../src/model/types";

function documentWithEveryPreset(ru: boolean): CanvasDocument {
  const positions: CanvasDocument["layout"]["objectPositions"] = {};
  const build = (branch: "hld" | "er" | "sequence") =>
    presetsOf(branch).map((preset, index) => {
      const block = preset.create(`${preset.id}-block`, ru);
      positions[block.id] = {
        x: 40 + index * 40,
        y: 40,
        width: preset.size.width,
        height: preset.size.height,
      };
      return block;
    });

  return {
    schemaVersion: 1,
    semantic: {
      domainId: "custom",
      templateProvenance: null,
      rubricVersion: "custom:1",
      context: {
        requirements: [],
        acceptanceCriteria: [],
        technicalParameters: [],
        assumptions: [],
        constraints: [],
      },
      diagrams: [
        {
          id: "diagram-hld",
          type: "hld",
          title: "Компоненты",
          nodes: build("hld") as HldNode[],
          edges: [],
          originTemplateObjectId: null,
        },
        {
          id: "diagram-er",
          type: "er",
          title: "Данные",
          entities: build("er") as Entity[],
          relationships: [],
          originTemplateObjectId: null,
        },
        {
          id: "diagram-sequence",
          type: "sequence",
          title: "Сценарий",
          participants: build("sequence") as Participant[],
          messages: [],
          originTemplateObjectId: null,
        },
      ],
      annotations: [],
      notes: [],
    },
    layout: {
      objectPositions: positions,
      annotationOffsets: {},
      diagramFrames: {
        "diagram-hld": { x: 0, y: 0, width: 900, height: 500 },
        "diagram-er": { x: 0, y: 520, width: 900, height: 400 },
        "diagram-sequence": { x: 0, y: 940, width: 900, height: 300 },
      },
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  } as CanvasDocument;
}

describe("the palette", () => {
  it("offers more than one block for each of the three branches", () => {
    for (const branch of ["hld", "er", "sequence"] as const) {
      expect(presetsOf(branch).length).toBeGreaterThan(1);
    }
  });

  it("builds a canvas the contract accepts, in either language", () => {
    expect(() => validateDocument(documentWithEveryPreset(true))).not.toThrow();
    expect(() => validateDocument(documentWithEveryPreset(false))).not.toThrow();
  });

  it("gives every preset its own id and short name prefix", () => {
    const ids = PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of PRESETS) {
      // The prefix is what a block's short name will be built from: qu0001.
      expect(preset.prefix).toMatch(/^[a-z]{2,3}$/);
      expect(preset.icon).not.toBe("");
    }
  });

  it("names the presets the sidebar and the specs rely on", () => {
    expect(presetById("hld-service").names.ru).toBe("Сервис");
    expect(presetById("hld-queue").prefix).toBe("qu");
    expect(presetById("hld-gateway").prefix).toBe("gw");
    expect(presetById("hld-balancer").prefix).toBe("lb");
    expect(() => presetById("nothing-like-this")).toThrow();
  });
});
