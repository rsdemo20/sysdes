/**
 * The points a connection may leave from and arrive at.
 *
 * A block used to offer one way in and one way out, which forced every line
 * through the same two spots: three services fed by one gateway produced three
 * lines overlapping for their first hundred pixels. A block now carries as many
 * ports as its author needs, each sitting where they put it.
 *
 * A port has no direction. There is no input and no output -- there is a free
 * port, and a connection may start from it or arrive at it. Which end of a line
 * is which belongs to the line, not to the point it touches, and making an
 * author pick the correct half of a block before drawing was a rule with
 * nothing behind it.
 *
 * Ports live in the layout, not in the semantics, and that is a deliberate
 * line. How many outlets a box is drawn with says nothing about the system --
 * the connections are what say it -- so a canvas that gains a port is the same
 * design as before, its content hash unchanged, and an evaluation sees no
 * difference. The same goes for which port a connection happens to use.
 *
 * A document written before ports existed has none stored. It is not port-less:
 * `portsOf` answers with the defaults, so every block starts with one input on
 * the left and two outputs on the right whether or not anything was saved.
 */
import type { CanvasDocument } from "../model/types";

export type PortSide = "left" | "right" | "top" | "bottom";

export interface BlockPort {
  id: string;
  side: PortSide;
  /** Where along the side it sits, from 0 at the start to 1 at the end. */
  offset: number;
}

/** The two opposite sides a block offers ports on. Four at once is not a thing. */
export type Orientation = "horizontal" | "vertical";

export const SIDES: Record<Orientation, [PortSide, PortSide]> = {
  horizontal: ["left", "right"],
  vertical: ["top", "bottom"],
};

export type PortMap = Record<string, BlockPort[]>;
export type EdgePortMap = Record<string, { source: string; target: string }>;

export type BlockKind = "hld" | "er" | "sequence";

/**
 * One port on one side and two on the other -- for an HLD block, where a
 * component really does feed several others and a single point forced every
 * line together.
 *
 * An entity is joined by relationships and a participant exchanges messages
 * along a lifeline; neither gains anything from extra points, so both keep the
 * single pair they always had.
 */
const DEFAULTS: Record<BlockKind, readonly BlockPort[]> = {
  hld: Object.freeze([
    { id: "in", side: "left", offset: 0.5 },
    { id: "out", side: "right", offset: 0.34 },
    { id: "out2", side: "right", offset: 0.68 },
  ]) as readonly BlockPort[],
  er: Object.freeze([
    { id: "in", side: "left", offset: 0.5 },
    { id: "out", side: "right", offset: 0.5 },
  ]) as readonly BlockPort[],
  sequence: Object.freeze([
    { id: "in", side: "left", offset: 0.5 },
    { id: "out", side: "right", offset: 0.5 },
  ]) as readonly BlockPort[],
};

export function defaultPorts(kind: BlockKind = "hld"): BlockPort[] {
  return DEFAULTS[kind].map((port) => ({ ...port }));
}

/**
 * The ports of a block: the stored ones, or the defaults for its kind.
 *
 * The defaults are one shared array per kind rather than a fresh copy. The
 * canvas compares node data by identity to decide what to redraw, and a new
 * array on every read would redraw every block on every keystroke.
 */
export function portsOf(
  layout: CanvasDocument["layout"],
  blockId: string,
  kind: BlockKind = "hld",
): BlockPort[] {
  const stored = (layout as { ports?: PortMap }).ports?.[blockId];
  return stored && stored.length ? stored : (DEFAULTS[kind] as BlockPort[]);
}

/**
 * The port a connection end uses: the stored one, or a sensible default.
 *
 * With nothing bound the line leaves from the last port and arrives at the
 * first, which for a default block means out of the right side and into the
 * left -- the order a diagram is read in.
 */
export function portOfEdge(
  layout: CanvasDocument["layout"],
  edgeId: string,
  blockId: string,
  end: "source" | "target",
  /** The block's kind: its defaults differ, and a line must name a port the
   *  block actually draws. */
  kind: BlockKind = "hld",
): string {
  const bound = (layout as { edgePorts?: EdgePortMap }).edgePorts?.[edgeId];
  const ports = portsOf(layout, blockId, kind);
  const candidate = bound?.[end];
  if (candidate && ports.some((port) => port.id === candidate)) return candidate;
  return (end === "source" ? ports[ports.length - 1] : ports[0]).id;
}

/**
 * The same ports with one more on `side`, spread evenly along it.
 *
 * Spreading rather than appending keeps the edge readable: ports bunched at one
 * end of a border are harder to tell apart than ports at even intervals, and an
 * author adding a fourth port has not asked to rearrange the first three.
 */
export function addPort(ports: BlockPort[], side: PortSide): BlockPort[] {
  const taken = new Set(ports.map((port) => port.id));
  let index = ports.length + 1;
  let id = `p${index}`;
  while (taken.has(id)) id = `p${(index += 1)}`;

  const next = [...ports, { id, side, offset: 0.5 }];
  const onSide = next.filter((port) => port.side === side);
  return next.map((port) => {
    if (port.side !== side) return port;
    const position = onSide.findIndex((other) => other.id === port.id);
    return { ...port, offset: (position + 1) / (onSide.length + 1) };
  });
}

/** Which pair of sides this block currently carries its ports on. */
export function orientationOf(ports: BlockPort[]): Orientation {
  return ports.some((port) => port.side === "top" || port.side === "bottom")
    ? "vertical"
    : "horizontal";
}

/**
 * The same ports turned onto the other pair of sides.
 *
 * Only two orientations exist. Ports on all four sides at once looks like more
 * freedom and reads as noise: a reader can no longer tell which way a block is
 * meant to be entered, and the lines stop lining up with the flow of the page.
 */
export function turnPorts(ports: BlockPort[]): BlockPort[] {
  const from = orientationOf(ports);
  const to: Orientation = from === "horizontal" ? "vertical" : "horizontal";
  const [wasFirst] = SIDES[from];
  const [first, second] = SIDES[to];
  return ports.map((port) => ({
    ...port,
    side: port.side === wasFirst ? first : second,
  }));
}

/** The same ports with one of them moved to a new place on the perimeter. */
export function movePort(
  ports: BlockPort[],
  portId: string,
  side: PortSide,
  offset: number,
): BlockPort[] {
  return ports.map((port) =>
    port.id === portId
      ? { ...port, side, offset: Math.min(1, Math.max(0, offset)) }
      : port,
  );
}

/**
 * Which side of a block a point is nearest, and how far along that side.
 *
 * Used while a port is dragged: the pointer is somewhere near the block, and
 * the port has to end up on the perimeter regardless.
 */
export function nearestSide(
  rect: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
): { side: PortSide; offset: number } {
  const dx = point.x - rect.x;
  const dy = point.y - rect.y;
  const distances: Array<[PortSide, number]> = [
    ["left", Math.abs(dx)],
    ["right", Math.abs(rect.width - dx)],
    ["top", Math.abs(dy)],
    ["bottom", Math.abs(rect.height - dy)],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  const side = distances[0][0];
  const along =
    side === "left" || side === "right" ? dy / rect.height : dx / rect.width;
  return { side, offset: Math.min(1, Math.max(0, along)) };
}

/**
 * How far either side of a line a press still lands on the line: React Flow
 * gives every connection an invisible grab band 20px wide.
 */
export const LINE_REACH = 10;
/**
 * How far the + steps aside: past a line's grab band with a little to spare,
 * so the middle of the + -- where a press aims -- is clear of it.
 */
export const ADD_BUTTON_STEP = LINE_REACH + 2;

/**
 * Where the + that adds a port goes along a side: its shift from the middle
 * of the side, in pixels.
 *
 * Lines are drawn above blocks, and a line leaves its port straight out, so a
 * port at the middle -- the only one, or the middle of three, five, seven --
 * puts its line across a + standing at the middle, and the + cannot be pressed.
 * The + stays at the middle while that is clear of every line on the side, and
 * otherwise steps aside, twelve pixels at a time, to the nearest clear place.
 * Where no place is clear, it takes the middle of the gap between two lines
 * nearest the middle of the side.
 */
export function addButtonShift(
  ports: readonly BlockPort[],
  side: PortSide,
  length: number,
): number {
  const lines = ports
    .filter((port) => port.side === side)
    .map((port) => port.offset * length)
    .sort((a, b) => a - b);
  const middle = length / 2;
  const clear = (at: number) =>
    lines.every((line) => Math.abs(line - at) >= ADD_BUTTON_STEP);
  // The + is 16px across and stays on its own side, clear of the corners.
  for (let step = 0; step * ADD_BUTTON_STEP <= middle - 8; step += 1)
    for (const shift of step
      ? [step * ADD_BUTTON_STEP, -step * ADD_BUTTON_STEP]
      : [0])
      if (clear(middle + shift)) return shift;
  const gaps = lines
    .slice(1)
    .map((line, index) => (line + lines[index]) / 2 - middle);
  return gaps.reduce(
    (best, gap) => (Math.abs(gap) < Math.abs(best) ? gap : best),
    ADD_BUTTON_STEP,
  );
}

/** Where to draw a port, as the inline style a handle needs. */
export function portStyle(port: BlockPort): Record<string, string> {
  const percent = `${Math.round(port.offset * 100)}%`;
  if (port.side === "left" || port.side === "right")
    return { top: percent, transform: "translateY(-50%)" };
  return { left: percent, transform: "translateX(-50%)" };
}
