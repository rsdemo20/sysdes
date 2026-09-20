/**
 * A controllable stand-in for the evaluation API.
 *
 * Runs are advanced by the test rather than by time: `settleAs` decides what the
 * next poll sees, so the states a real job passes through can be reproduced
 * without waiting for any of them.
 */
import {
  EvaluationController,
  type EvaluationTransport,
} from "../../src/evaluation/EvaluationController";
import type {
  EvaluationBody,
  EvaluationState,
  EvaluationType,
  Report,
} from "../../src/evaluation/types";

export function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    schemaVersion: 2,
    status: "evaluated",
    summary: "Ядро есть, кэш отсутствует.",
    evaluationType: "solution",
    reportLocale: "ru",
    createdAt: "2026-09-07T12:00:00Z",
    sourceRevision: 1,
    rubricVersion: "order-payment:1",
    acceptanceCoverage: [],
    findings: [],
    questions: [],
    assumptions: [],
    items: [
      {
        criterionId: "core",
        levelId: "full",
        awardedPoints: 1200,
        maxPoints: 1200,
        explanation: "Все основные блоки на месте.",
        evidenceRefs: ["hld-orders"],
      },
    ],
    rawScore: 1200,
    hldScore: 1200,
    additionalScore: 0,
    referenceScore: 1500,
    progressPercent: 80,
    maximumReached: false,
    ...overrides,
  };
}

export function createEvaluationHarness(
  options: {
    initialReport?: Report | null;
    initialStale?: boolean;
    prepare?: () => Promise<{ revision: number; stale: boolean }>;
  } = {},
) {
  let clock = 1_000_000;
  let nextState: EvaluationState = "queued";
  let nextResult: Report | null = null;
  let nextStale = false;
  let nextErrorCode: string | null = null;
  let startRejection: unknown = null;

  const startCalls: {
    revision: number;
    evaluationType: EvaluationType;
    reportLocale: string;
  }[] = [];
  let polls = 0;

  const stored: { id: string; report: Report | null; stale: boolean } = {
    id: "stored-run",
    report: options.initialReport ?? null,
    stale: options.initialStale ?? false,
  };

  const body = (id: string): EvaluationBody => ({
    evaluationId: id,
    solutionId: "canvas-1",
    evaluationType: "solution",
    sourceRevision: 1,
    reportLocale: "ru",
    state: nextState,
    createdAt: "2026-09-07T12:00:00Z",
    deadlineAt: new Date(clock + 120_000).toISOString(),
    finishedAt: null,
    resultAvailable: nextResult !== null,
    errorCode: nextErrorCode,
    result: nextResult,
    stale: nextStale,
  });

  const transport: EvaluationTransport = {
    async startEvaluation(_solutionId, request) {
      if (startRejection) throw startRejection;
      startCalls.push({
        revision: request.revision,
        evaluationType: request.evaluationType,
        reportLocale: request.reportLocale,
      });
      return {
        evaluationId: "run-1",
        state: "queued",
        deadlineAt: new Date(clock + 120_000).toISOString(),
      };
    },
    async getEvaluation(id) {
      if (id === stored.id)
        return {
          ...body(id),
          state: "succeeded",
          result: stored.report,
          resultAvailable: stored.report !== null,
          stale: stored.stale,
        };
      polls += 1;
      return body(id);
    },
    async listEvaluations() {
      return {
        items: stored.report
          ? [{ evaluationId: stored.id, resultAvailable: true }]
          : [],
      };
    },
  };

  const controller = new EvaluationController({
    solutionId: "canvas-1",
    transport,
    prepare:
      options.prepare ?? (async () => ({ revision: 7, stale: false })),
    reportLocale: () => "ru",
    now: () => clock,
  });

  return {
    controller,
    state: () => controller.getState(),
    startCalls,
    polls: () => polls,
    advance(ms: number) {
      clock += ms;
    },
    /** What the next poll of the active run will report. */
    settleAs(
      state: EvaluationState,
      extra: { result?: Report | null; errorCode?: string | null; stale?: boolean } = {},
    ) {
      nextState = state;
      nextResult = extra.result ?? null;
      nextErrorCode = extra.errorCode ?? null;
      nextStale = extra.stale ?? false;
    },
    rejectStartWith(error: unknown) {
      startRejection = error;
    },
  };
}
