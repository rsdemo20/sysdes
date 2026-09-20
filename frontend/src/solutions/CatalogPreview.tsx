/**
 * Reading a catalog entry whole: the statement, and the finished schema below it.
 *
 * This is the study half of the catalog. A card hides most of the template on
 * purpose, because solving is the exercise; here the reader has said they want
 * to look at the worked example instead, and hiding it then would teach nothing.
 * So the entry arrives complete -- every diagram, every note the author left --
 * and arrives read-only: it is someone else's finished work, and the way to
 * change anything is to start a canvas of your own.
 *
 * An administrator is the exception, because somebody has to be able to correct
 * a template that is wrong. They turn on editing explicitly -- reading stays the
 * default, so a stray drag cannot rewrite a template -- and then have the two
 * actions an editor expects. Save writes the correction over the template, so
 * the catalog keeps one row for it and the corrected drawing is what anybody
 * starting the task gets. Save as makes a template of its own under a new name
 * and leaves the original alone.
 */
import { useEffect, useMemo, useState } from "react";
import { EditorStore } from "../editor/EditorStore";
import { PrototypeCanvas } from "../editor/PrototypeCanvas";
import type { CatalogReferenceBody, CatalogSummary, SysdesApi } from "./api";

interface Props {
  api: SysdesApi;
  locale: "ru" | "en";
  entry: CatalogSummary;
  /** Only an administrator is offered the editing mode. */
  role: "user" | "admin";
  onClose: () => void;
  /** A template was saved or copied, so any list of entries is now stale. */
  onSaved?: (saved: CatalogSummary) => void;
}

export function CatalogPreview({
  api,
  locale,
  entry,
  role,
  onClose,
  onSaved,
}: Props) {
  const ru = locale === "ru";
  const [reference, setReference] = useState<CatalogReferenceBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // Non-null while the editor is naming a copy: the name is what turns Save
  // into Save as, so it is asked for rather than guessed at.
  const [copyName, setCopyName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await api.readCatalogReference(
          entry.entryId,
          entry.entryVersion,
          locale,
        );
        if (!cancelled) setReference(body);
      } catch {
        if (!cancelled)
          setError(ru ? "Шаблон недоступен." : "The template is unavailable.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, entry.entryId, entry.entryVersion, locale, ru]);

  // A store of its own, thrown away with the view: the editor's own canvas must
  // not see this document, and nothing here is saved until Save is pressed.
  const store = useMemo(
    () => (reference ? new EditorStore(reference.document) : null),
    [reference],
  );

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const failed = (failure: unknown, fallback: string) =>
    setError(failure instanceof Error ? failure.message : fallback);

  const save = async () => {
    if (!store) return;
    setBusy(true);
    setError(null);
    try {
      const stored = await api.saveCatalogTemplate(
        entry.entryId,
        entry.entryVersion,
        { document: store.getSnapshot() },
      );
      setEditing(false);
      setCopyName(null);
      setSaved(ru ? "Шаблон сохранён" : "The template was saved");
      onSaved?.(stored);
    } catch (failure) {
      failed(
        failure,
        ru ? "Шаблон не сохранён." : "The template was not saved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const saveAs = async () => {
    if (!store || !copyName?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.copyCatalogTemplate(entry.entryId, {
        baseVersion: entry.entryVersion,
        title: copyName.trim(),
        document: store.getSnapshot(),
      });
      setEditing(false);
      setCopyName(null);
      setSaved(
        ru
          ? `Создан шаблон «${created.title}»`
          : `The template “${created.title}” was created`,
      );
      onSaved?.(created);
    } catch (failure) {
      failed(
        failure,
        ru ? "Шаблон не создан." : "The template was not created.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="preview"
      role="region"
      aria-label={ru ? "Просмотр шаблона" : "Template view"}
    >
      <header className="preview-bar">
        <div>
          <span className="eyebrow">
            {editing
              ? ru
                ? "Правка шаблона"
                : "Editing the template"
              : ru
                ? "Шаблон целиком"
                : "The whole template"}
          </span>
          <h2>{entry.title}</h2>
        </div>
        <span className="preview-stars">{"★".repeat(entry.stars)}</span>
        {saved && <span className="preview-saved">{saved}</span>}
        {role === "admin" && !editing && (
          <button
            type="button"
            className="preview-edit"
            onClick={() => {
              setSaved(null);
              setEditing(true);
            }}
          >
            {ru ? "Редактировать" : "Edit"}
          </button>
        )}
        {editing && (
          <>
            <button
              type="button"
              className="preview-edit"
              disabled={busy || !store}
              onClick={() => void save()}
            >
              {ru ? "Сохранить" : "Save"}
            </button>
            <button
              type="button"
              className="preview-edit"
              disabled={busy || !store}
              onClick={() =>
                setCopyName((name) =>
                  name === null
                    ? ru
                      ? `${entry.title} (копия)`
                      : `${entry.title} (copy)`
                    : null,
                )
              }
            >
              {ru ? "Сохранить как…" : "Save as…"}
            </button>
          </>
        )}
        <button type="button" onClick={onClose}>
          {ru ? "Закрыть" : "Close"}
        </button>
      </header>

      {editing && copyName !== null && (
        <div className="preview-copy">
          <label>
            {ru ? "Название нового шаблона" : "The new template’s name"}
            <input
              type="text"
              value={copyName}
              autoFocus
              maxLength={200}
              onChange={(event) => setCopyName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveAs();
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || !copyName.trim()}
            onClick={() => void saveAs()}
          >
            {ru ? "Создать шаблон" : "Create the template"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setCopyName(null)}
          >
            {ru ? "Отмена" : "Cancel"}
          </button>
          <p className="preview-hint">
            {ru
              ? "Исходный шаблон останется без изменений."
              : "The template it came from stays as it is."}
          </p>
        </div>
      )}

      {error && (
        <p className="picker-error" role="alert">
          {error}
        </p>
      )}

      {reference && store && (
        <div className="preview-body">
          <div className="preview-canvas">
            <PrototypeCanvas
              store={store}
              locale={locale}
              onSelect={() => undefined}
              readOnly={!editing}
            />
          </div>
        </div>
      )}
    </section>
  );
}

export function TextList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="statement-block">
      <span className="eyebrow">{title}</span>
      <ul>
        {items.map((text, index) => (
          <li key={`${index}:${text.slice(0, 24)}`}>{text}</li>
        ))}
      </ul>
    </div>
  );
}
