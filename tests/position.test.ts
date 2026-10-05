import { describe, expect, it } from 'vitest';
import {
  clampPercent,
  clientToPercent,
  dragTo,
  grabOffset,
  nudge,
  snapToGuide,
  MAX_PERCENT,
  MIN_PERCENT,
} from '../src/features/preview/positionMath';

/** A 1080x1920 preview sitting 100px from the top-left of the window. */
const frame = { left: 100, top: 100, width: 540, height: 960 };

describe('pointer to percentage', () => {
  it('maps the frame corners and centre', () => {
    expect(clientToPercent(frame, 100, 100)).toEqual({ x: 0, y: 0 });
    expect(clientToPercent(frame, 640, 1060)).toEqual({ x: 100, y: 100 });
    expect(clientToPercent(frame, 370, 580)).toEqual({ x: 50, y: 50 });
  });

  /**
   * A frame with no size happens on first paint and whenever the preview is
   * hidden. Dividing by it would produce Infinity and fling the caption off
   * screen, so it returns null and the drag becomes a no-op.
   */
  it('refuses a frame with no size', () => {
    expect(clientToPercent({ ...frame, width: 0 }, 200, 200)).toBeNull();
    expect(clientToPercent({ ...frame, height: 0 }, 200, 200)).toBeNull();
  });

  it('reports positions outside the frame without clamping', () => {
    const point = clientToPercent(frame, 40, 100);
    expect(point?.x).toBeLessThan(0);
  });
});

describe('clamping', () => {
  it('keeps captions inside the frame', () => {
    expect(clampPercent(-40)).toBe(MIN_PERCENT);
    expect(clampPercent(500)).toBe(MAX_PERCENT);
    expect(clampPercent(50)).toBe(50);
  });
});

describe('centre guide', () => {
  it('snaps when close', () => {
    expect(snapToGuide(50.8)).toEqual({ value: 50, snapped: true });
    expect(snapToGuide(49.2)).toEqual({ value: 50, snapped: true });
  });

  it('leaves a deliberate offset alone', () => {
    expect(snapToGuide(56)).toEqual({ value: 56, snapped: false });
  });

  it('can be switched off, for placing freely', () => {
    expect(snapToGuide(50.4, false)).toEqual({ value: 50.4, snapped: false });
  });
});

describe('dragging', () => {
  it('keeps the grab point under the cursor', () => {
    const position = { x: 50, y: 72 };
    // grab 10% to the right of the caption centre
    const grabX = 100 + 540 * 0.6;
    const grabY = 100 + 960 * 0.72;

    const offset = grabOffset(frame, grabX, grabY, position);
    expect(offset).toEqual({ offsetX: 10, offsetY: 0 });

    // moving the pointer straight up should move the caption straight up
    const next = dragTo(frame, grabX, 100 + 960 * 0.4, offset!, { snap: false });
    expect(next?.x).toBeCloseTo(50, 6);
    expect(next?.y).toBeCloseTo(40, 6);
  });

  it('does not jump when grabbed off-centre', () => {
    const position = { x: 30, y: 60 };
    const grabX = 100 + 540 * 0.42;
    const grabY = 100 + 960 * 0.55;

    const offset = grabOffset(frame, grabX, grabY, position)!;
    // releasing without moving must leave the caption exactly where it was
    const next = dragTo(frame, grabX, grabY, offset, { snap: false });

    expect(next?.x).toBeCloseTo(position.x, 6);
    expect(next?.y).toBeCloseTo(position.y, 6);
  });

  it('snaps to the centre and reports it', () => {
    const offset = { offsetX: 0, offsetY: 0 };
    const nearCentre = dragTo(frame, 100 + 540 * 0.505, 100 + 960 * 0.5, offset);

    expect(nearCentre?.x).toBe(50);
    expect(nearCentre?.snappedX).toBe(true);
  });

  it('does not snap when snapping is off', () => {
    const offset = { offsetX: 0, offsetY: 0 };
    const free = dragTo(frame, 100 + 540 * 0.505, 100 + 960 * 0.5, offset, { snap: false });

    expect(free?.x).toBeCloseTo(50.5, 4);
    expect(free?.snappedX).toBe(false);
  });

  it('clamps a drag past the edge', () => {
    const offset = { offsetX: 0, offsetY: 0 };
    const past = dragTo(frame, -900, -900, offset, { snap: false });

    expect(past?.x).toBe(MIN_PERCENT);
    expect(past?.y).toBe(MIN_PERCENT);
  });

  it('is a no-op against a collapsed frame', () => {
    const offset = { offsetX: 0, offsetY: 0 };
    expect(dragTo({ ...frame, width: 0, height: 0 }, 200, 200, offset)).toBeNull();
    expect(grabOffset({ ...frame, width: 0 }, 200, 200, { x: 50, y: 50 })).toBeNull();
  });
});

describe('keyboard nudge', () => {
  it('moves one percent per press', () => {
    expect(nudge({ x: 50, y: 72 }, 'ArrowUp')).toEqual({ x: 50, y: 71 });
    expect(nudge({ x: 50, y: 72 }, 'ArrowDown')).toEqual({ x: 50, y: 73 });
    expect(nudge({ x: 50, y: 72 }, 'ArrowLeft')).toEqual({ x: 49, y: 72 });
    expect(nudge({ x: 50, y: 72 }, 'ArrowRight')).toEqual({ x: 51, y: 72 });
  });

  it('moves five percent with shift', () => {
    expect(nudge({ x: 50, y: 72 }, 'ArrowUp', true)).toEqual({ x: 50, y: 67 });
  });

  it('stays inside the frame', () => {
    expect(nudge({ x: 50, y: MIN_PERCENT }, 'ArrowUp')).toEqual({ x: 50, y: MIN_PERCENT });
    expect(nudge({ x: MAX_PERCENT, y: 50 }, 'ArrowRight')).toEqual({ x: MAX_PERCENT, y: 50 });
  });

  it('ignores keys that are not arrows', () => {
    expect(nudge({ x: 50, y: 50 }, 'a')).toBeNull();
    expect(nudge({ x: 50, y: 50 }, 'Enter')).toBeNull();
  });
});

describe('the box and the inspector share one coordinate system', () => {
  /**
   * Whatever the inspector writes as X/Y is what the box renders at, and a drag
   * produces the same kind of value. If these ever diverge, the box would sit
   * somewhere the caption is not.
   */
  it('round-trips a position through a drag unchanged', () => {
    for (const position of [
      { x: 50, y: 72 },
      { x: 20, y: 15 },
      { x: 80, y: 90 },
    ]) {
      const clientX = frame.left + (position.x / 100) * frame.width;
      const clientY = frame.top + (position.y / 100) * frame.height;

      const offset = grabOffset(frame, clientX, clientY, position)!;
      const next = dragTo(frame, clientX, clientY, offset, { snap: false })!;

      expect(next.x).toBeCloseTo(position.x, 6);
      expect(next.y).toBeCloseTo(position.y, 6);
    }
  });
});
