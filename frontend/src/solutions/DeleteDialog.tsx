/**
 * Deleting a canvas, which cannot be undone.
 *
 * The confirmation names the canvas rather than asking "are you sure": a dialog
 * that could be dismissed by reflex is not a confirmation of anything, and the
 * user may well have several canvases open in different tabs.
 *
 * Deletion goes through the same revision the editor holds. A canvas edited
 * elsewhere since it was read comes back as a conflict rather than being
 * deleted, and a run still in flight is refused by the server, because it holds
 * money and is about to write a report against this canvas.
 */
import { useState } from "react";
import { ApiError } from "./api";

const WORDS = {
  ru: {
    action: "Удалить холст",
    title: "Удалить безвозвратно?",
    body: (name: string) =>
      `Холст «${name}», его отчёт и снимки оценок будут удалены без возможности восстановления. Скачайте JSON, если хотите оставить копию.`,
    confirm: "Удалить",
    cancel: "Отмена",
    working: "Удаляем...",
  },
  en: {
    action: "Delete canvas",
    title: "Delete permanently?",
    body: (name: string) =>
      `The canvas "${name}", its report and evaluation snapshots will be removed with no way back. Download the JSON first if you want a copy.`,
    confirm: "Delete",
    cancel: "Cancel",
    working: "Deleting...",
  },
};

const REASONS: Record<string, string> = {
  evaluation_in_progress:
    "Оценка этого холста ещё выполняется. Дождитесь её окончания.",
  revision_conflict:
    "Холст изменился с момента чтения. Обновите страницу и повторите.",
  not_found: "Холст уже удалён.",
};

export function DeleteDialog({
  canvasName,
  locale,
  onDelete,
  onDeleted,
}: {
  canvasName: string;
  locale: "ru" | "en";
  onDelete: () => Promise<void>;
  onDeleted: () => void;
}) {
  const words = WORDS[locale];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      setOpen(false);
      onDeleted();
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : "";
      setError(REASONS[code] ?? String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="action-button danger"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {words.action}
      </button>

      {open && (
        <div className="delete-dialog" role="dialog" aria-label={words.title}>
          <p>
            <strong>{words.title}</strong>
          </p>
          <p>{words.body(canvasName)}</p>
          {error && (
            <p role="alert" className="delete-error">
              {error}
            </p>
          )}
          <button type="button" className="danger" disabled={busy} onClick={() => void confirm()}>
            {busy ? words.working : words.confirm}
          </button>
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>
            {words.cancel}
          </button>
        </div>
      )}
    </>
  );
}
