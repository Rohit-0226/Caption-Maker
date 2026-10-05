import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type {
  AnimationSettings,
  Caption,
  CaptionPosition,
  CaptionStyle,
} from '../core/types/project';
import { computeCaptionFrame } from '../core/rendering/frame';
import { CaptionText } from './CaptionText';

interface Props {
  caption: Caption;
  style: CaptionStyle;
  position: CaptionPosition;
  animation: AnimationSettings;
  maxLines: number;
  maxWordsPerLine: number;
}

/**
 * Places one caption in the video frame.
 *
 * The motion itself is resolved by computeCaptionFrame and drawn by
 * CaptionText, both shared with the gallery previews — this component only
 * positions the result.
 */
export const CaptionLayer: React.FC<Props> = ({
  caption,
  style,
  position,
  animation,
  maxLines,
  maxWordsPerLine,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const resolved = computeCaptionFrame({
    frame,
    fps,
    caption,
    animation,
    maxLines,
    maxWordsPerLine,
  });

  const { line } = resolved;

  return (
    <div
      /**
       * Lets the editor's bounding box measure the caption where it actually
       * lands, rather than guessing from the same percentages. The attribute is
       * inert at render time and costs nothing in an export.
       */
      data-cm-caption=""
      style={{
        position: 'absolute',
        left: `${position.x}%`,
        top: `${position.y}%`,
        width: `${position.maxWidth}%`,
        transform: [
          'translate(-50%, -50%)',
          `translate(${line.translateX}px, ${line.translateY}px)`,
          `scale(${line.scale})`,
          `rotate(${line.rotate}deg)`,
        ].join(' '),
        opacity: line.opacity * style.opacity,
        filter: line.blur > 0 ? `blur(${line.blur}px)` : undefined,
        display: 'flex',
        flexDirection: 'column',
        alignItems:
          style.align === 'center'
            ? 'center'
            : style.align === 'left'
              ? 'flex-start'
              : 'flex-end',
        willChange: 'transform, opacity',
      }}
    >
      <CaptionText frame={resolved} style={style} />
    </div>
  );
};
