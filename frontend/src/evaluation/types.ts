/**
 * What the server says about a run and its report.
 *
 * These mirror the published contract and nothing else. In particular the panel
 * never recomputes a score: every number here was checked and calculated by the
 * server against the snapshot it evaluated, and a second opinion computed in the
 * browser could only ever disagree with the stored report.
 */

/** Lifecycle of one run. Only the terminal ones stop the client polling. */
export type EvaluationState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "outcome_unknown";

export const TERMINAL_STATES: readonly EvaluationState[] = [
  "succeeded",
  "failed",
  "timed_out",
  "outcome_unknown",
];

export function isTerminal(state: EvaluationState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** The four commands. A solution run covers the whole canvas; the rest are narrower. */
export type EvaluationType = "solution" | "hld" | "er" | "sequence";

export interface EvaluationSummary {
  evaluationId: string;
  solutionId: string;
  evaluationType: EvaluationType;
  sourceRevision: number;
  reportLocale: string;
  state: EvaluationState;
  createdAt: string;
  deadlineAt: string;
  finishedAt: string | null;
  resultAvailable: boolean;
  errorCode: string | null;
}

/** One rubric line of a solution report. Points are the server's, not ours. */
export interface ReportItem {
  criterionId: string;
  levelId: string | null;
  awardedPoints: number;
  maxPoints: number;
  explanation: string;
  evidenceRefs: string[];
}

export interface CoverageEntry {
  criterionId: string;
  assessment: string;
  explanation: string;
  evidenceRefs: string[];
}

export interface Finding {
  id: string;
  severity?: string;
  title?: string;
  explanation: string;
  recommendation?: string;
  objectRefs?: string[];
}

/**
 * The stored report.
 *
 * `status` of `insufficient_data` is a successful outcome with no score, not a
 * zero: the snapshot did not carry enough to judge. Score fields are null in
 * that case and for diagnostics, which carry no total at all.
 */
export interface Report {
  schemaVersion: number;
  status: "evaluated" | "insufficient_data";
  summary: string;
  evaluationType: EvaluationType;
  reportLocale: string;
  createdAt: string;
  sourceRevision: number;
  rubricVersion: string;
  acceptanceCoverage: CoverageEntry[];
  findings: Finding[];
  questions: string[];
  assumptions: string[];
  items?: ReportItem[];
  criteria?: { id: string; score: number | null; explanation: string }[];
  overallScore?: number | null;
  rawScore?: number | null;
  hldScore?: number | null;
  additionalScore?: number | null;
  referenceScore?: number | null;
  progressPercent?: number | null;
  maximumReached?: boolean;
  /** Present only when hints were taken before the run was accepted. */
  hintsUsed?: number;
  /** Points taken off progressPercent: five per hint. */
  hintPenaltyPercent?: number;
  /** progressPercent before the charge, so the report can show the sum. */
  progressBeforeHintsPercent?: number;
}

export interface EvaluationBody extends EvaluationSummary {
  result: Report | null;
  /**
   * The stored report describes semantics the canvas no longer has. Decided by
   * the server from the semantic export, so moving a block never sets it.
   */
  stale: boolean;
}

export interface StartedEvaluation {
  evaluationId: string;
  state: EvaluationState;
  deadlineAt: string;
}
