/**
 * How the text of one object is set: its size, its emphasis and its typeface.
 *
 * Each block, note, annotation and connection label can be set on its own,
 * because the need is local: one long component name that should be smaller,
 * one decision that should stand out in bold. A canvas-wide setting would make
 * every block pay for the one that needed it.
 *
 * This is layout, the way a port or a label's placement is. How a name is set
 * says nothing about the system, so a canvas whose text got bigger is the same
 * design with the same content hash.
 *
 * The controls are three buttons in the panel the object already has -- smaller,
 * larger, and one each to step through emphasis and typeface -- rather than a
 * formatting toolbar: the panel is where the author already is, and a toolbar
 * for four choices would take more room than the choices do.
 */
import type { CSSProperties } from "react";

export type TextEmphasis = "normal" | "bold" | "italic";
export type TextFont = "sans" | "serif" | "mono" | "hand";

export interface TextStyle {
  /** A multiplier on the size the object's text is normally drawn at. */
  scale: number;
  emphasis: TextEmphasis;
  font: TextFont;
}

/**
 * The style of an object nobody has set.
 *
 * One shared object, never a fresh copy: the canvas compares node data by
 * identity to decide what to redraw, and a new object per read would redraw
 * every block on every keystroke.
 */
export const DEFAULT_TEXT_STYLE: TextStyle = Object.freeze({
  scale: 1,
  emphasis: "normal",
  font: "sans",
}) as TextStyle;

/**
 * The sizes the buttons step through.
 *
 * Fixed steps rather than a free number, so two blocks set "one size larger"
 * match exactly and a size can always be undone back to where it started.
 */
export const SCALE_STEPS = [0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];

export const EMPHASES: Array<{
  id: TextEmphasis;
  names: { ru: string; en: string };
}> = [
  { id: "normal", names: { ru: "Обычный", en: "Regular" } },
  { id: "bold", names: { ru: "Жирный", en: "Bold" } },
  { id: "italic", names: { ru: "Курсив", en: "Italic" } },
];

export const FONTS: Array<{
  id: TextFont;
  names: { ru: string; en: string };
  family: string;
}> = [
  {
    id: "sans",
    names: { ru: "Без засечек", en: "Sans serif" },
    family: "inherit",
  },
  {
    id: "serif",
    names: { ru: "С засечками", en: "Serif" },
    family: 'Georgia, "Times New Roman", serif',
  },
  {
    id: "mono",
    names: { ru: "Моноширинный", en: "Monospace" },
    family: 'ui-monospace, "SFMono-Regular", Consolas, monospace',
  },
  {
    id: "hand",
    names: { ru: "Рукописный", en: "Handwritten" },
    family: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive',
  },
];

export function textStyleOf(
  layout: { textStyles?: Record<string, TextStyle> },
  objectId: string,
): TextStyle {
  return layout.textStyles?.[objectId] ?? DEFAULT_TEXT_STYLE;
}

/** The nearest step to a stored scale, so an odd value still steps sensibly. */
function stepIndex(scale: number): number {
  let best = 0;
  SCALE_STEPS.forEach((step, index) => {
    if (Math.abs(step - scale) < Math.abs(SCALE_STEPS[best] - scale))
      best = index;
  });
  return best;
}

/** One step larger or smaller; unchanged at either end. */
export function nextScale(scale: number, direction: 1 | -1): number {
  const index = Math.min(
    SCALE_STEPS.length - 1,
    Math.max(0, stepIndex(scale) + direction),
  );
  return SCALE_STEPS[index];
}

export function canScale(scale: number, direction: 1 | -1): boolean {
  return nextScale(scale, direction) !== SCALE_STEPS[stepIndex(scale)];
}

export function nextEmphasis(emphasis: TextEmphasis): TextEmphasis {
  const index = EMPHASES.findIndex((option) => option.id === emphasis);
  return EMPHASES[(index + 1) % EMPHASES.length].id;
}

export function nextFont(font: TextFont): TextFont {
  const index = FONTS.findIndex((option) => option.id === font);
  return FONTS[(index + 1) % FONTS.length].id;
}

/**
 * What an object's container carries so its stylesheet can set the text.
 *
 * Custom properties rather than inline font rules on the field itself: each
 * kind of object draws its text at its own base size, and only the stylesheet
 * knows that base, so the container says "this much larger, in this face" and
 * each kind's rule applies it to its own size.
 */
export function textStyleProperties(style: TextStyle): CSSProperties {
  if (style === DEFAULT_TEXT_STYLE) return {};
  const font = FONTS.find((option) => option.id === style.font);
  // The page's own face is not a value to set: leaving the property out lets
  // the stylesheet's fallback stand, where `inherit` inside a custom property
  // would mean something else entirely.
  return {
    "--text-scale": String(style.scale),
    ...(font && font.id !== "sans" ? { "--text-family": font.family } : {}),
  } as CSSProperties;
}
