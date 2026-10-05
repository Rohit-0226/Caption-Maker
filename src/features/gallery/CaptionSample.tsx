import React, { useMemo } from 'react';
import type { AnimationSettings, Caption, CaptionStyle } from '../../core/types/project';
import { computeCaptionFrame } from '../../core/rendering/frame';
import { CaptionText } from '../../remotion/CaptionText';

/** Frame rate the preview cards resolve motion at. */
export const SAMPLE_FPS = 30;
/** How long one preview cycle runs, in seconds. */
export const SAMPLE_DURATION = 2.2;

/**
 * Builds a throwaway caption whose words are spread across the sample window,
 * so word-level animations have something to animate.
 */
export const buildSampleCaption = (text: string, duration = SAMPLE_DURATION): Caption => {
  const tokens = text.split(/\s+/).filter(Boolean);
  // hold the last quarter still so the finished state is readable at rest
  const speaking = duration * 0.72;
  const per = speaking / Math.max(1, tokens.length);

  return {
    id: 'sample',
    start: 0,
    end: duration,
    edited: false,
    words: tokens.map((token, i) => ({
      text: token,
      start: i * per,
      end: (i + 1) * per,
      emphasis: false,
    })),
  };
};

interface Props {
  caption: Caption;
  style: CaptionStyle;
  animation: AnimationSettings;
  /** seconds into the sample cycle */
  time: number;
  sizeScale: number;
  maxWordsPerLine?: number;
  maxLines?: number;
}

/**
 * One caption drawn at preview size, using the same motion engine and the same
 * text renderer as the exported video.
 */
export const CaptionSample: React.FC<Props> = React.memo(
  ({ caption, style, animation, time, sizeScale, maxWordsPerLine = 3, maxLines = 2 }) => {
    const resolved = useMemo(
      () =>
        computeCaptionFrame({
          frame: time * SAMPLE_FPS,
          fps: SAMPLE_FPS,
          caption,
          animation,
          maxLines,
          maxWordsPerLine,
        }),
      [caption, animation, time, maxLines, maxWordsPerLine],
    );

    const { line } = resolved;

    return (
      <div
        style={{
          transform: [
            `translate(${line.translateX * sizeScale}px, ${line.translateY * sizeScale}px)`,
            `scale(${line.scale})`,
            `rotate(${line.rotate}deg)`,
          ].join(' '),
          opacity: line.opacity * style.opacity,
          filter: line.blur > 0 ? `blur(${line.blur * sizeScale}px)` : undefined,
          willChange: 'transform, opacity',
        }}
      >
        <CaptionText frame={resolved} style={style} sizeScale={sizeScale} />
      </div>
    );
  },
);

CaptionSample.displayName = 'CaptionSample';
