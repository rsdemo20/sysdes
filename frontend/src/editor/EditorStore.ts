import type {
  CanvasDocument,
  Diagram,
  Message,
  Position,
} from "../model/types";
import {
  newContextItem,
  type ContextItemKind,
  type ContextSectionId,
} from "./contextPanels";
import {
  nextEmphasis,
  nextFont,
  nextScale,
  textStyleOf,
  type TextStyle,
} from "./textStyle";
import { applyCommand, CommandError } from "../model/commands";
import type { EditorCommand } from "../model/commands";
import { History } from "../model/history";
import { DraftRegistry } from "./drafts";
import {
  addPort,
  movePort,
  portOfEdge,
  portsOf,
  turnPorts,
  type BlockPort,
} from "./ports";
import { placeAnnotation } from "./annotationPlacement";
import { styleById, type ConnectionStyleId } from "./connectionStyle";
import { edgeLabelOf, nextPlacement, type EdgeLabelLayout } from "./edgeLabel";
import type { DraftEntry, TextPatch } from "./drafts";

export type { DraftEntry, TextPatch } from "./drafts";

/** A small local document coordinator. Draft values remain inside individual fields. */
export class EditorStore {
  private listeners = new Set<() => void>();
  /** Text drafts live in one registry shared with the save coordinator. */
  readonly drafts = new DraftRegistry((patches) => this.commit(patches));
  graphCommits = 0;
  profiler = { commits: 0, totalDuration: 0 };
  nodeRenders: Record<string, number> = {};
  private history: History;
  constructor(private document: CanvasDocument) {
    this.history = new History(document);
  }
  getSnapshot = () => this.document;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /**
   * The single funnel for every document change, so undo covers all of them.
   * `record: false` is for changes that are not user edits, such as panning the
   * viewport, which must not become a step in the undo history.
   */
  /** Notified once per document change, so the save coordinator can count generations. */
  onEdit: (() => void) | undefined;
  replace = (next: CanvasDocument, record = true) => {
    if (next === this.document) return;
    this.document = next;
    if (record) this.history.commit(next);
    this.graphCommits++;
    this.listeners.forEach((listener) => listener());
    this.onEdit?.();
  };
  /** Named write path: every editing action is a command over the immutable document. */
  dispatch = (command: EditorCommand) => {
    this.replace(applyCommand(this.document, command));
  };
  /**
   * Keep the document's viewport in step with what is on screen.
   *
   * `byUser` is false for a move the application made itself -- the placement a
   * canvas gets as it opens. That move still updates the document, because
   * blocks added later are sized to the visible area and must see the real
   * zoom; but it is not an edit. Counting it as one made every canvas dirty the
   * moment it opened, and a dirty canvas refuses a plain switch to another one:
   * it asks what to do with changes the user never made.
   */
  setViewport = (
    viewport: CanvasDocument["layout"]["viewport"],
    byUser = true,
  ) => {
    const doc = this.document;
    const next = { ...doc, layout: { ...doc.layout, viewport } };
    if (byUser) {
      this.replace(next, false);
      return;
    }
    this.document = next;
    this.listeners.forEach((listener) => listener());
  };
  get canUndo() {
    return this.history.canUndo;
  }
  get canRedo() {
    return this.history.canRedo;
  }
  private restore = (next: CanvasDocument) => {
    if (next === this.document) return;
    this.document = next;
    this.graphCommits++;
    this.listeners.forEach((listener) => listener());
    // Undo and redo change saved data too, so they count as edits.
    this.onEdit?.();
  };
  undo = () => this.restore(this.history.undo());
  redo = () => this.restore(this.history.redo());
  register = (key: string, entry: DraftEntry) =>
    this.drafts.register(key, entry);
  /**
   * Commit a batch of drafts as one document change. Each patch is a text.commit
   * command; folding them keeps a single graph commit per flush. A draft whose
   * object was deleted meanwhile is skipped rather than failing the whole batch.
   */
  commit = (patches: TextPatch[]) => {
    if (!patches.length) return;
    let next = this.document;
    for (const patch of patches) {
      try {
        next = applyCommand(next, {
          type: "text.commit",
          objectId: patch.objectId,
          field: patch.field,
          value: patch.value,
        });
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
      }
    }
    this.replace(next);
  };
  flush = (): Promise<void> => this.drafts.flushPendingInputs();
  updateDiagram = (id: string, change: (diagram: Diagram) => Diagram) => {
    const doc = this.document;
    this.replace({
      ...doc,
      semantic: {
        ...doc.semantic,
        diagrams: doc.semantic.diagrams.map((diagram) =>
          diagram.id === id ? change(diagram) : diagram,
        ),
      },
    });
  };
  /**
   * Ports are layout, so all three of these change how the canvas is drawn and
   * nothing about what it says. They go through `replace`, which means each is
   * one undo step, the way a move or a resize is.
   */
  addBlockPort = (blockId: string, side: BlockPort["side"]) => {
    const doc = this.document;
    const of = this.kindOf(blockId);
    this.replace({
      ...doc,
      layout: {
        ...doc.layout,
        ports: {
          ...doc.layout.ports,
          [blockId]: addPort(portsOf(doc.layout, blockId, of), side),
        },
      },
    });
  };
  moveBlockPort = (
    blockId: string,
    portId: string,
    side: BlockPort["side"],
    offset: number,
  ) => {
    const doc = this.document;
    const of = this.kindOf(blockId);
    this.replace({
      ...doc,
      layout: {
        ...doc.layout,
        ports: {
          ...doc.layout.ports,
          [blockId]: movePort(
            portsOf(doc.layout, blockId, of),
            portId,
            side,
            offset,
          ),
        },
      },
    });
  };
  /**
   * Removes an object and everything that hung on it, as one undo step.
   *
   * Silent when the object is already gone: the Delete key and the button on
   * the card can both fire for the same block, and the second one has nothing
   * to complain about.
   */
  deleteObject = (objectId: string) => {
    try {
      this.dispatch({ type: "object.delete", objectId });
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
    }
  };

  /**
   * Delete a selected group as one change, so a single undo brings it all back.
   *
   * Deleting one object can take others with it -- a block takes its
   * annotation -- so an id already gone by the time its turn comes is skipped
   * rather than treated as an error.
   */
  deleteObjects = (objectIds: readonly string[]) => {
    let next = this.document;
    for (const objectId of objectIds) {
      try {
        next = applyCommand(next, { type: "object.delete", objectId });
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
      }
    }
    this.replace(next);
  };

  /**
   * Draws a block as several instances of itself, or stops.
   *
   * This is design, not decoration: whether a component is scaled out is
   * exactly the kind of thing a reviewer looks for, so it lives with the block
   * and reaches the evaluation, rather than hiding in the layout.
   */
  toggleScaled = (blockId: string) => {
    const doc = this.document;
    this.replace({
      ...doc,
      semantic: {
        ...doc.semantic,
        diagrams: doc.semantic.diagrams.map((diagram) =>
          diagram.type !== "hld"
            ? diagram
            : {
                ...diagram,
                nodes: diagram.nodes.map((node) =>
                  node.id === blockId
                    ? {
                        ...node,
                        properties: {
                          ...node.properties,
                          scaled: node.properties.scaled ? null : true,
                        },
                      }
                    : node,
                ),
              },
        ),
      },
    });
  };

  /** Turns a block's ports onto the other pair of sides. */
  turnBlockPorts = (blockId: string) => {
    const doc = this.document;
    this.replace({
      ...doc,
      layout: {
        ...doc.layout,
        ports: {
          ...doc.layout.ports,
          [blockId]: turnPorts(
            portsOf(doc.layout, blockId, this.kindOf(blockId)),
          ),
        },
      },
    });
  };

  /**
   * Adds an annotation to a block, or reports the one it already has.
   *
   * The button that calls this is the same button for both cases: an author who
   * presses "add a note" on a block that has one means to edit that note, not
   * to collect a second one.
   */
  annotationFor = (blockId: string, text: string): string => {
    const doc = this.document;
    const existing = doc.semantic.annotations.find(
      (annotation) => annotation.ownerObjectId === blockId,
    );
    if (existing) return existing.id;
    const id = `annotation-${crypto.randomUUID()}`;
    this.replace({
      ...doc,
      semantic: {
        ...doc.semantic,
        annotations: [
          ...doc.semantic.annotations,
          { id, ownerObjectId: blockId, text },
        ],
      },
      layout: {
        ...doc.layout,
        annotationOffsets: {
          ...doc.layout.annotationOffsets,
          [id]: placeAnnotation(doc, blockId, { width: 280, height: 95 }),
        },
      },
    });
    return id;
  };

  /** Which kind of diagram a block belongs to, which decides its defaults. */
  private kindOf = (blockId: string): "hld" | "er" | "sequence" => {
    for (const diagram of this.document.semantic.diagrams) {
      const blocks =
        diagram.type === "hld"
          ? diagram.nodes
          : diagram.type === "er"
            ? diagram.entities
            : diagram.participants;
      if (blocks.some((block) => block.id === blockId)) return diagram.type;
    }
    return "hld";
  };
  /**
   * Draws a connection the way the author picked.
   *
   * The style is stored as what it means -- an interaction, and whether it
   * points both ways -- rather than as a second field describing the same line
   * twice.
   */
  setConnectionStyle = (edgeId: string, styleId: ConnectionStyleId) => {
    const style = styleById(styleId);
    const doc = this.document;
    this.replace({
      ...doc,
      semantic: {
        ...doc.semantic,
        diagrams: doc.semantic.diagrams.map((diagram) =>
          diagram.type !== "hld"
            ? diagram
            : {
                ...diagram,
                edges: diagram.edges.map((edge) =>
                  edge.id === edgeId
                    ? {
                        ...edge,
                        interaction: style.interaction,
                        bidirectional: style.bidirectional ? true : null,
                      }
                    : edge,
                ),
              },
        ),
      },
    });
  };

  /**
   * Where a connection's label sits and how big it is.
   *
   * Layout, like a port: it goes through `replace`, so a drag or a resize is
   * one undo step, and the semantic half of the document is never touched.
   */
  setEdgeLabel = (edgeId: string, patch: Partial<EdgeLabelLayout>) => {
    const doc = this.document;
    const current = edgeLabelOf(doc.layout, edgeId);
    this.replace({
      ...doc,
      layout: {
        ...doc.layout,
        edgeLabels: {
          ...doc.layout.edgeLabels,
          [edgeId]: { ...current, ...patch },
        },
      },
    });
  };

  /**
   * Sets a label the next way round its line.
   *
   * A dragged offset gives way: the author pressed the button to see the next
   * placement, and a label held where it was dragged would show them nothing.
   * The size stays, because it was chosen for the text rather than the spot.
   */
  cycleEdgeLabelPlacement = (edgeId: string) => {
    const current = edgeLabelOf(this.document.layout, edgeId);
    this.setEdgeLabel(edgeId, {
      placement: nextPlacement(current.placement),
      dx: null,
      dy: null,
    });
  };

  /**
   * How one object's text is set. Layout, so one undo step each and nothing
   * about the design changes.
   */
  setTextStyle = (objectId: string, patch: Partial<TextStyle>) => {
    const doc = this.document;
    const current = textStyleOf(doc.layout, objectId);
    this.replace({
      ...doc,
      layout: {
        ...doc.layout,
        textStyles: {
          ...doc.layout.textStyles,
          [objectId]: { ...current, ...patch },
        },
      },
    });
  };

  /** One size step up or down; nothing is recorded at either end of the range. */
  resizeText = (objectId: string, direction: 1 | -1) => {
    const current = textStyleOf(this.document.layout, objectId);
    const scale = nextScale(current.scale, direction);
    if (scale !== current.scale) this.setTextStyle(objectId, { scale });
  };

  cycleTextEmphasis = (objectId: string) => {
    const current = textStyleOf(this.document.layout, objectId);
    this.setTextStyle(objectId, { emphasis: nextEmphasis(current.emphasis) });
  };

  cycleTextFont = (objectId: string) => {
    const current = textStyleOf(this.document.layout, objectId);
    this.setTextStyle(objectId, { font: nextFont(current.font) });
  };

  /**
   * Points a one-way connection the other way.
   *
   * This one is design, not layout: which side calls which is exactly what an
   * arrow says, so the two ends of the connection trade places. The ports it is
   * drawn between are bound as they are drawn now, swapped, so the line stays on
   * the page where it was and only its arrowhead moves -- left to the defaults,
   * a reversed line would jump to other ports on both blocks.
   */
  reverseConnection = (edgeId: string) => {
    const doc = this.document;
    const edge = doc.semantic.diagrams
      .flatMap((diagram) => (diagram.type === "hld" ? diagram.edges : []))
      .find((candidate) => candidate.id === edgeId);
    if (!edge) return;
    const source = portOfEdge(
      doc.layout,
      edgeId,
      edge.sourceId,
      "source",
      "hld",
    );
    const target = portOfEdge(
      doc.layout,
      edgeId,
      edge.targetId,
      "target",
      "hld",
    );
    this.replace({
      ...doc,
      semantic: {
        ...doc.semantic,
        diagrams: doc.semantic.diagrams.map((diagram) =>
          diagram.type !== "hld"
            ? diagram
            : {
                ...diagram,
                edges: diagram.edges.map((candidate) =>
                  candidate.id === edgeId
                    ? {
                        ...candidate,
                        sourceId: candidate.targetId,
                        targetId: candidate.sourceId,
                      }
                    : candidate,
                ),
              },
        ),
      },
      layout: {
        ...doc.layout,
        edgePorts: {
          ...doc.layout.edgePorts,
          [edgeId]: { source: target, target: source },
        },
      },
    });
  };

  /** Adds an empty item to one of the task's lists and returns its id. */
  addContextItem = (kind: ContextItemKind): string => {
    const doc = this.document;
    const item = newContextItem(kind);
    this.replace({
      ...doc,
      semantic: {
        ...doc.semantic,
        context: {
          ...doc.semantic.context,
          [kind]: [...doc.semantic.context[kind], item],
        },
      },
    });
    return item.id;
  };

  /**
   * Removes one item from the task.
   *
   * A requirement is referred to by the criteria that check it, and the server
   * refuses a reference to a requirement that is gone, so those references go
   * with it in the same step.
   */
  removeContextItem = (itemId: string) => {
    const doc = this.document;
    const context = doc.semantic.context;
    const keep = <T extends { id: string }>(items: T[]) =>
      items.some((item) => item.id === itemId)
        ? items.filter((item) => item.id !== itemId)
        : items;
    const next = {
      requirements: keep(context.requirements),
      acceptanceCriteria: keep(context.acceptanceCriteria).map((criterion) =>
        criterion.requirementRefs.includes(itemId)
          ? {
              ...criterion,
              requirementRefs: criterion.requirementRefs.filter(
                (ref) => ref !== itemId,
              ),
            }
          : criterion,
      ),
      technicalParameters: keep(context.technicalParameters),
      assumptions: keep(context.assumptions),
      constraints: keep(context.constraints),
    };
    this.replace({ ...doc, semantic: { ...doc.semantic, context: next } });
  };

  /** Where a task panel stands. Layout: one undo step, nothing said changes. */
  moveContextPanel = (section: ContextSectionId, rect: Position) => {
    const doc = this.document;
    this.replace({
      ...doc,
      layout: {
        ...doc.layout,
        contextPanels: { ...doc.layout.contextPanels, [section]: rect },
      },
    });
  };

  /** Remembers which port each end of a connection was drawn from. */
  bindEdgePorts = (edgeId: string, source: string, target: string) => {
    const doc = this.document;
    this.replace(
      {
        ...doc,
        layout: {
          ...doc.layout,
          edgePorts: { ...doc.layout.edgePorts, [edgeId]: { source, target } },
        },
      },
      false,
    );
  };
  /** Refusals stay silent: the arrows are always visible and simply do nothing at the edges. */
  reorderMessage = (id: string, delta: number) => {
    try {
      this.dispatch({ type: "message.reorder", messageId: id, delta });
    } catch (error) {
      if (!(error instanceof CommandError)) throw error;
    }
  };
  addMessage = (kind: Message["kind"]) => {
    const diagram = this.document.semantic.diagrams.find(
      (d) => d.type === "sequence",
    );
    if (
      !diagram ||
      diagram.type !== "sequence" ||
      diagram.participants.length < 2
    )
      return;
    const request = [...diagram.messages]
      .reverse()
      .find((message) => message.kind === "sync");
    if (kind === "return" && !request) return;
    const message: Message = {
      id: `message-${crypto.randomUUID()}`,
      sourceId:
        kind === "return" ? request!.targetId : diagram.participants[0].id,
      targetId:
        kind === "return" ? request!.sourceId : diagram.participants[1].id,
      order: Math.max(0, ...diagram.messages.map((m) => m.order)) + 1,
      kind,
      label:
        kind === "return"
          ? "Response"
          : kind === "async"
            ? "Publish event"
            : "Request",
      replyToMessageId: kind === "return" ? request!.id : null,
      originTemplateObjectId: null,
    };
    this.updateDiagram(diagram.id, (current) =>
      current.type === "sequence"
        ? { ...current, messages: [...current.messages, message] }
        : current,
    );
    const doc = this.document,
      frame = doc.layout.diagramFrames[diagram.id];
    const height = Math.max(frame.height, 230 + message.order * 70);
    if (height !== frame.height)
      this.replace({
        ...doc,
        layout: {
          ...doc.layout,
          diagramFrames: {
            ...doc.layout.diagramFrames,
            [diagram.id]: { ...frame, height },
          },
        },
      });
  };
}
