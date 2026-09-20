/**
 * JSON Canonicalization Scheme (RFC 8785) and the two hashed projections.
 *
 * The backend must produce byte-identical output, so this file is deliberately a
 * direct port of the reference implementation the specification fixtures were
 * generated with. Changing the shape of a projection changes stored hashes, so it
 * is a contract change, not a refactor.
 */

/** Arrays that are sets of records: ordered by id before hashing. */
const RECORD_ARRAYS = new Set([
  "diagrams",
  "nodes",
  "edges",
  "entities",
  "relationships",
  "participants",
  "fields",
  "annotations",
  "notes",
  "requirements",
  "acceptanceCriteria",
  "technicalParameters",
  "assumptions",
  "constraints",
  "referencedObjects",
  "indexes",
  "uniqueConstraints",
]);

/** Arrays that are sets of plain IDs: ordered lexicographically before hashing. */
const ID_ARRAYS = new Set([
  "diagramIds",
  "requirementRefs",
  "childIds",
  "addedIds",
  "removedIds",
  "changedIds",
]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Order the arrays that are sets, so that a different authoring order does not
 * change the hash. Significant order is preserved: messages carry an explicit
 * order, and primaryKeyFieldIds, index fieldIds and fieldMapping pairs are
 * meaningful sequences that must never be sorted.
 */
export function normalize(value: unknown, key = ""): Json {
  if (Array.isArray(value)) {
    const items = value.map((item) => normalize(item));
    if (RECORD_ARRAYS.has(key))
      return [...items].sort((a, b) => {
        const left = (a as { id: string }).id;
        const right = (b as { id: string }).id;
        return left < right ? -1 : left > right ? 1 : 0;
      });
    if (ID_ARRAYS.has(key))
      return [...(items as string[])].sort() as unknown as Json[];
    if (key === "messages")
      return [...items].sort(
        (a, b) =>
          (a as { order: number }).order - (b as { order: number }).order,
      );
    return items;
  }
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        normalize(v, k),
      ]),
    );
  return value as Json;
}

/** RFC 8785 serialization: sorted keys by UTF-16 code unit, no insignificant whitespace. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite number");
    // JSON.stringify already emits the shortest round-tripping form RFC 8785 requires.
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff))
          throw new Error("Unpaired surrogate");
      } else if (unit >= 0xdc00 && unit <= 0xdfff)
        throw new Error("Unpaired surrogate");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return "[" + value.map(canonicalize).join(",") + "]";
  if (typeof value !== "object")
    throw new Error("Unsupported value in canonical JSON");
  const record = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(record)
      .sort()
      .map((key) => canonicalize(key) + ":" + canonicalize(record[key]))
      .join(",") +
    "}"
  );
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const SEMANTIC_KEYS = [
  "exportVersion",
  "evaluationType",
  "diagramIds",
  "semanticExport",
  "templateBaseline",
  "semanticDelta",
] as const;

const SETTINGS_KEYS = [
  "semanticContentHash",
  "promptVersion",
  "rubricVersion",
  "modelId",
  "modelParameters",
  "providerPolicy",
  "reportLocale",
] as const;

const pick = (source: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, source[key]]));

/**
 * The semantic projection excludes layout, name, canvasId, revision, timestamps
 * and evaluation settings. rubricVersion is stripped from the copied semantics
 * because it describes how the run is scored, not what the user drew.
 */
export function semanticProjection(input: Record<string, unknown>) {
  const projection = structuredClone(pick(input, SEMANTIC_KEYS)) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  for (const key of ["semanticExport", "templateBaseline"] as const) {
    const part = projection[key];
    if (!part) continue;
    delete part.rubricVersion;
    const provenance = part.templateProvenance as
      Record<string, unknown> | null | undefined;
    if (provenance) delete provenance.rubricVersion;
  }
  return projection;
}

export function settingsProjection(input: Record<string, unknown>) {
  return pick(input, SETTINGS_KEYS);
}

export function semanticContentHash(
  input: Record<string, unknown>,
): Promise<string> {
  return sha256Hex(canonicalBytes(normalize(semanticProjection(input))));
}

export function evaluationInputHash(
  input: Record<string, unknown>,
): Promise<string> {
  return sha256Hex(canonicalBytes(normalize(settingsProjection(input))));
}
