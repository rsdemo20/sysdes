import type fixture from "./mixed.json";

export interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Provenance {
  originTemplateObjectId?: string | null;
}
export interface HldNode extends Provenance {
  id: string;
  /** Stable handle a reader can point at: qu3, gw1, lb2. */
  shortName?: string | null;
  kind:
    | "actor"
    | "service"
    | "datastore"
    | "queue"
    | "external_system"
    | "boundary";
  label: string;
  properties: {
    /** Drawn as several instances of itself: the count is not the point. */
    scaled?: boolean | null;
    responsibility?: string | null;
    technology?: string | null;
    storageRole?: string | null;
    role?: string | null;
  };
  childIds?: string[];
}
export interface HldEdge extends Provenance {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  interaction: "sync" | "async" | "dataflow" | "unspecified";
  /** Drawn with an arrow at both ends: the two sides call each other. */
  bidirectional?: boolean | null;
  protocol: string | null;
}
export interface EntityField extends Provenance {
  id: string;
  name: string;
  dataType: string | null;
  nullable: boolean | null;
}
export interface Entity extends Provenance {
  id: string;
  shortName?: string | null;
  label: string;
  fields: EntityField[];
  primaryKeyFieldIds: string[];
  uniqueConstraints: Array<
    Provenance & { id: string; name: string; fieldIds: string[] }
  >;
  indexes: Array<Provenance & { id: string; name: string; fieldIds: string[] }>;
  storageNotes: string;
}
export type Cardinality = "0..1" | "1" | "0..*" | "1..*" | "unknown";
export interface Relationship extends Provenance {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  label: string;
  sourceCardinality: Cardinality;
  targetCardinality: Cardinality;
  fieldMapping: Array<{ sourceFieldId: string; targetFieldId: string }>;
  enforcement: "logical" | "foreign_key" | "unspecified";
}
export interface Participant extends Provenance {
  id: string;
  shortName?: string | null;
  label: string;
  role: "actor" | "system" | "unspecified";
  representedObjectId: string | null;
}
export interface Message extends Provenance {
  id: string;
  sourceId: string;
  targetId: string;
  order: number;
  kind: "sync" | "async" | "return";
  label: string;
  replyToMessageId: string | null;
}
interface DiagramBase extends Provenance {
  id: string;
  title: string;
}
export interface HldDiagram extends DiagramBase {
  type: "hld";
  nodes: HldNode[];
  edges: HldEdge[];
}
export interface ErDiagram extends DiagramBase {
  type: "er";
  entities: Entity[];
  relationships: Relationship[];
}
export interface SequenceDiagram extends DiagramBase {
  type: "sequence";
  participants: Participant[];
  messages: Message[];
}
export type Diagram = HldDiagram | ErDiagram | SequenceDiagram;
export interface Annotation extends Provenance {
  id: string;
  ownerObjectId: string;
  text: string;
}
export interface Note extends Provenance {
  id: string;
  text: string;
  diagramIds: string[];
}
/**
 * The task the canvas answers: what is asked, what it must satisfy, what is known.
 *
 * Typed here rather than inferred from a fixture, because a fixture with an
 * empty `technicalParameters` types that section as `never[]` -- fine until
 * something reads it, which the sidebar now does.
 */
export interface CanvasContext {
  requirements: Array<
    Provenance & {
      id: string;
      text: string;
      diagramIds: string[];
      kind: "functional" | "nonfunctional";
      priority: "must" | "should" | "could";
    }
  >;
  acceptanceCriteria: Array<
    Provenance & {
      id: string;
      text: string;
      diagramIds: string[];
      requirementRefs: string[];
      priority: "must" | "should";
      condition: Record<string, unknown>;
      verificationMethod: string;
    }
  >;
  technicalParameters: Array<
    Provenance & {
      id: string;
      name: string;
      value: number | string | null;
      unit: string;
      basis: string;
      status: "assumption" | "measured";
      diagramIds: string[];
    }
  >;
  assumptions: Array<
    Provenance & { id: string; text: string; diagramIds: string[] }
  >;
  constraints: Array<
    Provenance & { id: string; text: string; diagramIds: string[] }
  >;
}

export interface CanvasDocument {
  schemaVersion: 1;
  semantic: {
    domainId: string;
    templateProvenance: {
      templateId: string;
      templateVersion: number;
      templateLocale: "ru" | "en";
      rubricVersion: string;
    } | null;
    context: CanvasContext;
    diagrams: Diagram[];
    annotations: Annotation[];
    notes: Note[];
    rubricVersion: string;
  };
  layout: {
    objectPositions: Record<string, Position>;
    annotationOffsets: Record<
      string,
      { dx: number; dy: number; width: number; height: number }
    >;
    diagramFrames: Record<string, Position>;
    viewport: { x: number; y: number; zoom: number };
    /**
     * Where a block's free connection points sit. Absent means the defaults:
     * one on the left, two on the right.
     */
    ports?: Record<
      string,
      Array<{
        id: string;
        side: "left" | "right" | "top" | "bottom";
        offset: number;
      }>
    >;
    /** Which port each end of a connection uses. Absent means the first one. */
    edgePorts?: Record<string, { source: string; target: string }>;
    /**
     * How each connection's label is placed and sized. Absent means in the
     * line, sized by its text -- how every label was drawn before this existed.
     */
    edgeLabels?: Record<
      string,
      {
        placement: "inline" | "above" | "below" | "left" | "right";
        dx: number | null;
        dy: number | null;
        width: number | null;
        height: number | null;
      }
    >;
    /**
     * How the text of a block, note, annotation or connection label is set.
     * Absent means the size, weight and face every object was drawn with before.
     */
    /**
     * Where the three task panels stand. Absent, or missing a panel, means the
     * default column to the left of the diagrams.
     */
    contextPanels?: Partial<
      Record<"scope" | "requirements" | "criteria", Position>
    >;
    textStyles?: Record<
      string,
      {
        scale: number;
        emphasis: "normal" | "bold" | "italic";
        font: "sans" | "serif" | "mono" | "hand";
      }
    >;
  };
}
