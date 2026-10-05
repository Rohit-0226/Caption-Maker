import React from 'react';
import type { CaptionStyle } from '../core/types/project';
import type { CaptionFrame } from '../core/rendering/frame';
import { captionMetrics } from '../core/rendering/captionMetrics';

interface Props {
  frame: CaptionFrame;
  style: CaptionStyle;
  /**
   * Scales every pixel measurement — font size, stroke, padding — so a preview
   * card can render the identical look at thumbnail size.
   */
  sizeScale?: number;
}

/**
 * Renders a resolved caption frame as styled text.
 *
 * Deliberately knows nothing about position or timing: it turns transform
 * values into CSS and nothing else. The video layer and the gallery cards both
 * mount this, which is what guarantees a style card looks like the export.
 */
export const CaptionText: React.FC<Props> = ({ frame, style, sizeScale = 1 }) => {
  // one shared resolver decides every pixel measurement below
  const m = captionMetrics({ style, scale: sizeScale });

  const justify =
    style.align === 'center' ? 'center' : style.align === 'left' ? 'flex-start' : 'flex-end';

  let characterBudget = frame.revealedCharacters ?? Infinity;

  return (
    <div
      style={{
        fontFamily: `"${m.fontFamily}", "Segoe UI", system-ui, sans-serif`,
        fontSize: m.fontSize,
        fontWeight: m.fontWeight,
        letterSpacing: `${m.letterSpacing}px`,
        lineHeight: m.lineHeight,
        textAlign: style.align,
        color: style.color,
        WebkitTextStroke: style.strokeEnabled
          ? `${m.strokeWidth}px ${style.strokeColor}`
          : undefined,
        paintOrder: 'stroke fill',
        textShadow: style.shadowEnabled
          ? `0px ${m.shadowOffsetY}px ${m.shadowBlur}px ${style.shadowColor}`
          : undefined,
        background: style.boxEnabled ? style.boxColor : undefined,
        borderRadius: style.boxEnabled ? m.boxRadius : undefined,
        padding: style.boxEnabled
          ? `${m.boxPaddingY}px ${m.boxPaddingX}px`
          : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: `${m.lineGap}px`,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {frame.lines.map((lineWords, lineIndex) => (
        <div
          key={lineIndex}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: `0 ${m.wordSpacingEm}em`,
            justifyContent: justify,
            alignItems: 'baseline',
          }}
        >
          {lineWords.map(({ word, transform, index }) => {
            // character-reveal animations consume a shared budget left to right
            if (frame.revealedCharacters !== null) {
              const take = Math.max(0, Math.min(word.text.length, characterBudget));
              characterBudget -= word.text.length + 1;
              if (take === 0) return null;
              const shown = word.text.slice(0, take);
              const isEmphasized = Boolean(style.emphasisEnabled && word.emphasis);
              return (
                <span
                  key={index}
                  style={{
                    display: 'inline-block',
                    color: isEmphasized ? style.emphasisColor : style.color,
                    transform: isEmphasized ? `scale(${m.emphasisScale})` : undefined,
                  }}
                >
                  {style.uppercase ? shown.toUpperCase() : shown}
                </span>
              );
            }

            const showBox = transform.box && style.activeBoxEnabled;

            let color =
              transform.color === 'active'
                ? style.activeWordColor
                : transform.color === 'future'
                  ? style.futureWordColor
                  : style.color;
            let scale = transform.scale;

            if (transform.color === 'active') scale *= m.activeWordScale;
            if (style.emphasisEnabled && word.emphasis) {
              color = style.emphasisColor;
              scale *= m.emphasisScale;
            }

            return (
              <span
                key={index}
                style={{
                  display: 'inline-block',
                  transform: `translateY(${transform.translateY * m.scale}px) scale(${scale})`,
                  opacity: transform.opacity,
                  filter: transform.blur > 0 ? `blur(${transform.blur * m.scale}px)` : undefined,
                  color,
                  background: showBox ? style.activeBoxColor : undefined,
                  borderRadius: showBox ? m.activeBoxRadius : undefined,
                  padding: showBox ? '0.04em 0.14em' : undefined,
                  clipPath:
                    transform.clipRight > 0
                      ? `inset(-30% ${transform.clipRight}% -30% -10%)`
                      : undefined,
                  willChange: 'transform, opacity',
                }}
              >
                {style.uppercase ? word.text.toUpperCase() : word.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
