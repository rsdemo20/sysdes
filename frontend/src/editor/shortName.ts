/**
 * The short handle every block carries: qu3, gw1, lb2.
 *
 * A design is discussed out loud and in writing, and "the queue" stops working
 * the moment there are two. The prefix says what kind of part it is and the
 * number says which one, so an annotation, a message or a review comment can
 * point at exactly one block.
 *
 * The number is the block's position on its diagram, which makes it unique
 * there without any bookkeeping. New blocks continue past the highest number in
 * use rather than filling gaps, so deleting a block never renames another one --
 * a handle that moves is worse than no handle.
 *
 * Documents written before short names exist keep working: `shortNameOf` falls
 * back to deriving one from the block's kind and position, so every block can be
 * referred to whether or not the field was ever stored.
 */
import type { Diagram, Entity, HldNode, Participant } from "../model/types";

export type Block = HldNode | Entity | Participant;

/** Prefix for a block that has no stored short name, taken from its kind. */
const DERIVED_PREFIX: Record<string, string> = {
  actor: "ac",
  service: "svc",
  datastore: "db",
  queue: "qu",
  external_system: "ex",
  boundary: "bd",
  entity: "en",
  participant: "pt",
};

export function blocksOf(diagram: Diagram): Block[] {
  if (diagram.type === "hld") return diagram.nodes;
  if (diagram.type === "er") return diagram.entities;
  return diagram.participants;
}

function derivedPrefix(diagram: Diagram, block: Block): string {
  if (diagram.type === "hld")
    return DERIVED_PREFIX[(block as HldNode).kind] ?? "bl";
  return diagram.type === "er" ? DERIVED_PREFIX.entity : DERIVED_PREFIX.participant;
}

/** The trailing number of a short name, or 0 when it has none. */
function ordinalOf(shortName: string | null | undefined): number {
  const digits = /([0-9]+)$/.exec(shortName ?? "");
  return digits ? Number(digits[1]) : 0;
}

/**
 * The next free short name on this diagram for a preset's prefix.
 *
 * Continues past the highest number any block on the diagram holds, whatever
 * its prefix: the number is a position on the diagram, not a per-kind counter,
 * so two blocks never share it.
 */
export function nextShortName(diagram: Diagram | undefined, prefix: string): string {
  const blocks = diagram ? blocksOf(diagram) : [];
  const highest = blocks.reduce(
    (top, block) => Math.max(top, ordinalOf(block.shortName), 0),
    0,
  );
  // Four digits is the width the numbering is designed for; past that a canvas
  // is far beyond what one diagram should hold, and the name simply grows.
  return `${prefix}${Math.max(highest + 1, blocks.length + 1)}`;
}

/** The short name to show for a block: the stored one, or one derived from it. */
export function shortNameOf(diagram: Diagram, blockId: string): string | null {
  const blocks = blocksOf(diagram);
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return null;
  const block = blocks[index];
  return block.shortName ?? `${derivedPrefix(diagram, block)}${index + 1}`;
}

/** The short name of a block anywhere in the document, or null. */
export function findShortName(
  diagrams: Diagram[],
  blockId: string,
): string | null {
  for (const diagram of diagrams) {
    const found = shortNameOf(diagram, blockId);
    if (found) return found;
  }
  return null;
}
