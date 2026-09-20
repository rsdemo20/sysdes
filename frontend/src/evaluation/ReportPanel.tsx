/**
 * The one stored report of a canvas.
 *
 * Every number shown is the server's. The panel does not add, average or cap
 * anything: a total computed here could only disagree with the report that was
 * actually stored, and the user would have no way to tell which is real.
 *
 * Nulls are shown as unknown rather than as zero. `insufficient_data` is a
 * successful outcome meaning the snapshot did not carry enough to judge, and
 * printing it as 0% would turn "cannot tell" into "bad".
 *
 * Model text is rendered as text. Nothing here interprets it as markup, and no
 * link in it is followed, because the canvas it came from is user input that
 * travelled through a model.
 */
import { useSyncExternalStore } from "react";
import type { EvaluationController, StoredReport } from "./EvaluationController";
import type { Report } from "./types";

const WORDS = {
  ru: {
    region: "AI-отчёт",
    empty: "Оценок ещё не было.",
    loading: "Загружаем отчёт...",
    stale: "Холст изменился после этой оценки — отчёт устарел",
    insufficient: "Недостаточно данных для оценки",
    score: "Балл",
    of: "из",
    progress: "Прогресс",
    hld: "HLD",
    additional: "Дополнительно",
    maximum: "Максимум достигнут",
    hints: (used: number, penalty: number, before?: number) =>
      `подсказок: ${used}, −${penalty}%` +
      (before !== undefined ? ` (без подсказок было бы ${before}%)` : ""),
    items: "Пункты рубрики",
    coverage: "Критерии приёмки",
    findings: "Замечания",
    questions: "Вопросы",
    assumptions: "Допущения",
    about: "О запуске",
    unknown: "не определено",
    notScored: "без балла",
  },
  en: {
    region: "AI report",
    empty: "No evaluation yet.",
    loading: "Loading the report...",
    stale: "The canvas changed after this evaluation — the report is out of date",
    insufficient: "Not enough data to evaluate",
    score: "Score",
    of: "of",
    progress: "Progress",
    hld: "HLD",
    additional: "Additional",
    maximum: "Maximum reached",
    hints: (used: number, penalty: number, before?: number) =>
      `hints: ${used}, −${penalty}%` +
      (before !== undefined ? ` (${before}% without them)` : ""),
    items: "Rubric items",
    coverage: "Acceptance criteria",
    findings: "Findings",
    questions: "Questions",
    assumptions: "Assumptions",
    about: "About the run",
    unknown: "unknown",
    notScored: "not scored",
  },
};

type Words = (typeof WORDS)["ru"];

/** A number the server did not produce is unknown, never zero. */
function show(value: number | null | undefined, words: Words): string {
  return value === null || value === undefined ? words.unknown : String(value);
}

function Totals({ report, words }: { report: Report; words: Words }) {
  if (report.status === "insufficient_data")
    return (
      <p className="report-total" data-status="insufficient_data">
        {words.insufficient}
      </p>
    );
  // A diagnostic carries no total at all; only a solution run is scored.
  if (report.rawScore === undefined || report.rawScore === null)
    return (
      <p className="report-total" data-status="unscored">
        {report.overallScore !== undefined && report.overallScore !== null
          ? `${words.score}: ${report.overallScore} / 5`
          : words.notScored}
      </p>
    );
  return (
    <p className="report-total" data-status="evaluated">
      <strong>
        {words.score}: {report.rawScore} {words.of}{" "}
        {show(report.referenceScore, words)}
      </strong>
      {" · "}
      {words.progress}: {show(report.progressPercent, words)}%{" · "}
      {words.hld}: {show(report.hldScore, words)}
      {" · "}
      {words.additional}: {show(report.additionalScore, words)}
      {report.maximumReached ? ` · ${words.maximum}` : ""}
      {report.hintsUsed ? (
        // The server's arithmetic, shown as it was done: nothing recomputed here.
        <span className="report-hints" data-hints={report.hintsUsed}>
          {" · "}
          {words.hints(
            report.hintsUsed,
            report.hintPenaltyPercent ?? 0,
            report.progressBeforeHintsPercent,
          )}
        </span>
      ) : null}
    </p>
  );
}

export function ReportPanel({
  controller,
  locale,
}: {
  controller: EvaluationController;
  locale: "ru" | "en";
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
  );
  const words = WORDS[locale];
  const stored: StoredReport | null = state.current;

  return (
    <section className="report-panel" role="region" aria-label={words.region}>
      {state.error && (
        <p className="report-error" role="alert" data-code={state.error.code}>
          {state.error.message}
        </p>
      )}

      {!state.loaded && !stored && <p>{words.loading}</p>}
      {state.loaded && !stored && <p className="report-empty">{words.empty}</p>}

      {stored && (
        <article data-evaluation-id={stored.evaluationId} data-stale={stored.stale}>
          {stored.stale && (
            // Marked, never hidden: an out-of-date report is still the report.
            <p className="report-stale" role="note">
              {words.stale}
            </p>
          )}
          <Totals report={stored.report} words={words} />
          <p className="report-summary">{stored.report.summary}</p>

          {stored.report.items && stored.report.items.length > 0 && (
            <>
              <h4>{words.items}</h4>
              <ul className="report-items">
                {stored.report.items.map((item) => (
                  <li key={item.criterionId} data-criterion={item.criterionId}>
                    <strong>{item.criterionId}</strong>
                    {" — "}
                    {item.levelId ?? words.unknown} ({item.awardedPoints}/
                    {item.maxPoints}): {item.explanation}
                  </li>
                ))}
              </ul>
            </>
          )}

          {stored.report.criteria && stored.report.criteria.length > 0 && (
            <>
              <h4>{words.items}</h4>
              <ul className="report-items">
                {stored.report.criteria.map((entry) => (
                  <li key={entry.id} data-criterion={entry.id}>
                    <strong>{entry.id}</strong>
                    {" — "}
                    {show(entry.score, words)}: {entry.explanation}
                  </li>
                ))}
              </ul>
            </>
          )}

          {stored.report.acceptanceCoverage.length > 0 && (
            <>
              <h4>{words.coverage}</h4>
              <ul className="report-coverage">
                {stored.report.acceptanceCoverage.map((entry) => (
                  <li key={entry.criterionId} data-criterion={entry.criterionId}>
                    <strong>{entry.criterionId}</strong> — {entry.assessment}:{" "}
                    {entry.explanation}
                  </li>
                ))}
              </ul>
            </>
          )}

          {stored.report.findings.length > 0 && (
            <>
              <h4>{words.findings}</h4>
              <ul className="report-findings">
                {stored.report.findings.map((finding) => (
                  <li key={finding.id} data-severity={finding.severity}>
                    {finding.severity ? `[${finding.severity}] ` : ""}
                    {finding.title ? `${finding.title}: ` : ""}
                    {finding.explanation}
                    {finding.recommendation ? ` → ${finding.recommendation}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}

          {stored.report.questions.length > 0 && (
            <>
              <h4>{words.questions}</h4>
              <ul className="report-questions">
                {stored.report.questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </>
          )}

          {stored.report.assumptions.length > 0 && (
            <>
              <h4>{words.assumptions}</h4>
              <ul className="report-assumptions">
                {stored.report.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </>
          )}

          <p className="report-about">
            {words.about}: {stored.report.evaluationType} ·{" "}
            {stored.report.reportLocale} · {stored.report.rubricVersion} ·{" "}
            {stored.report.createdAt}
          </p>
        </article>
      )}
    </section>
  );
}
