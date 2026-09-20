import { describe, expect, it } from "vitest";
import {
  BLOCK_BORDERS,
  DEFAULTS,
  EDGE_WEIGHTS,
  borderProperties,
  createPreferenceStore,
  edgeWeightById,
  readStored,
} from "../src/settings/preferences";

/** A localStorage that answers, so the store can be exercised without a browser. */
function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

/** A storage that refuses everything: a private window, or blocked site data. */
function refusingStorage(): Storage {
  const refuse = () => {
    throw new Error("site data is blocked");
  };
  return {
    length: 0,
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  } as unknown as Storage;
}

describe("stored preferences are data, not a Preferences object", () => {
  it("falls back to the defaults when nothing was stored", () => {
    expect(readStored(null)).toEqual(DEFAULTS);
  });

  it("survives a blob that is not JSON at all", () => {
    expect(readStored("{not json")).toEqual(DEFAULTS);
  });

  it("drops a value this version no longer knows", () => {
    const stored = readStored(
      JSON.stringify({
        locale: "de",
        blockBorder: "neon",
        edgeWeight: "heavy",
      }),
    );
    // An unknown language is not a language; the weight it does know is kept.
    expect(stored.locale).toBe("ru");
    expect(stored.blockBorder).toBe(DEFAULTS.blockBorder);
    expect(stored.edgeWeight).toBe("heavy");
  });
});

describe("a choice is remembered", () => {
  it("writes the whole set, so a later read restores it", () => {
    const storage = memoryStorage();
    const store = createPreferenceStore(storage);
    store.update({ locale: "en" });
    store.update({ blockBorder: "bold" });

    const reopened = createPreferenceStore(storage);
    expect(reopened.getSnapshot()).toEqual({
      ...DEFAULTS,
      locale: "en",
      blockBorder: "bold",
    });
  });

  it("tells its subscribers only when something actually changed", () => {
    const store = createPreferenceStore(memoryStorage());
    let calls = 0;
    store.subscribe(() => {
      calls++;
    });
    store.update({ edgeWeight: "heavy" });
    store.update({ edgeWeight: "heavy" });
    expect(calls).toBe(1);
  });

  it("still applies a choice when storage refuses to keep it", () => {
    const store = createPreferenceStore(refusingStorage());
    store.update({ edgeWeight: "thin" });
    expect(store.getSnapshot().edgeWeight).toBe("thin");
  });
});

describe("what the canvas is given", () => {
  it("offers between two and five options of each kind", () => {
    for (const options of [BLOCK_BORDERS, EDGE_WEIGHTS]) {
      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(options.length).toBeLessThanOrEqual(5);
    }
  });

  it("raises weight and darkens colour together, step by step", () => {
    // A thicker line in the same pale colour is still pale, which was the
    // complaint the setting exists to answer.
    const widths = BLOCK_BORDERS.map((option) => parseFloat(option.width));
    expect([...widths].sort((a, b) => a - b)).toEqual(widths);
    const weights = EDGE_WEIGHTS.map((option) => option.width);
    expect([...weights].sort((a, b) => a - b)).toEqual(weights);
    const lightness = BLOCK_BORDERS.map((option) =>
      parseInt(option.hld.slice(1), 16),
    );
    expect([...lightness].sort((a, b) => b - a)).toEqual(lightness);
  });

  it("names one custom property per kind of card", () => {
    expect(borderProperties("bold")).toEqual({
      "--card-border-width": "2.5px",
      "--card-border-hld": "#4a6d9b",
      "--card-border-er": "#7355a3",
      "--card-border-sequence": "#3f8570",
    });
  });

  it("answers with a usable weight for an id it does not know", () => {
    expect(edgeWeightById("nonsense" as never).width).toBeGreaterThan(0);
  });
});
