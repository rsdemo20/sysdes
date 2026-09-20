/**
 * Where a connection's label sits, how big it is, and which way it faces the line.
 *
 * A label used to have one place -- cut into the middle of its line -- and one
 * size: a single-line field that stopped showing text after two dozen
 * characters. Both were wrong for real schemas. A long name needs to wrap, and
 * a line crowded by its neighbours reads better with its name set beside it
 * than printed across it.
 *
 * All of this is layout. Where a name is drawn says nothing about the system,
 * so a canvas whose labels moved is the same design with the same content hash,
 * the way a moved block or a turned port is.
 *
 * Three things decide the place, in order of authority:
 *
 * 1. an offset the author dragged the label to. It is kept relative to the
 *    middle of the line, so a label moved clear of something stays clear of it
 *    when the blocks at either end move: it follows its line, it does not stay
 *    pinned to the page;
 * 2. the placement the author picked -- across the line, above or below a
 *    horizontal run, left or right of a vertical one;
 * 3. the old behaviour, which is the default: in the line, at the spot the
 *    canvas found clear of blocks and other labels.
 *
 * The runs are read off the drawn path itself. A connection is drawn as steps,
 * so it is made of horizontal and vertical pieces, and the question "is there a
 * horizontal piece long enough to sit this label on" has an exact answer there.
 * Asked of the straight line between the two blocks instead, it has none.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type LabelPlacement = "inline" | "above" | "below" | "left" | "right";

/** What the layout stores for one connection's label. */
export interface EdgeLabelLayout {
  placement: LabelPlacement;
  /** The dragged offset from the middle of the line; null when never dragged. */
  dx: number | null;
  dy: number | null;
  /** The size the author gave it; null lets the text decide. */
  width: number | null;
  height: number | null;
}

/**
 * The label of a connection nobody has touched.
 *
 * One shared object, not a fresh copy per read: the canvas compares edge data by
 * identity to decide what to redraw, and a new object per render would redraw
 * every line on every keystroke.
 */
export const DEFAULT_EDGE_LABEL: EdgeLabelLayout = Object.freeze({
  placement: "inline",
  dx: null,
  dy: null,
  width: null,
  height: null,
}) as EdgeLabelLayout;

export const LABEL_PLACEMENTS: Array<{
  id: LabelPlacement;
  names: { ru: string; en: string };
}> = [
  { id: "inline", names: { ru: "В линии", en: "In the line" } },
  { id: "above", names: { ru: "Над линией", en: "Above the line" } },
  { id: "below", names: { ru: "Под линией", en: "Below the line" } },
  { id: "left", names: { ru: "Слева от линии", en: "Left of the line" } },
  { id: "right", names: { ru: "Справа от линии", en: "Right of the line" } },
];

/** The smallest a label may be made, so it can always be found and grabbed. */
export const MIN_LABEL: Size = { width: 60, height: 20 };
/** The largest, so one label cannot be dragged out to cover a diagram. */
export const MAX_LABEL: Size = { width: 480, height: 320 };

/** Space between a line and a label set beside it. */
const GAP = 6;
/**
 * How long a vertical run must be to count as one.
 *
 * A corner of a step is a few pixels of vertical line; setting a label beside
 * that would put it beside nothing a reader can see.
 */
const NOTICEABLE = 18;

/** Label text metrics at the size connection labels are drawn. */
const CHAR = 5.8;
const LINE = 14;
const PAD = { x: 16, y: 8 };
/** How wide a label grows before its lines wrap. */
export const LABEL_COLUMNS = 40;

export function edgeLabelOf(
  layout: { edgeLabels?: Record<string, EdgeLabelLayout> },
  edgeId: string,
): EdgeLabelLayout {
  return layout.edgeLabels?.[edgeId] ?? DEFAULT_EDGE_LABEL;
}

export function nextPlacement(placement: LabelPlacement): LabelPlacement {
  const index = LABEL_PLACEMENTS.findIndex((p) => p.id === placement);
  return LABEL_PLACEMENTS[(index + 1) % LABEL_PLACEMENTS.length].id;
}

/** Rows a text takes at `columns` characters a line, hard breaks included. */
export function rowsOf(text: string, columns = LABEL_COLUMNS): number {
  return text
    .split("\n")
    .reduce(
      (rows, line) => rows + Math.max(1, Math.ceil(line.length / columns)),
      0,
    );
}

/** Columns the widest line needs, up to the point where lines wrap. */
export function columnsOf(text: string, columns = LABEL_COLUMNS): number {
  const widest = Math.max(0, ...text.split("\n").map((line) => line.length));
  return Math.min(columns, Math.max(8, widest));
}

/**
 * The room a label takes: the size the author set, or what its text needs.
 *
 * An estimate, deliberately. Placement has to be decided while the canvas is
 * being built, before anything is measured, and a guess within a few pixels
 * puts a label beside its line just as well as a measurement would.
 */
export function labelSize(
  text: string,
  entry: EdgeLabelLayout,
  scale = 1,
): Size {
  const width =
    entry.width ??
    Math.min(260 * scale, Math.max(75, columnsOf(text) * CHAR * scale + PAD.x));
  const height = entry.height ?? rowsOf(text) * LINE * scale + PAD.y;
  return { width, height };
}

/**
 * The corners of a stepped path, read back from the path string.
 *
 * React Flow draws a step path as `M`, then for every corner a straight run to
 * just before it and a quadratic curve whose control point *is* the corner, and
 * a final `L`. A corner that does not turn is written as a plain `L`. So the
 * corners are the `M` point, every `Q` control point, every `L` not immediately
 * followed by a curve, and the last point.
 */
export function polylineOf(path: string): Point[] {
  const tokens = path.match(/[MLQ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const commands: Array<{ op: string; values: number[] }> = [];
  for (const token of tokens) {
    if (/^[MLQ]$/i.test(token))
      commands.push({ op: token.toUpperCase(), values: [] });
    else commands[commands.length - 1]?.values.push(Number(token));
  }
  const points: Point[] = [];
  const push = (x: number, y: number) => {
    const last = points[points.length - 1];
    if (!last || Math.abs(last.x - x) > 0.01 || Math.abs(last.y - y) > 0.01)
      points.push({ x, y });
  };
  commands.forEach((command, index) => {
    // For `Q` the first pair is the control point, which is the corner itself.
    const [x, y] = command.values;
    if (command.op === "M" || command.op === "Q") push(x, y);
    else if (command.op === "L" && commands[index + 1]?.op !== "Q") push(x, y);
  });
  return points;
}

function length(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The point halfway along the path, measured along the line, not across it. */
export function midpointOf(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  const total = points
    .slice(1)
    .reduce((sum, point, i) => sum + length(points[i], point), 0);
  let remaining = total / 2;
  for (let i = 1; i < points.length; i++) {
    const piece = length(points[i - 1], points[i]);
    if (remaining <= piece && piece > 0) {
      const t = remaining / piece;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
    remaining -= piece;
  }
  return points[points.length - 1];
}

interface Run {
  from: Point;
  to: Point;
  length: number;
}

function runs(points: Point[], horizontal: boolean): Run[] {
  const found: Run[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const flat = horizontal
      ? Math.abs(a.y - b.y) < 0.5
      : Math.abs(a.x - b.x) < 0.5;
    if (flat && length(a, b) > 0)
      found.push({ from: a, to: b, length: length(a, b) });
  }
  return found;
}

function clamp(value: number, low: number, high: number): number {
  return low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value));
}

/** The point of a run nearest to `target`. */
function nearestOn(run: Run, target: Point): Point {
  return {
    x: clamp(
      target.x,
      Math.min(run.from.x, run.to.x),
      Math.max(run.from.x, run.to.x),
    ),
    y: clamp(
      target.y,
      Math.min(run.from.y, run.to.y),
      Math.max(run.from.y, run.to.y),
    ),
  };
}

/**
 * The run to set a label against: long enough, and nearest the middle.
 *
 * When none is long enough the longest one stands in -- a label a little wider
 * than its run still reads as belonging to it, where no label at all would read
 * as a line without a name.
 */
function chooseRun(
  candidates: Run[],
  minimum: number,
  middle: Point,
): Run | null {
  if (candidates.length === 0) return null;
  const long = candidates.filter((run) => run.length >= minimum);
  if (long.length === 0)
    return candidates.reduce((best, run) =>
      run.length > best.length ? run : best,
    );
  return long.reduce((best, run) =>
    length(nearestOn(run, middle), middle) <
    length(nearestOn(best, middle), middle)
      ? run
      : best,
  );
}

/**
 * Where the centre of a label goes for a placement, before any dragging.
 *
 * `inline` is the spot the canvas already chose for the label inside its line.
 */
export function placementCentre(
  points: Point[],
  placement: LabelPlacement,
  size: Size,
  inline: Point,
): Point {
  if (placement === "inline" || points.length < 2) return inline;
  const middle = midpointOf(points);

  if (placement === "above" || placement === "below") {
    const run = chooseRun(runs(points, true), size.width / 2, middle);
    const sign = placement === "above" ? -1 : 1;
    if (!run)
      return { x: middle.x, y: middle.y + sign * (GAP + size.height / 2) };
    const left = Math.min(run.from.x, run.to.x);
    const right = Math.max(run.from.x, run.to.x);
    // Keep at least half the label over the run, so it sits on it rather than
    // hanging off the corner.
    const x = clamp(
      nearestOn(run, middle).x,
      left + size.width / 4,
      right - size.width / 4,
    );
    return { x, y: run.from.y + sign * (GAP + size.height / 2) };
  }

  const run = chooseRun(
    runs(points, false),
    Math.max(NOTICEABLE, size.height / 2),
    middle,
  );
  const sign = placement === "left" ? -1 : 1;
  if (!run) return { x: middle.x + sign * (GAP + size.width / 2), y: middle.y };
  const top = Math.min(run.from.y, run.to.y);
  const bottom = Math.max(run.from.y, run.to.y);
  const y = clamp(
    nearestOn(run, middle).y,
    top + size.height / 4,
    bottom - size.height / 4,
  );
  return { x: run.from.x + sign * (GAP + size.width / 2), y };
}

/** Where the centre of a label goes: a dragged offset wins over any placement. */
export function labelCentre(
  points: Point[],
  entry: EdgeLabelLayout,
  size: Size,
  inline: Point,
): Point {
  if (entry.dx !== null && entry.dy !== null) {
    const middle = points.length ? midpointOf(points) : inline;
    return { x: middle.x + entry.dx, y: middle.y + entry.dy };
  }
  return placementCentre(points, entry.placement, size, inline);
}

/** A size inside the bounds a label may be given. */
export function clampSize(size: Size): Size {
  return {
    width: Math.round(clamp(size.width, MIN_LABEL.width, MAX_LABEL.width)),
    height: Math.round(clamp(size.height, MIN_LABEL.height, MAX_LABEL.height)),
  };
}
