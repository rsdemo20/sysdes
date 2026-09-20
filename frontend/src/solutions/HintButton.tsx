/**
 * The hint button in the header, after the canvas name.
 *
 * One press opens the next part of the template the canvas started from. The
 * price is on the button before it is pressed, not discovered afterwards: five
 * points of the score each, and the running total shows beside the lightbulb.
 *
 * The canvas is saved first, because the hint is merged into the document on the
 * server against the revision the user is looking at. A canvas that would not
 * save is not hinted: the hint would land on an older version and the unsaved
 * work would then have to be reconciled with it.
 *
 * There is no confirmation dialog. The score is a bearing for the learner rather
 * than a verdict, and a prompt before every press would make the one tool meant
 * to help feel like a trap.
 */
import { useState } from "react";
import { ApiError, type HintKind, type HintTaken } from "./api";

const HINT_PENALTY_PERCENT = 5;

const OPENED: Record<"ru" | "en", Record<HintKind, (count: number) => string>> = {
  ru: {
    hld: (n) => `Открыто в HLD: ${n}`,
    er: (n) => `Открыта часть схемы ER: ${n}`,
    sequence: (n) => `Открыта часть Sequence: ${n}`,
    notes: (n) => `Открыто текстовых блоков: ${n}`,
  },
  en: {
    hld: (n) => `Opened in HLD: ${n}`,
    er: (n) => `Opened part of the ER diagram: ${n}`,
    sequence: (n) => `Opened part of the sequence: ${n}`,
    notes: (n) => `Opened text blocks: ${n}`,
  },
};

const WORDS = {
  ru: {
    label: "Подсказка",
    title: (used: number) =>
      used === 0
        ? `Подсказка: откроет часть шаблона, −${HINT_PENALTY_PERCENT}% к оценке`
        : `Подсказка: откроет часть шаблона, −${HINT_PENALTY_PERCENT}% к оценке. ` +
          `Уже взято: ${used} (−${used * HINT_PENALTY_PERCENT}%)`,
    exhausted: "Шаблон открыт целиком — подсказок больше нет.",
    unsaved: "Не удалось сохранить холст, подсказка не взята.",
    conflict: "Холст изменился в другой вкладке. Обновите страницу.",
    zero: "Подсказки забрали всю оценку: запуск оценки решения больше не выполняется.",
  },
  en: {
    label: "Hint",
    title: (used: number) =>
      used === 0
        ? `Hint: opens part of the template, −${HINT_PENALTY_PERCENT}% to the score`
        : `Hint: opens part of the template, −${HINT_PENALTY_PERCENT}% to the score. ` +
          `Taken so far: ${used} (−${used * HINT_PENALTY_PERCENT}%)`,
    exhausted: "The whole template is open — no hints left.",
    unsaved: "The canvas could not be saved, so no hint was taken.",
    conflict: "The canvas changed in another tab. Reload the page.",
    zero: "Hints have taken the whole score: solution evaluation is no longer run.",
  },
};

export function hintMessage(result: HintTaken, locale: "ru" | "en"): string {
  const opened = OPENED[locale][result.kind](result.revealedCount);
  const price =
    locale === "ru"
      ? ` · подсказок: ${result.hintsUsed}, −${result.penaltyPercent}% к оценке`
      : ` · hints: ${result.hintsUsed}, −${result.penaltyPercent}% to the score`;
  return opened + price + (result.scoreExhausted ? ` · ${WORDS[locale].zero}` : "");
}

export function HintButton({
  locale,
  hintsUsed,
  prepare,
  take,
  onTaken,
}: {
  locale: "ru" | "en";
  hintsUsed: number;
  /** Saves the canvas and returns the revision the server now holds. */
  prepare: () => Promise<{ revision: number; stale: boolean }>;
  take: (revision: number) => Promise<HintTaken>;
  /** Hands the updated canvas to whoever owns it; the editor reloads from it. */
  onTaken: (result: HintTaken, message: string) => void;
}) {
  const words = WORDS[locale];
  const [busy, setBusy] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const press = async () => {
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepare();
      if (prepared.stale) {
        setError(words.unsaved);
        return;
      }
      const result = await take(prepared.revision);
      onTaken(result, hintMessage(result, locale));
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : "";
      if (code === "hints_exhausted") {
        setExhausted(true);
        setError(words.exhausted);
      } else if (code === "revision_conflict") {
        setError(words.conflict);
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="hint-control">
      <button
        type="button"
        className="hint-button"
        disabled={busy || exhausted}
        // Keeps the caret in a field being typed in, as the save button does:
        // the snapshot is flushed without a blur.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void press()}
        aria-label={words.label}
        title={exhausted ? words.exhausted : words.title(hintsUsed)}
        data-hints-used={hintsUsed}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {hintsUsed > 0 && (
          <span className="hint-count" aria-hidden="true">
            −{hintsUsed * HINT_PENALTY_PERCENT}%
          </span>
        )}
      </button>
      {error && (
        <span className="hint-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
