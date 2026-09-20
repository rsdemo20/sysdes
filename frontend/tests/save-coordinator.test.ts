import { describe, expect, test } from "vitest";
import { createSaveHarness } from "./support/saveHarness";
import { isBlocked } from "../src/solutions/saveState";

const MINUTE = 60_000;
/** Let the coordinator's own awaits settle without advancing the fake clock. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("acknowledgement and dirty state", () => {
  test("acknowledgment leaves newer edits dirty", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    const pending = h.coordinator.manualSave();
    await settle();
    h.editText("v2");
    h.resolvePut({ revision: 2 });
    await pending;

    expect(h.state().isDirty).toBe(true);
    expect(h.state().status).toBe("saved_with_new_changes");
    expect(h.documentText()).toBe("v2");
  });

  test("the request body is frozen while edits continue", async () => {
    const h = createSaveHarness();
    h.editText("sent");
    const pending = h.coordinator.manualSave();
    await settle();
    const inflight = h.lastPut();
    h.editText("typed later");
    expect(inflight.snapshot.document.semantic.notes[0].text).toBe("sent");
    h.resolvePut({ revision: 2 });
    await pending;
  });

  test("a clean canvas saves without sending anything", async () => {
    const h = createSaveHarness();
    await h.coordinator.manualSave();
    expect(h.pendingPuts()).toBe(0);
    expect(h.state().status).toBe("saved");
    expect(h.state().manualPending).toBe(false);
  });

  test("an edit and a confirmation move the revision forward", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    const pending = h.coordinator.manualSave();
    await settle();
    expect(h.lastPut().baseRevision).toBe(1);
    h.resolvePut({ revision: 2 });
    await pending;
    expect(h.coordinator.revision).toBe(2);
    expect(h.state().isDirty).toBe(false);
    expect(h.state().lastConfirmedAt).toBe(h.now());
  });
});

describe("one write at a time", () => {
  test("a manual command during an autosave never opens a second PUT", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    h.advance(MINUTE);
    const auto = h.coordinator.tick();
    await settle();
    expect(h.pendingPuts()).toBe(1);

    const manual = h.coordinator.manualSave();
    await settle();
    expect(h.pendingPuts()).toBe(1);
    expect(h.state().manualPending).toBe(true);

    h.resolvePut({ revision: 2 });
    await Promise.all([auto, manual]);
    expect(h.pendingPuts()).toBe(0);
    expect(h.state().isDirty).toBe(false);
  });

  test("a manual command waits for an in-flight write that predates it, then writes once", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    h.advance(MINUTE);
    const auto = h.coordinator.tick();
    await settle();

    h.editText("v2");
    const manual = h.coordinator.manualSave();
    await settle();
    expect(h.pendingPuts()).toBe(1);

    h.resolvePut({ revision: 2 });
    await auto;
    await settle();
    // The first write did not cover v2, so exactly one more goes out.
    expect(h.pendingPuts()).toBe(1);
    expect(h.lastPut().snapshot.document.semantic.notes[0].text).toBe("v2");
    h.resolvePut({ revision: 3 });
    await manual;
    expect(h.state().isDirty).toBe(false);
    expect(h.coordinator.revision).toBe(3);
  });

  test("repeated manual commands collapse into the newest target", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    const first = h.coordinator.manualSave();
    await settle();
    const second = h.coordinator.manualSave();
    const third = h.coordinator.manualSave();
    await settle();
    expect(h.pendingPuts()).toBe(1);
    h.resolvePut({ revision: 2 });
    await Promise.all([first, second, third]);
    expect(h.pendingPuts()).toBe(0);
  });
});

describe("the minute timer", () => {
  test("a tick sends nothing while the canvas is clean", async () => {
    const h = createSaveHarness();
    h.advance(MINUTE * 5);
    await h.coordinator.tick();
    expect(h.pendingPuts()).toBe(0);
  });

  test("continuous editing does not postpone autosave", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    h.advance(MINUTE / 2);
    h.editText("v2");
    h.advance(MINUTE / 2);
    h.editText("v3");
    const auto = h.coordinator.tick();
    await settle();
    expect(h.pendingPuts()).toBe(1);
    h.resolvePut({ revision: 2 });
    await auto;
  });

  test("the minute is counted from the confirmation, not from the request", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    const manual = h.coordinator.manualSave();
    await settle();
    h.advance(MINUTE);
    h.resolvePut({ revision: 2 });
    await manual;
    const confirmedAt = h.state().lastConfirmedAt;
    expect(confirmedAt).toBe(h.now());

    h.editText("v2");
    h.advance(MINUTE - 1);
    await h.coordinator.tick();
    expect(h.pendingPuts()).toBe(0);

    h.advance(1);
    const auto = h.coordinator.tick();
    await settle();
    expect(h.pendingPuts()).toBe(1);
    h.resolvePut({ revision: 3 });
    await auto;
  });

  test("failed automatic attempts stay at least a minute apart", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    h.advance(MINUTE);
    const first = h.coordinator.tick();
    await settle();
    h.failPut(500);
    await first;
    expect(h.state().status).toBe("error");

    h.advance(MINUTE - 1);
    await h.coordinator.tick();
    expect(h.pendingPuts()).toBe(0);

    h.advance(1);
    const retry = h.coordinator.tick();
    await settle();
    expect(h.pendingPuts()).toBe(1);
    h.resolvePut({ revision: 2 });
    await retry;
    expect(h.state().status).toBe("saved");
  });
});

describe("errors keep the local document", () => {
  test.each([
    [401, "auth_required"],
    [412, "conflict"],
    [422, "invalid"],
  ])(
    "a %s response blocks automatic writing as %s",
    async (status, expected) => {
      const h = createSaveHarness();
      h.editText("v1");
      const manual = h.coordinator.manualSave();
      await settle();
      h.failPut(status);
      await manual;

      expect(h.state().status).toBe(expected);
      expect(h.state().isDirty).toBe(true);
      expect(h.documentText()).toBe("v1");

      h.advance(MINUTE * 3);
      await h.coordinator.tick();
      expect(h.pendingPuts()).toBe(0);

      h.coordinator.resume();
      h.advance(MINUTE);
      const resumed = h.coordinator.tick();
      await settle();
      expect(h.pendingPuts()).toBe(1);
      h.resolvePut({ revision: 2 });
      await resumed;
    },
  );

  test("a manual command after a conflict does not paper over it with another PUT", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    const first = h.coordinator.manualSave();
    await settle();
    h.failPut(412);
    await first;

    await h.coordinator.manualSave();
    expect(h.pendingPuts()).toBe(0);
    expect(h.state().status).toBe("conflict");
  });
});

describe("an unknown outcome is settled by reading", () => {
  test("a stored snapshot is accepted as confirmation", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    const manual = h.coordinator.manualSave();
    await settle();
    h.storeThenLoseResponse(2);
    await settle();
    expect(h.state().status).toBe("unknown");

    h.settleGet();
    await manual;
    expect(h.state().status).toBe("saved");
    expect(h.coordinator.revision).toBe(2);
    expect(h.state().isDirty).toBe(false);
  });

  test("nothing is sent while the outcome is unknown", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    const manual = h.coordinator.manualSave();
    await settle();
    h.loseResponse();
    await settle();

    h.advance(MINUTE * 2);
    await h.coordinator.tick();
    expect(h.pendingPuts()).toBe(0);
    h.settleGet();
    await manual;
  });

  test("a canvas changed elsewhere is reported as a conflict, not silently overwritten", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    const manual = h.coordinator.manualSave();
    await settle();
    h.serverMovedOn(9);
    h.loseResponse();
    await settle();
    h.settleGet();
    await manual;

    expect(h.state().status).toBe("conflict");
    expect(h.pendingPuts()).toBe(0);
    expect(h.state().isDirty).toBe(true);
  });
});

describe("evaluation and disposal", () => {
  test("preparing an evaluation saves first and reports the stored revision", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    const prepared = h.coordinator.prepareEvaluation();
    await settle();
    h.resolvePut({ revision: 2 });
    expect(await prepared).toEqual({ revision: 2, stale: false });
  });

  test("editing during preparation marks the evaluation stale rather than blocking", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    const prepared = h.coordinator.prepareEvaluation();
    await settle();
    h.editText("v2");
    h.resolvePut({ revision: 2 });
    const result = await prepared;
    expect(result.stale).toBe(true);
    expect(h.documentText()).toBe("v2");
  });

  test("a late response for a closed document changes nothing", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    const manual = h.coordinator.manualSave();
    await settle();
    const before = h.state();

    h.coordinator.dispose("open-1");
    h.resolvePut({ revision: 2 });
    await manual;

    expect(h.state()).toEqual(before);
    expect(h.coordinator.revision).toBe(1);
  });

  test("disposing another opening of the document is ignored", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    h.coordinator.dispose("open-2");
    const manual = h.coordinator.manualSave();
    await settle();
    expect(h.pendingPuts()).toBe(1);
    h.resolvePut({ revision: 2 });
    await manual;
    expect(h.state().status).toBe("saved");
  });
});

describe("the indicator has its own state", () => {
  test("a manual command shows its own pending flag separately from the status", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    h.clearStates();
    const manual = h.coordinator.manualSave();
    await settle();
    expect(h.state().manualPending).toBe(true);
    expect(h.state().status).toBe("saving");

    h.resolvePut({ revision: 2 });
    await manual;
    expect(h.state().manualPending).toBe(false);
    expect(h.seenStates().some((state) => state.status === "saving")).toBe(
      true,
    );
  });

  test("an automatic write never raises the manual spinner", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    h.advance(MINUTE);
    const auto = h.coordinator.tick();
    await settle();
    expect(h.state().status).toBe("saving");
    expect(h.state().manualPending).toBe(false);
    h.resolvePut({ revision: 2 });
    await auto;
  });
});

describe("pausing automatic writes", () => {
  test("a paused coordinator skips ticks but still honours a manual save", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    h.coordinator.setAutomaticPaused(true);
    h.advance(MINUTE);
    await h.coordinator.tick();
    expect(h.pendingPuts()).toBe(0);
    expect(h.state().isDirty).toBe(true);

    const manual = h.coordinator.manualSave();
    await settle();
    expect(h.pendingPuts()).toBe(1);
    h.resolvePut({ revision: 2 });
    await manual;
    expect(h.state().isDirty).toBe(false);
  });

  test("unpausing lets the timer work again", async () => {
    const h = createSaveHarness();
    h.editText("v1");
    h.coordinator.setAutomaticPaused(true);
    h.advance(MINUTE);
    await h.coordinator.tick();
    expect(h.pendingPuts()).toBe(0);

    h.coordinator.setAutomaticPaused(false);
    const auto = h.coordinator.tick();
    await settle();
    expect(h.pendingPuts()).toBe(1);
    h.resolvePut({ revision: 2 });
    await auto;
  });
});

describe("a dependency being down is retryable, not blocking", () => {
  test("503 leaves the canvas dirty and automatic saving alive", async () => {
    // The server answers 503 when it cannot reach PostgreSQL. That is not the
    // user's problem to resolve, unlike 401, 412 or 422, so it must not stop
    // automatic saving the way those do -- the write should simply be retried.
    const h = createSaveHarness();
    h.editText("written while the database was down");
    const pending = h.coordinator.manualSave();
    await settle();
    h.failPut(503);
    await pending;

    expect(h.state().status).toBe("error");
    expect(h.state().isDirty).toBe(true);
    expect(isBlocked(h.state().status)).toBe(false);
  });
});
