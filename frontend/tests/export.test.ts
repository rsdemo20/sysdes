import { describe, it, expect } from "vitest";
import source from "../src/model/mixed.json";
import type { CanvasDocument } from "../src/model/types";
const fixture = source as unknown as CanvasDocument;
import { documentToSvg, documentToExport } from "../src/solutions/export";
describe("independent full canvas export", () => {
  it("wraps the original canonical document without renderer data", () => {
    const result = documentToExport(fixture, "Тест / Design");
    expect(result).toEqual({
      exportSchemaVersion: 1,
      name: "Тест / Design",
      domainId: "ecommerce",
      templateProvenance: fixture.semantic.templateProvenance,
      document: fixture,
    });
  });
  it("includes all diagrams, fields, return, external text and safe XML", () => {
    const doc = structuredClone(fixture);
    doc.semantic.diagrams[0].title = '<script>alert("x")</script> & текст';
    const svg = documentToSvg(doc);
    for (const value of [
      "Orders",
      "PaymentEvent",
      "200 OK",
      "Поведение после сбоя",
      "Корзину",
      "field-order-id",
      "message-response",
    ])
      expect(
        svg.replace(/<[^>]+>/g, "") + " " + svg.match(/id="[^"]+"/g)?.join(" "),
      ).toContain(value);
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toMatch(/<script|foreignObject|<image|<input|<button/);
  });
  it("ignores viewport and includes remote negative-position annotations", () => {
    const doc = structuredClone(fixture);
    const original = documentToSvg(doc);
    doc.layout.viewport = { x: 999, y: -555, zoom: 0.3 };
    expect(documentToSvg(doc)).toBe(original);
    doc.layout.annotationOffsets["annotation-orders"] = {
      dx: -4000,
      dy: 2200,
      width: 330,
      height: 160,
    };
    const svg = documentToSvg(doc);
    const viewBox = svg
      .match(/viewBox="([^"]+)"/)![1]
      .split(" ")
      .map(Number);
    expect(viewBox[0]).toBeLessThan(-3900);
    expect(viewBox[1] + viewBox[3]).toBeGreaterThan(2460);
  });
});
