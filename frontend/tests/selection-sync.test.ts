import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SelectionSync, type Selection } from "../src/solutions/selectionSync";

function createHarness(options: { intervalMs?: number } = {}) {
  let visible = true;
  let selection: Selection = { currentSolutionId: "a", selectionRevision: 1 };
  const listeners = new Map<string, Set<() => void>>();
  const changes: Selection[] = [];
  const errors: unknown[] = [];
  let reads = 0;
  let failNext = 0;

  const sync = new SelectionSync({
    intervalMs: options.intervalMs ?? 5_000,
    isVisible: () => visible,
    addListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeListener: (type, listener) => listeners.get(type)?.delete(listener),
    read: async () => {
      reads++;
      if (failNext > 0) {
        failNext--;
        throw new Error("network");
      }
      return selection;
    },
    onChanged: (value) => changes.push(value),
    onError: (error) => errors.push(error),
  });

  return {
    sync,
    changes,
    errors,
    readCount: () => reads,
    hide: () => {
      visible = false;
    },
    show: () => {
      visible = true;
    },
    failNextRead: (times = 1) => {
      failNext = times;
    },
    moveSelection: (next: Selection) => {
      selection = next;
    },
    fire: (type: string) =>
      listeners.get(type)?.forEach((listener) => listener()),
    listenerCount: () =>
      [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}

/** Let the sync's own awaited read resolve without advancing the fake clock. */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("polling schedule", () => {
  test("reads every five seconds while the tab is visible", async () => {
    const h = createHarness();
    h.sync.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.readCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.readCount()).toBe(3);
    h.sync.stop();
  });

  test("a hidden tab does not poll and catches up when it becomes visible", async () => {
    const h = createHarness();
    h.sync.start();
    h.hide();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.readCount()).toBe(0);

    h.show();
    h.fire("visibilitychange");
    await settle();
    expect(h.readCount()).toBe(1);
    h.sync.stop();
  });

  test("regaining focus and coming back online each read immediately", async () => {
    const h = createHarness();
    h.sync.start();
    h.fire("focus");
    await settle();
    h.fire("online");
    await settle();
    expect(h.readCount()).toBe(2);
    h.sync.stop();
  });

  test("stopping removes the timer and every listener", async () => {
    const h = createHarness();
    h.sync.start();
    expect(h.listenerCount()).toBe(3);
    h.sync.stop();
    expect(h.listenerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(30_000);
    h.fire("focus");
    await settle();
    expect(h.readCount()).toBe(0);
  });

  test("restarting does not leave a second timer behind", async () => {
    const h = createHarness();
    h.sync.start();
    h.sync.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.readCount()).toBe(1);
    h.sync.stop();
  });
});

describe("what counts as a change", () => {
  test("the first read establishes a baseline instead of reporting a switch", async () => {
    const h = createHarness();
    h.sync.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.changes).toHaveLength(0);
    h.sync.stop();
  });

  test("a primed selection makes an equal first read a non-event", async () => {
    const h = createHarness();
    h.sync.prime({ currentSolutionId: "a", selectionRevision: 1 });
    h.sync.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.changes).toHaveLength(0);
    h.sync.stop();
  });

  test("a new revision from another device is reported once", async () => {
    const h = createHarness();
    h.sync.prime({ currentSolutionId: "a", selectionRevision: 1 });
    h.sync.start();
    h.moveSelection({ currentSolutionId: "b", selectionRevision: 2 });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.changes).toEqual([
      { currentSolutionId: "b", selectionRevision: 2 },
    ]);

    // Reading the same value again is not another switch.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.changes).toHaveLength(1);
    h.sync.stop();
  });

  test("clearing the selection elsewhere counts as a change", async () => {
    const h = createHarness();
    h.sync.prime({ currentSolutionId: "a", selectionRevision: 1 });
    h.sync.start();
    h.moveSelection({ currentSolutionId: null, selectionRevision: 2 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.changes).toEqual([
      { currentSolutionId: null, selectionRevision: 2 },
    ]);
    h.sync.stop();
  });
});

describe("failures", () => {
  test("a failed read is not a switch and the next tick retries", async () => {
    const h = createHarness();
    h.sync.prime({ currentSolutionId: "a", selectionRevision: 1 });
    h.sync.start();
    h.failNextRead();
    h.moveSelection({ currentSolutionId: "b", selectionRevision: 2 });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.changes).toHaveLength(0);
    expect(h.errors).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.changes).toEqual([
      { currentSolutionId: "b", selectionRevision: 2 },
    ]);
    h.sync.stop();
  });
});
