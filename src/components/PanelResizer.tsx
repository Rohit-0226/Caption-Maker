import React, { useCallback, useRef, useState } from 'react';

export interface PanelResizerProps {
  orientation: 'col' | 'row';
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onResize: (value: number) => void;
  label: string;
  invert?: boolean;
  className?: string;
}

/**
 * A fluid, accessible splitter handle between workspace panels.
 *
 * Adheres to UI/UX Pro Max guidelines:
 * - Generous 10px hit target with 1px visual border line
 * - Fluid pointer capture (never drops drag over iframe/video/stage)
 * - Double-click to reset to default dimension
 * - Keyboard navigation (Arrow keys with Shift modifier, Home to reset)
 * - Proper ARIA separator semantics
 */
export const PanelResizer: React.FC<PanelResizerProps> = ({
  orientation,
  value,
  min,
  max,
  defaultValue,
  onResize,
  label,
  invert = false,
  className = '',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startCoord: number;
    startValue: number;
    pointerId: number;
  } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore in non-browser testing environments
      }

      dragRef.current = {
        startCoord: orientation === 'col' ? e.clientX : e.clientY,
        startValue: value,
        pointerId: e.pointerId,
      };

      setIsDragging(true);
      document.body.style.cursor = orientation === 'col' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [orientation, value],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const currentCoord = orientation === 'col' ? e.clientX : e.clientY;
      let diff = currentCoord - dragRef.current.startCoord;
      if (invert) diff = -diff;
      const nextValue = Math.round(
        Math.max(min, Math.min(max, dragRef.current.startValue + diff)),
      );
      onResize(nextValue);
    },
    [orientation, invert, min, max, onResize],
  );

  const handlePointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragRef.current) {
        try {
          e.currentTarget.releasePointerCapture(dragRef.current.pointerId);
        } catch {}
        dragRef.current = null;
      }
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },
    [],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onResize(defaultValue);
    },
    [defaultValue, onResize],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 24 : 8;
      let next = value;

      if (orientation === 'col') {
        if (e.key === 'ArrowLeft') {
          next = invert ? value + step : value - step;
        } else if (e.key === 'ArrowRight') {
          next = invert ? value - step : value + step;
        } else if (e.key === 'Home') {
          next = defaultValue;
        } else if (e.key === 'End') {
          next = max;
        } else {
          return;
        }
      } else {
        if (e.key === 'ArrowUp') {
          next = invert ? value + step : value - step;
        } else if (e.key === 'ArrowDown') {
          next = invert ? value - step : value + step;
        } else if (e.key === 'Home') {
          next = defaultValue;
        } else if (e.key === 'End') {
          next = max;
        } else {
          return;
        }
      }

      e.preventDefault();
      onResize(Math.max(min, Math.min(max, next)));
    },
    [orientation, invert, value, min, max, defaultValue, onResize],
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation === 'col' ? 'vertical' : 'horizontal'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={`Resize ${label}`}
      title={`Drag to resize ${label} (Double-click to reset)`}
      className={`cm-resizer cm-resizer--${orientation} ${isDragging ? 'is-dragging' : ''} ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="cm-resizer__line" />
      <div className="cm-resizer__pill" />
    </div>
  );
};
