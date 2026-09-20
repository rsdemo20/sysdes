import {
  Profiler,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  applyNodeChanges,
  ConnectionMode,
  type Connection,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
  type ReactFlowInstance,
  useStoreApi,
} from "@xyflow/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { CanvasDocument, Diagram, Position } from "../model/types";
import { EditorStore } from "./EditorStore";
import {
  CanvasNode,
  ConnectionEdge,
  type CardData,
  type CardNode,
  type CanvasEdge,
  type ConnectionData,
} from "./CanvasNodes";
import { findShortName, shortNameOf } from "./shortName";
import { leaderColour, leaderHandles } from "./annotationLeader";
import { portOfEdge, portsOf, type BlockPort } from "./ports";
import { makeRoom } from "./relax";
import { LABEL, labelSpot, type Rect } from "./labelSpot";
import { styleOf } from "./connectionStyle";
import { edgeLabelOf } from "./edgeLabel";
import {
  INITIAL_VIEW,
  contentBounds,
  topLeftViewport,
} from "./initialViewport";
import {
  CONTEXT_SECTIONS,
  panelId,
  panelRectOf,
  sectionOfPanel,
  type ContextPanelModel,
} from "./contextPanels";
import { textStyleOf, type TextStyle } from "./textStyle";

/**
 * How near a frame's border a press has to be to mean the frame.
 *
 * Further in and the press belongs to the diagram's contents. The number is a
 * compromise the requirement names: close enough that clicking a block never
 * grabs the frame, wide enough that a person aiming at an edge hits it.
 */
const BORDER_REACH = 30;

const NO_GROUP: ReadonlySet<string> = new Set();

/**
 * Whether a node can be part of a selected group.
 *
 * Blocks and their annotations can. A frame cannot: it already carries the
 * blocks inside it when it moves, and in a group they would be moved twice.
 * The task panels cannot either -- they are the statement, not the drawing.
 */
function groupable(kind: CardData["kind"] | undefined) {
  return kind !== undefined && kind !== "frame" && kind !== "context";
}

/**
 * Shift adds a block to the selection. Shift alone: Ctrl already has work of
 * its own on the canvas -- walking a port, zooming with the wheel.
 */
function adds(event: { shiftKey: boolean }) {
  return event.shiftKey;
}
/**
 * How far a press may wander and still be a click. A hand on a mouse moves a
 * pixel or two while clicking; counted as a drag, that swallowed the click and
 * with it a Shift-click meant to add a block.
 */
const CLICK_SLACK = 4;

type FlowStore = ReturnType<typeof useStoreApi>;
/** Hands the canvas React Flow's store, which lives only inside the flow. */
function FlowStoreBridge({ into }: { into: { current: FlowStore | null } }) {
  into.current = useStoreApi();
  return null;
}

const nodeTypes = { card: CanvasNode };
const edgeTypes = { connection: ConnectionEdge };

/**
 * The head drawn at an end of a connection. React Flow orients a marker with
 * `auto-start-reverse`, so the same head serves the start of a line as well as
 * its end and points outward at both.
 */
function arrowhead(kind: string) {
  return {
    type: kind === "async" ? MarkerType.Arrow : MarkerType.ArrowClosed,
    color: "#667895",
    width: 16,
    height: 16,
  };
}
const defaultEdgeOptions = { type: "connection" };
const flowOptions = { hideAttribution: false };

function members(diagram: Diagram) {
  return diagram.type === "hld"
    ? diagram.nodes
    : diagram.type === "er"
      ? diagram.entities
      : diagram.participants;
}

export const PrototypeCanvas = memo(function PrototypeCanvas({
  store,
  locale,
  onSelect,
  onHover,
  readOnly = false,
}: {
  store: EditorStore;
  locale: "ru" | "en";
  onSelect: (id: string | null) => void;
  /** The object under the cursor, for the status line. Frames are not objects. */
  onHover?: (id: string | null) => void;
  /**
   * Show the document without offering to change it.
   *
   * Used to read a catalog entry: the reader pans and zooms over someone else's
   * finished work, so every affordance that would edit it is absent rather than
   * merely ignored -- a button that does nothing is worse than no button.
   */
  readOnly?: boolean;
}) {
  const document = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const nodeCache = useRef(new Map<string, CardNode>());
  const edgeCache = useRef(new Map<string, CanvasEdge>());
  // A panel's model is kept while the task it shows is the same object, so a
  // move elsewhere on the canvas does not redraw the three panels.
  const contextModels = useRef(new Map<string, ContextPanelModel>());
  const [selection, setSelection] = useState<string | null>(null);
  // Blocks selected together with `selection`, which stays the one picked last:
  // it is what the inspector shows, and a click on a connection replaces it.
  const [group, setGroup] = useState<ReadonlySet<string>>(NO_GROUP);
  // While Shift is dragging a selection box: what was selected when it began,
  // and what the box has caught so far.
  /**
   * Nodes React Flow has marked selected or not on its own.
   *
   * It flips the flag on its internal copy of a node as a click lands, and
   * keeps that copy for as long as it is handed the same node object. Selection
   * here is decided by the click handler, so a node the library touched is
   * rebuilt on the next render and the library takes our flag again -- else a
   * block could lose its panel, or drop out of a group, while still selected.
   */
  const overruled = useRef(new Set<string>());
  const [resync, setResync] = useState(0);
  const flowStore = useRef<FlowStore | null>(null);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const boxRef = useRef<{ base: Set<string>; caught: Set<string> } | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<string | null>(null);
  const [liveNodes, setLiveNodes] = useState<CardNode[] | null>(null);
  const annotate = useCallback(
    (blockId: string) => {
      const id = store.annotationFor(
        blockId,
        locale === "ru"
          ? "Опишите решение или открытый вопрос…"
          : "Describe a decision or an open question…",
      );
      // The note may have just been created, so the field is looked for after
      // the canvas has drawn it.
      requestAnimationFrame(() => {
        const field = window.document.querySelector<HTMLTextAreaElement>(
          `[data-id="${id}"] textarea`,
        );
        field?.focus();
        field?.select();
      });
    },
    [store, locale],
  );
  const graph = useMemo(() => {
    const nodes: CardNode[] = [],
      edges: CanvasEdge[] = [];
    const node = (
      id: string,
      model: CardData["model"],
      kind: CardData["kind"],
      position: Position,
      lineHeight?: number,
      shortName?: string | null,
      leader?: string,
      leaderAnchors?: boolean,
      ports?: BlockPort[],
      onAnnotate?: (blockId: string) => void,
      frameResize?: boolean,
      textStyle?: TextStyle,
    ) => {
      const old = nodeCache.current.get(id);
      const data: CardData =
        old?.data.model === model &&
        old.data.locale === locale &&
        old.data.lineHeight === lineHeight &&
        // A derived short name can change while the block itself does not:
        // deleting an earlier block shifts the position it is counted from.
        old.data.shortName === shortName &&
        old.data.leader === leader &&
        old.data.leaderAnchors === leaderAnchors &&
        old.data.ports === ports &&
        old.data.onAnnotate === onAnnotate &&
        old.data.frameResize === frameResize &&
        old.data.textStyle === textStyle &&
        old.data.readOnly === readOnly
          ? old.data
          : {
              kind,
              model,
              store,
              locale,
              lineHeight,
              shortName,
              leader,
              leaderAnchors,
              ports,
              onAnnotate,
              frameResize,
              textStyle,
              readOnly,
            };
      const selected =
        kind === "frame"
          ? selectedFrame === id
          : selection === id || group.has(id);
      const next: CardNode =
        old &&
        old.data === data &&
        old.position.x === position.x &&
        old.position.y === position.y &&
        old.width === position.width &&
        old.height === position.height &&
        old.selected === selected &&
        !overruled.current.has(id)
          ? old
          : {
              id,
              type: "card",
              position: { x: position.x, y: position.y },
              data,
              width: position.width,
              height: position.height,
              measured: { width: position.width, height: position.height },
              style: { width: position.width, height: position.height },
              selected,
              // `nokey`: with Shift held, a press on a block is a Shift-click
              // on that block, not the start of a selection box drawn from it.
              // The box starts from empty canvas -- and from inside a frame,
              // whose body lets presses through to the canvas.
              className: kind === "frame" ? undefined : "nokey",
              draggable: !readOnly,
              // A frame is moved by its header alone: its body is the backdrop
              // a canvas is panned across, and dragging from anywhere would
              // take the diagram with every attempt to pan.
              dragHandle: kind === "frame" ? ".frame-heading" : undefined,
              // A frame is selectable so it can be resized, but never dragged:
              // moving it would leave its blocks behind.
              selectable: true,
              connectable:
                !readOnly &&
                kind !== "frame" &&
                kind !== "annotation" &&
                kind !== "note" &&
                kind !== "context",
              // A frame sits under the blocks but not under the pane: at a
              // negative depth its own resize handles are unreachable by the
              // pointer. Its body ignores pointer events instead, so dragging
              // inside a frame still pans the canvas.
              zIndex: kind === "frame" ? 0 : kind === "annotation" ? 4 : 1,
            };
      nodeCache.current.set(id, next);
      nodes.push(next);
    };
    const edge = (
      id: string,
      source: string,
      target: string,
      data: ConnectionData,
      // Which defaults the two ends draw, when they have stored no ports.
      kind: "hld" | "er" | "sequence" = "hld",
    ) => {
      const sourceHandle = portOfEdge(
        document.layout,
        id,
        source,
        "source",
        kind,
      );
      const targetHandle = portOfEdge(
        document.layout,
        id,
        target,
        "target",
        kind,
      );
      const old = edgeCache.current.get(id);
      // Edges are a controlled prop here, so React Flow cannot record a
      // selection of its own: the editor's own state is what marks one.
      const chosen = selection === id;
      const same =
        old &&
        old.data &&
        old.sourceHandle === sourceHandle &&
        old.targetHandle === targetHandle &&
        old.selected === chosen &&
        Object.keys(data).every((key) => data[key] === old.data![key]);
      const next: CanvasEdge = same
        ? old
        : {
            id,
            source,
            target,
            selected: chosen,
            sourceHandle,
            targetHandle,
            type: "connection",
            data,
            zIndex: 3,
            markerEnd: arrowhead(data.kind),
            // A line that points both ways needs its second head supplied: the
            // edge only draws a start marker it is given, and without this one
            // the two-way style drew a one-way arrow.
            ...(data.style?.arrowAtSource
              ? { markerStart: arrowhead(data.kind) }
              : {}),
          };
      edgeCache.current.set(id, next);
      edges.push(next);
    };
    // What a connection's label must not cover: every block, and then every
    // label already placed.
    const obstacles: Rect[] = Object.values(document.layout.objectPositions);

    // Only a block that actually carries an annotation needs the anchors a
    // leader ends on; the rest keep exactly the two handles they always had.
    const annotated = new Set(
      document.semantic.annotations.map((a) => a.ownerObjectId),
    );
    for (const diagram of document.semantic.diagrams) {
      const frame = document.layout.diagramFrames[diagram.id];
      node(
        diagram.id,
        diagram,
        "frame",
        frame,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        selectedFrame === diagram.id,
      );
      for (const member of members(diagram)) {
        const position = document.layout.objectPositions[member.id];
        node(
          member.id,
          member,
          diagram.type,
          position,
          diagram.type === "sequence"
            ? Math.max(
                0,
                frame.y + frame.height - 40 - position.y - position.height,
              )
            : undefined,
          shortNameOf(diagram, member.id),
          undefined,
          annotated.has(member.id),
          portsOf(document.layout, member.id, diagram.type),
          annotate,
          undefined,
          textStyleOf(document.layout, member.id),
        );
      }
      if (diagram.type === "hld")
        for (const connection of diagram.edges) {
          const from = document.layout.objectPositions[connection.sourceId];
          const to = document.layout.objectPositions[connection.targetId];
          // The label rides the run between the two blocks and steps along it
          // until it is clear of the blocks and of the labels already placed.
          const point = from && to ? labelSpot(from, to, obstacles) : undefined;
          if (point)
            obstacles.push({
              x: point.x - LABEL.width / 2,
              y: point.y - LABEL.height / 2,
              ...LABEL,
            });
          edge(connection.id, connection.sourceId, connection.targetId, {
            store,
            locale,
            label: connection.label,
            kind: connection.interaction,
            style: styleOf(connection),
            labelPoint: point,
            labelLayout: edgeLabelOf(document.layout, connection.id),
            textStyle: textStyleOf(document.layout, connection.id),
            readOnly,
          });
        }
      if (diagram.type === "er")
        for (const connection of diagram.relationships)
          edge(
            connection.id,
            connection.sourceEntityId,
            connection.targetEntityId,
            {
              store,
              locale,
              label: connection.label,
              kind: "er",
              textStyle: textStyleOf(document.layout, connection.id),
              readOnly,
            },
            "er",
          );
      if (diagram.type === "sequence")
        for (const message of diagram.messages) {
          const source = document.layout.objectPositions[message.sourceId],
            target = document.layout.objectPositions[message.targetId];
          edge(
            message.id,
            message.sourceId,
            message.targetId,
            {
              store,
              locale,
              label: message.label,
              kind: message.kind,
              message,
              fixedY: frame.y + 220 + (message.order - 1) * 70,
              sourceCenter: source.x + source.width / 2,
              targetCenter: target.x + target.width / 2,
              textStyle: textStyleOf(document.layout, message.id),
              readOnly,
            },
            "sequence",
          );
        }
    }
    for (const annotation of document.semantic.annotations) {
      const owner = document.layout.objectPositions[annotation.ownerObjectId],
        offset = document.layout.annotationOffsets[annotation.id];
      if (!owner || !offset) continue;
      const colour = leaderColour(annotation.id);
      node(
        annotation.id,
        annotation,
        "annotation",
        {
          x: owner.x + offset.dx,
          y: owner.y + offset.dy,
          width: offset.width,
          height: offset.height,
        },
        undefined,
        findShortName(document.semantic.diagrams, annotation.ownerObjectId),
        colour,
        undefined,
        undefined,
        undefined,
        undefined,
        textStyleOf(document.layout, annotation.id),
      );
      // A leader, not a connection: it is drawn from the annotation to the
      // block it describes and belongs to no diagram. Nothing can select it,
      // click it or route a message along it.
      const anchors = leaderHandles(
        {
          x: owner.x + offset.dx,
          y: owner.y + offset.dy,
          width: offset.width,
          height: offset.height,
        },
        owner,
      );
      edges.push({
        id: `lead-${annotation.id}`,
        source: annotation.id,
        target: annotation.ownerObjectId,
        sourceHandle: anchors.source,
        targetHandle: anchors.target,
        type: "straight",
        selectable: false,
        focusable: false,
        interactionWidth: 0,
        zIndex: 2,
        style: { stroke: colour, strokeDasharray: "3 5", strokeWidth: 1 },
      } as CanvasEdge);
    }
    for (const note of document.semantic.notes) {
      const p = document.layout.objectPositions[note.id];
      if (p)
        node(
          note.id,
          note,
          "note",
          p,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          textStyleOf(document.layout, note.id),
        );
    }
    // The task, in its three panels: always there, in a column of their own
    // unless the author moved them.
    for (const section of CONTEXT_SECTIONS) {
      const id = panelId(section.id);
      const cached = contextModels.current.get(id);
      const model =
        cached && cached.context === document.semantic.context
          ? cached
          : { id, section: section.id, context: document.semantic.context };
      contextModels.current.set(id, model);
      node(id, model, "context", panelRectOf(document, section.id));
    }
    overruled.current.clear();
    return { nodes, edges };
    // `resync` has no value to read: it only asks for the rebuild above.
  }, [document, store, locale, selection, group, selectedFrame, annotate, readOnly, resync]);
  const displayedNodes = liveNodes ?? graph.nodes;
  const livePositions = new Map(displayedNodes.map((node) => [node.id, node]));
  const displayedEdges = liveNodes
    ? graph.edges.map((edge) => {
        if (!edge.data?.message) return edge;
        const a = livePositions.get(edge.source),
          b = livePositions.get(edge.target);
        if (!a || !b) return edge;
        return {
          ...edge,
          data: {
            ...edge.data,
            sourceCenter: a.position.x + (a.width ?? 0) / 2,
            targetCenter: b.position.x + (b.width ?? 0) / 2,
          },
        };
      })
    : graph.edges;
  const displayedRef = useRef(displayedNodes);
  displayedRef.current = displayedNodes;
  /** Every block selected right now: the last one picked and its group. */
  const selectedBlocks = useCallback(() => {
    const all = new Set(group);
    if (selection && displayedRef.current.some((node) => node.id === selection))
      all.add(selection);
    return all;
  }, [group, selection]);
  /**
   * Make `members` the selection, keeping `preferred` as the one the inspector
   * shows if it is still among them.
   */
  const selectBlocks = useCallback(
    (members: Set<string>, preferred: string | null) => {
      const primary =
        preferred && members.has(preferred)
          ? preferred
          : (members.values().next().value ?? null);
      const rest = new Set(members);
      if (primary) rest.delete(primary);
      setSelectedFrame(null);
      setSelection(primary);
      setGroup(rest.size ? rest : NO_GROUP);
      onSelect(primary);
    },
    [onSelect],
  );
  const kindOf = (id: string) =>
    displayedRef.current.find((node) => node.id === id)?.data.kind;
  const startBox = useCallback(() => {
    boxRef.current = { base: selectedBlocks(), caught: new Set() };
  }, [selectedBlocks]);
  const endBox = useCallback(() => {
    boxRef.current = null;
  }, []);
  const onNodesChange = useCallback(
    (changes: NodeChange<CardNode>[]) => {
      // A Shift-drawn box adds what it catches to what was already selected;
      // outside a box, selection is decided by the click handler instead.
      const flipped = changes.filter((change) => change.type === "select");
      if (flipped.length) {
        for (const change of flipped) overruled.current.add(change.id);
        setResync((n) => n + 1);
      }
      const box = boxRef.current;
      if (box) {
        let touched = false;
        for (const change of changes) {
          if (change.type !== "select" || !groupable(kindOf(change.id))) continue;
          if (change.selected) box.caught.add(change.id);
          else box.caught.delete(change.id);
          touched = true;
        }
        if (touched) {
          const members = new Set([...box.base, ...box.caught]);
          selectBlocks(members, selection);
        }
      }
      const meaningful = changes.filter(
        (change) =>
          change.type === "position" ||
          (change.type === "dimensions" && change.resizing !== undefined),
      );
      if (!meaningful.length) return;
      const oldNodes = displayedRef.current;
      const changed = applyNodeChanges(meaningful, oldNodes).map((node) => {
        const annotation = store
          .getSnapshot()
          .semantic.annotations.find((a) => a.id === node.id);
        if (
          annotation &&
          !meaningful.some((c) => "id" in c && c.id === node.id)
        ) {
          const change = meaningful.find(
            (c) =>
              "id" in c &&
              c.id === annotation.ownerObjectId &&
              c.type === "position",
          );
          const owner = oldNodes.find((n) => n.id === annotation.ownerObjectId);
          if (change?.type === "position" && change.position && owner)
            return {
              ...node,
              position: {
                x: node.position.x + change.position.x - owner.position.x,
                y: node.position.y + change.position.y - owner.position.y,
              },
            };
        }
        if (
          meaningful.some(
            (c) => "id" in c && c.id === node.id && c.type === "dimensions",
          )
        )
          return {
            ...node,
            width: Math.round(node.measured?.width ?? node.width!),
            height: Math.round(node.measured?.height ?? node.height!),
            measured: {
              width: Math.round(node.measured?.width ?? node.width!),
              height: Math.round(node.measured?.height ?? node.height!),
            },
            style: {
              ...node.style,
              width: Math.round(node.measured?.width ?? node.width!),
              height: Math.round(node.measured?.height ?? node.height!),
            },
          };
        return node;
      });
      displayedRef.current = changed;
      setLiveNodes(changed);
      const finished = meaningful.some((change) =>
        change.type === "position"
          ? change.dragging === false
          : change.type === "dimensions" && change.resizing === false,
      );
      if (!finished) return;
      const doc = store.getSnapshot();
      const positions = { ...doc.layout.objectPositions },
        offsets = { ...doc.layout.annotationOffsets },
        frames = { ...doc.layout.diagramFrames };
      const panels: NonNullable<CanvasDocument["layout"]["contextPanels"]> = {
        ...doc.layout.contextPanels,
      };
      let touched = false;
      const carried: Array<{ diagramId: string; dx: number; dy: number }> = [];
      for (const item of changed) {
        const section = sectionOfPanel(item.id);
        if (section) {
          const original = panelRectOf(doc, section);
          if (
            original.x !== item.position.x ||
            original.y !== item.position.y ||
            original.width !== item.width ||
            original.height !== item.height
          ) {
            panels[section] = {
              x: item.position.x,
              y: item.position.y,
              width: item.width!,
              height: item.height!,
            };
            touched = true;
          }
          continue;
        }
        if (frames[item.id]) {
          const original = frames[item.id];
          if (
            original.x !== item.position.x ||
            original.y !== item.position.y ||
            original.width !== item.width ||
            original.height !== item.height
          ) {
            // A frame that moved carries its diagram, but the shift is applied
            // after this loop: the loop also visits every block, and a block
            // moved here would be written back from its own unchanged change.
            const dx = item.position.x - original.x;
            const dy = item.position.y - original.y;
            if (dx || dy) carried.push({ diagramId: item.id, dx, dy });
            frames[item.id] = {
              x: item.position.x,
              y: item.position.y,
              width: item.width!,
              height: item.height!,
            };
            touched = true;
          }
        } else if (positions[item.id]) {
          const original = positions[item.id];
          if (
            original.x !== item.position.x ||
            original.y !== item.position.y ||
            original.width !== item.width ||
            original.height !== item.height
          ) {
            positions[item.id] = {
              x: item.position.x,
              y: item.position.y,
              width: item.width!,
              height: item.height!,
            };
            touched = true;
          }
        } else if (offsets[item.id]) {
          const annotation = doc.semantic.annotations.find(
            (a) => a.id === item.id,
          )!;
          // The owner's new place, not the one in the document: in a group
          // move both have shifted, and which the loop reaches first must
          // not decide where the annotation ends up.
          const ownerNode = changed.find(
            (node) => node.id === annotation.ownerObjectId,
          );
          const owner = ownerNode
            ? ownerNode.position
            : positions[annotation.ownerObjectId];
          const original = offsets[item.id];
          // A stationary annotation follows its owner; only a directly changed annotation writes an offset.
          if (
            !meaningful.some(
              (change) => "id" in change && change.id === item.id,
            )
          )
            continue;
          const next = {
            dx: item.position.x - owner.x,
            dy: item.position.y - owner.y,
            width: item.width!,
            height: item.height!,
          };
          if (
            Object.keys(next).some(
              (key) =>
                next[key as keyof typeof next] !==
                original[key as keyof typeof original],
            )
          ) {
            offsets[item.id] = next;
            touched = true;
          }
        }
      }
      // Everything inside a moved frame keeps its place relative to it, which
      // is the only reading of "the diagram moved" that leaves the drawing
      // intact.
      // A block that moved in this same gesture has its place already; carrying
      // it with its frame as well would move it twice.
      const movedThemselves = new Set(
        meaningful.flatMap((change) =>
          change.type === "position" ? [change.id] : [],
        ),
      );
      for (const move of carried) {
        const diagram = doc.semantic.diagrams.find(
          (candidate) => candidate.id === move.diagramId,
        );
        for (const member of diagram ? members(diagram) : [])
          if (positions[member.id] && !movedThemselves.has(member.id))
            positions[member.id] = {
              ...positions[member.id],
              x: positions[member.id].x + move.dx,
              y: positions[member.id].y + move.dy,
            };
      }
      if (touched) {
        let next = {
          ...doc,
          layout: {
            ...doc.layout,
            objectPositions: positions,
            annotationOffsets: offsets,
            diagramFrames: frames,
            ...(Object.keys(panels).length ? { contextPanels: panels } : {}),
          },
        };
        // A block that finished growing takes the room it needs: neighbours
        // step aside and its own annotation moves off it.
        for (const change of meaningful)
          if (
            change.type === "dimensions" &&
            change.resizing === false &&
            positions[change.id]
          )
            // The document still holds the block as it was before this gesture:
            // a resize writes nothing until it ends, so this is the arrangement
            // the author was looking at when they took hold of the corner.
            next = makeRoom(
              next,
              change.id,
              doc.layout.objectPositions[change.id],
            );
        store.replace(next);
      }
      setLiveNodes(null);
    },
    [store, selectBlocks, selection],
  );
  const selectEdge = useCallback(
    (_event: ReactMouseEvent, connection: CanvasEdge) => {
      setSelection(connection.id);
      setGroup(NO_GROUP);
      setSelectedFrame(null);
      onSelect(null);
    },
    [onSelect],
  );
  const select: NodeMouseHandler<CardNode> = useCallback(
    (event, node) => {
      if (node.data.kind === "frame") {
        // A frame answers to the pointer only near its border. Further in, the
        // press belongs to whatever is inside -- and to the canvas itself --
        // so resize mode ends and the blocks take the focus back.
        const box = (
          event.currentTarget as HTMLElement
        ).getBoundingClientRect();
        const near =
          Math.min(
            Math.abs(event.clientX - box.left),
            Math.abs(box.right - event.clientX),
            Math.abs(event.clientY - box.top),
            Math.abs(box.bottom - event.clientY),
          ) <= BORDER_REACH;
        setSelectedFrame(near ? node.id : null);
        setSelection(null);
        setGroup(NO_GROUP);
        onSelect(null);
        return;
      }
      // Shift adds a block to the selection, or takes it back out.
      if (adds(event) && groupable(node.data.kind)) {
        const members = selectedBlocks();
        if (members.has(node.id)) {
          members.delete(node.id);
          selectBlocks(members, selection === node.id ? null : selection);
        } else {
          members.add(node.id);
          selectBlocks(members, node.id);
        }
        return;
      }
      setSelectedFrame(null);
      setGroup(NO_GROUP);
      setSelection(node.id);
      onSelect(node.id);
    },
    [onSelect, selectedBlocks, selectBlocks, selection],
  );
  /**
   * Taking hold of a block outside the group moves that block alone, so the
   * group lets go of it rather than staying highlighted while it stays put.
   * Taking hold of a member moves the whole group; React Flow does that itself
   * for every node marked selected.
   */
  const dragStart: OnNodeDrag<CardNode> = useCallback(
    (event, node) => {
      if (!groupable(node.data.kind)) return;
      const members = selectedBlocks();
      if (members.has(node.id)) return;
      // With Shift, the block joins the group and moves with it.
      if (adds(event)) {
        members.add(node.id);
        selectBlocks(members, node.id);
        return;
      }
      if (!group.size) return;
      selectBlocks(new Set([node.id]), node.id);
    },
    [group, selectedBlocks, selectBlocks],
  );
  const clearSelection = useCallback(() => {
    setSelection(null);
    setGroup(NO_GROUP);
    setSelectedFrame(null);
    onSelect(null);
  }, [onSelect]);
  /*
   * A box selection leaves a cover over the group: taking hold of it anywhere
   * moves the whole group. It goes once the group does, or it would sit over a
   * single block and keep its fields out of reach.
   */
  useEffect(() => {
    if (!group.size) flowStore.current?.setState({ nodesSelectionActive: false });
  }, [group]);
  /**
   * A click on the cover, rather than a drag of it, is meant for the block
   * underneath: it narrows the selection to that block, or with Shift adds it
   * or takes it out, exactly as a click on an uncovered block would.
   */
  const clickThroughCover = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains("react-flow__nodesselection-rect")) return;
      const from = pressedAt.current;
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > 3)
        return;
      const beneath = window.document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest<HTMLElement>(".react-flow__node"))
        .find((element) => groupable(kindOf(element?.dataset.id ?? "")));
      const node = displayedRef.current.find(
        (candidate) => candidate.id === beneath?.dataset.id,
      );
      if (node) select(event, node);
      else clearSelection();
    },
    [select, clearSelection],
  );

  /**
   * A press inside a frame, on a block or on empty canvas, ends resize mode.
   *
   * The frame keeps the size it was given: nothing is written here, because the
   * resize itself already wrote it. What ends is the mode, and with it the eight
   * grips that would otherwise sit under every click for the rest of the
   * session.
   */
  const leaveFrameResize = useCallback(
    (event: ReactMouseEvent) => {
      if (!selectedFrame) return;
      const frame = window.document.querySelector(
        `[data-id="${selectedFrame}"]`,
      );
      const box = frame?.getBoundingClientRect();
      if (!box) return setSelectedFrame(null);
      const distance = Math.min(
        Math.abs(event.clientX - box.left),
        Math.abs(box.right - event.clientX),
        Math.abs(event.clientY - box.top),
        Math.abs(box.bottom - event.clientY),
      );
      if (distance > BORDER_REACH) setSelectedFrame(null);
    },
    [selectedFrame],
  );
  const hover: NodeMouseHandler<CardNode> = useCallback(
    (_event, node) => {
      // A frame is the diagram's own backdrop, not something to report.
      if (node.data.kind !== "frame" && node.data.kind !== "context")
        onHover?.(node.id);
    },
    [onHover],
  );
  const clearHover = useCallback(() => onHover?.(null), [onHover]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" || !selection) return;
      const target = event.target as HTMLElement | null;
      // Input Isolation: Delete inside a field edits text, never the canvas.
      if (
        target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      )
        return;
      event.preventDefault();
      // A selected group goes as one change, so one undo brings it all back.
      if (group.size) store.deleteObjects([selection, ...group]);
      else store.deleteObject(selection);
      setSelection(null);
      setGroup(NO_GROUP);
      onSelect(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, group, store, onSelect]);

  useEffect(() => {
    if (!selectedFrame) return;
    const STEP = 40;
    const MIN = { width: 240, height: 180 };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || !event.key.startsWith("Arrow")) return;
      const grow =
        event.key === "ArrowRight"
          ? { width: STEP, height: 0 }
          : event.key === "ArrowLeft"
            ? { width: -STEP, height: 0 }
            : event.key === "ArrowDown"
              ? { width: 0, height: STEP }
              : { width: 0, height: -STEP };
      event.preventDefault();
      const doc = store.getSnapshot();
      const frame = doc.layout.diagramFrames[selectedFrame];
      if (!frame) return;
      store.replace({
        ...doc,
        layout: {
          ...doc.layout,
          diagramFrames: {
            ...doc.layout.diagramFrames,
            [selectedFrame]: {
              ...frame,
              width: Math.max(MIN.width, frame.width + grow.width),
              height: Math.max(MIN.height, frame.height + grow.height),
            },
          },
        },
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedFrame, store]);
  const validConnection = useCallback(
    (connection: Connection | CanvasEdge) => {
      if (connection.source === connection.target)
        return store
          .getSnapshot()
          .semantic.diagrams.some(
            (d) =>
              d.type === "sequence" &&
              d.participants.some((p) => p.id === connection.source),
          );
      return store
        .getSnapshot()
        .semantic.diagrams.some(
          (diagram) =>
            members(diagram).some((item) => item.id === connection.source) &&
            members(diagram).some((item) => item.id === connection.target),
        );
    },
    [store],
  );
  const connect = useCallback(
    (connection: Connection) => {
      if (!validConnection(connection)) return;
      const id = `connection-${crypto.randomUUID()}`;
      if (connection.sourceHandle && connection.targetHandle)
        store.bindEdgePorts(
          id,
          connection.sourceHandle,
          connection.targetHandle,
        );
      for (const diagram of store.getSnapshot().semantic.diagrams) {
        if (!members(diagram).some((item) => item.id === connection.source))
          continue;
        store.updateDiagram(diagram.id, (current) => {
          if (current.type === "hld")
            return {
              ...current,
              edges: [
                ...current.edges,
                {
                  id,
                  sourceId: connection.source,
                  targetId: connection.target,
                  label: locale === "ru" ? "Взаимодействие" : "Interaction",
                  interaction: "sync",
                  protocol: null,
                  originTemplateObjectId: null,
                },
              ],
            };
          if (current.type === "er")
            return {
              ...current,
              relationships: [
                ...current.relationships,
                {
                  id,
                  sourceEntityId: connection.source,
                  targetEntityId: connection.target,
                  label: locale === "ru" ? "Связь" : "Relationship",
                  sourceCardinality: "0..*",
                  targetCardinality: "1",
                  fieldMapping: [],
                  enforcement: "logical",
                  originTemplateObjectId: null,
                },
              ],
            };
          return {
            ...current,
            messages: [
              ...current.messages,
              {
                id,
                sourceId: connection.source,
                targetId: connection.target,
                order: Math.max(0, ...current.messages.map((m) => m.order)) + 1,
                kind: "sync",
                label: "Request",
                replyToMessageId: null,
                originTemplateObjectId: null,
              },
            ],
          };
        });
        const updated = store.getSnapshot();
        const seq = updated.semantic.diagrams.find((d) => d.id === diagram.id);
        if (seq?.type === "sequence") {
          const frame = updated.layout.diagramFrames[seq.id];
          const height = Math.max(
            frame.height,
            300 + Math.max(0, ...seq.messages.map((m) => m.order)) * 70,
          );
          if (height !== frame.height)
            store.replace({
              ...updated,
              layout: {
                ...updated.layout,
                diagramFrames: {
                  ...updated.layout.diagramFrames,
                  [seq.id]: { ...frame, height },
                },
              },
            });
        }
      }
    },
    [store, validConnection, locale],
  );
  // The canvas opens fitted but set against its top-left corner rather than
  // centred, so a canvas holding only its task shows the task panels at the
  // left edge instead of in the middle of the screen.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const placeInitialView = useCallback(
    (instance: ReactFlowInstance<CardNode, CanvasEdge>) => {
      const shell = shellRef.current;
      const bounds = contentBounds(displayedRef.current);
      if (!shell || !bounds) return;
      const { width, height } = shell.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      void instance.setViewport(topLeftViewport(bounds, width, height));
    },
    [],
  );
  return (
    <div
      ref={shellRef}
      className="canvas-shell"
      aria-label={locale === "ru" ? "Смешанный холст" : "Mixed canvas"}
    >
      <Profiler
        id="canvas"
        onRender={(_id, _phase, duration) => {
          if (import.meta.env.DEV) {
            store.profiler.commits++;
            store.profiler.totalDuration += duration;
          }
        }}
      >
        <ReactFlow<CardNode, CanvasEdge>
          nodes={displayedNodes}
          edges={displayedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={readOnly ? undefined : onNodesChange}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          connectionMode={ConnectionMode.Loose}
          // A selected frame must not rise above the blocks it holds: React
          // Flow lifts a selected node by default, which put the whole diagram
          // over its own contents the moment its border was pressed.
          elevateNodesOnSelect={false}
          onNodeClick={select}
          onEdgeClick={selectEdge}
          onClick={leaveFrameResize}
          onNodeMouseEnter={hover}
          onNodeMouseLeave={clearHover}
          onPaneClick={clearSelection}
          onConnect={connect}
          isValidConnection={validConnection}
          onInit={placeInitialView}
          onNodeDragStart={readOnly ? undefined : dragStart}
          onPointerDownCapture={(event) => {
            pressedAt.current = { x: event.clientX, y: event.clientY };
          }}
          // Shift and a press on a block pick the block, not a place in its
          // text: no caret goes into the field, and a field being edited is
          // closed -- so the next Delete removes the selection rather than
          // editing whichever title the last Shift-click landed on.
          onMouseDownCapture={(event) => {
            if (!event.shiftKey || readOnly) return;
            if (!(event.target as HTMLElement).closest(".react-flow__node.nokey"))
              return;
            event.preventDefault();
            (window.document.activeElement as HTMLElement | null)?.blur?.();
          }}
          onClickCapture={readOnly ? undefined : clickThroughCover}
          // Shift with a click adds a block to the selection; Shift with a
          // drag on empty canvas draws a box that adds every block inside it.
          // A plain drag keeps panning, which is how the canvas is moved
          // around.
          multiSelectionKeyCode="Shift"
          nodeDragThreshold={CLICK_SLACK}
          nodeClickDistance={CLICK_SLACK}
          selectionKeyCode={readOnly ? null : "Shift"}
          onSelectionStart={readOnly ? undefined : startBox}
          onSelectionEnd={readOnly ? undefined : endBox}
          minZoom={INITIAL_VIEW.minZoom}
          maxZoom={2.5}
          deleteKeyCode={null}
          defaultEdgeOptions={defaultEdgeOptions}
          proOptions={flowOptions}
          onlyRenderVisibleElements={false}
          onMoveEnd={
            readOnly
              ? undefined
              : // React Flow passes no event for a move made in code, such as
                // the placement the canvas gets as it opens; only a move the
                // user made with the mouse, wheel or touch is an edit.
                (event, viewport) => store.setViewport(viewport, event != null)
          }
        >
          <FlowStoreBridge into={flowStore} />
          <Background gap={24} size={1.1} color="#d3dae5" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) =>
              node.data.kind === "annotation"
                ? "#f5d990"
                : node.data.kind === "frame"
                  ? "#edf1f8"
                  : "#9db1d9"
            }
            maskColor="rgba(245,247,251,.65)"
          />
        </ReactFlow>
      </Profiler>
      {/* The hint is about editing, so it has nothing to say in a reading view. */}
      <div className="canvas-hint" hidden={readOnly}>
        {/* The frame hotkey has no other place to be discovered. */}
        {locale === "ru"
          ? selectedFrame
            ? "Shift + стрелки — размер рамки · тяните угол или сторону"
            : "Тяните блоки · Shift + клик или рамка — несколько сразу · Ctrl + колесо для масштаба"
          : selectedFrame
            ? "Shift + arrows resize the frame · drag a corner or a side"
            : "Drag blocks · Shift + click or box for several · Ctrl + scroll to zoom"}
      </div>
    </div>
  );
});
