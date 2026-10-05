export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Captions may sit this close to the frame edge, in percent. */
export const MIN_PERCENT = 2;
export const MAX_PERCENT = 98;

/** How close to a guide, in percent, before the caption snaps to it. */
export const SNAP_PERCENT = 1.5;
export const GUIDE_LINES = [50];

/**
 * Converts a pointer position into a percentage of the frame.
 *
 * Percentages are the shared coordinate system: the renderer positions captions
 * with them, the inspector edits them, and the export uses the same numbers. A
 * frame with no size yields null rather than a division by zero — that happens
 * on the first paint, and while the preview is hidden.
 */
export const clientToPercent = (rect: Rect, clientX: number, clientY: number): Point | null => {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100,
  };
};

export const clampPercent = (value: number): number =>
  Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value));

/** Snaps to the centre guide unless the caller opts out. */
export const snapToGuide = (
  value: number,
  enabled = true,
): { value: number; snapped: boolean } => {
  if (!enabled) return { value, snapped: false };
  for (const guide of GUIDE_LINES) {
    if (Math.abs(value - guide) < SNAP_PERCENT) return { value: guide, snapped: true };
  }
  return { value, snapped: false };
};

export interface DragOffset {
  offsetX: number;
  offsetY: number;
}

/**
 * The offset between where the pointer went down and the caption's centre, so
 * the caption does not jump under the cursor when a drag starts.
 */
export const grabOffset = (
  rect: Rect,
  clientX: number,
  clientY: number,
  position: Point,
): DragOffset | null => {
  const point = clientToPercent(rect, clientX, clientY);
  if (!point) return null;
  return { offsetX: point.x - position.x, offsetY: point.y - position.y };
};

export interface DragResult {
  x: number;
  y: number;
  snappedX: boolean;
}

/** Where a caption lands for a pointer at this position, mid-drag. */
export const dragTo = (
  rect: Rect,
  clientX: number,
  clientY: number,
  offset: DragOffset,
  options: { snap?: boolean } = {},
): DragResult | null => {
  const point = clientToPercent(rect, clientX, clientY);
  if (!point) return null;

  const snappedX = snapToGuide(point.x - offset.offsetX, options.snap !== false);

  return {
    x: clampPercent(snappedX.value),
    y: clampPercent(point.y - offset.offsetY),
    snappedX: snappedX.snapped,
  };
};

/** Arrow-key nudge, in percent. */
export const nudge = (
  position: Point,
  key: string,
  large = false,
): Point | null => {
  const step = large ? 5 : 1;
  const moves: Record<string, [number, number]> = {
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
  };
  const move = moves[key];
  if (!move) return null;
  return {
    x: clampPercent(position.x + move[0]),
    y: clampPercent(position.y + move[1]),
  };
};
