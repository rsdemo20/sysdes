import { describe, expect, test } from "vitest";
import { messageFor } from "../src/evaluation/EvaluationController";
import {
  createEvaluationHarness,
  makeReport,
} from "./support/evaluationHarness";

describe("starting a run", () => {
  test("evaluates the revision the coordinator confirmed", async () => {
    const h = createEvaluationHarness();
    h.settleAs("succeeded", { result: makeReport() });
    await h.controller.run("solution");

    expect(h.startCalls).toEqual([
      { revision: 7, evaluationType: "solution", reportLocale: "ru" },
    ]);
    expect(h.state().current?.report.progressPercent).toBe(80);
  });

  test("a canvas that would not save is not evaluated at all", async () => {
    // Evaluating anyway would report on a revision the user is not looking at.
    const h = createEvaluationHarness({
      prepare: async () => ({ revision: 7, stale: true }),
    });
    await h.controller.run("solution");

    expect(h.startCalls).toHaveLength(0);
    expect(h.state().error?.code).toBe("unsaved_changes");
  });

  test("a second command is refused while one is in flight", async () => {
    const h = createEvaluationHarness();
    h.settleAs("succeeded", { result: makeReport() });
    const first = h.controller.run("solution");
    const second = h.controller.run("hld");
    await Promise.all([first, second]);

    expect(h.startCalls).toHaveLength(1);
  });

  test("the run is over before busy is cleared", async () => {
    const h = createEvaluationHarness();
    h.settleAs("succeeded", { result: makeReport() });
    const pending = h.controller.run("solution");
    expect(h.state().busy).toBe(true);
    expect(h.state().activeType).toBe("solution");
    await pending;
    expect(h.state().busy).toBe(false);
  });
});

describe("a failure never erases the report", () => {
  test("a refused run keeps the previous report and explains itself", async () => {
    const h = createEvaluationHarness({ initialReport: makeReport() });
    await h.controller.loadCurrentReport();
    expect(h.state().current?.report.rawScore).toBe(1200);

    h.settleAs("failed", { errorCode: "invalid_result" });
    await h.controller.run("hld");

    expect(h.state().current?.report.rawScore).toBe(1200);
    expect(h.state().error?.code).toBe("invalid_result");
  });

  test("a rejected start keeps the previous report", async () => {
    const h = createEvaluationHarness({ initialReport: makeReport() });
    await h.controller.loadCurrentReport();
    h.rejectStartWith(
      Object.assign(new Error("conflict"), { code: "revision_conflict" }),
    );
    await h.controller.run("solution");

    expect(h.state().current).not.toBeNull();
    expect(h.state().error?.code).toBe("revision_conflict");
  });

  test("a successful insufficient_data replaces the report with no score", async () => {
    // Not a zero: the snapshot did not carry enough to judge.
    const h = createEvaluationHarness({ initialReport: makeReport() });
    await h.controller.loadCurrentReport();
    h.settleAs("succeeded", {
      result: makeReport({
        status: "insufficient_data",
        rawScore: null,
        progressPercent: null,
        items: [],
      }),
    });
    await h.controller.run("solution");

    expect(h.state().current?.report.status).toBe("insufficient_data");
    expect(h.state().current?.report.rawScore).toBeNull();
    expect(h.state().error).toBeNull();
  });
});

describe("watching a run", () => {
  test("polling continues until the run reaches a terminal state", async () => {
    const h = createEvaluationHarness();
    h.settleAs("queued");
    const pending = h.controller.run("solution");
    await new Promise((resolve) => setTimeout(resolve, 5));
    h.settleAs("succeeded", { result: makeReport() });
    await pending;

    expect(h.polls()).toBeGreaterThan(1);
    expect(h.state().current).not.toBeNull();
  });

  test("watching stops once the server deadline has passed", async () => {
    const h = createEvaluationHarness();
    h.settleAs("running");
    const pending = h.controller.run("solution");
    await new Promise((resolve) => setTimeout(resolve, 5));
    h.advance(200_000);
    await pending;

    expect(h.state().error?.code).toBe("deadline_exceeded");
  });

  test("an unknown outcome says the money may already be spent", async () => {
    const h = createEvaluationHarness();
    h.settleAs("outcome_unknown", { errorCode: "outcome_unknown" });
    await h.controller.run("solution");

    expect(h.state().error?.message).toContain("Повторный платный вызов");
  });
});

describe("the stored report", () => {
  test("the entry carrying the result is the one report of the canvas", async () => {
    const h = createEvaluationHarness({ initialReport: makeReport() });
    await h.controller.loadCurrentReport();

    expect(h.state().loaded).toBe(true);
    expect(h.state().current?.evaluationId).toBe("stored-run");
  });

  test("a canvas with no report loads as empty rather than unknown", async () => {
    const h = createEvaluationHarness({ initialReport: null });
    await h.controller.loadCurrentReport();

    expect(h.state().loaded).toBe(true);
    expect(h.state().current).toBeNull();
  });

  test("staleness is taken from the server, not decided here", async () => {
    const h = createEvaluationHarness({
      initialReport: makeReport(),
      initialStale: true,
    });
    await h.controller.loadCurrentReport();

    expect(h.state().current?.stale).toBe(true);
  });
});

describe("error wording", () => {
  test("known codes are explained, unknown ones are passed through", () => {
    expect(messageFor("budget_exceeded", "x")).toContain("лимит");
    expect(messageFor("something_new", "как есть")).toBe("как есть");
  });
});
