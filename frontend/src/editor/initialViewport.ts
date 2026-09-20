/**
 * Where the canvas looks when it opens.
 *
 * It opens fitted, at exactly the zoom React Flow's own fit would choose, so a
 * canvas with diagrams opens as it always did. What changes is the alignment.
 * The fit centres whatever it fits, and a canvas that holds only its task -- a
 * Custom canvas, or one started from a card that opens no schema -- has nothing
 * on it but the three task panels, so they opened in the middle of the screen
 * with empty canvas either side. The content is set against the top-left
 * corner instead: the task stands at the left edge, and the room to draw in is
 * to the right of it.
 */

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placed {
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

/** How the canvas opens: the same numbers the fit used before. */
export const INITIAL_VIEW = { padding: 0.07, minZoom: 0.12, maxZoom: 1 };

/** The box around everything drawn, or nothing when nothing is. */
export function contentBounds(nodes: Placed[]): Bounds | null {
  const sized = nodes.filter(
    (node) => (node.width ?? 0) > 0 && (node.height ?? 0) > 0,
  );
  if (sized.length === 0) return null;
  const left = Math.min(...sized.map((node) => node.position.x));
  const top = Math.min(...sized.map((node) => node.position.y));
  const right = Math.max(...sized.map((node) => node.position.x + node.width!));
  const bottom = Math.max(
    ...sized.map((node) => node.position.y + node.height!),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The pixels a fractional fit padding leaves on each side, worked out the way
 * React Flow works them out, so the zoom below is the zoom its fit would pick.
 */
export function paddingPixels(size: number, padding: number): number {
  return Math.floor((size - size / (1 + padding)) * 0.5);
}

export function topLeftViewport(
  bounds: Bounds,
  width: number,
  height: number,
  options: { padding: number; minZoom: number; maxZoom: number } = INITIAL_VIEW,
): { x: number; y: number; zoom: number } {
  const padX = paddingPixels(width, options.padding);
  const padY = paddingPixels(height, options.padding);
  const fitted = Math.min(
    (width - 2 * padX) / bounds.width,
    (height - 2 * padY) / bounds.height,
  );
  const zoom = Math.min(options.maxZoom, Math.max(options.minZoom, fitted));
  return { x: padX - bounds.x * zoom, y: padY - bounds.y * zoom, zoom };
}
