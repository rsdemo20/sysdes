import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  canonicalBytes,
  canonicalize,
  evaluationInputHash,
  normalize,
  semanticContentHash,
  semanticProjection,
  settingsProjection,
  sha256Hex,
} from "../src/model/canonical";
import { DocumentError, validateDocument } from "../src/model/validate";

// One vendored copy of the contract fixtures serves both the TypeScript and the
// Python suites, so the two languages cannot silently verify different bytes.
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../contracts/examples/${name}`, import.meta.url));
const readJson = (name: string) =>
  JSON.parse(readFileSync(fixture(name), "utf8"));
const readBytes = (name: string) => new Uint8Array(readFileSync(fixture(name)));

const evaluationInput = readJson("evaluation-input.json");
const hashes = readJson("canonical-hashes.json");

describe("canonical bytes", () => {
  test("semantic projection reproduces the cross-language fixture bytes", () => {
    const bytes = canonicalBytes(
      normalize(semanticProjection(evaluationInput)),
    );
    expect(bytes).toEqual(readBytes("semantic-projection.canonical.json"));
  });

  test("settings projection reproduces the cross-language fixture bytes", () => {
    const bytes = canonicalBytes(
      normalize(settingsProjection(evaluationInput)),
    );
    expect(bytes).toEqual(readBytes("settings-projection.canonical.json"));
  });

  test("hashes match the values Python produced for the same fixture", async () => {
    expect(await semanticContentHash(evaluationInput)).toBe(
      hashes.semanticContentHash,
    );
    expect(await evaluationInputHash(evaluationInput)).toBe(
      hashes.evaluationInputHash,
    );
    expect(evaluationInput.semanticContentHash).toBe(
      hashes.semanticContentHash,
    );
  });

  test("JCS vectors cover number formatting, Unicode and key order", () => {
    for (const vector of readJson("jcs-vectors.json"))
      expect(canonicalize(vector.input)).toBe(vector.expected);
  });

  test("record and set order does not change the semantic hash", async () => {
    const shuffled = structuredClone(evaluationInput);
    shuffled.diagramIds.reverse();
    shuffled.semanticExport.diagrams.reverse();
    shuffled.semanticExport.diagrams[0].nodes?.reverse();
    expect(await semanticContentHash(shuffled)).toBe(
      await semanticContentHash(evaluationInput),
    );
  });

  test("message order is authoritative and is not re-sorted by id", () => {
    const projection = normalize(semanticProjection(evaluationInput)) as {
      semanticExport: {
        diagrams: Array<{ messages?: Array<{ order: number }> }>;
      };
    };
    for (const diagram of projection.semanticExport.diagrams) {
      if (!diagram.messages) continue;
      const orders = diagram.messages.map((m) => m.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    }
  });

  test("edited free text changes the semantic hash", async () => {
    const changed = structuredClone(evaluationInput);
    changed.semanticExport.notes[0].text += " ";
    expect(await semanticContentHash(changed)).not.toBe(
      await semanticContentHash(evaluationInput),
    );
  });

  test("report locale changes the input hash but not the semantic hash", async () => {
    const changed = structuredClone(evaluationInput);
    changed.reportLocale = changed.reportLocale === "ru" ? "en" : "ru";
    expect(await semanticContentHash(changed)).toBe(
      await semanticContentHash(evaluationInput),
    );
    expect(await evaluationInputHash(changed)).not.toBe(
      await evaluationInputHash(evaluationInput),
    );
  });

  test("non-finite numbers and unpaired surrogates are rejected", () => {
    expect(() => canonicalize({ a: Number.NaN })).toThrow(/finite/i);
    expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow(
      /finite/i,
    );
    expect(() => canonicalize({ a: "\ud800" })).toThrow(/surrogate/i);
  });

  test("sha256 of known bytes matches the documented hex form", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("document validation", () => {
  test("the schema compiled into the app matches the vendored contract", () => {
    const bundled = readFileSync(
      fileURLToPath(
        new URL(
          "../src/model/contracts/canvas-document.schema.json",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const vendored = readFileSync(
      fileURLToPath(
        new URL("../../contracts/canvas-document.schema.json", import.meta.url),
      ),
      "utf8",
    );
    expect(JSON.parse(bundled)).toEqual(JSON.parse(vendored));
  });

  test("the contract fixture is accepted", () => {
    expect(() =>
      validateDocument(readJson("canvas-document.json")),
    ).not.toThrow();
  });

  test("the shipped prototype scene is a valid production document", async () => {
    const mixed = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../src/model/mixed.json", import.meta.url)),
        "utf8",
      ),
    );
    expect(() => validateDocument(mixed)).not.toThrow();
  });

  test.each([
    ["unknown-property", "schema"],
    ["invalid-kind", "schema"],
    ["duplicate-id", "duplicate_id"],
    ["dangling-edge", "edge_endpoints"],
    ["bad-return", "schema"],
    ["reverse-return", "return_direction"],
    ["wrong-layout-type", "layout_reference"],
  ])("negative fixture %s is rejected as %s", (name, code) => {
    let error: unknown;
    try {
      validateDocument(readJson(`negative/${name}.json`));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DocumentError);
    expect((error as DocumentError).code).toBe(code);
  });

  test("a return answering a later message is rejected by the invariant, not the schema", () => {
    const document = readJson("canvas-document.json");
    const sequence = document.semantic.diagrams.find(
      (d: { type: string }) => d.type === "sequence",
    );
    // Structurally valid: kinds, orders and the reference all satisfy the schema.
    const [request, reply] = [sequence.messages[0], sequence.messages[1]];
    request.order = 2;
    reply.order = 1;
    let error: unknown;
    try {
      validateDocument(document);
    } catch (caught) {
      error = caught;
    }
    expect((error as DocumentError).code).toBe("return_target");
  });

  test("structural typing alone is not treated as full validation", () => {
    const document = readJson("canvas-document.json");
    const hld = document.semantic.diagrams.find(
      (d: { type: string }) => d.type === "hld",
    );
    hld.edges[0].targetId = "hld-does-not-exist";
    expect(() => validateDocument(document)).toThrow(DocumentError);
  });

  test("more than three external annotations on one block are rejected", () => {
    const document = readJson("canvas-document.json");
    const owner = document.semantic.annotations[0].ownerObjectId;
    for (let i = 0; i < 4; i++) {
      document.semantic.annotations.push({
        id: `annotation-extra-${i}`,
        ownerObjectId: owner,
        text: "extra",
        originTemplateObjectId: null,
      });
      document.layout.annotationOffsets[`annotation-extra-${i}`] = {
        dx: 10,
        dy: 10,
        width: 120,
        height: 40,
      };
    }
    expect(() => validateDocument(document)).toThrow(
      expect.objectContaining({ code: "annotation_limit" }),
    );
  });
});
