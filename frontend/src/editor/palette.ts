/**
 * The blocks the palette can put on the canvas.
 *
 * One rectangle was not enough: a design is read by the shape of its parts, and
 * a gateway, a queue and a datastore are different parts. The contract keeps a
 * small closed set of HLD kinds on purpose, so a preset is a kind plus the
 * wording and the properties that make it recognisable -- a gateway is a
 * service, and saying so in its technology is what tells a reader which service
 * it is.
 *
 * `prefix` is the short name a block of this preset will carry (qu0001, gw0002).
 * It lives here because the palette is where a block learns what it is.
 */
import type { Entity, HldNode, Participant } from "../model/types";

export type Branch = "hld" | "er" | "sequence";

export interface BlockPreset {
  id: string;
  branch: Branch;
  /** One glyph, shown in the palette grid. */
  icon: string;
  /** Short name prefix: qu, gw, lb and so on. */
  prefix: string;
  names: { ru: string; en: string };
  /** Default size on the canvas, in canvas units. */
  size: { width: number; height: number };
  create: (id: string, ru: boolean) => HldNode | Entity | Participant;
}

function hld(
  id: string,
  icon: string,
  prefix: string,
  ru: string,
  en: string,
  kind: HldNode["kind"],
  properties: HldNode["properties"] = {},
): BlockPreset {
  // A cylinder gives up part of its box to the rim it is drawn with, so those
  // two start taller and wider than a plain box would.
  const cylinder =
    kind === "datastore"
      ? { width: 226, height: 138 }
      : kind === "queue"
        ? { width: 252, height: 116 }
        : { width: 220, height: 112 };
  return {
    id,
    branch: "hld",
    icon,
    prefix,
    names: { ru, en },
    size: cylinder,
    create: (nodeId, isRu) => ({
      id: nodeId,
      label: isRu ? ru : en,
      kind,
      properties: { responsibility: "", technology: null, ...properties },
      originTemplateObjectId: null,
    }),
  };
}

function entity(
  id: string,
  icon: string,
  prefix: string,
  ru: string,
  en: string,
  storageNotes: { ru: string; en: string },
): BlockPreset {
  return {
    id,
    branch: "er",
    icon,
    prefix,
    names: { ru, en },
    size: { width: 245, height: 150 },
    create: (entityId, isRu) => ({
      id: entityId,
      label: isRu ? ru : en,
      fields: [
        {
          id: `${entityId}-id`,
          name: "id",
          dataType: "uuid",
          nullable: false,
          originTemplateObjectId: null,
        },
      ],
      primaryKeyFieldIds: [`${entityId}-id`],
      uniqueConstraints: [],
      indexes: [],
      storageNotes: isRu ? storageNotes.ru : storageNotes.en,
      originTemplateObjectId: null,
    }),
  };
}

function participant(
  id: string,
  icon: string,
  prefix: string,
  ru: string,
  en: string,
  role: Participant["role"],
): BlockPreset {
  return {
    id,
    branch: "sequence",
    icon,
    prefix,
    names: { ru, en },
    size: { width: 210, height: 82 },
    create: (participantId, isRu) => ({
      id: participantId,
      label: isRu ? ru : en,
      role,
      representedObjectId: null,
      originTemplateObjectId: null,
    }),
  };
}

export const PRESETS: BlockPreset[] = [
  hld("hld-service", "⬡", "svc", "Сервис", "Service", "service"),
  hld("hld-gateway", "⇥", "gw", "Gateway", "Gateway", "service", {
    technology: "API gateway",
  }),
  hld("hld-balancer", "⚖", "lb", "Балансировщик", "Load balancer", "service", {
    technology: "load balancer",
  }),
  hld("hld-queue", "☰", "qu", "Очередь", "Queue", "queue"),
  hld("hld-datastore", "⛁", "db", "Хранилище", "Datastore", "datastore", {
    storageRole: "primary",
  }),
  hld("hld-cache", "⚡", "ca", "Кэш", "Cache", "datastore", {
    storageRole: "cache",
  }),
  hld("hld-actor", "◍", "ac", "Актор", "Actor", "actor"),
  hld("hld-external", "☁", "ex", "Внешняя система", "External system",
      "external_system"),
  hld("hld-boundary", "⬚", "bd", "Граница", "Boundary", "boundary"),

  entity("er-entity", "▤", "en", "Сущность", "Entity", { ru: "", en: "" }),
  entity("er-reference", "▥", "rf", "Справочник", "Reference", {
    ru: "Справочник: меняется редко, читается часто.",
    en: "Reference data: rarely written, often read.",
  }),
  entity("er-link", "⧉", "lk", "Связующая", "Link table", {
    ru: "Связующая таблица: ключ из двух внешних.",
    en: "Link table: its key is two foreign keys.",
  }),

  participant("seq-system", "⇄", "pt", "Система", "System", "system"),
  participant("seq-actor", "◍", "pa", "Актор", "Actor", "actor"),
  participant("seq-external", "☁", "px", "Внешний сервис", "External service",
              "system"),
];

export const BRANCHES: Array<{
  id: Branch;
  names: { ru: string; en: string };
  hints: { ru: string; en: string };
}> = [
  {
    id: "hld",
    names: { ru: "HLD", en: "HLD" },
    hints: { ru: "Компоненты системы", en: "System components" },
  },
  {
    id: "er",
    names: { ru: "ER", en: "ER" },
    hints: { ru: "Сущности и поля", en: "Entities and fields" },
  },
  {
    id: "sequence",
    names: { ru: "Sequence", en: "Sequence" },
    hints: { ru: "Участники сценария", en: "Scenario participants" },
  },
];

export function presetsOf(branch: Branch): BlockPreset[] {
  return PRESETS.filter((preset) => preset.branch === branch);
}

export function presetById(id: string): BlockPreset {
  const found = PRESETS.find((preset) => preset.id === id);
  if (!found) throw new Error(`Unknown block preset: ${id}`);
  return found;
}
