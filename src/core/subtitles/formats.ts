import type { Caption, CaptionStyle, CaptionPosition } from '../types/project';
import { captionText } from '../segmentation/segmenter';
import { captionMetrics } from '../rendering/captionMetrics';

// ---------------------------------------------------------------------------
// Timecodes
// ---------------------------------------------------------------------------

const pad = (n: number, len = 2) => String(Math.floor(n)).padStart(len, '0');

const splitTime = (seconds: number) => {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  // rounding can push milliseconds to 1000; carry it
  return ms === 1000 ? { h, m, sec: sec + 1, ms: 0 } : { h, m, sec, ms };
};

export const toSrtTime = (seconds: number) => {
  const { h, m, sec, ms } = splitTime(seconds);
  return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms, 3)}`;
};

export const toVttTime = (seconds: number) => {
  const { h, m, sec, ms } = splitTime(seconds);
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms, 3)}`;
};

/** ASS uses centiseconds and a single-digit hour. */
export const toAssTime = (seconds: number) => {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return cs === 100
    ? `${h}:${pad(m)}:${pad(sec + 1)}.00`
    : `${h}:${pad(m)}:${pad(sec)}.${pad(cs)}`;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface TimestampIssue {
  index: number;
  captionId: string;
  message: string;
}

/**
 * Checks captions are exportable: ordered, non-overlapping, positive duration,
 * and non-empty. Returns every problem found rather than throwing on the first.
 */
export const validateCaptions = (captions: Caption[]): TimestampIssue[] => {
  const issues: TimestampIssue[] = [];

  captions.forEach((caption, i) => {
    if (captionText(caption).trim().length === 0) {
      issues.push({ index: i, captionId: caption.id, message: 'Caption has no text' });
    }
    if (!Number.isFinite(caption.start) || !Number.isFinite(caption.end)) {
      issues.push({ index: i, captionId: caption.id, message: 'Timestamp is not a number' });
      return;
    }
    if (caption.start < 0) {
      issues.push({ index: i, captionId: caption.id, message: 'Starts before zero' });
    }
    if (caption.end <= caption.start) {
      issues.push({ index: i, captionId: caption.id, message: 'Ends before it starts' });
    }
    const prev = captions[i - 1];
    if (prev && caption.start < prev.end - 1e-6) {
      issues.push({
        index: i,
        captionId: caption.id,
        message: `Overlaps caption ${i} (starts at ${caption.start.toFixed(3)}s, previous ends at ${prev.end.toFixed(3)}s)`,
      });
    }
  });

  return issues;
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Text as it should appear, honouring uppercase and the line layout. */
const renderLines = (caption: Caption, lines: string[][] | null): string => {
  if (!lines) return captionText(caption);
  return lines.map((l) => l.join(' ')).join('\n');
};

export interface SubtitleExportOptions {
  /** pre-wrapped lines per caption, when the caller wants layout preserved */
  lines?: string[][][];
  uppercase?: boolean;
}

const applyCase = (text: string, uppercase: boolean | undefined) =>
  uppercase ? text.toUpperCase() : text;

export const toSrt = (captions: Caption[], options: SubtitleExportOptions = {}): string => {
  const blocks = captions.map((caption, i) => {
    const body = applyCase(renderLines(caption, options.lines?.[i] ?? null), options.uppercase);
    return `${i + 1}\n${toSrtTime(caption.start)} --> ${toSrtTime(caption.end)}\n${body}`;
  });
  return blocks.join('\n\n') + '\n';
};

export const toVtt = (captions: Caption[], options: SubtitleExportOptions = {}): string => {
  const blocks = captions.map((caption, i) => {
    const body = applyCase(renderLines(caption, options.lines?.[i] ?? null), options.uppercase);
    return `${i + 1}\n${toVttTime(caption.start)} --> ${toVttTime(caption.end)}\n${body}`;
  });
  return 'WEBVTT\n\n' + blocks.join('\n\n') + '\n';
};

/** Convert "#RRGGBB" to ASS's &HAABBGGRR&. */
const toAssColour = (hex: string, alpha = 0): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '&H00FFFFFF';
  const r = m[1].slice(0, 2);
  const g = m[1].slice(2, 4);
  const b = m[1].slice(4, 6);
  return `&H${pad(alpha, 2)}${b}${g}${r}`.toUpperCase();
};

export const toAss = (
  captions: Caption[],
  style: CaptionStyle,
  position: CaptionPosition,
  frame: { width: number; height: number },
  options: SubtitleExportOptions = {},
): string => {
  // ASS alignment: 1-3 bottom, 4-6 middle, 7-9 top; 2/5/8 are centred
  const alignRow = position.y >= 66 ? 0 : position.y >= 33 ? 3 : 6;
  const alignCol = style.align === 'left' ? 1 : style.align === 'right' ? 3 : 2;
  const alignment = alignRow + alignCol;
  const marginV = Math.round((frame.height * Math.min(position.y, 100 - position.y)) / 100);

  // PlayRes below is the frame itself, so style units are output pixels already
  const metrics = captionMetrics({ style });

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${frame.width}`,
    `PlayResY: ${frame.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    [
      'Style: Default',
      metrics.fontFamily,
      Math.round(metrics.fontSize),
      toAssColour(style.color),
      toAssColour(style.activeWordColor),
      toAssColour(style.strokeColor),
      '&H80000000',
      style.fontWeight >= 700 ? -1 : 0,
      0,
      0,
      0,
      100,
      100,
      Math.round(metrics.letterSpacing),
      0,
      1,
      // CSS centres its text stroke, ASS draws the outline outward only
      metrics.strokeWidth > 0 ? Math.round(metrics.strokeWidth / 2) : 0,
      style.shadowEnabled ? 1 : 0,
      alignment,
      40,
      40,
      marginV,
      1,
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const events = captions.map((caption, i) => {
    const body = applyCase(renderLines(caption, options.lines?.[i] ?? null), options.uppercase)
      .split('\n')
      .join('\\N');
    return `Dialogue: 0,${toAssTime(caption.start)},${toAssTime(caption.end)},Default,,0,0,0,,${body}`;
  });

  return `${header}\n${events.join('\n')}\n`;
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

import { nanoid } from 'nanoid';
import { enrichWord } from '../transcription/scriptClassifier';
import type { CaptionWord } from '../types/project';

const SRT_TIME =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

const fromParts = (h: string, m: string, s: string, ms: string) =>
  Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;

export interface ParsedCue {
  start: number;
  end: number;
  text: string;
}

/**
 * Parses SRT or VTT. Tolerates BOMs, CRLF, missing indices, VTT cue
 * settings after the timestamp, and inline HTML formatting tags.
 */
export const parseSubtitles = (raw: string): ParsedCue[] => {
  const text = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^WEBVTT.*$/m, '');

  const lines = text.split('\n');
  const cues: ParsedCue[] = [];
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  let currentBody: string[] = [];

  const flush = () => {
    if (currentStart !== null && currentEnd !== null) {
      // Remove trailing index number if picked up before the next cue
      while (currentBody.length > 0 && /^\d+$/.test(currentBody[currentBody.length - 1].trim())) {
        currentBody.pop();
      }
      const rawBody = currentBody.join('\n').trim();
      const cleanBody = rawBody
        .replace(/<[^>]+>/g, '') // remove HTML tags like <i>, <b>, <font>
        .replace(/\{[^}]+\}/g, '') // remove ASS formatting tags
        .trim();
      if (cleanBody) {
        cues.push({
          start: currentStart,
          end: Math.max(currentEnd, currentStart + 0.01),
          text: cleanBody,
        });
      }
    }
    currentStart = null;
    currentEnd = null;
    currentBody = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = SRT_TIME.exec(line);
    if (m) {
      flush();
      currentStart = fromParts(m[1], m[2], m[3], m[4]);
      currentEnd = fromParts(m[5], m[6], m[7], m[8]);
    } else if (currentStart !== null) {
      currentBody.push(lines[i]);
    }
  }
  flush();

  return cues.sort((a, b) => a.start - b.start);
};

/**
 * Converts parsed SRT/VTT cues into rich Caption Maker captions.
 * Distributes time across words proportionally based on character length so that
 * all word-level template animations (wordScale, activeWordPunch, spotlight, etc.)
 * animate organically and smoothly.
 */
export const cuesToCaptions = (cues: ParsedCue[]): Caption[] => {
  return cues.map((cue) => {
    const cleanText = cue.text
      .replace(/<[^>]+>/g, '')
      .replace(/\{[^}]+\}/g, '')
      .trim();

    const tokens = cleanText.split(/\s+/).filter(Boolean);
    const span = Math.max(cue.end - cue.start, 0.05);
    const weights = tokens.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length + 2);
    const total = weights.reduce((a, b) => a + b, 0) || 1;

    let cursor = cue.start;
    const words: CaptionWord[] = tokens.map((t, i) => {
      const share = (weights[i] / total) * span;
      const start = cursor;
      const end = cursor + share;
      cursor = end;
      return enrichWord({
        text: t,
        start,
        end,
        emphasis: false,
      });
    });

    return {
      id: nanoid(),
      start: cue.start,
      end: cue.end,
      words,
      edited: false,
    };
  });
};
