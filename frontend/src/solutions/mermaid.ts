/**
 * Mermaid export: one document per diagram.
 *
 * Not one combined file. Mermaid parses a single definition of a single type, so
 * a canvas holding an HLD, an ER and a sequence cannot be expressed as one `.mmd`
 * at all -- pasting such a file into Draw.io or Miro fails on the second header.
 * D-44 settles this: separate documents, with a combined `.md` only as
 * documentation, where each diagram sits in its own fenced block.
 *
 * The acceptance criterion is that a document pastes into those tools without
 * hand editing, which makes escaping the substance of this file rather than a
 * detail. Labels here are arbitrary user text: they contain quotes, pipes,
 * newlines and semicolons, all of which are syntax in one Mermaid dialect or
 * another. Every label goes through an escape that turns those into Mermaid's
 * own entity codes, so the text survives and the syntax does not break.
 */
import type { CanvasDocument } from "../model/types";

export interface MermaidDocument {
  diagramId: string;
  /** The diagram kind this came from, which decides the Mermaid dialect. */
  type: "hld" | "er" | "sequence";
  title: string;
  text: string;
}

/**
 * Make user text safe inside a Mermaid label.
 *
 * Mermaid reads `#NNN;` as a character code, which is the only escape it offers
 * inside labels. `#` itself goes first, or escaping anything else would produce
 * a sequence Mermaid then re-reads as an entity.
 */
export function escapeLabel(value: string): string {
  return value
    .replace(/#/g, "#35;")
    .replace(/"/g, "#quot;")
    // `%` is rejected inside an ER entity name -- `%%` opens a comment, and the
    // lexer will not take it even quoted. "99.9%" is an ordinary label, so this
    // is not an edge case.
    .replace(/%/g, "#37;")
    .replace(/\|/g, "#124;")
    .replace(/[{}]/g, (brace) => (brace === "{" ? "#123;" : "#125;"))
    .replace(/</g, "#60;")
    .replace(/>/g, "#62;")
    // A newline inside a label ends the statement; Mermaid's own break is <br/>,
    // which has to be written after the angle brackets above are escaped.
    .replace(/\r?\n/g, "<br/>");
}

/**
 * A Mermaid-safe identifier.
 *
 * Object ids are ours and already tame, but an id is not a label: anything
 * outside word characters would end the token and silently split a statement.
 */
function identifier(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `n_${cleaned}` : cleaned;
}

/** Shapes carry meaning that a rectangle would lose. */
const HLD_SHAPE: Record<string, [string, string]> = {
  actor: ["([", "])"],
  service: ["[", "]"],
  datastore: ["[(", ")]"],
  queue: [">", "]"],
  external_system: ["[[", "]]"],
  boundary: ["{{", "}}"],
};

function hldDiagram(diagram: Record<string, any>): string {
  const lines = ["flowchart LR"];
  for (const node of diagram.nodes ?? []) {
    const [open, close] = HLD_SHAPE[node.kind] ?? ["[", "]"];
    lines.push(`  ${identifier(node.id)}${open}"${escapeLabel(node.label ?? node.id)}"${close}`);
  }
  for (const edge of diagram.edges ?? []) {
    // Direction is part of the design, so the arrow always points source to
    // target; the line style carries the interaction instead.
    const arrow =
      edge.interaction === "async"
        ? "-.->"
        : edge.interaction === "return"
          ? "-.->"
          : "-->";
    const parts = [edge.label, edge.protocol].filter(Boolean).join(" · ");
    const label = parts ? `|"${escapeLabel(parts)}"|` : "";
    lines.push(
      `  ${identifier(edge.sourceId)} ${arrow}${label} ${identifier(edge.targetId)}`,
    );
  }
  return lines.join("\n");
}

/**
 * Cardinality glyphs, which are not symmetric in Mermaid: the left side of a
 * relationship is written with mirrored characters.
 */
const LEFT_CARDINALITY: Record<string, string> = {
  "1": "||",
  "0..1": "|o",
  "1..*": "}|",
  "0..*": "}o",
};
const RIGHT_CARDINALITY: Record<string, string> = {
  "1": "||",
  "0..1": "o|",
  "1..*": "|{",
  "0..*": "o{",
};

function erDiagram(diagram: Record<string, any>): string {
  const lines = ["erDiagram"];
  for (const entity of diagram.entities ?? []) {
    const keys = new Set<string>(entity.primaryKeyFieldIds ?? []);
    lines.push(`  "${escapeLabel(entity.label ?? entity.id)}" {`);
    for (const field of entity.fields ?? []) {
      // Types and names are tokens here, not labels: Mermaid gives them no
      // escape at all, so anything unusable is reduced rather than smuggled in.
      const type = identifier(String(field.dataType ?? "unknown"));
      const name = identifier(String(field.name ?? field.id));
      const marks = [keys.has(field.id) ? "PK" : "", field.nullable === false ? "" : ""]
        .filter(Boolean)
        .join(",");
      lines.push(`    ${type} ${name}${marks ? ` ${marks}` : ""}`);
    }
    lines.push("  }");
  }
  const byId = new Map(
    (diagram.entities ?? []).map((entity: Record<string, any>) => [
      entity.id,
      escapeLabel(entity.label ?? entity.id),
    ]),
  );
  for (const relationship of diagram.relationships ?? []) {
    const left = LEFT_CARDINALITY[relationship.sourceCardinality] ?? "||";
    const right = RIGHT_CARDINALITY[relationship.targetCardinality] ?? "||";
    // A dashed line is Mermaid's non-identifying relationship, which is what a
    // relationship the database does not enforce actually is.
    const line = relationship.enforcement === "foreign_key" ? "--" : "..";
    const source = byId.get(relationship.sourceEntityId) ?? identifier(relationship.sourceEntityId);
    const target = byId.get(relationship.targetEntityId) ?? identifier(relationship.targetEntityId);
    lines.push(
      `  "${source}" ${left}${line}${right} "${target}" : "${escapeLabel(relationship.label ?? "")}"`,
    );
  }
  return lines.join("\n");
}

const MESSAGE_ARROW: Record<string, string> = {
  sync: "->>",
  async: "-)",
  return: "-->>",
};

function sequenceDiagram(diagram: Record<string, any>): string {
  const lines = ["sequenceDiagram"];
  for (const participant of diagram.participants ?? []) {
    const keyword = participant.role === "actor" ? "actor" : "participant";
    lines.push(
      `  ${keyword} ${identifier(participant.id)} as "${escapeLabel(participant.label ?? participant.id)}"`,
    );
  }
  // Order is explicit in the document and never inferred from position, so it
  // is what the export follows.
  const messages = [...(diagram.messages ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  for (const message of messages) {
    const arrow = MESSAGE_ARROW[message.kind] ?? "->>";
    lines.push(
      `  ${identifier(message.sourceId)}${arrow}${identifier(message.targetId)}: ${escapeLabel(message.label ?? "")}`,
    );
  }
  return lines.join("\n");
}

const RENDERERS: Record<string, (diagram: Record<string, any>) => string> = {
  hld: hldDiagram,
  er: erDiagram,
  sequence: sequenceDiagram,
};

/** One valid document per diagram the canvas actually has. */
export function documentToMermaid(document: CanvasDocument): MermaidDocument[] {
  const diagrams = (document.semantic as Record<string, any>).diagrams ?? [];
  const result: MermaidDocument[] = [];
  for (const diagram of diagrams as Record<string, any>[]) {
    const render = RENDERERS[diagram.type];
    if (!render) continue;
    result.push({
      diagramId: diagram.id,
      type: diagram.type,
      title: diagram.title ?? diagram.id,
      text: render(diagram),
    });
  }
  return result;
}

/**
 * The combined Markdown, which is documentation rather than a diagram.
 *
 * Each diagram keeps its own fenced block, because that is the only way several
 * of them coexist in one file without Mermaid trying to parse them together.
 */
export function mermaidToMarkdown(
  documents: MermaidDocument[],
  canvasName: string,
): string {
  const parts = [`# ${canvasName}`, ""];
  for (const item of documents) {
    parts.push(`## ${item.title}`, "", "```mermaid", item.text, "```", "");
  }
  return parts.join("\n");
}

/** A file name per diagram, stable and free of anything a filesystem dislikes. */
export function mermaidFileName(item: MermaidDocument): string {
  return `${identifier(item.diagramId)}.mmd`;
}
