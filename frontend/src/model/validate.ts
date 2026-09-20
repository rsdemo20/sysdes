/**
 * Document validation in two layers.
 *
 * The structural layer is the published JSON Schema, compiled as-is rather than
 * restated in TypeScript: types, enums, required fields, ranges and closed
 * objects are already expressed there. The semantic layer below covers exactly
 * what JSON Schema cannot say — reference targets and their types, uniqueness of
 * IDs across separate arrays, message ordering, cycles and quotas.
 *
 * TypeScript interfaces are a convenience for the editor, never the validation.
 */
import Ajv2020 from "ajv/dist/2020";
import type { ErrorObject, ValidateFunction } from "ajv";
import schema from "./contracts/canvas-document.schema.json";
import type { CanvasDocument } from "./types";

export type DocumentErrorCode =
  | "schema"
  | "document_bytes"
  | "object_limit"
  | "duplicate_id"
  | "edge_endpoints"
  | "non_boundary_children"
  | "boundary_child"
  | "boundary_cycle"
  | "pk_reference"
  | "index_reference"
  | "er_endpoints"
  | "fk_source"
  | "fk_target"
  | "empty_fk_mapping"
  | "represented_object"
  | "message_order"
  | "message_endpoints"
  | "return_target"
  | "return_direction"
  | "annotation_owner"
  | "short_name"
  | "annotation_limit"
  | "requirement_reference"
  | "numeric_range"
  | "unexpected_upper_threshold"
  | "context_scope"
  | "layout_reference";

export class DocumentError extends Error {
  constructor(
    readonly code: DocumentErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "DocumentError";
  }
}

const MAX_OBJECTS = 2000;
const MAX_BYTES = 2 * 1024 * 1024;
const HLD_KINDS = new Set([
  "actor",
  "service",
  "datastore",
  "queue",
  "external_system",
  "boundary",
]);

function require_(
  condition: unknown,
  code: DocumentErrorCode,
  message: string,
  detail?: string,
): asserts condition {
  if (!condition) throw new DocumentError(code, message, detail);
}

let compiled: ValidateFunction | undefined;
function structural(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: false, strict: false });
    compiled = ajv.compile(schema as object);
  }
  return compiled;
}

const describe = (errors: ErrorObject[] | null | undefined) =>
  errors?.length
    ? `${errors[0].instancePath || "/"} ${errors[0].message ?? ""}`.trim()
    : "structural validation failed";

type AnyRecord = Record<string, unknown>;
type Diagram = CanvasDocument["semantic"]["diagrams"][number];

/** Blocks are the addressable objects of a diagram, whatever its type. */
const blocksOf = (
  diagram: Diagram,
): Array<{ id: string; shortName?: string | null }> =>
  diagram.type === "hld"
    ? diagram.nodes
    : diagram.type === "er"
      ? diagram.entities
      : diagram.participants;

/**
 * Collect every authored object ID in one namespace. Provenance IDs are
 * references to a template, not objects of this document, so they are excluded.
 */
function collectIds(semantic: AnyRecord): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const record = value as AnyRecord;
    if (typeof record.id === "string") {
      require_(
        !found.has(record.id),
        "duplicate_id",
        "Object IDs must be unique across the whole document",
        record.id,
      );
      found.add(record.id);
    }
    for (const item of Object.values(record)) walk(item);
  };
  for (const key of ["context", "diagrams", "annotations", "notes"])
    walk(semantic[key]);
  return found;
}

function checkHld(diagram: Extract<Diagram, { type: "hld" }>) {
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  for (const edge of diagram.edges)
    require_(
      nodes.has(edge.sourceId) && nodes.has(edge.targetId),
      "edge_endpoints",
      "HLD edge endpoints must belong to the same HLD diagram",
      edge.id,
    );
  const visit = (id: string, trail: Set<string>) => {
    require_(
      !trail.has(id),
      "boundary_cycle",
      "Boundary nesting is cyclic",
      id,
    );
    const node = nodes.get(id)!;
    const children = node.childIds ?? [];
    require_(
      children.length === 0 || node.kind === "boundary",
      "non_boundary_children",
      "Only a boundary may contain child components",
      id,
    );
    for (const child of children) {
      require_(
        nodes.has(child),
        "boundary_child",
        "Boundary child must exist in the same diagram",
        child,
      );
      visit(child, new Set(trail).add(id));
    }
  };
  for (const id of nodes.keys()) visit(id, new Set());
}

function checkEr(diagram: Extract<Diagram, { type: "er" }>) {
  const entities = new Set(diagram.entities.map((entity) => entity.id));
  const fieldOwner = new Map<string, string>();
  for (const entity of diagram.entities) {
    const own = new Set(entity.fields.map((field) => field.id));
    for (const field of entity.fields) fieldOwner.set(field.id, entity.id);
    for (const id of entity.primaryKeyFieldIds)
      require_(
        own.has(id),
        "pk_reference",
        "Primary key must reference fields of its own entity",
        id,
      );
    for (const index of [...entity.indexes, ...entity.uniqueConstraints])
      for (const id of index.fieldIds)
        require_(
          own.has(id),
          "index_reference",
          "Index and unique constraint must reference fields of their entity",
          index.id,
        );
  }
  for (const relationship of diagram.relationships) {
    require_(
      entities.has(relationship.sourceEntityId) &&
        entities.has(relationship.targetEntityId),
      "er_endpoints",
      "Relationship endpoints must exist in the same ER diagram",
      relationship.id,
    );
    for (const mapping of relationship.fieldMapping) {
      require_(
        fieldOwner.get(mapping.sourceFieldId) === relationship.sourceEntityId,
        "fk_source",
        "Mapped source field must belong to the declared source entity",
        relationship.id,
      );
      require_(
        fieldOwner.get(mapping.targetFieldId) === relationship.targetEntityId,
        "fk_target",
        "Mapped target field must belong to the declared target entity",
        relationship.id,
      );
    }
    require_(
      relationship.enforcement !== "foreign_key" ||
        relationship.fieldMapping.length > 0,
      "empty_fk_mapping",
      "A foreign key relationship requires a field mapping",
      relationship.id,
    );
  }
}

function checkSequence(
  diagram: Extract<Diagram, { type: "sequence" }>,
  hldObjects: Set<string>,
) {
  const participants = new Set(diagram.participants.map((p) => p.id));
  for (const participant of diagram.participants)
    require_(
      participant.representedObjectId === null ||
        hldObjects.has(participant.representedObjectId),
      "represented_object",
      "A participant may only represent an HLD component or nothing",
      participant.id,
    );
  const messages = new Map(
    diagram.messages.map((message) => [message.id, message]),
  );
  const orders = [...messages.values()]
    .map((m) => m.order)
    .sort((a, b) => a - b);
  require_(
    orders.every((order, index) => order === index + 1),
    "message_order",
    "Message order must be 1..N without gaps or repeats",
    diagram.id,
  );
  for (const message of messages.values()) {
    require_(
      participants.has(message.sourceId) && participants.has(message.targetId),
      "message_endpoints",
      "Message endpoints must be participants of the same diagram",
      message.id,
    );
    if (message.kind !== "return") continue;
    const request = message.replyToMessageId
      ? messages.get(message.replyToMessageId)
      : undefined;
    require_(
      request !== undefined &&
        request.kind === "sync" &&
        request.order < message.order,
      "return_target",
      "A return must answer an earlier sync message",
      message.id,
    );
    require_(
      request.sourceId === message.targetId &&
        request.targetId === message.sourceId,
      "return_direction",
      "A return must travel back between the same two participants",
      message.id,
    );
  }
}

/**
 * Full validation. Structural errors surface as `schema`; every other code names
 * the invariant that failed, so callers can report it without parsing text.
 */
export function validateDocument(value: unknown): CanvasDocument {
  const validate = structural();
  require_(
    validate(value),
    "schema",
    "Document does not match the schema",
    describe(validate.errors),
  );

  const document = value as CanvasDocument;
  const semantic = document.semantic as unknown as AnyRecord;

  require_(
    new TextEncoder().encode(JSON.stringify(document)).length <= MAX_BYTES,
    "document_bytes",
    `Document exceeds ${MAX_BYTES} bytes`,
  );

  const ids = collectIds(semantic);
  require_(
    ids.size <= MAX_OBJECTS,
    "object_limit",
    `Document exceeds ${MAX_OBJECTS} addressable objects`,
  );

  const hldObjects = new Set<string>();
  for (const diagram of document.semantic.diagrams)
    if (diagram.type === "hld")
      for (const node of diagram.nodes)
        if (HLD_KINDS.has(node.kind)) hldObjects.add(node.id);

  const blocks = new Set<string>();
  for (const diagram of document.semantic.diagrams)
    for (const block of blocksOf(diagram)) blocks.add(block.id);

  for (const diagram of document.semantic.diagrams) {
    if (diagram.type === "hld") checkHld(diagram);
    else if (diagram.type === "er") checkEr(diagram);
    else checkSequence(diagram, hldObjects);
    // A short name exists so a reader can point at exactly one block; two
    // blocks answering to qu3 would defeat the only thing it is for.
    const shortNames = new Set<string>();
    for (const block of blocksOf(diagram)) {
      const name = block.shortName;
      if (!name) continue;
      require_(
        !shortNames.has(name),
        "short_name",
        `Two blocks share the short name ${name}`,
      );
      shortNames.add(name);
    }
  }

  const owners = new Map<string, number>();
  for (const annotation of document.semantic.annotations) {
    require_(
      blocks.has(annotation.ownerObjectId),
      "annotation_owner",
      "An external annotation must belong to an existing block",
      annotation.id,
    );
    owners.set(
      annotation.ownerObjectId,
      (owners.get(annotation.ownerObjectId) ?? 0) + 1,
    );
  }
  for (const [owner, count] of owners)
    require_(
      count <= 3,
      "annotation_limit",
      "A block carries at most three external annotations",
      owner,
    );

  const context = semantic.context as Record<string, AnyRecord[]>;
  const requirements = new Set(context.requirements.map((r) => r.id as string));
  for (const records of Object.values(context))
    for (const record of records) {
      for (const ref of (record.requirementRefs as string[] | undefined) ?? [])
        require_(
          requirements.has(ref),
          "requirement_reference",
          "Acceptance criteria must reference existing requirements",
          ref,
        );
      const condition = record.condition as AnyRecord | undefined;
      if (!condition || condition.kind !== "numeric") continue;
      if (condition.comparator === "range")
        require_(
          condition.value === null ||
            condition.upperValue === null ||
            (condition.value as number) <= (condition.upperValue as number),
          "numeric_range",
          "A numeric range needs lower <= upper",
          record.id as string,
        );
      else
        require_(
          condition.upperValue === null,
          "unexpected_upper_threshold",
          "Only a range comparator may carry an upper threshold",
          record.id as string,
        );
    }

  const diagramIds = new Set(document.semantic.diagrams.map((d) => d.id));
  for (const records of [
    ...Object.values(context),
    document.semantic.notes as unknown as AnyRecord[],
  ])
    for (const record of records)
      for (const id of (record.diagramIds as string[] | undefined) ?? [])
        require_(
          diagramIds.has(id),
          "context_scope",
          "Context and notes may only reference existing diagrams",
          id,
        );

  const positionTargets = new Set([
    ...blocks,
    ...document.semantic.notes.map((note) => note.id),
  ]);
  const layoutTargets: Record<string, Set<string>> = {
    objectPositions: positionTargets,
    annotationOffsets: new Set(
      document.semantic.annotations.map((annotation) => annotation.id),
    ),
    diagramFrames: diagramIds,
    // A label's placement belongs to its connection, and the server refuses
    // one that outlived it; saying so here keeps the refusal off the network.
    edgeLabels: new Set(
      document.semantic.diagrams.flatMap((diagram) =>
        diagram.type === "hld"
          ? diagram.edges.map((edge) => edge.id)
          : diagram.type === "er"
            ? diagram.relationships.map((relationship) => relationship.id)
            : diagram.messages.map((message) => message.id),
      ),
    ),
  };
  layoutTargets.textStyles = new Set([
    ...positionTargets,
    ...layoutTargets.annotationOffsets,
    ...layoutTargets.edgeLabels,
  ]);
  for (const [key, targets] of Object.entries(layoutTargets))
    for (const id of Object.keys(
      (document.layout as unknown as Record<string, AnyRecord>)[key] ?? {},
    ))
      require_(
        targets.has(id),
        "layout_reference",
        `Layout key ${key} must reference an object of the matching type`,
        id,
      );

  return document;
}
