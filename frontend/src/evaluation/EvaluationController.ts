/**
 * The lifecycle of one evaluation run, kept out of React.
 *
 * A run is started from a revision the save coordinator has confirmed, then
 * polled until it reaches a terminal state or its deadline passes. Two rules
 * shape everything here.
 *
 * A failure never erases the stored report. The canvas keeps exactly one report,
 * and the server replaces it only on success, so a failed run that blanked the
 * panel would be showing something the server does not believe.
 *
 * Nothing is scored here. Every number rendered comes from the verified server
 * report; a total recomputed in the browser could only ever disagree with the
 * one that was stored.
 */
import type {
  EvaluationBody,
  EvaluationType,
  Report,
  StartedEvaluation,
} from "./types";
import { isTerminal } from "./types";

/** How often a running job is polled while the panel is open. */
export const POLL_INTERVAL_MS = 1000;

export interface EvaluationTransport {
  startEvaluation(
    solutionId: string,
    body: {
      revision: number;
      evaluationType: EvaluationType;
      reportLocale: string;
      diagramIds: string[] | null;
    },
  ): Promise<StartedEvaluation>;
  getEvaluation(id: string): Promise<EvaluationBody>;
  listEvaluations(
    solutionId: string,
    limit?: number,
  ): Promise<{ items: { evaluationId: string; resultAvailable: boolean }[] }>;
}

export interface StoredReport {
  evaluationId: string;
  report: Report;
  /** Server's verdict: the canvas has moved on from what this report judged. */
  stale: boolean;
}

export interface EvaluationRunState {
  /** A run this client started and is still watching. */
  activeType: EvaluationType | null;
  /** True from the moment a command is pressed until the run settles. */
  busy: boolean;
  current: StoredReport | null;
  /** Set by the last failed attempt; cleared when a new run starts. */
  error: { code: string; message: string } | null;
  /** True once the report has been read at least once, so "no report yet" is real. */
  loaded: boolean;
}

export const initialRunState: EvaluationRunState = {
  activeType: null,
  busy: false,
  current: null,
  error: null,
  loaded: false,
};

export interface ControllerOptions {
  solutionId: string;
  transport: EvaluationTransport;
  /** Flushes drafts and returns the revision the server has confirmed. */
  prepare: () => Promise<{ revision: number; stale: boolean }>;
  reportLocale: () => string;
  now?: () => number;
}

/** Codes the user can act on; anything else is reported as it came. */
const MESSAGES: Record<string, string> = {
  revision_conflict:
    "Холст изменился с момента чтения. Сохраните его и повторите оценку.",
  evaluation_in_progress: "Оценка этого аккаунта уже выполняется.",
  quota_exceeded: "Суточная квота запусков исчерпана.",
  budget_exceeded: "Дневной или месячный лимит расходов исчерпан.",
  queue_full: "Очередь оценки заполнена, попробуйте позже.",
  ai_not_configured: "Оценка не настроена.",
  ai_unavailable: "Провайдер временно недоступен.",
  invalid_result: "Модель вернула ответ, который не прошёл проверку.",
  deadline_exceeded: "Оценка не уложилась в отведённое время.",
  outcome_unknown:
    "Исход запроса установить не удалось. Повторный платный вызов не делается автоматически.",
  input_too_large: "Схема или набор критериев слишком велики для одного запуска.",
  invalid_reference:
    "Нечего оценивать: на холсте нет ни одной диаграммы в области этой команды.",
  not_found: "Холст или запуск не найден.",
  score_exhausted:
    "Подсказки забрали всю оценку, поэтому оценка решения не запускается. Подсказки по-прежнему доступны.",
};

export function messageFor(code: string, fallback: string): string {
  return MESSAGES[code] ?? fallback;
}

export class EvaluationController {
  private state: EvaluationRunState = initialRunState;

  private listeners = new Set<() => void>();

  private readonly now: () => number;

  private disposed = false;

  /** Guards against a second run being started while one is in flight. */
  private inFlight = false;

  constructor(private readonly options: ControllerOptions) {
    this.now = options.now ?? Date.now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): EvaluationRunState => this.state;

  private publish(patch: Partial<EvaluationRunState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  /**
   * Read the one stored report of this canvas, if there is one.
   *
   * The entry carrying `resultAvailable` is that report; every other run kept
   * its metadata but had its content displaced.
   */
  async loadCurrentReport(): Promise<void> {
    try {
      const { items } = await this.options.transport.listEvaluations(
        this.options.solutionId,
      );
      const withResult = items.find((item) => item.resultAvailable);
      if (!withResult) {
        this.publish({ current: null, loaded: true });
        return;
      }
      const body = await this.options.transport.getEvaluation(
        withResult.evaluationId,
      );
      if (this.disposed) return;
      this.publish({ current: bodyToStored(body), loaded: true });
    } catch {
      // A canvas that cannot be read is not a canvas without a report; say
      // nothing rather than claim there is none.
      if (!this.disposed) this.publish({ loaded: true });
    }
  }

  /**
   * Run one of the four commands.
   *
   * The snapshot is confirmed first, so what is judged is what the user sees.
   * A canvas that still has unsaved changes after that is refused here rather
   * than evaluated silently against an older revision.
   */
  async run(evaluationType: EvaluationType): Promise<void> {
    if (this.inFlight || this.disposed) return;
    this.inFlight = true;
    this.publish({ busy: true, activeType: evaluationType, error: null });
    try {
      const prepared = await this.options.prepare();
      if (this.disposed) return;
      if (prepared.stale) {
        this.fail(
          "unsaved_changes",
          "Не удалось сохранить холст перед оценкой; оценка не запущена.",
        );
        return;
      }
      const started = await this.options.transport.startEvaluation(
        this.options.solutionId,
        {
          revision: prepared.revision,
          evaluationType,
          reportLocale: this.options.reportLocale(),
          // Scope narrowing is the server's to decide from the command.
          diagramIds: null,
        },
      );
      if (this.disposed) return;
      await this.poll(started);
    } catch (error) {
      if (!this.disposed) this.fail(codeOf(error), String(messageOf(error)));
    } finally {
      this.inFlight = false;
      if (!this.disposed) this.publish({ busy: false, activeType: null });
    }
  }

  /**
   * Watch a run until it settles or its deadline passes.
   *
   * The deadline is the server's, so a client whose polling is throttled in a
   * background tab stops asking rather than waiting forever.
   */
  private async poll(started: StartedEvaluation): Promise<void> {
    const deadline = Date.parse(started.deadlineAt);
    for (;;) {
      const body = await this.options.transport.getEvaluation(
        started.evaluationId,
      );
      if (this.disposed) return;
      if (isTerminal(body.state)) {
        if (body.state === "succeeded" && body.result) {
          this.publish({ current: bodyToStored(body), error: null });
        } else {
          // The previous report stands: only a success replaces it.
          this.fail(
            body.errorCode ?? body.state,
            messageFor(body.errorCode ?? body.state, "Оценка не выполнена."),
          );
        }
        return;
      }
      if (Number.isFinite(deadline) && this.now() > deadline) {
        this.fail(
          "deadline_exceeded",
          messageFor("deadline_exceeded", "Оценка не уложилась во время."),
        );
        return;
      }
      await this.wait(POLL_INTERVAL_MS);
      if (this.disposed) return;
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private fail(code: string, message: string): void {
    this.publish({ error: { code, message: messageFor(code, message) } });
  }
}

function bodyToStored(body: EvaluationBody): StoredReport | null {
  if (!body.result) return null;
  return {
    evaluationId: body.evaluationId,
    report: body.result,
    stale: body.stale,
  };
}

function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "request_failed";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
