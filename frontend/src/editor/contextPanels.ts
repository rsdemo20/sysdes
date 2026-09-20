/**
 * The task, set on the canvas in three panels of its own.
 *
 * The statement used to sit in the sidebar as three read-only lists, away from
 * the drawing it is the brief for. It now lives on the canvas beside the
 * diagrams, in three panels an author can move, size and edit but not delete:
 * a canvas without its task is not a lighter canvas, it is a different exercise.
 *
 * The panels show the task as it is stored -- structured items, not a block of
 * prose. A requirement is referred to by the criteria that check it, a key
 * figure has a value and a unit, a criterion carries its scenario, and the
 * evaluation reads all of it. Flattening that into text would lose exactly what
 * the model is scored against, so each item stays an item and is edited in
 * place.
 *
 * What goes where:
 *   scope         assumptions and constraints -- what is given, what is out
 *   requirements  requirements
 *   criteria      key figures and acceptance criteria
 *
 * Where a panel sits is layout (`layout.contextPanels`). Until an author moves
 * one, the three stand in a column to the left of the leftmost diagram, top to
 * bottom in that order, each as tall as its items need -- so a canvas opened to
 * fit shows the task down its left side and the diagrams to the right of it.
 */
import type { CanvasContext, CanvasDocument, Position } from "../model/types";

export type ContextSectionId = "scope" | "requirements" | "criteria";
export type ContextItemKind = keyof CanvasContext;

export interface ContextPanelModel {
  id: string;
  section: ContextSectionId;
  context: CanvasContext;
}

export const CONTEXT_SECTIONS: Array<{
  id: ContextSectionId;
  names: { ru: string; en: string };
  kinds: ContextItemKind[];
}> = [
  {
    id: "scope",
    names: {
      ru: "Задание и границы системы",
      en: "Task and system boundaries",
    },
    kinds: ["assumptions", "constraints"],
  },
  {
    id: "requirements",
    names: { ru: "Требования", en: "Requirements" },
    kinds: ["requirements"],
  },
  {
    id: "criteria",
    names: {
      ru: "Ключевые метрики и критерии приёмки",
      en: "Key metrics and acceptance criteria",
    },
    kinds: ["technicalParameters", "acceptanceCriteria"],
  },
];

type Names = { group: string; one: string; add: string };

export const KIND_NAMES: Record<ContextItemKind, { ru: Names; en: Names }> = {
  assumptions: {
    ru: { group: "Допущения", one: "Допущение", add: "+ допущение" },
    en: { group: "Assumptions", one: "Assumption", add: "+ assumption" },
  },
  constraints: {
    ru: { group: "Ограничения", one: "Ограничение", add: "+ ограничение" },
    en: { group: "Constraints", one: "Constraint", add: "+ constraint" },
  },
  requirements: {
    ru: { group: "Требования", one: "Требование", add: "+ требование" },
    en: { group: "Requirements", one: "Requirement", add: "+ requirement" },
  },
  technicalParameters: {
    ru: { group: "Ключевые метрики", one: "Метрика", add: "+ метрика" },
    en: { group: "Key metrics", one: "Metric", add: "+ metric" },
  },
  acceptanceCriteria: {
    ru: { group: "Критерии приёмки", one: "Критерий", add: "+ критерий" },
    en: { group: "Acceptance criteria", one: "Criterion", add: "+ criterion" },
  },
};

/**
 * The most acceptance criteria one evaluation takes.
 *
 * The same limit the server applies when it builds a run; stopping the author
 * at the ninth criterion here is kinder than refusing their evaluation later.
 */
export const MAX_ACCEPTANCE_CRITERIA = 8;

export const PANEL_WIDTH = 340;
/** Space between two panels, and between the column and the diagrams. */
export const PANEL_GAP = 24;

const HEADER = 40;
const GROUP_TITLE = 22;
const ADD_BUTTON = 30;
const LINE = 16;
const ITEM_PAD = 10;
const COLUMNS = 44;
const MIN_HEIGHT = 140;
const MAX_HEIGHT = 640;

export function panelId(section: ContextSectionId): string {
  return `context-${section}`;
}

export function sectionOfPanel(id: string): ContextSectionId | null {
  const found = CONTEXT_SECTIONS.find((section) => panelId(section.id) === id);
  return found ? found.id : null;
}

function rows(text: string): number {
  return text
    .split("\n")
    .reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / COLUMNS)),
      0,
    );
}

/** How tall a panel needs to be to show its items without scrolling. */
export function estimatePanelHeight(
  context: CanvasContext,
  section: ContextSectionId,
): number {
  const definition = CONTEXT_SECTIONS.find((s) => s.id === section)!;
  let height = HEADER;
  for (const kind of definition.kinds) {
    if (definition.kinds.length > 1) height += GROUP_TITLE;
    for (const item of context[kind] as unknown as Array<
      Record<string, unknown>
    >) {
      const text =
        kind === "technicalParameters" ? item.name : (item.text as unknown);
      height += LINE * rows(String(text ?? "")) + ITEM_PAD;
      if (kind === "acceptanceCriteria") {
        const condition = item.condition as Record<string, unknown> | undefined;
        if (condition?.kind === "scenario") height += 3 * (LINE + 4);
        else if (condition) height += LINE + 4;
      }
    }
    height += ADD_BUTTON;
  }
  return Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)));
}

/**
 * Where the three panels stand when nobody has moved them: a column to the
 * left of the leftmost diagram, starting level with the topmost one.
 */
export function defaultPanelRects(
  document: CanvasDocument,
): Record<ContextSectionId, Position> {
  const frames = Object.values(document.layout.diagramFrames);
  const left = frames.length ? Math.min(...frames.map((frame) => frame.x)) : 0;
  const top = frames.length ? Math.min(...frames.map((frame) => frame.y)) : 0;
  const x = left - 2 * PANEL_GAP - PANEL_WIDTH;
  let y = top;
  const rects = {} as Record<ContextSectionId, Position>;
  for (const section of CONTEXT_SECTIONS) {
    const height = estimatePanelHeight(document.semantic.context, section.id);
    rects[section.id] = { x, y, width: PANEL_WIDTH, height };
    y += height + PANEL_GAP;
  }
  return rects;
}

export function panelRectOf(
  document: CanvasDocument,
  section: ContextSectionId,
): Position {
  return (
    document.layout.contextPanels?.[section] ??
    defaultPanelRects(document)[section]
  );
}

/**
 * An empty item of a kind, valid as it stands.
 *
 * A new criterion is a plain yes-or-no condition with nothing filled in: the
 * schema requires some condition, and that one assumes least about what the
 * author is about to write.
 */
export function newContextItem(
  kind: ContextItemKind,
): CanvasContext[ContextItemKind][number] {
  const uuid = crypto.randomUUID();
  const base = { diagramIds: [] as string[], originTemplateObjectId: null };
  switch (kind) {
    case "requirements":
      return {
        ...base,
        id: `req-${uuid}`,
        text: "",
        kind: "functional",
        priority: "must",
      };
    case "acceptanceCriteria":
      return {
        ...base,
        id: `accept-${uuid}`,
        text: "",
        requirementRefs: [],
        priority: "must",
        condition: { kind: "boolean", statement: "", expected: null },
        verificationMethod: "",
      };
    case "technicalParameters":
      return {
        ...base,
        id: `param-${uuid}`,
        name: "",
        value: null,
        unit: "",
        basis: "",
        status: "assumption",
      };
    case "assumptions":
      return { ...base, id: `assumption-${uuid}`, text: "" };
    case "constraints":
      return { ...base, id: `constraint-${uuid}`, text: "" };
  }
}

/**
 * The value an author typed for a key figure.
 *
 * A number when it reads as one -- a decimal comma included, since that is how
 * the figure is written in Russian -- the text itself when it does not ("about
 * a thousand" is a real estimate), and nothing when the field was emptied.
 */
export function parameterValue(typed: string): number | string | null {
  const trimmed = typed.trim();
  if (trimmed === "") return null;
  const normalised = trimmed.replace(",", ".");
  if (/^-?\d+(\.\d+)?$/.test(normalised)) {
    const value = Number(normalised);
    if (Math.abs(value) <= 1e15) return value;
  }
  return typed;
}
