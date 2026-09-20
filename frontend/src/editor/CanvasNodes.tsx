import { memo, useRef, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  getSmoothStepPath,
  useStoreApi,
  type Node,
  type NodeProps,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type {
  Annotation,
  Note,
  Entity,
  HldNode,
  Participant,
  Message,
} from "../model/types";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { EditorStore } from "./EditorStore";
import { edgeWeightById } from "../settings/preferences";
import { usePreferences } from "../settings/usePreferences";
import {
  SIDES,
  addButtonShift,
  nearestSide,
  orientationOf,
  portStyle,
  type BlockPort,
} from "./ports";
import { CONNECTION_STYLES, type ConnectionStyle } from "./connectionStyle";
import {
  DEFAULT_EDGE_LABEL,
  LABEL_COLUMNS,
  LABEL_PLACEMENTS,
  clampSize,
  labelCentre,
  labelSize,
  midpointOf,
  polylineOf,
  type EdgeLabelLayout,
  type Point,
  type Size,
} from "./edgeLabel";
import { TextField } from "./TextField";
import { ContextPanel } from "./ContextPanel";
import type { ContextPanelModel } from "./contextPanels";
import {
  DEFAULT_TEXT_STYLE,
  EMPHASES,
  FONTS,
  canScale,
  textStyleProperties,
  type TextStyle,
} from "./textStyle";

export interface CardData extends Record<string, unknown> {
  kind: "hld" | "er" | "sequence" | "annotation" | "note" | "frame" | "context";
  model:
    | HldNode
    | Entity
    | Participant
    | Annotation
    | Note
    | { id: string; title: string; type: string }
    | ContextPanelModel;
  store: EditorStore;
  locale: "ru" | "en";
  lineHeight?: number;
  /** The handle a reader points at: qu3, gw1. Absent for frames and text. */
  shortName?: string | null;
  /** For an annotation: the colour of its leader line, so card and line match. */
  leader?: string;
  /** True for a block that carries an annotation and so needs leader anchors. */
  leaderAnchors?: boolean;
  /** The connection points this block offers. */
  ports?: BlockPort[];
  /** Opens the block's note, creating it the first time. */
  onAnnotate?: (blockId: string) => void;
  /** True while the document is only being read, so nothing offers to change it. */
  readOnly?: boolean;
  /**
   * The frame is in resize mode.
   *
   * Deliberately not React Flow's `selected`: that flag is the library's to
   * change -- a drag, a click elsewhere, a rubber band all move it -- and the
   * mode has to survive exactly those things while the author works an edge.
   */
  frameResize?: boolean;
  /** How this object's text is set: size, emphasis, typeface. */
  textStyle?: TextStyle;
}
export type CardNode = Node<CardData>;

/**
 * Smaller, larger, emphasis, typeface: the four text controls every panel that
 * belongs to one object offers, for that object alone.
 */
function TextStyleButtons({
  store,
  objectId,
  style,
  locale,
  name,
}: {
  store: EditorStore;
  objectId: string;
  style: TextStyle;
  locale: "ru" | "en";
  name: string;
}) {
  const ru = locale === "ru";
  const emphasis = EMPHASES.find((option) => option.id === style.emphasis)!;
  const font = FONTS.find((option) => option.id === style.font)!;
  const stop = (event: ReactPointerEvent<HTMLButtonElement>) =>
    event.stopPropagation();
  const smaller = ru ? "Уменьшить шрифт" : "Smaller text";
  const larger = ru ? "Увеличить шрифт" : "Larger text";
  const emphasisName = ru ? "Начертание" : "Emphasis";
  const fontName = ru ? "Шрифт" : "Typeface";
  return (
    <>
      <button
        type="button"
        className="port-add text-control"
        disabled={!canScale(style.scale, -1)}
        title={smaller}
        aria-label={`${smaller} ${name}`}
        onPointerDown={stop}
        onClick={() => store.resizeText(objectId, -1)}
      >
        A−
      </button>
      <button
        type="button"
        className="port-add text-control"
        disabled={!canScale(style.scale, 1)}
        title={larger}
        aria-label={`${larger} ${name}`}
        onPointerDown={stop}
        onClick={() => store.resizeText(objectId, 1)}
      >
        A+
      </button>
      <button
        type="button"
        className={`port-add text-control${style.emphasis !== "normal" ? " is-on" : ""}`}
        title={`${emphasisName}: ${emphasis.names[locale]}`}
        aria-label={`${emphasisName} ${name}`}
        data-emphasis={style.emphasis}
        onPointerDown={stop}
        onClick={() => store.cycleTextEmphasis(objectId)}
      >
        {style.emphasis === "italic" ? (ru ? "К" : "I") : ru ? "Ж" : "B"}
      </button>
      <button
        type="button"
        className={`port-add text-control${style.font !== "sans" ? " is-on" : ""}`}
        title={`${fontName}: ${font.names[locale]}`}
        aria-label={`${fontName} ${name}`}
        style={font.id === "sans" ? undefined : { fontFamily: font.family }}
        onPointerDown={stop}
        onClick={() => store.cycleTextFont(objectId)}
      >
        Aa
      </button>
    </>
  );
}
/**
 * The glyph a block wears.
 *
 * A gateway and a balancer are services in the contract -- the shape is not
 * allowed to encode a vendor -- but they are not the same part to a reader, so
 * the icon is chosen from what the block says about itself.
 */
function blockIcon(kind: CardData["kind"], hld: HldNode): string {
  if (kind === "er") return "▤";
  if (kind === "sequence") return "◉";
  const technology = (hld.properties.technology ?? "").toLowerCase();
  if (technology.includes("gateway")) return "⇥";
  if (technology.includes("balancer")) return "⚖";
  if (hld.properties.storageRole === "cache") return "⚡";
  return (
    {
      actor: "◍",
      service: "⬡",
      datastore: "⛁",
      queue: "☰",
      external_system: "☁",
      boundary: "⬚",
    }[hld.kind] ?? "⬡"
  );
}

const SIDE: Record<BlockPort["side"], Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

/**
 * Ctrl and drag moves a port around the block's border.
 *
 * Without the modifier a press on a port starts a connection, which is what it
 * should do: moving a port is the rarer intent, so it is the one that asks for
 * a key. The pointer is followed in screen coordinates and the side is chosen
 * from the block's own box, so the zoom level makes no difference.
 */
function dragPort(
  event: ReactPointerEvent<HTMLDivElement>,
  blockId: string,
  port: BlockPort,
  data: CardData,
): void {
  if (!event.ctrlKey && !event.metaKey) return;
  const card = (event.currentTarget as HTMLElement).closest(
    ".object-card",
  ) as HTMLElement | null;
  if (!card) return;
  event.preventDefault();
  event.stopPropagation();

  const box = card.getBoundingClientRect();
  const rect = {
    x: box.left,
    y: box.top,
    width: box.width,
    height: box.height,
  };
  const move = (moved: PointerEvent) => {
    const place = nearestSide(rect, { x: moved.clientX, y: moved.clientY });
    card.style.setProperty("--port-preview", place.side);
  };
  const finish = (ended: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    card.style.removeProperty("--port-preview");
    const place = nearestSide(rect, { x: ended.clientX, y: ended.clientY });
    data.store.moveBlockPort(blockId, port.id, place.side, place.offset);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish);
}

const roleLabel: Record<string, [string, string]> = {
  service: ["СЕРВИС", "SERVICE"],
  external_system: ["ВНЕШНЯЯ СИСТЕМА", "EXTERNAL SYSTEM"],
  datastore: ["ХРАНИЛИЩЕ", "DATASTORE"],
  queue: ["ОЧЕРЕДЬ", "QUEUE"],
  actor: ["АКТОР", "ACTOR"],
  boundary: ["ГРАНИЦА", "BOUNDARY"],
};
export const CanvasNode = memo(function CanvasNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<CardNode>) {
  if (import.meta.env.DEV)
    data.store.nodeRenders[id] = (data.store.nodeRenders[id] ?? 0) + 1;
  const ru = data.locale === "ru";
  if (data.kind === "frame") {
    const model = data.model as { title: string; type: string };
    return (
      <div
        className={`diagram-frame frame-${model.type} ${
          data.frameResize ? "is-selected" : ""
        }`}
      >
        {/*
          Blocks fit inside a frame that never grew on purpose, leaving nowhere
          to route the connections between them. Eight grips resize it: four
          corners and four sides, the sides drawn as long bars because that is
          what a hand reaches for on an edge. Shift with the arrow keys does the
          same without a mouse.

          They appear only while the frame is in resize mode -- entered by a
          press near its border -- so that the rest of the time a diagram is a
          backdrop and not a control.
        */}
        <NodeResizer
          minWidth={240}
          minHeight={180}
          isVisible={Boolean(data.frameResize)}
          color="#8aa4cf"
          handleClassName="frame-grip"
          lineClassName="frame-bar"
        />
        {/* Only a band along the border answers the pointer. The middle of a
            frame belongs to what is drawn on it, and to panning. */}
        {(["top", "right", "bottom", "left"] as const).map((side) => (
          <span key={side} className={`frame-edge-hit frame-edge-${side}`} />
        ))}
        <div className="frame-heading">
          <span className="frame-type">
            {model.type === "sequence" ? "SEQUENCE" : model.type.toUpperCase()}
          </span>
          <span>{model.title}</span>
        </div>
      </div>
    );
  }
  if (data.kind === "context")
    return (
      <ContextPanel
        id={id}
        model={data.model as ContextPanelModel}
        store={data.store}
        locale={data.locale}
        readOnly={data.readOnly}
        selected={Boolean(selected)}
      />
    );
  if (data.kind === "annotation" || data.kind === "note") {
    const annotation = data.model as Annotation;
    const textStyle = data.textStyle ?? DEFAULT_TEXT_STYLE;
    return (
      <div
        className={`annotation-card ${selected ? "is-selected" : ""}`}
        data-text-emphasis={textStyle.emphasis}
        style={{
          ...textStyleProperties(textStyle),
          ...(data.leader ? { borderLeftColor: data.leader } : {}),
        }}
      >
        {/* A note or an annotation has no other controls, so its text controls
            come with its selection and go with it. */}
        {selected && !data.readOnly && (
          <div className="block-actions annotation-actions">
            <TextStyleButtons
              store={data.store}
              objectId={id}
              style={textStyle}
              locale={data.locale}
              name={
                data.kind === "note"
                  ? ru
                    ? "текста"
                    : "of the note"
                  : ru
                    ? "подписи"
                    : "of the annotation"
              }
            />
          </div>
        )}
        <NodeResizer
          minWidth={180}
          minHeight={65}
          isVisible={selected}
          color="#c59236"
        />
        {/* The leader leaves from whichever side faces the block; these are
            anchors, never connection points. */}
        {data.kind === "annotation" &&
          (
            [
              ["lead-out-left", Position.Left],
              ["lead-out-right", Position.Right],
              ["lead-out-top", Position.Top],
              ["lead-out-bottom", Position.Bottom],
            ] as const
          ).map(([anchor, side]) => (
            <Handle
              key={anchor}
              type="source"
              position={side}
              id={anchor}
              isConnectable={false}
              className="lead-handle"
            />
          ))}
        <div className="annotation-grip">
          <span className="annotation-owner" style={{ color: data.leader }}>
            ↗ {data.shortName ?? (ru ? "БЛОК" : "BLOCK")}
          </span>
          <span>⠿</span>
        </div>
        <TextField
          store={data.store}
          readOnly={data.readOnly}
          objectId={id}
          field="text"
          value={annotation.text}
          label={
            data.kind === "note"
              ? ru
                ? "Текст решения"
                : "Design note"
              : ru
                ? "Внешняя подпись"
                : "External annotation"
          }
          multiline
          maxLength={data.kind === "note" ? 10000 : 4000}
        />
      </div>
    );
  }
  const model = data.model as HldNode | Entity | Participant;
  const label = ru
    ? `Название блока ${model.label}`
    : `Block title ${model.label}`;
  const hld = model as HldNode;
  const textStyle = data.textStyle ?? DEFAULT_TEXT_STYLE;
  // The second line edits what it shows: the technology when the block names
  // one -- the line has always shown that first -- and otherwise what the
  // component is responsible for, which is what almost every template fills.
  const described: "technology" | "responsibility" =
    data.kind === "hld" && hld.properties.technology
      ? "technology"
      : "responsibility";
  return (
    <div
      className={`object-card ${data.kind}-card ${"kind" in model ? model.kind : ""} ${selected ? "is-selected" : ""} ${
        data.kind === "hld" && hld.properties.scaled ? "is-scaled" : ""
      }`}
      data-text-emphasis={textStyle.emphasis}
      style={textStyleProperties(textStyle)}
    >
      {/* A block is resized like anything else on the canvas: by its corners
          and sides, once it is selected. */}
      <NodeResizer
        minWidth={160}
        minHeight={80}
        isVisible={selected}
        color="#7f9ac9"
      />
      {/* Every port is free: a line may start here or end here, which is why
          each one is both a source and a target in the same spot. A reading
          view still renders them: a connection hangs on its two ports, and
          removing them would take every line on the diagram with them. */}
      {(data.ports ?? []).map((port) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={SIDE[port.side]}
          style={portStyle(port)}
          className={`block-port${data.readOnly ? " is-quiet" : ""}`}
          data-port={port.id}
          isConnectable={!data.readOnly}
          onPointerDownCapture={
            data.readOnly
              ? undefined
              : (event) => dragPort(event, id, port, data)
          }
        />
      ))}
      {/* A + on each of the two sides the ports live on, and nowhere else:
          the orientation button is what moves them, not a third and fourth
          button. An entity or a lifeline is not fed from several places, so
          neither offers them. */}
      {data.kind === "hld" &&
        !data.readOnly &&
        SIDES[orientationOf(data.ports ?? [])].map((side) => (
          <button
            key={side}
            type="button"
            className={`port-add port-add-${side}`}
            // Aside from the middle when a line leaves from there, or the
            // line lies across the + and takes the press.
            style={{
              transform: `${side === "left" || side === "right" ? "translateY" : "translateX"}(${addButtonShift(
                data.ports ?? [],
                side,
                (side === "left" || side === "right" ? height : width) ?? 0,
              )}px)`,
            }}
            title={ru ? "Добавить порт" : "Add a port"}
            aria-label={`${ru ? "Добавить порт" : "Add a port"} ${model.label}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => data.store.addBlockPort(id, side)}
          >
            +
          </button>
        ))}
      {/* Above the top-right corner: turn the ports, write a note, remove the
          block. Same shape as the + buttons, and shown by the same hover. */}
      {!data.readOnly && (
        <div className="block-actions">
          {data.kind === "hld" && (
            <button
              type="button"
              className="port-add"
              title={ru ? "Повернуть порты" : "Turn the ports"}
              aria-label={`${ru ? "Повернуть порты" : "Turn the ports"} ${model.label}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => data.store.turnBlockPorts(id)}
            >
              {orientationOf(data.ports ?? []) === "horizontal" ? "⇵" : "⇆"}
            </button>
          )}
          <button
            type="button"
            className="port-add"
            title={ru ? "Комментарий к блоку" : "Note about this block"}
            aria-label={`${ru ? "Комментарий" : "Note"} ${model.label}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => data.onAnnotate?.(id)}
          >
            T
          </button>
          {data.kind === "hld" && (
            <button
              type="button"
              className={`port-add${hld.properties.scaled ? " is-on" : ""}`}
              title={
                ru
                  ? "Несколько экземпляров блока"
                  : "Several instances of this block"
              }
              aria-label={`${ru ? "Несколько экземпляров" : "Several instances"} ${model.label}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => data.store.toggleScaled(id)}
            >
              M
            </button>
          )}
          <TextStyleButtons
            store={data.store}
            objectId={id}
            style={textStyle}
            locale={data.locale}
            name={model.label}
          />
          <button
            type="button"
            className="port-add port-remove"
            title={ru ? "Удалить блок (Del)" : "Delete the block (Del)"}
            aria-label={`${ru ? "Удалить" : "Delete"} ${model.label}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => data.store.deleteObject(id)}
          >
            ×
          </button>
        </div>
      )}
      <div className="card-kicker">
        <span className="card-icon">{blockIcon(data.kind, hld)}</span>
        <span>
          {data.kind === "hld"
            ? (roleLabel[hld.kind]?.[ru ? 0 : 1] ?? hld.kind)
            : data.kind === "er"
              ? ru
                ? "СУЩНОСТЬ"
                : "ENTITY"
              : ru
                ? "УЧАСТНИК"
                : "PARTICIPANT"}
        </span>
        {data.shortName && (
          <span className="card-short-name">{data.shortName}</span>
        )}
        <span className="drag-grip">⠿</span>
      </div>
      <TextField
        store={data.store}
        readOnly={data.readOnly}
        objectId={id}
        value={model.label}
        label={label}
        className="card-title"
        multiline
      />
      {/* Editable like the title, wherever the title is: a template's blocks
          arrive with a description, and a description nobody can correct is
          a wrong one that stays. */}
      {data.kind === "hld" && (
        <TextField
          store={data.store}
          readOnly={data.readOnly}
          objectId={id}
          field={`properties.${described}`}
          value={hld.properties[described] ?? ""}
          label={
            ru
              ? `Описание блока ${model.label}`
              : `Block description ${model.label}`
          }
          placeholder={
            ru
              ? "Ответственность компонента"
              : "What this component is responsible for"
          }
          className="card-description"
          multiline
        />
      )}
      {data.kind === "er" && (
        <div className="entity-fields">
          {(model as Entity).fields.map((field) => (
            <div className="entity-row" key={field.id}>
              <span
                className={
                  (model as Entity).primaryKeyFieldIds.includes(field.id)
                    ? "primary-key"
                    : "field-marker"
                }
              >
                {(model as Entity).primaryKeyFieldIds.includes(field.id)
                  ? "◆"
                  : "·"}
              </span>
              <TextField
                store={data.store}
                readOnly={data.readOnly}
                objectId={field.id}
                field="name"
                value={field.name}
                label={
                  ru ? `Имя поля ${field.name}` : `Field name ${field.name}`
                }
              />
              <TextField
                store={data.store}
                readOnly={data.readOnly}
                objectId={field.id}
                field="dataType"
                value={field.dataType ?? ""}
                label={
                  ru ? `Тип поля ${field.name}` : `Field type ${field.name}`
                }
                className="field-type"
              />
            </div>
          ))}
        </div>
      )}
      {data.kind === "sequence" && (
        <div
          className="lifeline"
          style={{ height: data.lineHeight }}
          aria-hidden="true"
        />
      )}
      {data.leaderAnchors &&
        (
          [
            ["lead-in-left", Position.Left],
            ["lead-in-right", Position.Right],
            ["lead-in-top", Position.Top],
            ["lead-in-bottom", Position.Bottom],
          ] as const
        ).map(([anchor, side]) => (
          <Handle
            key={anchor}
            type="target"
            position={side}
            id={anchor}
            isConnectable={false}
            className="lead-handle"
          />
        ))}
    </div>
  );
});

export interface ConnectionData extends Record<string, unknown> {
  store: EditorStore;
  locale: "ru" | "en";
  label: string;
  kind: string;
  message?: Message;
  fixedY?: number;
  sourceCenter?: number;
  targetCenter?: number;
  /** How an HLD connection is drawn, and what that says. */
  style?: ConnectionStyle;
  /** Where the label sits: on the run, clear of what is already there. */
  labelPoint?: { x: number; y: number };
  /** How the author placed and sized an HLD connection's label. */
  labelLayout?: EdgeLabelLayout;
  /** How a connection's label text is set: relationship, message or HLD. */
  textStyle?: TextStyle;
  /** True while the document is only being read. */
  readOnly?: boolean;
}
export type CanvasEdge = Edge<ConnectionData>;
/** A drag or a resize of a label, from the press to the release. */
interface LabelGesture {
  kind: "move" | "resize";
  pointer: Point;
  zoom: number;
  centre: Point;
  size: Size;
}

/** Below this many pixels a press on a handle is a click, not a gesture. */
const GESTURE_THRESHOLD = 2;

export const ConnectionEdge = memo(function ConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  markerStart,
  selected,
}: EdgeProps<CanvasEdge>) {
  // Hooks before the early return: a hook may not be skipped for some edges.
  const weight = edgeWeightById(usePreferences().edgeWeight);
  // Read lazily, never subscribed to: an edge that re-rendered on every zoom
  // step would redraw the whole diagram while the reader scrolls.
  const flow = useStoreApi();
  const box = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<LabelGesture | null>(null);
  // Drawn live while a gesture is in progress; written once, on release.
  const [live, setLive] = useState<{ centre?: Point; size?: Size } | null>(
    null,
  );
  if (!data) return null;
  const sequence = Boolean(data.message),
    kind = data.kind;
  const ru = data.locale === "ru";
  const style = data.style;
  let path: string, labelX: number, labelY: number;
  if (sequence) {
    const x1 = data.sourceCenter!,
      x2 = data.targetCenter!,
      y = data.fixedY!;
    const self = data.message!.sourceId === data.message!.targetId;
    path = self ? `M ${x1} ${y} h 65 v 35 h -65` : `M ${x1} ${y} L ${x2} ${y}`;
    labelX = self ? x1 + 60 : (x1 + x2) / 2;
    labelY = y - 15;
  } else
    [path, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius: 14,
    });
  const line = (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={style && !style.arrowAtTarget ? undefined : markerEnd}
      markerStart={style?.arrowAtSource ? markerStart : undefined}
      style={{
        stroke: selected
          ? "#3f6bb5"
          : sequence
            ? weight.sequenceColour
            : weight.colour,
        // A selected line is drawn heavier than the reader's own weight, so
        // the selection stays visible at every setting.
        strokeWidth: selected ? weight.width + 0.8 : weight.width,
        strokeDasharray: kind === "return" || style?.dashed ? "6 5" : undefined,
      }}
    />
  );
  const labelName = `${ru ? "Подпись связи" : "Connection label"} ${data.label}`;

  if (!style) {
    // A relationship or a message: their labels keep their place in the line.
    // A relationship's name still wraps, because a long one used to be cut off
    // mid-word; a message stays on one row with its order and its kind.
    const labelStyle = data.textStyle ?? DEFAULT_TEXT_STYLE;
    return (
      <>
        {line}
        <EdgeLabelRenderer>
          <div
            className={`edge-label nodrag nopan ${sequence ? "sequence-message" : ""}`}
            data-message-id={data.message?.id}
            data-message-order={data.message?.order}
            data-message-kind={data.message?.kind}
            data-text-emphasis={labelStyle.emphasis}
            style={{
              ...textStyleProperties(labelStyle),
              transform: `translate(-50%, -50%) translate(${
                data.labelPoint?.x ?? labelX
              }px, ${data.labelPoint?.y ?? labelY}px)`,
            }}
          >
            {sequence && (
              <span className="message-order">
                {data.message!.order.toString().padStart(2, "0")}
              </span>
            )}
            <TextField
              store={data.store}
              readOnly={data.readOnly}
              objectId={id}
              value={data.label}
              label={labelName}
              multiline={!sequence}
              autoSize={sequence ? undefined : { columns: LABEL_COLUMNS }}
            />
            {sequence && (
              <span className="message-kind">
                {kind === "return" ? "↩" : kind === "async" ? "↗" : "→"}
              </span>
            )}
            {/* Neither has a panel of its own, so the text controls come with
                the selection, under the label, and go with it. */}
            {selected && !data.readOnly && (
              <div className="edge-actions edge-text-actions">
                <TextStyleButtons
                  store={data.store}
                  objectId={id}
                  style={labelStyle}
                  locale={data.locale}
                  name={
                    sequence
                      ? ru
                        ? "сообщения"
                        : "of the message"
                      : ru
                        ? "подписи связи"
                        : "of the relationship label"
                  }
                />
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      </>
    );
  }

  const entry = data.labelLayout ?? DEFAULT_EDGE_LABEL;
  const textStyle = data.textStyle ?? DEFAULT_TEXT_STYLE;
  const points = polylineOf(path);
  const inline = data.labelPoint ?? { x: labelX, y: labelY };
  const estimate = labelSize(data.label, entry, textStyle.scale);
  const centre = live?.centre ?? labelCentre(points, entry, estimate, inline);
  const sized =
    live?.size ??
    (entry.width !== null && entry.height !== null
      ? { width: entry.width, height: entry.height }
      : null);
  const editable = Boolean(selected) && !data.readOnly;
  const dragged = entry.dx !== null && entry.dy !== null;
  const placementName = dragged
    ? ru
      ? "перемещена вручную"
      : "moved by hand"
    : LABEL_PLACEMENTS.find((option) => option.id === entry.placement)!.names[
        data.locale
      ];

  const begin =
    (gestureKind: LabelGesture["kind"]) =>
    (event: ReactPointerEvent<HTMLElement>) => {
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const zoom = flow.getState().transform[2] || 1;
      const rect = box.current?.getBoundingClientRect();
      gesture.current = {
        kind: gestureKind,
        pointer: { x: event.clientX, y: event.clientY },
        zoom,
        centre,
        // The box as drawn, so a label sized by its text starts resizing from
        // exactly the size the reader sees.
        size: rect
          ? { width: rect.width / zoom, height: rect.height / zoom }
          : (sized ?? estimate),
      };
    };
  const travel = (
    event: ReactPointerEvent<HTMLElement>,
    current: LabelGesture,
  ) => ({
    dx: (event.clientX - current.pointer.x) / current.zoom,
    dy: (event.clientY - current.pointer.y) / current.zoom,
  });
  const follow = (event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current) return;
    const { dx, dy } = travel(event, current);
    if (current.kind === "move")
      setLive({
        centre: { x: current.centre.x + dx, y: current.centre.y + dy },
      });
    // The label is centred on its point, so a corner dragged by d widens it by
    // twice that and the corner stays under the pointer.
    else
      setLive({
        size: clampSize({
          width: current.size.width + 2 * dx,
          height: current.size.height + 2 * dy,
        }),
      });
  };
  const finish = (event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setLive(null);
    const { dx, dy } = travel(event, current);
    if (Math.hypot(dx, dy) * current.zoom < GESTURE_THRESHOLD) return;
    if (current.kind === "move") {
      // Kept relative to the middle of the line, so the label follows it when
      // the blocks at either end move.
      const middle = points.length ? midpointOf(points) : inline;
      data.store.setEdgeLabel(id, {
        dx: Math.round(current.centre.x + dx - middle.x),
        dy: Math.round(current.centre.y + dy - middle.y),
      });
    } else
      data.store.setEdgeLabel(
        id,
        clampSize({
          width: current.size.width + 2 * dx,
          height: current.size.height + 2 * dy,
        }),
      );
  };
  const handle = (gestureKind: LabelGesture["kind"]) => ({
    onPointerDown: begin(gestureKind),
    onPointerMove: follow,
    onPointerUp: finish,
    onPointerCancel: finish,
  });

  return (
    <>
      {line}
      <EdgeLabelRenderer>
        <div
          className="edge-label-anchor"
          style={{ transform: `translate(${centre.x}px, ${centre.y}px)` }}
        >
          <div
            ref={box}
            className={`edge-label edge-label-hld nodrag nopan${
              editable ? " is-editable" : ""
            }${sized ? " is-sized" : ""}`}
            data-placement={dragged ? "dragged" : entry.placement}
            data-text-emphasis={textStyle.emphasis}
            style={{
              ...textStyleProperties(textStyle),
              ...(sized ? { width: sized.width, height: sized.height } : {}),
            }}
          >
            {editable && (
              <span
                className="edge-label-grip"
                title={ru ? "Перетащить подпись" : "Drag the label"}
                aria-label={ru ? "Перетащить подпись" : "Drag the label"}
                {...handle("move")}
              >
                ⠿
              </span>
            )}
            <TextField
              store={data.store}
              readOnly={data.readOnly}
              objectId={id}
              value={data.label}
              label={labelName}
              multiline
              autoSize={sized ? undefined : { columns: LABEL_COLUMNS }}
            />
            {editable && (
              <span
                className="edge-label-resize"
                title={ru ? "Изменить размер подписи" : "Resize the label"}
                aria-label={ru ? "Изменить размер подписи" : "Resize the label"}
                {...handle("resize")}
              />
            )}
            {/* The connection's own controls, shown while it is selected: how
                it is drawn, where its name sits, and whether it stays at all. */}
            {editable && (
              <div className="edge-actions">
                {CONNECTION_STYLES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`port-add${option.id === style.id ? " is-on" : ""}`}
                    title={
                      option.id === style.id &&
                      option.arrowAtTarget &&
                      !option.arrowAtSource
                        ? `${option.names[data.locale]}: ${ru ? "нажмите ещё раз, чтобы развернуть стрелку" : "press again to reverse the arrow"}`
                        : option.names[data.locale]
                    }
                    aria-label={`${ru ? "Вид связи" : "Connection style"}: ${option.names[data.locale]}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() =>
                      // Pressing the arrow a line already is points it the
                      // other way; any other press changes how it is drawn.
                      option.id === style.id &&
                      option.arrowAtTarget &&
                      !option.arrowAtSource
                        ? data.store.reverseConnection(id)
                        : data.store.setConnectionStyle(id, option.id)
                    }
                  >
                    {option.glyph}
                  </button>
                ))}
                <button
                  type="button"
                  className="port-add edge-placement"
                  title={`${ru ? "Расположение подписи" : "Label placement"}: ${placementName}`}
                  aria-label={ru ? "Расположение подписи" : "Label placement"}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => data.store.cycleEdgeLabelPlacement(id)}
                >
                  ⌖
                </button>
                <TextStyleButtons
                  store={data.store}
                  objectId={id}
                  style={textStyle}
                  locale={data.locale}
                  name={ru ? "подписи связи" : "of the connection label"}
                />
                <button
                  type="button"
                  className="port-add port-remove"
                  title={
                    ru ? "Удалить связь (Del)" : "Delete the connection (Del)"
                  }
                  aria-label={ru ? "Удалить связь" : "Delete the connection"}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => data.store.deleteObject(id)}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
