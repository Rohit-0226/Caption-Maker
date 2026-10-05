import type {
  AnimationSettings,
  Caption,
  CaptionPosition,
  CaptionStyle,
  CaptionWord,
} from '../../src/core/types/project';
import { captionMetrics } from '../../src/core/rendering/captionMetrics';

export interface AssCompilerOptions {
  width: number;
  height: number;
  fps?: number;
  presetId?: string;
}

const pad = (n: number, width = 2) => String(Math.floor(n)).padStart(width, '0');

/** Convert seconds to ASS time format: H:MM:SS.CC (centiseconds) */
export const toAssTime = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const totalCs = Math.round(safe * 100);
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs, 2)}`;
};

/** Convert "#RRGGBB" or "rgba(...)" hex to ASS's &HAABBGGRR&. */
export const toAssColour = (color: string, defaultAlpha = 0): string => {
  if (!color) return '&H00FFFFFF';

  // Handle rgba(r, g, b, a)
  const rgbaMatch = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i.exec(color.trim());
  if (rgbaMatch) {
    const r = Number(rgbaMatch[1]).toString(16).padStart(2, '0');
    const g = Number(rgbaMatch[2]).toString(16).padStart(2, '0');
    const b = Number(rgbaMatch[3]).toString(16).padStart(2, '0');
    const a = rgbaMatch[4] !== undefined
      ? Math.round((1 - Number(rgbaMatch[4])) * 255).toString(16).padStart(2, '0')
      : pad(defaultAlpha, 2);
    return `&H${a}${b}${g}${r}`.toUpperCase();
  }

  // Handle #RRGGBB or #RGB
  const hex = color.trim().replace(/^#/, '');
  if (hex.length === 3) {
    const r = hex[0] + hex[0];
    const g = hex[1] + hex[1];
    const b = hex[2] + hex[2];
    return `&H${pad(defaultAlpha, 2)}${b}${g}${r}`.toUpperCase();
  }
  if (hex.length >= 6) {
    const r = hex.slice(0, 2);
    const g = hex.slice(2, 4);
    const b = hex.slice(4, 6);
    return `&H${pad(defaultAlpha, 2)}${b}${g}${r}`.toUpperCase();
  }

  return '&H00FFFFFF';
};

/**
 * Compiles Caption[] into a complete ASS subtitle script ready for libass burn-in.
 */
export const compileToAss = (
  captions: Caption[],
  style: CaptionStyle,
  position: CaptionPosition,
  animation: AnimationSettings,
  options: AssCompilerOptions,
): string => {
  const { width, height } = options;

  // ASS alignment: 1-3 bottom, 4-6 middle, 7-9 top; 2/5/8 are centered
  const alignRow = position.y >= 66 ? 0 : position.y >= 33 ? 3 : 6;
  const alignCol = style.align === 'left' ? 1 : style.align === 'right' ? 3 : 2;
  const alignment = alignRow + alignCol;

  const marginV = Math.round((height * Math.min(position.y, 100 - position.y)) / 100);
  const marginH = Math.round(width * 0.08);

  /**
   * PlayResX/PlayResY below are the frame's own pixels, so libass already draws
   * one style unit as one output pixel. Scaling the font size again against a
   * fixed 1080 reference — as this used to — shrank every caption on a 720p
   * export to two thirds of the size the editor showed, and a `max(16, …)`
   * floor made the error non-linear across sizes. The shared resolver keeps this
   * path in step with the Remotion renderer instead.
   */
  const metrics = captionMetrics({ style });
  const fontSize = Math.round(metrics.fontSize);
  // CSS centres its text stroke, ASS draws the outline outward only
  const strokeWidth = metrics.strokeWidth > 0 ? Math.max(1, Math.round(metrics.strokeWidth / 2)) : 0;
  const shadowDepth = style.shadowEnabled ? Math.max(1, Math.round(metrics.shadowBlur / 4)) : 0;

  const primaryCol = toAssColour(style.color);
  const secondaryCol = toAssColour(style.activeWordColor);
  const outlineCol = toAssColour(style.strokeColor);
  const backCol = style.boxEnabled
    ? toAssColour(style.boxColor, 64)
    : style.shadowEnabled
      ? toAssColour(style.shadowColor, 128)
      : '&H80000000';

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Default style
    [
      'Style: Default',
      style.fontFamily || 'Arial',
      fontSize,
      primaryCol,
      secondaryCol,
      outlineCol,
      backCol,
      style.fontWeight >= 700 ? -1 : 0,
      0, // Italic
      0, // Underline
      0, // StrikeOut
      100, // ScaleX
      100, // ScaleY
      Math.round(metrics.letterSpacing),
      0, // Angle
      style.boxEnabled ? 3 : 1, // BorderStyle: 3 is opaque box
      strokeWidth,
      shadowDepth,
      alignment,
      marginH,
      marginH,
      marginV,
      1,
    ].join(','),
    // Highlighted/Active style for word-by-word karaoke
    [
      'Style: Highlight',
      style.fontFamily || 'Arial',
      Math.round(fontSize * (metrics.activeWordScale || 1)),
      secondaryCol,
      primaryCol,
      outlineCol,
      backCol,
      style.fontWeight >= 700 ? -1 : 0,
      0,
      0,
      0,
      100,
      100,
      Math.round(style.letterSpacing),
      0,
      style.boxEnabled ? 3 : 1,
      strokeWidth,
      shadowDepth,
      alignment,
      marginH,
      marginH,
      marginV,
      1,
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const events: string[] = [];

  for (const caption of captions) {
    if (!caption.words.length) continue;

    const startStr = toAssTime(caption.start);
    const endStr = toAssTime(caption.end);

    // Single word at a time preset
    if (options.presetId === 'single') {
      for (const word of caption.words) {
        const text = style.uppercase ? word.text.toUpperCase() : word.text;
        events.push(
          `Dialogue: 0,${toAssTime(word.start)},${toAssTime(word.end)},Highlight,,0,0,0,,${text}`,
        );
      }
      continue;
    }

    // Karaoke mode: active word fills with colour as spoken
    if (options.presetId === 'karaoke' || animation.enter === 'wordHighlight') {
      // Build ASS karaoke line using {\k<duration_cs>}
      let lineText = '';
      for (const word of caption.words) {
        const durationCs = Math.max(1, Math.round((word.end - word.start) * 100));
        const wordText = style.uppercase ? word.text.toUpperCase() : word.text;
        lineText += `{\\k${durationCs}}${wordText} `;
      }
      events.push(
        `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${lineText.trim()}`,
      );
      continue;
    }

    // Spotlight mode: dim inactive words
    if (options.presetId === 'spotlight' || animation.enter === 'spotlight') {
      for (let i = 0; i < caption.words.length; i++) {
        const activeWord = caption.words[i];
        let frameText = '';
        for (let j = 0; j < caption.words.length; j++) {
          const w = caption.words[j];
          const wText = style.uppercase ? w.text.toUpperCase() : w.text;
          if (j === i) {
            frameText += `{\\c${secondaryCol}\\alpha&H00&}${wText} `;
          } else {
            frameText += `{\\c${primaryCol}\\alpha&H90&}${wText} `;
          }
        }
        events.push(
          `Dialogue: 0,${toAssTime(activeWord.start)},${toAssTime(activeWord.end)},Default,,0,0,0,,${frameText.trim()}`,
        );
      }
      continue;
    }

    // Punch / Creator mode: Active word highlighted in secondary color with slight scale
    if (options.presetId === 'punch' || style.activeWordColor !== style.color) {
      for (let i = 0; i < caption.words.length; i++) {
        const activeWord = caption.words[i];
        let frameText = '';
        for (let j = 0; j < caption.words.length; j++) {
          const w = caption.words[j];
          const wText = style.uppercase ? w.text.toUpperCase() : w.text;
          if (j === i) {
            frameText += `{\\c${secondaryCol}}${wText} `;
          } else {
            frameText += `{\\c${primaryCol}}${wText} `;
          }
        }
        events.push(
          `Dialogue: 0,${toAssTime(activeWord.start)},${toAssTime(activeWord.end)},Default,,0,0,0,,${frameText.trim()}`,
        );
      }
      continue;
    }

    // Clean / Subtitle / Default: static lines
    const lineText = caption.words
      .map((w) => (style.uppercase ? w.text.toUpperCase() : w.text))
      .join(' ');
    events.push(
      `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${lineText}`,
    );
  }

  return `${header}\n${events.join('\n')}\n`;
};
