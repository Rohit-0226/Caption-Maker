import { describe, expect, it } from 'vitest';
import { encodeWavPcm16, parseWavPcm16, sliceSeconds } from '../src/core/speech/pcm';
import { buildSpeechMap, speechMapFromIntervals, type SpeechMap } from '../src/core/speech/speechMap';
import {
  allocateTokens,
  buildPhrases,
  finaliseTimeline,
  findSpeechGaps,
  measureTimingQuality,
  refineWordTimings,
} from '../src/core/speech/timing';
import { planChunks } from '../src/core/speech/chunks';
import { repairWordTimings } from '../src/core/segmentation/segmenter';
import type { TranscriptWord } from '../src/core/types/project';

const RATE = 16000;

const word = (text: string, start: number, end: number): TranscriptWord => ({ text, start, end, confidence: null });

/** A voiced tone wherever there is speech, faint noise everywhere else. */
const synthesise = (
  duration: number,
  speech: Array<[number, number]>,
  { level = 8000, noise = 40, steady = false } = {},
): Int16Array => {
  const samples = new Int16Array(Math.round(duration * RATE));
  let seed = 7;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  for (let i = 0; i < samples.length; i++) {
    const t = i / RATE;
    const talking = speech.some(([from, to]) => t >= from && t < to);
    // real speech swells and fades syllable by syllable; `steady` is a flat drone
    const envelope = steady ? 1 : 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t);
    const voice = talking ? level * Math.sin(2 * Math.PI * 180 * t) * envelope : 0;
    samples[i] = Math.max(-32768, Math.min(32767, Math.round(voice + noise * random() * 2)));
  }
  return samples;
};

const expectNear = (actual: number, expected: number, tolerance: number) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

describe('PCM WAV', () => {
  it('round-trips samples exactly', () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
    const parsed = parseWavPcm16(encodeWavPcm16(samples, RATE));
    expect(parsed?.sampleRate).toBe(RATE);
    expect(Array.from(parsed!.samples)).toEqual(Array.from(samples));
  });

  it('downmixes stereo to mono', () => {
    const bytes = new Uint8Array(52);
    const view = new DataView(bytes.buffer);
    const tag = (offset: number, text: string) => {
      for (let i = 0; i < 4; i++) bytes[offset + i] = text.charCodeAt(i);
    };
    tag(0, 'RIFF');
    view.setUint32(4, 44, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, RATE, true);
    view.setUint32(28, RATE * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    tag(36, 'data');
    view.setUint32(40, 8, true);
    view.setInt16(44, 1000, true);
    view.setInt16(46, 3000, true);
    view.setInt16(48, -2000, true);
    view.setInt16(50, 0, true);

    expect(Array.from(parseWavPcm16(bytes)!.samples)).toEqual([2000, -1000]);
  });

  it('refuses audio that is not 16-bit PCM', () => {
    const bytes = encodeWavPcm16(new Int16Array(10), RATE);
    new DataView(bytes.buffer).setUint16(20, 3, true); // IEEE float
    expect(parseWavPcm16(bytes)).toBeNull();
  });

  it('slices by time to the exact sample', () => {
    const samples = Int16Array.from({ length: RATE }, (_, i) => i);
    const slice = sliceSeconds({ samples, sampleRate: RATE }, 0.5, 0.75);
    expect(slice.length).toBe(4000);
    expect(slice[0]).toBe(8000);
  });
});

describe('speech map', () => {
  it('finds each stretch of speech and the pause between them', () => {
    const map = buildSpeechMap(synthesise(4, [[1, 1.6], [2.4, 3]]), RATE);
    expect(map.reliable).toBe(true);
    expect(map.intervals).toHaveLength(2);
    expectNear(map.intervals[0].start, 1, 0.08);
    expectNear(map.intervals[0].end, 1.6, 0.1);
    expectNear(map.intervals[1].start, 2.4, 0.08);
    expectNear(map.intervals[1].end, 3, 0.1);
  });

  it("keeps a stop consonant's brief silence inside the word", () => {
    const map = buildSpeechMap(synthesise(3, [[0.5, 1], [1.08, 1.5]]), RATE);
    expect(map.intervals).toHaveLength(1);
  });

  it('ignores a click', () => {
    const map = buildSpeechMap(synthesise(3, [[0.2, 0.8], [2, 2.01]]), RATE);
    expect(map.intervals).toHaveLength(1);
  });

  it('reports digital silence as reliably silent', () => {
    const map = buildSpeechMap(new Int16Array(RATE * 2), RATE);
    expect(map.reliable).toBe(true);
    expect(map.intervals).toHaveLength(0);
  });

  it('declines to guess when nothing is quieter than anything else', () => {
    const map = buildSpeechMap(synthesise(3, [[0, 3]], { steady: true }), RATE);
    expect(map.reliable).toBe(false);
  });
});

describe('refining word timing against the audio', () => {
  it('delays a word that starts before the speaker does', () => {
    const map = speechMapFromIntervals([{ start: 1, end: 1.6 }], 3);
    const { words } = refineWordTimings([word('hello', 0.7, 1.3), word('there', 1.3, 1.6)], map);
    expect(words[0].start).toBe(1);
    expect(words[1].start).toBe(1.3);
  });

  it('ends a word when its sound ends, so the pause after it survives', () => {
    const map = speechMapFromIntervals([{ start: 1, end: 1.5 }, { start: 2, end: 2.5 }], 3);
    const stretched = [word('hello', 1, 1.9), word('world', 1.9, 2.5)];

    expect(measureTimingQuality(stretched, map).pausesRespected).toBe(0);

    const { words } = refineWordTimings(stretched, map);
    expect(words[0].end).toBeLessThanOrEqual(1.55);
    expect(words[1].start).toBeGreaterThanOrEqual(1.99);
    expect(measureTimingQuality(words, map).pausesRespected).toBe(1);
  });

  it('moves a word placed in silence onto the nearest speech', () => {
    const map = speechMapFromIntervals([{ start: 2, end: 2.6 }], 4);
    const { words, stats } = refineWordTimings([word('um', 1.2, 1.5)], map);
    expect(words[0].start).toBeGreaterThanOrEqual(2);
    expect(words[0].end).toBeLessThanOrEqual(2.6);
    expect(stats.relocated).toBe(1);
  });

  it('lays out again a run of words all pushed into the silence before a phrase', () => {
    const map = speechMapFromIntervals([{ start: 2, end: 3 }], 4);
    const { words } = refineWordTimings(
      [word('a', 1.2, 1.4), word('b', 1.4, 1.6), word('c', 1.6, 2.4), word('d', 2.4, 3)],
      map,
    );
    for (const w of words.slice(0, 3)) expect(w.start).toBeGreaterThanOrEqual(1.99);
    for (let i = 1; i < words.length; i++) expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].end);
  });

  it('leaves words in continuous speech alone', () => {
    const map = speechMapFromIntervals([{ start: 0.5, end: 3 }], 4);
    const input = [
      word('ek', 0.5, 1),
      word('do', 1, 1.5),
      word('teen', 1.5, 2),
      word('char', 2, 2.5),
      word('paanch', 2.5, 3),
    ];
    const { words } = refineWordTimings(input, map);
    words.forEach((w, i) => {
      expectNear(w.start, input[i].start, 0.001);
      expectNear(w.end, input[i].end, 0.001);
    });
  });

  it('changes nothing when the audio could not be read for pauses', () => {
    const unreliable: SpeechMap = { ...speechMapFromIntervals([{ start: 0, end: 3 }], 3), reliable: false };
    const input = [word('hello', 0.7, 1.3)];
    expect(refineWordTimings(input, unreliable).words).toEqual(input);
  });
});

describe('finaliseTimeline', () => {
  it('trims the earlier word instead of delaying the later one', () => {
    const [first, second] = finaliseTimeline([word('x', 1, 2), word('y', 1.5, 2.2)]);
    expect(first.end).toBe(1.5);
    expect(second.start).toBe(1.5);
  });
});

describe('allocateTokens', () => {
  it('skips silence inside the span', () => {
    const placed = allocateTokens(['ba', 'ba', 'ba', 'ba'], { start: 0, end: 3 }, [
      { start: 0, end: 1 },
      { start: 2, end: 3 },
    ]);
    expect(placed.map((w) => [w.start, w.end])).toEqual([
      [0, 0.5],
      [0.5, 1],
      [2, 2.5],
      [2.5, 3],
    ]);
  });
});

describe('findSpeechGaps', () => {
  it('reports speech that no word covers', () => {
    const map = speechMapFromIntervals([{ start: 0, end: 1 }, { start: 2, end: 3 }], 3);
    const gaps = findSpeechGaps([word('a', 0.1, 0.9)], map);
    expect(gaps).toHaveLength(1);
    expectNear(gaps[0].start, 2, 0.01);
    expectNear(gaps[0].speechSeconds, 1, 0.01);
  });
});

describe('buildPhrases', () => {
  it('breaks at sentence ends and at pauses', () => {
    const phrases = buildPhrases([
      word('a', 0, 0.3),
      word('b', 0.3, 0.6),
      word('c.', 0.6, 0.9),
      word('d', 0.95, 1.2),
      word('e', 1.6, 1.9),
    ]);
    expect(phrases.map((p) => [p.from, p.to])).toEqual([
      [0, 3],
      [3, 4],
      [4, 5],
    ]);
  });
});

describe('planChunks', () => {
  it('cuts long audio in the pauses nearest each limit', () => {
    const map = speechMapFromIntervals(
      [
        { start: 0, end: 85 },
        { start: 86, end: 170 },
        { start: 171, end: 200 },
      ],
      200,
    );
    const chunks = planChunks(map, 90);
    expect(chunks).toHaveLength(3);
    expectNear(chunks[0].end, 85.5, 0.01);
    expectNear(chunks[1].end, 170.5, 0.01);
    expect(chunks[2].end).toBe(200);
  });
});

describe('repairWordTimings', () => {
  it('trims an overlapping word instead of pushing the next one late', () => {
    const [first, second] = repairWordTimings([word('a', 1, 2), word('b', 1.5, 2.2)]);
    expect(first.end).toBe(1.5);
    expect(second.start).toBe(1.5);
  });
});
