import fixture from "./mixed.json";
import type { CanvasDocument, HldDiagram, SequenceDiagram } from "./types";

/** The source fixture's semantics are preserved; this is the prototype's explicit initial layout. */
export function createMixedDocument(): CanvasDocument {
  const doc = structuredClone(fixture) as CanvasDocument;
  doc.layout.diagramFrames = {
    "diagram-hld": { x: 0, y: 0, width: 850, height: 350 },
    "diagram-er": { x: 0, y: 390, width: 850, height: 330 },
    "diagram-sequence": { x: 900, y: 0, width: 650, height: 720 },
  };
  doc.layout.objectPositions = {
    "hld-payment": { x: 35, y: 105, width: 220, height: 112 },
    "hld-orders": { x: 315, y: 105, width: 220, height: 112 },
    "hld-store": { x: 595, y: 105, width: 220, height: 112 },
    "entity-order": { x: 45, y: 500, width: 260, height: 150 },
    "entity-event": { x: 525, y: 500, width: 280, height: 150 },
    "participant-payment": { x: 945, y: 90, width: 210, height: 82 },
    "participant-orders": { x: 1285, y: 90, width: 210, height: 82 },
  };
  doc.semantic.notes.forEach((note, i) => {
    doc.layout.objectPositions[note.id] = {
      x: 40 + i * 430,
      y: 780,
      width: 380,
      height: 130,
    };
  });
  doc.layout.annotationOffsets["annotation-orders"] = {
    dx: 0,
    dy: 137,
    width: 300,
    height: 75,
  };
  return doc;
}

/** Deterministic workload: 150 blocks, 250 graph edges, 100 annotations, 40 messages. */
export function createStandardDocument(): CanvasDocument {
  const doc = createMixedDocument();
  const hld = doc.semantic.diagrams.find(
    (d): d is HldDiagram => d.type === "hld",
  )!;
  for (let i = 3; i < 146; i++) {
    const id = `load-block-${i}`;
    hld.nodes.push({
      id,
      kind: i % 6 === 0 ? "datastore" : "service",
      label: `Service ${i}`,
      properties: { responsibility: `Processing step ${i}`, technology: null },
      originTemplateObjectId: null,
    });
    doc.layout.objectPositions[id] = {
      x: (i % 10) * 290,
      y: 850 + Math.floor(i / 10) * 210,
      width: 220,
      height: 112,
    };
  }
  for (let i = hld.edges.length; i < 249; i++) {
    hld.edges.push({
      id: `load-edge-${i}`,
      sourceId: hld.nodes[i % hld.nodes.length].id,
      targetId:
        hld.nodes[(i + 1 + Math.floor(i / hld.nodes.length)) % hld.nodes.length]
          .id,
      label: `event ${i}`,
      interaction: i % 2 ? "async" : "sync",
      protocol: null,
      originTemplateObjectId: null,
    });
  }
  for (let i = 1; i < 100; i++) {
    const id = `load-annotation-${i}`;
    doc.semantic.annotations.push({
      id,
      ownerObjectId: hld.nodes[i].id,
      text: `Design observation ${i}`,
    });
    doc.layout.annotationOffsets[id] = {
      dx: 0,
      dy: 130,
      width: 230,
      height: 60,
    };
  }
  const seq = doc.semantic.diagrams.find(
    (d): d is SequenceDiagram => d.type === "sequence",
  )!;
  for (let i = 3; i <= 40; i++)
    seq.messages.push({
      id: `load-message-${i}`,
      sourceId: seq.participants[0].id,
      targetId: seq.participants[1].id,
      order: i,
      kind: i % 2 ? "async" : "sync",
      label: `Process event ${i}`,
      replyToMessageId: null,
      originTemplateObjectId: null,
    });
  doc.layout.diagramFrames["diagram-sequence"].height = 3100;
  return doc;
}

/**
 * The mixed canvas's task with nothing drawn yet: what a Custom canvas, or one
 * started from a card that opens no schema, holds when it opens.
 */
export function createTaskOnlyDocument(): CanvasDocument {
  const doc = createMixedDocument();
  doc.semantic.diagrams = [];
  doc.semantic.annotations = [];
  doc.semantic.notes = [];
  // With no diagrams, nothing in the task can be scoped to one.
  for (const items of Object.values(doc.semantic.context))
    for (const item of items as Array<{ diagramIds: string[] }>)
      item.diagramIds = [];
  doc.layout.objectPositions = {};
  doc.layout.annotationOffsets = {};
  doc.layout.diagramFrames = {};
  delete doc.layout.ports;
  delete doc.layout.edgePorts;
  return doc;
}
