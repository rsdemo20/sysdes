// @vitest-environment jsdom
/**
 * Mermaid export.
 *
 * The acceptance criterion is that each document pastes into Draw.io and Miro
 * without hand editing, and both of those parse with Mermaid itself. So these
 * tests parse with Mermaid itself too: asserting on substrings would only prove
 * the generator repeats what the generator was told to write, and every
 * interesting failure here is a syntax error that a substring check sails past.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import mermaid from "mermaid";
import {
  documentToMermaid,
  escapeLabel,
  mermaidFileName,
  mermaidToMarkdown,
} from "../src/solutions/mermaid";
import type { CanvasDocument } from "../src/model/types";

// Resolved from the working directory: under the jsdom environment import.meta
// is not a file URL, so it cannot be used to find the fixture.
const example = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../contracts/examples/canvas-document.json"),
    "utf-8",
  ),
) as CanvasDocument;

/** Mermaid's parser needs a DOM-free configuration to run under Vitest. */
beforeAll(() => {
  mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true });
});

async function parses(text: string): Promise<true> {
  // mermaid.parse throws on a syntax error and resolves otherwise.
  await mermaid.parse(text);
  return true;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

describe("one document per diagram", () => {
  test("a mixed canvas yields one document per diagram, each of its own type", () => {
    const documents = documentToMermaid(example);
    expect(documents.map((d) => d.type)).toEqual(["hld", "er", "sequence"]);
    expect(new Set(documents.map((d) => d.diagramId)).size).toBe(3);
  });

  test("every document parses as Mermaid", async () => {
    for (const document of documentToMermaid(example)) {
      await expect(parses(document.text), document.type).resolves.toBe(true);
    }
  });

  test("no combined .mmd is produced, because Mermaid cannot read one", async () => {
    // Concatenating the documents is exactly what must not be offered: the
    // second header is a syntax error, which is the whole reason for D-44.
    const joined = documentToMermaid(example)
      .map((d) => d.text)
      .join("\n");
    await expect(mermaid.parse(joined)).rejects.toBeDefined();
  });

  test("the combined markdown keeps each diagram in its own fenced block", () => {
    const documents = documentToMermaid(example);
    const markdown = mermaidToMarkdown(documents, "Оплата заказа");
    expect(markdown.match(/```mermaid/g)).toHaveLength(3);
    expect(markdown).toContain("# Оплата заказа");
  });

  test("file names are per diagram and filesystem-safe", () => {
    for (const document of documentToMermaid(example)) {
      expect(mermaidFileName(document)).toMatch(/^[A-Za-z0-9_]+\.mmd$/);
    }
  });
});

describe("labels survive without breaking syntax", () => {
  const hostile = 'Заказ "срочный" | 100% #1 <b> {json} \nвторая строка';

  test("the escape neutralises every character that is syntax somewhere", () => {
    const escaped = escapeLabel(hostile);
    // Only the deliberate line break may still contain angle brackets.
    expect(escaped.replace(/<br\/>/g, "")).not.toMatch(/["|<>{}]/);
    expect(escaped).toContain("<br/>");
    expect(escaped).not.toContain("\n");
    // The hash is escaped first, or escaping anything else would produce a
    // sequence Mermaid reads back as an entity.
    expect(escaped).toContain("#35;1");
  });

  test("hostile labels still parse in every dialect", async () => {
    const document = clone(example) as any;
    for (const diagram of document.semantic.diagrams) {
      for (const node of diagram.nodes ?? []) node.label = hostile;
      for (const edge of diagram.edges ?? []) edge.label = hostile;
      for (const entity of diagram.entities ?? []) entity.label = hostile;
      for (const relation of diagram.relationships ?? []) relation.label = hostile;
      for (const participant of diagram.participants ?? []) participant.label = hostile;
      for (const message of diagram.messages ?? []) message.label = hostile;
    }
    for (const generated of documentToMermaid(document)) {
      await expect(parses(generated.text), generated.type).resolves.toBe(true);
    }
  });
});

describe("what the diagrams have to preserve", () => {
  test("message order follows the document, not the array order", async () => {
    const document = clone(example) as any;
    const sequence = document.semantic.diagrams.find((d: any) => d.type === "sequence");
    sequence.messages.reverse();
    const text = documentToMermaid(document).find((d) => d.type === "sequence")!.text;

    const expected = [...sequence.messages]
      .sort((a: any, b: any) => a.order - b.order)
      .map((m: any) => escapeLabel(m.label));
    // Message lines are the ones carrying an arrow; participant ids happen to
    // start with "participant" too, so the keyword alone cannot separate them.
    const emitted = text
      .split("\n")
      .filter((line) => /(?:->>|-\)|-->>)/.test(line))
      .map((line) => line.slice(line.indexOf(":") + 1).trim());
    expect(emitted).toEqual(expected);
    await expect(parses(text)).resolves.toBe(true);
  });

  test("edge direction is kept even for an asynchronous interaction", () => {
    const text = documentToMermaid(example).find((d) => d.type === "hld")!.text;
    // The webhook runs payment -> orders; a dotted line marks it async, and the
    // arrow still points the way the design says.
    expect(text).toMatch(/hld_payment\s+-\.->.*hld_orders/);
  });

  test("primary keys are marked and cardinalities are not mirrored away", () => {
    const text = documentToMermaid(example).find((d) => d.type === "er")!.text;
    expect(text).toMatch(/uuid id PK/);
    // 0..* on the source and 1 on the target, in Mermaid's asymmetric glyphs.
    expect(text).toMatch(/\}o--\|\|/);
  });

  test("a canvas with no diagrams produces nothing rather than an empty file", () => {
    const document = clone(example) as any;
    document.semantic.diagrams = [];
    expect(documentToMermaid(document)).toEqual([]);
  });
});
