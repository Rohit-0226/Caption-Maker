import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../../app/store';
import { useActiveCaptionId } from '../../app/playbackClock';
import type { Caption } from '../../core/types/project';
import { dragTo, grabOffset, nudge, type DragOffset } from './positionMath';

interface DragState extends DragOffset {
  pointerId: number;
}

const PADDING = 6;

const EMPTY: Caption[] = [];

/**
 * The editor-only handle for moving captions in the preview.
 *
 * It measures the caption element the renderer actually produced and draws
 * itself around that, rather than re-deriving a position from the same
 * percentages. Font size, line count and wrapping all change the caption's real
 * size, so a box computed independently would drift out of alignment — this one
 * cannot, because it is reading the thing it is wrapping.
 *
 * Measuring happens on an animation frame and writes straight to the DOM. Doing
 * it through React state would re-render the preview sixty times a second, for
 * no benefit.
 *
 * Rendered as a sibling of the composition, so it can never reach an export.
 */
export const CaptionBoundingBox: React.FC<{
  frameRef: React.RefObject<HTMLDivElement | null>;
}> = ({ frameRef }) => {
  const position = useEditor((s) => s.project?.position);
  const selectedId = useEditor((s) => s.selectedCaptionId);
  const captions = useEditor((s) => s.project?.captions);
  const selectCaption = useEditor((s) => s.selectCaption);
  const playingId = useActiveCaptionId(captions ?? EMPTY);
  const updatePosition = useEditor((s) => s.updatePosition);
  const beginTransaction = useEditor((s) => s.beginTransaction);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [snapped, setSnapped] = useState(false);
  const [visible, setVisible] = useState(false);

  const boxRef = useRef<HTMLDivElement>(null);

  /**
   * Draws the box around the caption the renderer actually produced.
   *
   * Writes straight to the DOM: going through React state would re-render the
   * preview on every frame for no benefit.
   */
  const measure = useCallback(() => {
    const frame = frameRef.current;
    const box = boxRef.current;
    if (!frame || !box) return;

    const caption = frame.querySelector<HTMLElement>('[data-cm-caption]');
    if (!caption) {
      // no caption under the playhead — nothing to wrap
      box.style.opacity = '0';
      box.style.pointerEvents = 'none';
      return;
    }

    const frameRect = frame.getBoundingClientRect();
    const rect = caption.getBoundingClientRect();

    // Only the caption needs a size to be drawn around; the frame supplies
    // nothing but the origin. Its width matters for dragging, not for this.
    if (rect.width === 0 || rect.height === 0) return;

    box.style.opacity = '1';
    box.style.pointerEvents = 'auto';
    box.style.left = `${rect.left - frameRect.left - PADDING}px`;
    box.style.top = `${rect.top - frameRect.top - PADDING}px`;
    box.style.width = `${rect.width + PADDING * 2}px`;
    box.style.height = `${rect.height + PADDING * 2}px`;
  }, [frameRef]);

  /**
   * Position immediately whenever something that moves the caption changes, so
   * the box is correct on the very first paint rather than one frame late.
   */
  useLayoutEffect(() => {
    measure();
    setVisible(true);
  }, [measure, position, selectedId]);

  /** Then keep following it — the caption also moves during playback. */
  useEffect(() => {
    let raf = 0;
    const track = () => {
      measure();
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    return () => cancelAnimationFrame(raf);
  }, [measure]);

  // a resized window changes the frame without any state changing
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      const frame = frameRef.current;
      if (!frame) return;

      // hold Alt to place freely, ignoring the centre guide
      const next = dragTo(frame.getBoundingClientRect(), event.clientX, event.clientY, drag, {
        snap: !event.altKey,
      });
      if (!next) return;

      setSnapped(next.snappedX);
      updatePosition({ x: next.x, y: next.y, preset: 'custom' });
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      setDrag(null);
      setSnapped(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, frameRef, updatePosition]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const frame = frameRef.current;
      if (!position || !frame) return;

      const offset = grabOffset(
        frame.getBoundingClientRect(),
        event.clientX,
        event.clientY,
        position,
      );
      if (!offset) return;

      event.preventDefault();

      // Touching the box adopts whatever caption is on screen, so the row you
      // can see in the video is the one the list and inspector are editing.
      if (playingId && playingId !== selectedId) selectCaption(playingId);

      // one history entry for the whole gesture, not one per frame
      beginTransaction();
      setDrag({ pointerId: event.pointerId, ...offset });
    },
    [position, frameRef, beginTransaction, playingId, selectedId, selectCaption],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!position) return;
      const next = nudge(position, event.key, event.shiftKey);
      if (!next) return;

      event.preventDefault();
      event.stopPropagation();
      beginTransaction();
      updatePosition({ ...next, preset: 'custom' });
    },
    [position, updatePosition, beginTransaction],
  );

  const activeId = selectedId || playingId;
  if (!position || !activeId) return null;

  return (
    <>
      {snapped ? <div className="cm-guide cm-guide--vertical" /> : null}

      <div
        ref={boxRef}
        className={`cm-bbox ${drag ? 'is-dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Caption position — drag to move, arrow keys to nudge"
        style={{ opacity: visible ? undefined : 0 }}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <span className="cm-bbox__corner cm-bbox__corner--tl" />
        <span className="cm-bbox__corner cm-bbox__corner--tr" />
        <span className="cm-bbox__corner cm-bbox__corner--bl" />
        <span className="cm-bbox__corner cm-bbox__corner--br" />
      </div>
    </>
  );
};
