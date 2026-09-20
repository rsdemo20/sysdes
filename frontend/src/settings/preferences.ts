/**
 * What the reader has chosen about their own copy of the editor.
 *
 * These are preferences, not documents. Nothing here belongs to a canvas: two
 * people opening the same design should be able to read it with the line weight
 * that suits their screen without changing what the other one sees, and the
 * server has no opinion about it. So they live in this browser, and they are
 * remembered across reloads -- a language picked once should not have to be
 * picked again on every visit, which was the whole complaint.
 *
 * Storage can fail or be switched off (a private window, blocked site data),
 * and that is not an error worth reporting: every read and write is guarded and
 * the defaults simply stand. What must not fail is rendering, so a stored value
 * the code no longer knows is dropped rather than trusted.
 *
 * The appearance choices are applied in two ways because two mechanisms draw
 * the picture. Blocks are HTML, so their weight and colour arrive as custom
 * properties on the root element and every stylesheet rule reads them from
 * there -- that reaches the canvas inside the template view as well, which is
 * not inside the application shell. Connections are SVG drawn by React Flow
 * with inline attributes, so the edge component reads the value itself.
 */

export type Locale = "ru" | "en";
export type BlockBorderId = "hairline" | "soft" | "firm" | "bold";
export type EdgeWeightId = "thin" | "regular" | "strong" | "heavy";

export interface Preferences {
  locale: Locale;
  blockBorder: BlockBorderId;
  edgeWeight: EdgeWeightId;
}

export const DEFAULTS: Preferences = {
  locale: "ru",
  blockBorder: "soft",
  edgeWeight: "regular",
};

interface Named {
  names: { ru: string; en: string };
}

/**
 * How heavily a block is outlined.
 *
 * `hairline` is what the editor drew before any of this existed, and it is kept
 * because it is the quietest the canvas can be -- but it is not the default any
 * more: on a full schema those blocks read as barely there, which is what the
 * complaint was. Each step raises the weight and darkens the outline together;
 * a thicker line in the same pale colour is still pale.
 */
export interface BlockBorder extends Named {
  id: BlockBorderId;
  width: string;
  /** One colour per kind of card, so a diagram keeps telling them apart. */
  hld: string;
  er: string;
  sequence: string;
}

export const BLOCK_BORDERS: BlockBorder[] = [
  {
    id: "hairline",
    names: { ru: "Тонкие, светлые", en: "Hairline, pale" },
    width: "1px",
    hld: "#cddcf1",
    er: "#ddcfed",
    sequence: "#c6e1d8",
  },
  {
    id: "soft",
    names: { ru: "Обычные", en: "Regular" },
    width: "1.5px",
    hld: "#a9c0e0",
    er: "#c4addf",
    sequence: "#9fcdbd",
  },
  {
    id: "firm",
    names: { ru: "Контрастные", en: "Contrasting" },
    width: "2px",
    hld: "#7b9bc6",
    er: "#a184c9",
    sequence: "#6faf99",
  },
  {
    id: "bold",
    names: { ru: "Жирные, тёмные", en: "Bold, dark" },
    width: "2.5px",
    hld: "#4a6d9b",
    er: "#7355a3",
    sequence: "#3f8570",
  },
];

/** How heavily a connection is drawn, and how far it stands off the page. */
export interface EdgeWeight extends Named {
  id: EdgeWeightId;
  width: number;
  colour: string;
  /** The sequence lane keeps its own colour; only its weight follows. */
  sequenceColour: string;
}

export const EDGE_WEIGHTS: EdgeWeight[] = [
  {
    id: "thin",
    names: { ru: "Тонкие", en: "Thin" },
    width: 1.2,
    colour: "#a4b2c6",
    sequenceColour: "#8494ad",
  },
  {
    id: "regular",
    names: { ru: "Обычные", en: "Regular" },
    width: 1.6,
    colour: "#8b9bb3",
    sequenceColour: "#667895",
  },
  {
    id: "strong",
    names: { ru: "Контрастные", en: "Contrasting" },
    width: 2.2,
    colour: "#6a7c98",
    sequenceColour: "#4d5f7e",
  },
  {
    id: "heavy",
    names: { ru: "Жирные", en: "Heavy" },
    width: 3,
    colour: "#4a5a76",
    sequenceColour: "#374765",
  },
];

const STORAGE_KEY = "sysdes.preferences";

function known<T extends { id: string }>(
  options: T[],
  value: unknown,
  fallback: T["id"],
): T["id"] {
  return typeof value === "string" && options.some((o) => o.id === value)
    ? (value as T["id"])
    : fallback;
}

/** A stored blob is data, not a Preferences object: every field is checked. */
export function readStored(raw: string | null): Preferences {
  if (!raw) return { ...DEFAULTS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULTS };
  }
  const value = (parsed ?? {}) as Record<string, unknown>;
  return {
    locale: value.locale === "en" ? "en" : "ru",
    blockBorder: known(BLOCK_BORDERS, value.blockBorder, DEFAULTS.blockBorder),
    edgeWeight: known(EDGE_WEIGHTS, value.edgeWeight, DEFAULTS.edgeWeight),
  };
}

export function borderById(id: BlockBorderId): BlockBorder {
  return BLOCK_BORDERS.find((o) => o.id === id) ?? BLOCK_BORDERS[1];
}

export function edgeWeightById(id: EdgeWeightId): EdgeWeight {
  return EDGE_WEIGHTS.find((o) => o.id === id) ?? EDGE_WEIGHTS[1];
}

/**
 * The custom properties the stylesheet reads for block outlines.
 *
 * Returned rather than written so the mapping can be checked without a DOM.
 */
export function borderProperties(id: BlockBorderId): Record<string, string> {
  const border = borderById(id);
  return {
    "--card-border-width": border.width,
    "--card-border-hld": border.hld,
    "--card-border-er": border.er,
    "--card-border-sequence": border.sequence,
  };
}

type Listener = () => void;

class PreferenceStore {
  private value: Preferences;

  private readonly listeners = new Set<Listener>();

  constructor(private readonly storage?: Storage) {
    this.value = readStored(this.load());
    this.publish();
  }

  private load(): string | null {
    try {
      return (
        (this.storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY) ?? null
      );
    } catch {
      // Site data can be blocked outright; the defaults are a fine answer.
      return null;
    }
  }

  private save(): void {
    try {
      (this.storage ?? globalThis.localStorage)?.setItem(
        STORAGE_KEY,
        JSON.stringify(this.value),
      );
    } catch {
      // A preference that cannot be stored still applies to this session.
    }
  }

  /** Puts the appearance where CSS can see it, for every canvas on the page. */
  private publish(): void {
    const root = globalThis.document?.documentElement;
    if (!root) return;
    for (const [name, value] of Object.entries(
      borderProperties(this.value.blockBorder),
    ))
      root.style.setProperty(name, value);
    root.setAttribute("lang", this.value.locale);
  }

  getSnapshot = (): Preferences => this.value;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update = (patch: Partial<Preferences>): void => {
    const next = { ...this.value, ...patch };
    if (
      next.locale === this.value.locale &&
      next.blockBorder === this.value.blockBorder &&
      next.edgeWeight === this.value.edgeWeight
    )
      return;
    this.value = next;
    this.save();
    this.publish();
    for (const listener of [...this.listeners]) listener();
  };
}

export type { PreferenceStore };

/** The one store the application reads; a test may build its own. */
export const preferences = new PreferenceStore();

export function createPreferenceStore(storage?: Storage): PreferenceStore {
  return new PreferenceStore(storage);
}
