/**
 * The four evaluation commands.
 *
 * Pressing one confirms the canvas first, so the report describes the version on
 * screen. All four are disabled together while a run is in flight: the account
 * may hold only one queued or running job, and offering a second command would
 * be offering a refusal.
 *
 * The notice about sending the canvas to an external provider is shown before
 * the first run and has to be accepted once. It states what leaves the browser
 * and does not promise that anything is stripped or anonymised on the way.
 */
import { useState, useSyncExternalStore } from "react";
import type { EvaluationController } from "./EvaluationController";
import type { EvaluationType } from "./types";

const NOTICE_KEY = "sysdes.evaluation.notice-accepted";

const COMMANDS: { type: EvaluationType; ru: string; en: string }[] = [
  { type: "solution", ru: "Оценить решение", en: "Evaluate solution" },
  { type: "hld", ru: "Оценить HLD", en: "Evaluate HLD" },
  { type: "er", ru: "Оценить ER", en: "Evaluate ER" },
  { type: "sequence", ru: "Оценить Sequence", en: "Evaluate Sequence" },
];

const WORDS = {
  ru: {
    legend: "Оценка",
    running: "Выполняется...",
    noticeTitle: "Данные уходят внешнему провайдеру",
    noticeBody:
      "Схемы, требования, критерии приёмки и свободный текст холста передаются модели через OpenRouter. Используйте учебные или обезличенные данные: секреты и персональные данные не удаляются автоматически и обезличивание не проверяется.",
    accept: "Понятно, продолжить",
    cancel: "Отмена",
  },
  en: {
    legend: "Evaluation",
    running: "Running...",
    noticeTitle: "Data leaves for an external provider",
    noticeBody:
      "Diagrams, requirements, acceptance criteria and free text from the canvas are sent to a model through OpenRouter. Use training or anonymised data: secrets and personal data are not stripped automatically and anonymisation is not verified.",
    accept: "Understood, continue",
    cancel: "Cancel",
  },
};

function noticeAlreadyAccepted(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    // Storage can be unavailable; then the notice is simply shown again.
    return false;
  }
}

export function EvaluationActions({
  controller,
  locale,
  disabled = false,
}: {
  controller: EvaluationController;
  locale: "ru" | "en";
  disabled?: boolean;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
  );
  const words = WORDS[locale];
  const [pendingCommand, setPendingCommand] = useState<EvaluationType | null>(
    null,
  );

  const launch = (type: EvaluationType) => {
    if (noticeAlreadyAccepted()) {
      void controller.run(type);
      return;
    }
    setPendingCommand(type);
  };

  const accept = () => {
    try {
      localStorage.setItem(NOTICE_KEY, "1");
    } catch {
      // Not being able to remember it only costs another confirmation.
    }
    const type = pendingCommand;
    setPendingCommand(null);
    if (type) void controller.run(type);
  };

  return (
    <fieldset className="evaluation-actions" aria-label={words.legend}>
      <legend>{words.legend}</legend>
      {COMMANDS.map((command) => (
        <button
          key={command.type}
          type="button"
          disabled={disabled || state.busy}
          data-command={command.type}
          // Keep the caret where the user left it, as the save button does: the
          // snapshot is flushed without a blur, and a run is long enough that
          // coming back to a field that lost its place would be its own problem.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => launch(command.type)}
        >
          {state.busy && state.activeType === command.type
            ? words.running
            : locale === "ru"
              ? command.ru
              : command.en}
        </button>
      ))}

      {pendingCommand !== null && (
        <div className="evaluation-notice" role="dialog" aria-label={words.noticeTitle}>
          <p>
            <strong>{words.noticeTitle}</strong>
          </p>
          <p>{words.noticeBody}</p>
          <button type="button" onClick={accept} data-notice="accept">
            {words.accept}
          </button>
          <button
            type="button"
            onClick={() => setPendingCommand(null)}
            data-notice="cancel"
          >
            {words.cancel}
          </button>
        </div>
      )}
    </fieldset>
  );
}
