/**
 * "Add to catalog".
 *
 * The button is always offered and the server decides. Hiding it until the
 * client believes the score is full would mean the browser deciding
 * eligibility, and the browser's copy of a report can be displaced, stale, or
 * simply from another tab; every refusal here names its own reason instead.
 *
 * The export tag defaults to the user's login and can be replaced with a value
 * unique across the application (D-46). A clash is reported before anything is
 * published.
 */
import { useState } from "react";
import { ApiError } from "./api";

const WORDS = {
  ru: {
    action: "Добавить в каталог",
    title: "Опубликовать решение",
    tag: "Тэг экспорта",
    tagHint: "По умолчанию — ваш логин. Значение уникально в пределах приложения.",
    reserve: "Дополнительная сложность",
    publish: "Опубликовать",
    cancel: "Отмена",
    working: "Публикуем...",
    done: "Решение опубликовано в каталоге.",
    note: "Запись доступна для чтения и фильтрации. Оцениваемым заданием она станет после того, как владелец утвердит рубрику.",
  },
  en: {
    action: "Add to catalog",
    title: "Publish this solution",
    tag: "Export tag",
    tagHint: "Defaults to your login. The value is unique across the application.",
    reserve: "Extra difficulty",
    publish: "Publish",
    cancel: "Cancel",
    working: "Publishing...",
    done: "The solution is published to the catalog.",
    note: "The entry is readable and filterable. It becomes a graded task once the owner approves a rubric.",
  },
};

/** Each refusal is a different situation, so each gets its own sentence. */
const REASONS: Record<string, string> = {
  no_report: "Сначала выполните оценку решения.",
  diagnostic_report:
    "Диагностика одной схемы не открывает публикацию — нужна оценка решения целиком.",
  maximum_not_reached:
    "Публикация доступна только при достигнутом максимуме по текущей оценке.",
  report_stale:
    "Холст изменился после оценки. Оцените его заново и повторите публикацию.",
  export_tag_taken: "Такой тэг экспорта уже занят. Выберите другой.",
  already_published: "Этот холст уже опубликован в каталоге.",
  revision_conflict: "Холст изменился с момента чтения. Обновите страницу.",
};

export function PublishToCatalog({
  locale,
  revision,
  onPublish,
}: {
  locale: "ru" | "en";
  revision: () => number;
  onPublish: (body: {
    revision: number;
    exportTag: string | null;
    allowedDisclosureLevels: number[];
    difficultyReserve: number;
  }) => Promise<void>;
}) {
  const words = WORDS[locale];
  const [open, setOpen] = useState(false);
  const [tag, setTag] = useState("");
  const [reserve, setReserve] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await onPublish({
        revision: revision(),
        // Empty means "use my tag", which the server resolves to the login.
        exportTag: tag.trim() === "" ? null : tag.trim().toLowerCase(),
        allowedDisclosureLevels: [1, 2, 3],
        difficultyReserve: reserve,
      });
      setDone(true);
      setOpen(false);
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
        className="action-button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setError(null);
          setDone(false);
          setOpen(true);
        }}
      >
        {words.action}
      </button>

      {done && <p className="publish-done">{words.done}</p>}

      {open && (
        <div className="publish-dialog" role="dialog" aria-label={words.title}>
          <p>
            <strong>{words.title}</strong>
          </p>
          <label>
            {words.tag}
            <input
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              placeholder={locale === "ru" ? "ваш логин" : "your login"}
              maxLength={40}
            />
          </label>
          <p className="publish-hint">{words.tagHint}</p>
          <label>
            {words.reserve}
            <select
              value={reserve}
              onChange={(event) => setReserve(Number(event.target.value))}
            >
              <option value={0}>0</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </label>
          <p className="publish-hint">{words.note}</p>
          {error && (
            <p role="alert" className="publish-error">
              {error}
            </p>
          )}
          <button type="button" disabled={busy} onClick={() => void publish()}>
            {busy ? words.working : words.publish}
          </button>
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>
            {words.cancel}
          </button>
        </div>
      )}
    </>
  );
}
