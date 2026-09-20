/**
 * The single write path for a CanvasDocument.
 *
 * Every edit is a named command applied to an immutable document, returning a
 * new document that shares every untouched subtree. Named commands are what the
 * latency budget in the technical SLI is measured against and what the save
 * coordinator and history hang off; sharing is what keeps a renderer from
 * re-rendering diagrams that did not change.
 *
 * Undo is not built from inverse commands. History keeps whole snapshots
 * (see history.ts), which is why a cascading delete is undone in one step
 * without reconstructing the references it removed.
 */
import type {
  CanvasDocument,
  Diagram,
  HldEdge,
  Message,
  Position,
} from "./types";
import { parameterValue } from "../editor/contextPanels";

export type EditorCommand =
  | { type: "text.commit"; objectId: string; field: string; value: string }
  | { type: "object.move"; objectId: string; position: Position }
  | { type: "object.delete"; objectId: string }
  | {
      type: "edge.connect";
      diagramId: string;
      edgeId: string;
      sourceId: string;
      targetId: string;
      label: string;
      interaction?: HldEdge["interaction"];
    }
  | { type: "message.reorder"; messageId: string; delta: number };

export class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

/** Map an array but return the original when nothing changed, preserving identity. */
function mapStable<T>(items: T[], map: (item: T) => T): T[] {
  let changed = false;
  const result = items.map((item) => {
    const next = map(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? result : items;
}

function filterStable<T>(items: T[], keep: (item: T) => boolean): T[] {
  const result = items.filter(keep);
  return result.length === items.length ? items : result;
}

function withDiagrams(
  document: CanvasDocument,
  map: (diagram: Diagram) => Diagram,
): CanvasDocument {
  const diagrams = mapStable(document.semantic.diagrams, map);
  if (diagrams === document.semantic.diagrams) return document;
  return { ...document, semantic: { ...document.semantic, diagrams } };
}

const blocksOf = (diagram: Diagram): Array<{ id: string }> =>
  diagram.type === "hld"
    ? diagram.nodes
    : diagram.type === "er"
      ? diagram.entities
      : diagram.participants;

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

function commitText(
  document: CanvasDocument,
  objectId: string,
  field: string,
  value: string,
): CanvasDocument {
  let found = false;
  // A block's description lives among its properties and a criterion's scenario
  // in its condition, so a field may name one of those as `properties.<name>`
  // or `condition.<name>`. Only an object that already carries that part takes
  // such a field: anywhere else it would invent structure the schema refuses,
  // so the object is reported as not found instead.
  const dot = field.indexOf(".");
  const container =
    dot > 0 && ["properties", "condition"].includes(field.slice(0, dot))
      ? field.slice(0, dot)
      : null;
  const nested = container === null ? null : field.slice(dot + 1);
  const update = <T extends { id: string }>(object: T): T => {
    if (object.id !== objectId) return object;
    if (nested !== null) {
      const part = (object as unknown as Record<string, unknown>)[
        container!
      ] as Record<string, unknown> | undefined;
      if (!part || typeof part !== "object") return object;
      found = true;
      // An emptied description is an unknown one, which the document writes as
      // null rather than as an empty string. A condition's texts are plain
      // strings and stay strings.
      const stored = container === "properties" && value === "" ? null : value;
      if ((part[nested] ?? null) === stored) return object;
      return { ...object, [container!]: { ...part, [nested]: stored } };
    }
    found = true;
    const record = object as unknown as Record<string, unknown>;
    // A key figure's value is a number when it reads as one.
    const stored =
      field === "value" && "status" in record && "unit" in record
        ? parameterValue(value)
        : value;
    if (record[field] === stored) return object;
    return { ...object, [field]: stored };
  };
  const next = withDiagrams(document, (diagram) => {
    if (diagram.type === "hld") {
      const nodes = mapStable(diagram.nodes, update);
      const edges = mapStable(diagram.edges, update);
      return nodes === diagram.nodes && edges === diagram.edges
        ? diagram
        : { ...diagram, nodes, edges };
    }
    if (diagram.type === "er") {
      const entities = mapStable(diagram.entities, (entity) => {
        const fields = mapStable(entity.fields, update);
        const updated = update(entity);
        return fields === entity.fields ? updated : { ...updated, fields };
      });
      const relationships = mapStable(diagram.relationships, update);
      return entities === diagram.entities &&
        relationships === diagram.relationships
        ? diagram
        : { ...diagram, entities, relationships };
    }
    const participants = mapStable(diagram.participants, update);
    const messages = mapStable(diagram.messages, update);
    return participants === diagram.participants &&
      messages === diagram.messages
      ? diagram
      : { ...diagram, participants, messages };
  });

  const annotations = mapStable(document.semantic.annotations, update);
  const notes = mapStable(document.semantic.notes, update);
  // The task's items are edited on the canvas like any other text.
  const before = document.semantic.context;
  const context = {
    requirements: mapStable(before.requirements, update),
    acceptanceCriteria: mapStable(before.acceptanceCriteria, update),
    technicalParameters: mapStable(before.technicalParameters, update),
    assumptions: mapStable(before.assumptions, update),
    constraints: mapStable(before.constraints, update),
  };
  const contextChanged = (
    Object.keys(context) as Array<keyof typeof context>
  ).some((key) => context[key] !== before[key]);
  if (!found)
    throw new CommandError("unknown_object", `No object ${objectId} to edit`);
  if (
    annotations === document.semantic.annotations &&
    notes === document.semantic.notes &&
    !contextChanged
  )
    return next;
  return {
    ...next,
    semantic: {
      ...next.semantic,
      annotations,
      notes,
      context: contextChanged ? context : before,
    },
  };
}

/**
 * Remove one object together with everything that only exists because of it:
 * edges, relationships and messages that touch it, its external annotations and
 * every layout entry. Sequence messages are renumbered so order stays 1..N.
 */
function deleteObject(
  document: CanvasDocument,
  objectId: string,
): CanvasDocument {
  const isBlock = document.semantic.diagrams.some((diagram) =>
    blocksOf(diagram).some((block) => block.id === objectId),
  );
  const isNote = document.semantic.notes.some((note) => note.id === objectId);
  const isAnnotation = document.semantic.annotations.some(
    (annotation) => annotation.id === objectId,
  );
  // A connection is an object with an id too, and it is deleted by naming it.
  const isConnection = document.semantic.diagrams.some((diagram) =>
    (diagram.type === "hld"
      ? diagram.edges
      : diagram.type === "er"
        ? diagram.relationships
        : diagram.messages
    ).some((connection) => connection.id === objectId),
  );
  if (!isBlock && !isNote && !isAnnotation && !isConnection)
    throw new CommandError("unknown_object", `No object ${objectId} to delete`);

  let next = withDiagrams(document, (diagram) => {
    if (diagram.type === "hld") {
      const nodes = filterStable(diagram.nodes, (node) => node.id !== objectId);
      // A connection is an object with an id of its own (invariant 1), so it
      // is deleted either by naming it or by removing what it joined.
      const edges = filterStable(
        diagram.edges,
        (edge) =>
          edge.id !== objectId &&
          edge.sourceId !== objectId &&
          edge.targetId !== objectId,
      );
      const cleaned = mapStable(nodes, (node) => {
        if (!node.childIds?.includes(objectId)) return node;
        return {
          ...node,
          childIds: node.childIds.filter((child) => child !== objectId),
        };
      });
      return cleaned === diagram.nodes && edges === diagram.edges
        ? diagram
        : { ...diagram, nodes: cleaned, edges };
    }
    if (diagram.type === "er") {
      const entities = filterStable(
        diagram.entities,
        (entity) => entity.id !== objectId,
      );
      const relationships = filterStable(
        diagram.relationships,
        (relationship) =>
          relationship.id !== objectId &&
          relationship.sourceEntityId !== objectId &&
          relationship.targetEntityId !== objectId,
      );
      return entities === diagram.entities &&
        relationships === diagram.relationships
        ? diagram
        : { ...diagram, entities, relationships };
    }
    // A participant may represent the deleted HLD component; drop that reference
    // rather than the participant, which is an object of its own.
    const rebound = mapStable(diagram.participants, (participant) =>
      participant.representedObjectId === objectId
        ? { ...participant, representedObjectId: null }
        : participant,
    );
    const participants = filterStable(
      rebound,
      (participant) => participant.id !== objectId,
    );
    const kept = filterStable(
      diagram.messages,
      (message) =>
        message.id !== objectId &&
        message.sourceId !== objectId &&
        message.targetId !== objectId,
    );
    if (participants === diagram.participants && kept === diagram.messages)
      return diagram;
    if (participants.length === rebound.length && kept === diagram.messages)
      return { ...diagram, participants };
    // A return whose request disappeared would dangle; drop it too.
    const keptIds = new Set(kept.map((message) => message.id));
    const withoutOrphans = kept.filter(
      (message) =>
        message.kind !== "return" ||
        (message.replyToMessageId !== null &&
          keptIds.has(message.replyToMessageId)),
    );
    const renumbered = [...withoutOrphans]
      .sort((a, b) => a.order - b.order)
      .map((message, index) => ({ ...message, order: index + 1 }));
    return { ...diagram, participants, messages: renumbered };
  });

  const annotations = filterStable(
    next.semantic.annotations,
    (annotation) =>
      annotation.id !== objectId && annotation.ownerObjectId !== objectId,
  );
  const notes = filterStable(
    next.semantic.notes,
    (note) => note.id !== objectId,
  );
  const removedAnnotations = next.semantic.annotations
    .filter((annotation) => !annotations.includes(annotation))
    .map((annotation) => annotation.id);
  if (
    annotations !== next.semantic.annotations ||
    notes !== next.semantic.notes
  )
    next = { ...next, semantic: { ...next.semantic, annotations, notes } };

  let objectPositions = omitKey(next.layout.objectPositions, objectId);
  let annotationOffsets = omitKey(next.layout.annotationOffsets, objectId);
  for (const id of removedAnnotations)
    annotationOffsets = omitKey(annotationOffsets, id);
  // The ports of a deleted block, and the bindings of every connection that
  // went with it, are layout for objects that no longer exist. Leaving them
  // behind would grow the document by exactly the parts nobody can see.
  let ports = next.layout.ports
    ? omitKey(next.layout.ports, objectId)
    : next.layout.ports;
  let edgePorts = next.layout.edgePorts;
  let edgeLabels = next.layout.edgeLabels;
  // A style can belong to any object, and a block takes its connections and
  // its annotation with it, so every id still in the document is checked.
  let textStyles = next.layout.textStyles;
  if (textStyles) {
    const present = new Set<string>([
      ...next.semantic.notes.map((note) => note.id),
      ...next.semantic.annotations.map((annotation) => annotation.id),
      ...next.semantic.diagrams.flatMap((diagram) =>
        diagram.type === "hld"
          ? [...diagram.nodes, ...diagram.edges].map((item) => item.id)
          : diagram.type === "er"
            ? [...diagram.entities, ...diagram.relationships].map(
                (item) => item.id,
              )
            : [...diagram.participants, ...diagram.messages].map(
                (item) => item.id,
              ),
      ),
    ]);
    for (const id of Object.keys(textStyles))
      if (!present.has(id)) textStyles = omitKey(textStyles, id);
  }
  if (edgePorts || edgeLabels) {
    const alive = new Set(
      next.semantic.diagrams.flatMap((diagram) =>
        diagram.type === "hld"
          ? diagram.edges.map((edge) => edge.id)
          : diagram.type === "er"
            ? diagram.relationships.map((relationship) => relationship.id)
            : diagram.messages.map((message) => message.id),
      ),
    );
    if (edgePorts)
      for (const id of Object.keys(edgePorts))
        if (!alive.has(id)) edgePorts = omitKey(edgePorts, id);
    if (edgeLabels)
      for (const id of Object.keys(edgeLabels))
        if (!alive.has(id)) edgeLabels = omitKey(edgeLabels, id);
  }
  if (
    objectPositions !== next.layout.objectPositions ||
    annotationOffsets !== next.layout.annotationOffsets ||
    ports !== next.layout.ports ||
    edgePorts !== next.layout.edgePorts ||
    edgeLabels !== next.layout.edgeLabels ||
    textStyles !== next.layout.textStyles
  )
    next = {
      ...next,
      layout: {
        ...next.layout,
        objectPositions,
        annotationOffsets,
        ...(ports ? { ports } : {}),
        ...(edgePorts ? { edgePorts } : {}),
        ...(edgeLabels ? { edgeLabels } : {}),
        ...(textStyles ? { textStyles } : {}),
      },
    };
  return next;
}

function connectEdge(
  document: CanvasDocument,
  command: Extract<EditorCommand, { type: "edge.connect" }>,
): CanvasDocument {
  const diagram = document.semantic.diagrams.find(
    (candidate) => candidate.id === command.diagramId,
  );
  if (!diagram || diagram.type !== "hld")
    throw new CommandError("unknown_diagram", "Edges belong to an HLD diagram");
  const ids = new Set(diagram.nodes.map((node) => node.id));
  if (!ids.has(command.sourceId) || !ids.has(command.targetId))
    throw new CommandError(
      "edge_endpoints",
      "Both endpoints must be components of this diagram",
    );
  if (diagram.edges.some((edge) => edge.id === command.edgeId))
    throw new CommandError(
      "duplicate_id",
      `Edge ${command.edgeId} already exists`,
    );
  const edge: HldEdge = {
    id: command.edgeId,
    sourceId: command.sourceId,
    targetId: command.targetId,
    label: command.label,
    interaction: command.interaction ?? "unspecified",
    protocol: null,
    originTemplateObjectId: null,
  };
  return withDiagrams(document, (candidate) =>
    candidate.id === diagram.id && candidate.type === "hld"
      ? { ...candidate, edges: [...candidate.edges, edge] }
      : candidate,
  );
}

function reorderMessage(
  document: CanvasDocument,
  messageId: string,
  delta: number,
): CanvasDocument {
  for (const diagram of document.semantic.diagrams) {
    if (diagram.type !== "sequence") continue;
    const ordered = [...diagram.messages].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((message) => message.id === messageId);
    if (index < 0) continue;
    const other = index + delta;
    if (other < 0 || other >= ordered.length)
      throw new CommandError("out_of_range", "Message is already at the edge");
    const a = ordered[index];
    const b = ordered[other];
    const messages: Message[] = diagram.messages.map((message) =>
      message.id === a.id
        ? { ...message, order: b.order }
        : message.id === b.id
          ? { ...message, order: a.order }
          : message,
    );
    const byId = new Map(messages.map((message) => [message.id, message]));
    for (const message of messages) {
      if (message.kind !== "return") continue;
      const request = message.replyToMessageId
        ? byId.get(message.replyToMessageId)
        : undefined;
      if (!request || request.order >= message.order)
        throw new CommandError(
          "return_target",
          "A return cannot be moved before the request it answers",
        );
    }
    return withDiagrams(document, (candidate) =>
      candidate.id === diagram.id && candidate.type === "sequence"
        ? { ...candidate, messages }
        : candidate,
    );
  }
  throw new CommandError("unknown_object", `No message ${messageId}`);
}

export function applyCommand(
  document: CanvasDocument,
  command: EditorCommand,
): CanvasDocument {
  switch (command.type) {
    case "text.commit":
      return commitText(
        document,
        command.objectId,
        command.field,
        command.value,
      );
    case "object.move": {
      const current = document.layout.objectPositions[command.objectId];
      if (!current)
        throw new CommandError(
          "unknown_object",
          `No placed object ${command.objectId}`,
        );
      return {
        ...document,
        layout: {
          ...document.layout,
          objectPositions: {
            ...document.layout.objectPositions,
            [command.objectId]: command.position,
          },
        },
      };
    }
    case "object.delete":
      return deleteObject(document, command.objectId);
    case "edge.connect":
      return connectEdge(document, command);
    case "message.reorder":
      return reorderMessage(document, command.messageId, command.delta);
  }
}
