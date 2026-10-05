import type { CaptionStyle } from '../types/project';

/**
 * The one place caption style becomes pixels.
 *
 * Every surface that draws a caption — the editor preview, the Remotion export,
 * the gallery cards, the ASS compilers — resolves its measurements here. That
 * matters because a caption's size is only trustworthy if exactly one piece of
 * code decides it: when two renderers each apply their own factor, the same
 * project exports at a different size than it was designed at, and the two
 * disagree in ways that are invisible until someone compares frames.
 *
 * Read `scale` as "how many device pixels one style unit is worth here".
 */
export interface CaptionMetricsInput {
  style: CaptionStyle;
  /**
   * Ratio between the surface being drawn and the frame the style is authored
   * against. The video render draws at the project's own frame, so it passes
   * nothing; a thumbnail that wants the same design at a third of the size
   * passes 1/3.
   */
  scale?: number;
}

/**
 * Caption measurements in the pixels of the surface being drawn.
 *
 * Sizes are already scaled. Ratios (`lineHeight`, `wordSpacingEm`, the two word
 * scales) are deliberately left unscaled — they multiply a size that has been
 * scaled already, so scaling them too is the classic double-scale.
 */
export interface CaptionMetrics {
  /** what the input scale resolved to, for callers that must scale extras */
  scale: number;

  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
  /** unitless multiplier of fontSize, never scaled */
  lineHeight: number;
  /** gap between words, in em, so it tracks fontSize on its own */
  wordSpacingEm: number;
  /** vertical gap between wrapped lines, already in pixels */
  lineGap: number;

  strokeWidth: number;
  shadowBlur: number;
  shadowOffsetY: number;

  boxPaddingX: number;
  boxPaddingY: number;
  boxRadius: number;
  activeBoxRadius: number;

  /** unitless, never scaled */
  activeWordScale: number;
  /** unitless, never scaled */
  emphasisScale: number;
}

/** A caption's measurements on one surface. */
export const captionMetrics = ({ style, scale = 1 }: CaptionMetricsInput): CaptionMetrics => {
  // guard against a zero or nonsense scale collapsing the caption to nothing
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const px = (value: number) => value * factor;

  const fontSize = px(style.fontSize);

  return {
    scale: factor,

    fontFamily: style.fontFamily,
    fontSize,
    fontWeight: style.fontWeight,
    letterSpacing: px(style.letterSpacing),
    lineHeight: style.lineHeight,
    wordSpacingEm: style.wordSpacing,
    lineGap: (style.lineHeight - 1) * fontSize,

    strokeWidth: style.strokeEnabled ? px(style.strokeWidth) : 0,
    shadowBlur: px(style.shadowBlur),
    shadowOffsetY: px(style.shadowOffsetY),

    boxPaddingX: px(style.boxPaddingX),
    boxPaddingY: px(style.boxPaddingY),
    boxRadius: px(style.boxRadius),
    activeBoxRadius: px(style.activeBoxRadius),

    activeWordScale: style.activeWordScale,
    emphasisScale: style.emphasisScale,
  };
};

/**
 * The CSS font shorthand for a face, for `document.fonts.load` and canvas.
 *
 * The weight matters: asking the browser for a weight the caption does not use
 * leaves the real face unloaded, and the first frames drawn then fall back to a
 * system face whose metrics are a different size.
 */
export const fontShorthand = (style: CaptionStyle, size = 64): string =>
  `${style.fontWeight} ${size}px "${style.fontFamily}"`;
