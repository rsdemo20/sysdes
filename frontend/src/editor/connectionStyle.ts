/**
 * The five ways a connection can be drawn, and what each one says.
 *
 * The vocabulary is the author's: a solid arrow, a solid arrow both ways, a
 * plain line, a dashed arrow, a dashed line. What the document stores is what
 * those drawings mean -- `interaction` and, for the one the enum could not
 * express, `bidirectional`. Nothing here is a second, parallel description of
 * the same fact: the style *is* the meaning, spelled the way a reviewer and the
 * model both already read it.
 *
 * A dashed line is not decoration either. Solid means a call, dashed means the
 * two sides are not waiting on each other, and no arrowhead means the direction
 * was never claimed -- which is a thing a design may honestly leave open.
 */
import type { HldEdge } from "../model/types";

export type ConnectionStyleId =
  "arrow" | "double" | "line" | "dashed-arrow" | "dashed-line";

export interface ConnectionStyle {
  id: ConnectionStyleId;
  /** One glyph for the picker, drawn the way the line will be. */
  glyph: string;
  names: { ru: string; en: string };
  interaction: HldEdge["interaction"];
  bidirectional: boolean;
  dashed: boolean;
  arrowAtTarget: boolean;
  arrowAtSource: boolean;
}

/**
 * In the order the panel offers them: the two arrows a design reaches for
 * most, the line that points both ways, then the two that claim no direction.
 */
export const CONNECTION_STYLES: ConnectionStyle[] = [
  {
    id: "arrow",
    glyph: "→",
    names: { ru: "Стрелка", en: "Arrow" },
    interaction: "sync",
    bidirectional: false,
    dashed: false,
    arrowAtTarget: true,
    arrowAtSource: false,
  },
  {
    id: "dashed-arrow",
    glyph: "⇢",
    names: { ru: "Пунктир со стрелкой", en: "Dashed arrow" },
    interaction: "async",
    bidirectional: false,
    dashed: true,
    arrowAtTarget: true,
    arrowAtSource: false,
  },
  {
    id: "double",
    glyph: "↔",
    names: { ru: "В обе стороны", en: "Both ways" },
    interaction: "sync",
    bidirectional: true,
    dashed: false,
    arrowAtTarget: true,
    arrowAtSource: true,
  },
  {
    id: "line",
    glyph: "—",
    names: { ru: "Линия", en: "Line" },
    interaction: "unspecified",
    bidirectional: false,
    dashed: false,
    arrowAtTarget: false,
    arrowAtSource: false,
  },
  {
    id: "dashed-line",
    glyph: "⋯",
    names: { ru: "Пунктир", en: "Dashed line" },
    interaction: "dataflow",
    bidirectional: false,
    dashed: true,
    arrowAtTarget: false,
    arrowAtSource: false,
  },
];

const BY_ID = new Map(CONNECTION_STYLES.map((style) => [style.id, style]));

export function styleById(id: ConnectionStyleId): ConnectionStyle {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown connection style: ${id}`);
  return found;
}

/**
 * How an existing connection is drawn.
 *
 * A two-way line is recognised whatever its interaction, because pointing both
 * ways is the louder statement; everything else follows the interaction, and an
 * unknown value falls back to the plain line rather than inventing a direction.
 */
export function styleOf(edge: {
  interaction: HldEdge["interaction"];
  bidirectional?: boolean | null;
}): ConnectionStyle {
  if (edge.bidirectional) return styleById("double");
  return (
    CONNECTION_STYLES.find(
      (style) => !style.bidirectional && style.interaction === edge.interaction,
    ) ?? styleById("line")
  );
}
