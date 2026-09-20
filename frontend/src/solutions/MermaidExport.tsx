/**
 * The Mermaid export panel.
 *
 * One entry per diagram, because one combined file is not a thing Mermaid can
 * read (D-44). Copying to the clipboard is the primary path: pasting into
 * Draw.io or Miro is what the acceptance criterion is about, and a downloaded
 * file would only be a longer route to the same paste.
 *
 * The `.mmd` files and the combined `.md` are offered as well, for keeping the
 * diagrams beside the code they describe.
 */
import { useState } from "react";
import type { CanvasDocument } from "../model/types";
import {
  documentToMermaid,
  mermaidFileName,
  mermaidToMarkdown,
  type MermaidDocument,
} from "./mermaid";

const WORDS = {
  ru: {
    legend: "Mermaid",
    empty: "На холсте пока нет диаграмм.",
    copy: "Копировать",
    copied: "Скопировано",
    file: "Файл .mmd",
    markdown: "Все диаграммы в .md",
    failed: "Не удалось скопировать. Текст показан ниже.",
    hint: "Отдельный документ на диаграмму: Mermaid не читает несколько типов в одном определении.",
  },
  en: {
    legend: "Mermaid",
    empty: "This canvas has no diagrams yet.",
    copy: "Copy",
    copied: "Copied",
    file: ".mmd file",
    markdown: "All diagrams as .md",
    failed: "Copying failed. The text is shown below.",
    hint: "One document per diagram: Mermaid cannot read several types in one definition.",
  },
};

function saveText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function MermaidExport({
  snapshot,
  canvasName,
  locale,
  onBeforeExport,
  onHint,
  disabled = false,
}: {
  snapshot: () => CanvasDocument;
  canvasName: string;
  locale: "ru" | "en";
  /** Flushes pending drafts, so the export carries what is on screen. */
  onBeforeExport: () => Promise<void>;
  /**
   * Says what the status line should show while the cursor is on the button.
   * The same sentence is the button's tooltip; the status line is there for
   * the reader who never hovers long enough for a tooltip to appear.
   */
  onHint?: (hint: string | null) => void;
  disabled?: boolean;
}) {
  const words = WORDS[locale];
  const [documents, setDocuments] = useState<MermaidDocument[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);

  const build = async () => {
    // A second click closes it: the button sits among the export formats now,
    // and a panel that only ever opens would cover them.
    if (documents !== null) {
      setDocuments(null);
      setFallback(null);
      return;
    }
    await onBeforeExport();
    setDocuments(documentToMermaid(snapshot()));
  };

  const copy = async (item: MermaidDocument) => {
    setFallback(null);
    try {
      await navigator.clipboard.writeText(item.text);
      setCopied(item.diagramId);
    } catch {
      // Clipboard access can be refused outright; showing the text is the only
      // honest fallback, and it is still selectable by hand.
      setFallback(item.text);
      setCopied(null);
    }
  };

  return (
    <div className="mermaid-export">
      <button
        type="button"
        disabled={disabled}
        aria-expanded={documents !== null}
        aria-label={`${locale === "ru" ? "Экспорт" : "Export"} MMD`}
        title={words.hint}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={() => onHint?.(words.hint)}
        onMouseLeave={() => onHint?.(null)}
        onFocus={() => onHint?.(words.hint)}
        onBlur={() => onHint?.(null)}
        onClick={() => void build()}
      >
        <span>↓</span> MMD
      </button>

      {documents !== null && (
        <div role="group" aria-label={words.legend} className="mermaid-panel">
          <p className="mermaid-hint">{words.hint}</p>
          {documents.length === 0 && <p>{words.empty}</p>}

          {documents.map((item) => (
            <div key={item.diagramId} className="mermaid-item" data-diagram={item.diagramId}>
              <strong>{item.title}</strong> <span>({item.type})</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void copy(item)}
              >
                {copied === item.diagramId ? words.copied : words.copy}
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => saveText(item.text, mermaidFileName(item))}
              >
                {words.file}
              </button>
            </div>
          ))}

          {documents.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                saveText(mermaidToMarkdown(documents, canvasName), `${canvasName}.md`)
              }
            >
              {words.markdown}
            </button>
          )}

          {fallback !== null && (
            <>
              <p role="alert">{words.failed}</p>
              <textarea readOnly value={fallback} rows={8} aria-label={words.legend} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
