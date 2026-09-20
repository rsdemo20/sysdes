import { describe, expect, test } from "vitest";
import type { HintTaken } from "../src/solutions/api";
import { hintMessage } from "../src/solutions/HintButton";

function taken(overrides: Partial<HintTaken> = {}): HintTaken {
  return {
    kind: "hld",
    revealedCount: 3,
    hintsUsed: 1,
    penaltyPercent: 5,
    scoreExhausted: false,
    solution: {} as HintTaken["solution"],
    ...overrides,
  };
}

describe("what a hint says it did", () => {
  test("names the kind opened and the running price", () => {
    expect(hintMessage(taken(), "ru")).toBe(
      "Открыто в HLD: 3 · подсказок: 1, −5% к оценке",
    );
  });

  test("each kind has its own wording in both languages", () => {
    for (const kind of ["hld", "er", "sequence", "notes"] as const) {
      const ru = hintMessage(taken({ kind }), "ru");
      const en = hintMessage(taken({ kind }), "en");
      expect(ru).not.toBe(en);
      expect(ru.length).toBeGreaterThan(0);
    }
  });

  test("the twentieth hint also says the score is gone", () => {
    // The user must learn this when it happens, not on their next evaluation.
    const message = hintMessage(
      taken({ hintsUsed: 20, penaltyPercent: 100, scoreExhausted: true }),
      "ru",
    );
    expect(message).toContain("−100%");
    expect(message).toContain("больше не выполняется");
  });
});
