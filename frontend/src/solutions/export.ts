import type { CanvasDocument, Position } from "../model/types";

const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const palette = { hld: "#297a6a", er: "#6455aa", sequence: "#b47a28" };

export function documentToExport(document: CanvasDocument, name: string) {
  return {
    exportSchemaVersion: 1,
    name,
    domainId: document.semantic.domainId,
    templateProvenance: document.semantic.templateProvenance,
    document,
  };
}

/** A standalone, inert SVG. No DOM capture, foreignObject, HTML or remote assets. */
export function documentToSvg(document: CanvasDocument): string {
  const content: string[] = [];
  const bounds: Position[] = [];
  const positions = document.layout.objectPositions;
  const include = (rect: Position) => bounds.push(rect);
  const lineHeight = 19;
  // Conservative character widths keep line wrapping independent of the DOM.
  const wrap = (text: string, width: number) => {
    return text.split("\n").flatMap((line) => {
      const lines: string[] = [];
      let current = "";
      let used = 0;
      for (const c of Array.from(line)) {
        const cell = /[il.,:;!| ]/.test(c)
          ? 4
          : /[MW@\u0400-\u04ff]/.test(c)
            ? 10
            : (c.codePointAt(0) ?? 0) > 0x2fff
              ? 14
              : 8;
        if (used + cell > width && current) {
          lines.push(current);
          current = "";
          used = 0;
        }
        current += c;
        used += cell;
      }
      lines.push(current);
      return lines;
    });
  };
  function text(
    value: string,
    x: number,
    y: number,
    width: number,
    options = "",
  ) {
    const lines = wrap(value, width);
    include({ x, y: y - 14, width, height: lines.length * lineHeight });
    return `<text x="${x}" y="${y}" font-size="13" ${options}>${lines.map((s, i) => `<tspan x="${x}" dy="${i ? lineHeight : 0}">${xml(s)}</tspan>`).join("")}</text>`;
  }
  function card(
    id: string,
    rect: Position,
    title: string,
    rows: Array<{ id?: string; text: string }>,
    color: string,
    fill = "#fff",
  ) {
    const titleLines = title ? wrap(title, rect.width - 28).length : 0;
    const rowHeights = rows.map(
      (row) => wrap(row.text, rect.width - 28).length * lineHeight,
    );
    const height = Math.max(
      rect.height,
      30 + titleLines * lineHeight + rowHeights.reduce((a, b) => a + b, 0) + 12,
    );
    include({ ...rect, height });
    let y = rect.y + 25;
    let inner = title
      ? text(title, rect.x + 14, y, rect.width - 28, 'font-weight="700"')
      : "";
    if (title) y += titleLines * lineHeight + 10;
    rows.forEach((row, i) => {
      inner += `<g${row.id ? ` id="${xml(row.id)}"` : ""}>${text(row.text, rect.x + 14, y, rect.width - 28, 'fill="#63716e"')}</g>`;
      y += rowHeights[i];
    });
    content.push(
      `<g id="${xml(id)}"><rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${height}" rx="9" fill="${fill}" stroke="${color}"/>${inner}</g>`,
    );
  }
  function arrow(
    id: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    label: string,
    kind = "sync",
    labelY?: number,
    self = false,
  ) {
    const extent = self ? 75 : 0;
    include({
      x: Math.min(x1, x2) - 10,
      y: Math.min(y1, y2) - 10,
      width: Math.abs(x2 - x1) + extent + 20,
      height: Math.abs(y2 - y1) + (self ? 50 : 20),
    });
    const path = self ? `M${x1} ${y1}h70v35h-70` : `M${x1} ${y1}L${x2} ${y2}`;
    const labelWidth = Math.max(130, Math.abs(x2 - x1) - 22);
    const labelText = text(
      label,
      (x1 + x2) / 2 - labelWidth / 2,
      labelY ?? y1 - 20,
      labelWidth,
      'fill="#4b5d58"',
    );
    content.push(
      `<g id="${xml(id)}" data-kind="${kind}"><path d="${path}" fill="none" stroke="#778c86" stroke-width="1.5" ${kind === "return" ? 'stroke-dasharray="6 5"' : ""} marker-end="url(#${kind === "async" ? "open" : "closed"}-arrow)"/>${labelText}</g>`,
    );
  }
  for (const diagram of document.semantic.diagrams) {
    const frame = document.layout.diagramFrames[diagram.id];
    if (frame) {
      include(frame);
      content.push(
        `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="14" fill="#f8faf9" stroke="#d7e2dd"/>`,
      );
      content.push(
        text(
          `${diagram.type.toUpperCase()} · ${diagram.title}`,
          frame.x + 20,
          frame.y + 29,
          frame.width - 40,
          `fill="${palette[diagram.type]}" font-weight="700"`,
        ),
      );
    }
    if (diagram.type === "sequence") {
      const endY =
        (frame?.y ?? 0) +
        Math.max(
          frame?.height ?? 600,
          180 + diagram.messages.length * 70 + 60,
        ) -
        40;
      for (const participant of diagram.participants) {
        const p = positions[participant.id];
        if (!p) continue;
        include({
          x: p.x + p.width / 2,
          y: p.y + p.height,
          width: 1,
          height: Math.max(0, endY - p.y - p.height),
        });
        content.push(
          `<path d="M${p.x + p.width / 2} ${p.y + p.height}V${endY}" stroke="#c4b9a3" stroke-dasharray="5 6"/>`,
        );
      }
      for (const m of [...diagram.messages].sort((a, b) => a.order - b.order)) {
        const a = positions[m.sourceId],
          b = positions[m.targetId];
        if (a && b) {
          const y = (frame?.y ?? 0) + 220 + (m.order - 1) * 70;
          arrow(
            m.id,
            a.x + a.width / 2,
            y,
            b.x + b.width / 2,
            y,
            `${m.order}. ${m.label}`,
            m.kind,
            undefined,
            m.sourceId === m.targetId,
          );
        }
      }
      for (const p of diagram.participants) {
        const rect = positions[p.id];
        if (rect)
          card(p.id, rect, p.label, [{ text: p.role }], palette.sequence);
      }
    } else if (diagram.type === "hld") {
      for (const e of diagram.edges) {
        const a = positions[e.sourceId],
          b = positions[e.targetId];
        if (a && b)
          arrow(
            e.id,
            b.x >= a.x ? a.x + a.width : a.x,
            a.y + a.height / 2,
            b.x >= a.x ? b.x : b.x + b.width,
            b.y + b.height / 2,
            e.label,
            e.interaction,
            Math.min(a.y, b.y) - 24,
          );
      }
      for (const node of diagram.nodes) {
        const rect = positions[node.id];
        if (rect)
          card(
            node.id,
            rect,
            node.label,
            [
              { text: node.kind },
              ...((node.properties.technology ?? node.properties.responsibility)
                ? [
                    {
                      text: (node.properties.technology ??
                        node.properties.responsibility)!,
                    },
                  ]
                : []),
            ],
            palette.hld,
          );
      }
    } else {
      for (const e of diagram.relationships) {
        const a = positions[e.sourceEntityId],
          b = positions[e.targetEntityId];
        if (a && b)
          arrow(
            e.id,
            b.x >= a.x ? a.x + a.width : a.x,
            a.y + a.height / 2,
            b.x >= a.x ? b.x : b.x + b.width,
            b.y + b.height / 2,
            `${e.sourceCardinality} → ${e.targetCardinality}${e.label ? " · " + e.label : ""}`,
            "sync",
            Math.min(a.y, b.y) - 24,
          );
      }
      for (const entity of diagram.entities) {
        const rect = positions[entity.id];
        if (rect)
          card(
            entity.id,
            rect,
            entity.label,
            entity.fields.map((f) => ({
              id: f.id,
              text: `${entity.primaryKeyFieldIds.includes(f.id) ? "PK · " : ""}${f.name}${f.dataType ? " : " + f.dataType : ""}`,
            })),
            palette.er,
          );
      }
    }
  }
  for (const annotation of document.semantic.annotations) {
    const owner = positions[annotation.ownerObjectId],
      offset = document.layout.annotationOffsets[annotation.id];
    if (owner && offset)
      card(
        annotation.id,
        {
          x: owner.x + offset.dx,
          y: owner.y + offset.dy,
          width: offset.width,
          height: offset.height,
        },
        "",
        [{ text: annotation.text }],
        "#dfc98a",
        "#fff9e8",
      );
  }
  document.semantic.notes.forEach((note, i) => {
    const rect = positions[note.id] ?? {
      x: 40,
      y: 800 + i * 180,
      width: 320,
      height: 140,
    };
    card(note.id, rect, "", [{ text: note.text }], "#dfc98a", "#fff9e8");
  });
  if (!bounds.length) include({ x: 0, y: 0, width: 640, height: 480 });
  const x = Math.min(...bounds.map((b) => b.x)) - 32,
    y = Math.min(...bounds.map((b) => b.y)) - 32;
  const width = Math.max(...bounds.map((b) => b.x + b.width)) - x + 32,
    height = Math.max(...bounds.map((b) => b.y + b.height)) - y + 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" font-family="Arial, sans-serif" fill="#253e35"><title>sysdes canvas</title><defs><marker id="closed-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#778c86"/></marker><marker id="open-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="none" stroke="#778c86"/></marker></defs><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/>${content.join("")}</svg>`;
}

export async function svgToPng(svg: string): Promise<Blob> {
  const image = new Image();
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    image.src = url;
    await image.decode();
    const scale = Math.min(
      1,
      8192 / image.naturalWidth,
      8192 / image.naturalHeight,
      Math.sqrt(32_000_000 / (image.naturalWidth * image.naturalHeight)),
    );
    if (scale < 1)
      throw new Error(
        "PNG exceeds 8192 px or 32 MP. Export SVG for the full-size canvas.",
      );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG rendering unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("PNG rendering failed")),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportCanvas(
  document: CanvasDocument,
  name: string,
  format: "json" | "svg" | "png",
): Promise<void> {
  let blob: Blob;
  if (format === "json")
    blob = new Blob(
      [JSON.stringify(documentToExport(document, name), null, 2)],
      { type: "application/json;charset=utf-8" },
    );
  else {
    const svg = documentToSvg(document);
    blob =
      format === "svg"
        ? new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
        : await svgToPng(svg);
  }
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 120) || "solution"}.${format}`;
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
