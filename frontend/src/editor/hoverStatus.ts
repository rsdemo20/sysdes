/**
 * What the status line says about the object under the cursor.
 *
 * Pure and separate from the canvas so it can be read at a glance and tested
 * without a browser: the canvas reports an id, this decides what that id is
 * worth saying out loud.
 *
 * The wording answers the question a reader actually has -- what is this thing
 * and where does it live -- so every line carries the kind, the label and the
 * diagram it belongs to. An object with no label of its own (a free note, an
 * annotation) is described by its own text instead, trimmed, because a status
 * line is one line.
 */
import type { CanvasDocument, Diagram } from "../model/types";

const KINDS = {
  ru: {
    actor: "Актор",
    service: "Сервис",
    datastore: "Хранилище",
    queue: "Очередь",
    external_system: "Внешняя система",
    boundary: "Граница",
    entity: "Сущность",
    participant: "Участник",
    annotation: "Подпись",
    note: "Свободный текст",
  },
  en: {
    actor: "Actor",
    service: "Service",
    datastore: "Datastore",
    queue: "Queue",
    external_system: "External system",
    boundary: "Boundary",
    entity: "Entity",
    participant: "Participant",
    annotation: "Annotation",
    note: "Free text",
  },
} as const;

/** A status line is one line: long text is cut rather than allowed to wrap. */
const LIMIT = 80;

export interface HoverStatus {
  /** Human name of what kind of object this is. */
  kind: string;
  /** Its label, or its own text when it has no label. */
  label: string;
  /** The diagram it belongs to, absent for notes that belong to the canvas. */
  diagram: string | null;
}

function shorten(text: string): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > LIMIT ? `${single.slice(0, LIMIT - 1)}…` : single;
}

function inDiagram(
  diagram: Diagram,
  id: string,
  locale: "ru" | "en",
): HoverStatus | null {
  const kinds = KINDS[locale];
  if (diagram.type === "hld") {
    const node = diagram.nodes.find((item) => item.id === id);
    return node
      ? { kind: kinds[node.kind], label: node.label, diagram: diagram.title }
      : null;
  }
  if (diagram.type === "er") {
    const entity = diagram.entities.find((item) => item.id === id);
    return entity
      ? { kind: kinds.entity, label: entity.label, diagram: diagram.title }
      : null;
  }
  const participant = diagram.participants.find((item) => item.id === id);
  return participant
    ? {
        kind: kinds.participant,
        label: participant.label,
        diagram: diagram.title,
      }
    : null;
}

/** The object with this id, described for the status line, or null. */
export function describeObject(
  document: CanvasDocument,
  id: string,
  locale: "ru" | "en",
): HoverStatus | null {
  for (const diagram of document.semantic.diagrams) {
    const found = inDiagram(diagram, id, locale);
    if (found) return { ...found, label: shorten(found.label) };
  }
  const kinds = KINDS[locale];
  const note = document.semantic.notes.find((item) => item.id === id);
  if (note) {
    return { kind: kinds.note, label: shorten(note.text), diagram: null };
  }
  const annotation = document.semantic.annotations.find(
    (item) => item.id === id,
  );
  if (annotation) {
    const owner = describeObject(document, annotation.ownerObjectId, locale);
    return {
      kind: kinds.annotation,
      label: shorten(annotation.text),
      diagram: owner?.diagram ?? null,
    };
  }
  return null;
}

/** The whole status line as one string, ready to render. */
export function statusLine(status: HoverStatus): string {
  const head = `${status.kind} · ${status.label}`;
  return status.diagram ? `${head} · ${status.diagram}` : head;
}
