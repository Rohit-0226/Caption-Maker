import { describe, expect, it } from 'vitest';
import {
  parseSilencedetectOutput,
  analyzeSpeechCoverage,
  sanitizeWordTimestamps,
} from '../server/services/vad';

describe('VAD: parseSilencedetectOutput', () => {
  it('inverts one silence block into one speech interval at start', () => {
    const stderr = `
[silencedetect] silence_start: 5.0
[silencedetect] silence_end: 8.0 | silence_duration: 3.0
`;
    const result = parseSilencedetectOutput(stderr, 10);
    expect(result.length).toBe(2);
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(5);
    expect(result[1].start).toBe(8);
    expect(result[1].end).toBe(10);
  });

  it('inverts two silence blocks into three speech intervals', () => {
    const stderr = `
[silencedetect] silence_start: 3.5
[silencedetect] silence_end: 5.2 | silence_duration: 1.7
[silencedetect] silence_start: 10.0
[silencedetect] silence_end: 12.0 | silence_duration: 2.0
`;
    const result = parseSilencedetectOutput(stderr, 15);
    expect(result.length).toBe(3);
    expect(result[0]).toMatchObject({ start: 0, end: 3.5 });
    expect(result[1]).toMatchObject({ start: 5.2, end: 10 });
    expect(result[2]).toMatchObject({ start: 12, end: 15 });
  });

  it('handles no silence (entire file is speech)', () => {
    const result = parseSilencedetectOutput('', 10);
    expect(result.length).toBe(1);
    expect(result[0]).toMatchObject({ start: 0, end: 10, duration: 10 });
  });

  it('handles silence from start to end (total silence)', () => {
    const stderr = `
[silencedetect] silence_start: 0.0
[silencedetect] silence_end: 10.0 | silence_duration: 10.0
`;
    const result = parseSilencedetectOutput(stderr, 10);
    expect(result.length).toBe(0);
  });

  it('handles unclosed silence (silence reaches EOF)', () => {
    const stderr = `
[silencedetect] silence_start: 0
[silencedetect] silence_end: 5.0 | silence_duration: 5.0
[silencedetect] silence_start: 8.0
`;
    const result = parseSilencedetectOutput(stderr, 12);
    expect(result.length).toBe(1);
    expect(result[0]).toMatchObject({ start: 5.0, end: 8.0 });
  });
});

describe('VAD: analyzeSpeechCoverage', () => {
  it('detects missing gap when no Whisper words cover a speech interval', () => {
    const words = [
      { text: 'hello', start: 0.5, end: 1.0, confidence: null },
      { text: 'world', start: 1.1, end: 1.6, confidence: null },
      // gap from 1.6 to 6.0 — 4.4s with no Whisper words!
      { text: 'done', start: 6.0, end: 6.4, confidence: null },
    ];
    const speechIntervals = [
      { start: 0, end: 1.8, duration: 1.8 },
      { start: 2.0, end: 5.5, duration: 3.5 }, // Whisper missed this entire interval
      { start: 5.8, end: 6.5, duration: 0.7 },
    ];
    const report = analyzeSpeechCoverage(words, speechIntervals, 7, 1.0);
    expect(report.missingGaps.length).toBeGreaterThan(0);
    const gap = report.missingGaps.find((g) => g.start >= 2.0 && g.end <= 5.5);
    expect(gap).toBeDefined();
  });

  it('reports full coverage when words match speech intervals', () => {
    const words = [
      { text: 'one', start: 0.5, end: 0.9, confidence: null },
      { text: 'two', start: 1.0, end: 1.4, confidence: null },
      { text: 'three', start: 1.5, end: 2.0, confidence: null },
    ];
    const speechIntervals = [{ start: 0.3, end: 2.1, duration: 1.8 }];
    const report = analyzeSpeechCoverage(words, speechIntervals, 2.5, 1.0);
    expect(report.missingGaps.length).toBe(0);
  });

  it('returns coverageRatio between 0 and 1', () => {
    const words = [{ text: 'hi', start: 1.0, end: 1.3, confidence: null }];
    const intervals = [{ start: 0, end: 5, duration: 5 }];
    const report = analyzeSpeechCoverage(words, intervals, 5, 0.5);
    expect(report.coverageRatio).toBeGreaterThanOrEqual(0);
    expect(report.coverageRatio).toBeLessThanOrEqual(1);
  });
});

describe('VAD: sanitizeWordTimestamps', () => {
  it('enforces monotonic progression', () => {
    const words = [
      { text: 'a', start: 1.0, end: 1.5, confidence: null },
      { text: 'b', start: 0.5, end: 1.0, confidence: null }, // out-of-order
      { text: 'c', start: 2.0, end: 2.5, confidence: null },
    ];
    const result = sanitizeWordTimestamps(words);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].start).toBeGreaterThanOrEqual(result[i - 1].end);
    }
  });

  it('clamps tokens that span more than 2.5s', () => {
    const words = [
      { text: 'long', start: 0.0, end: 8.0, confidence: null }, // 8s — frozen caption bug
      { text: 'next', start: 8.1, end: 8.5, confidence: null },
    ];
    const result = sanitizeWordTimestamps(words, 2.5);
    expect(result[0].end - result[0].start).toBeLessThanOrEqual(2.5);
  });

  it('ensures end > start for every word', () => {
    const words = [
      { text: 'bad', start: 1.0, end: 0.9, confidence: null }, // end < start
      { text: 'also-bad', start: 1.5, end: 1.5, confidence: null }, // end = start
    ];
    const result = sanitizeWordTimestamps(words);
    for (const w of result) {
      expect(w.end).toBeGreaterThan(w.start);
    }
  });

  it('preserves correct timestamps unchanged', () => {
    const words = [
      { text: 'hello', start: 0.5, end: 0.9, confidence: null },
      { text: 'world', start: 1.0, end: 1.4, confidence: null },
    ];
    const result = sanitizeWordTimestamps(words);
    expect(result[0].start).toBe(0.5);
    expect(result[0].end).toBe(0.9);
    expect(result[1].start).toBe(1.0);
    expect(result[1].end).toBe(1.4);
  });
});
