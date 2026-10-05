import { describe, expect, it } from 'vitest';
import {
  parseSubtitles,
  toAss,
  toAssTime,
  toSrt,
  toSrtTime,
  toVtt,
  toVttTime,
  validateCaptions,
} from '../src/core/subtitles/formats';
import { defaultPosition, defaultStyle } from '../src/core/project/defaults';
import type { Caption } from '../src/core/types/project';

const caption = (id: string, start: number, end: number, text: string): Caption => {
  const tokens = text.split(/\s+/).filter(Boolean);
  const span = (end - start) / Math.max(tokens.length, 1);
  return {
    id,
    start,
    end,
    edited: false,
    words: tokens.map((t, i) => ({
      text: t,
      start: start + i * span,
      end: start + (i + 1) * span,
      emphasis: false,
    })),
  };
};

describe('timecode formatting', () => {
  it('formats SRT timestamps', () => {
    expect(toSrtTime(0)).toBe('00:00:00,000');
    expect(toSrtTime(1.5)).toBe('00:00:01,500');
    expect(toSrtTime(61.25)).toBe('00:01:01,250');
    expect(toSrtTime(3725.125)).toBe('01:02:05,125');
  });

  it('formats VTT timestamps with a dot', () => {
    expect(toVttTime(61.25)).toBe('00:01:01.250');
  });

  it('formats ASS timestamps in centiseconds', () => {
    expect(toAssTime(61.25)).toBe('0:01:01.25');
  });

  it('carries milliseconds that round up to a full second', () => {
    expect(toSrtTime(1.9999)).toBe('00:00:02,000');
  });

  it('clamps negative times to zero', () => {
    expect(toSrtTime(-5)).toBe('00:00:00,000');
  });
});

describe('SRT export', () => {
  it('numbers cues from one and separates them with a blank line', () => {
    const output = toSrt([
      caption('a', 0, 1, 'hello there'),
      caption('b', 1, 2, 'second line'),
    ]);

    expect(output).toBe(
      '1\n00:00:00,000 --> 00:00:01,000\nhello there\n\n' +
        '2\n00:00:01,000 --> 00:00:02,000\nsecond line\n',
    );
  });

  it('applies uppercase when the style asks for it', () => {
    const output = toSrt([caption('a', 0, 1, 'hello there')], { uppercase: true });
    expect(output).toContain('HELLO THERE');
  });

  it('preserves Hinglish and Devanagari exactly', () => {
    const text = 'Aapne fully furnished ka system chalu kiya';
    const output = toSrt([caption('a', 0, 2, text)]);
    expect(output).toContain(text);

    const devanagari = 'नमस्ते दोस्तों';
    expect(toSrt([caption('b', 0, 2, devanagari)])).toContain(devanagari);
  });

  it('round-trips through the parser', () => {
    const captions = [
      caption('a', 0.07, 1.172, 'Aapne mere hisab se'),
      caption('b', 1.172, 2.054, 'pahle vyakti ne'),
    ];

    const parsed = parseSubtitles(toSrt(captions));

    expect(parsed).toHaveLength(2);
    expect(parsed[0].text).toBe('Aapne mere hisab se');
    expect(parsed[0].start).toBeCloseTo(0.07, 3);
    expect(parsed[1].end).toBeCloseTo(2.054, 3);
  });
});

describe('VTT export', () => {
  it('starts with the WEBVTT header', () => {
    expect(toVtt([caption('a', 0, 1, 'hi')]).startsWith('WEBVTT\n\n')).toBe(true);
  });
});

describe('ASS export', () => {
  it('includes the script header, a style and one dialogue line per caption', () => {
    const output = toAss(
      [caption('a', 0, 1, 'hello'), caption('b', 1, 2, 'world')],
      defaultStyle,
      defaultPosition,
      { width: 1080, height: 1920 },
    );

    expect(output).toContain('[Script Info]');
    expect(output).toContain('PlayResX: 1080');
    expect(output).toContain('Style: Default');
    expect(output.match(/^Dialogue:/gm)).toHaveLength(2);
  });
});

describe('subtitle parsing', () => {
  it('accepts CRLF, a BOM and a missing trailing newline', () => {
    const raw = '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nhello';
    const parsed = parseSubtitles(raw);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe('hello');
  });

  it('reads VTT with a dot separator', () => {
    const parsed = parseSubtitles('WEBVTT\n\n1\n00:00:01.500 --> 00:00:02.500\nhi there');
    expect(parsed[0].start).toBeCloseTo(1.5, 3);
  });

  it('keeps multi-line cue text', () => {
    const parsed = parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\nline one\nline two');
    expect(parsed[0].text).toBe('line one\nline two');
  });

  it('skips blocks with no timestamp', () => {
    expect(parseSubtitles('just some prose\n\nmore prose')).toEqual([]);
  });

  it('sorts cues by start time', () => {
    const raw =
      '1\n00:00:05,000 --> 00:00:06,000\nsecond\n\n2\n00:00:01,000 --> 00:00:02,000\nfirst';
    expect(parseSubtitles(raw).map((c) => c.text)).toEqual(['first', 'second']);
  });
});

describe('validation', () => {
  it('passes clean captions', () => {
    expect(
      validateCaptions([caption('a', 0, 1, 'one'), caption('b', 1, 2, 'two')]),
    ).toEqual([]);
  });

  it('reports a caption that ends before it starts', () => {
    const bad = { ...caption('a', 2, 1, 'oops'), start: 2, end: 1 };
    const issues = validateCaptions([bad]);
    expect(issues.some((i) => i.message.includes('Ends before'))).toBe(true);
  });

  it('reports overlapping captions', () => {
    const issues = validateCaptions([
      caption('a', 0, 2, 'one'),
      caption('b', 1, 3, 'two'),
    ]);
    expect(issues.some((i) => i.message.includes('Overlaps'))).toBe(true);
  });

  it('reports an empty caption', () => {
    const empty: Caption = { id: 'a', start: 0, end: 1, words: [], edited: false };
    expect(validateCaptions([empty]).some((i) => i.message.includes('no text'))).toBe(true);
  });

  it('reports a negative start', () => {
    const issues = validateCaptions([caption('a', -1, 1, 'oops')]);
    expect(issues.some((i) => i.message.includes('before zero'))).toBe(true);
  });
});
