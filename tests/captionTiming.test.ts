import { describe, expect, it } from 'vitest';
import { cuesToCaptions } from '../src/core/subtitles/formats';
import { captionFrameRange, removeCaptionGaps, restoreCaptionGaps, shiftCaptions } from '../src/core/subtitles/timing';

const captions = () => cuesToCaptions([
  { start: 1, end: 2, text: 'Hello world' },
  { start: 4, end: 5, text: 'Next caption' },
]);

describe('bulk caption timing', () => {
  it('restores original gaps after delaying the closed track', () => {
    const result = restoreCaptionGaps(shiftCaptions(removeCaptionGaps(captions()), 0.5));
    expect(result.map((c) => [c.start, c.end])).toEqual([[1.5, 2.5], [4.5, 5.5]]);
    expect(result.every((c) => c.gapRestoreEnd === undefined)).toBe(true);
  });

  it('never leaves a blank frame or overlap between touching captions', () => {
    for (const fps of [24, 30, 60]) {
      for (let end = 0.03; end < 2; end += 0.013) {
        const first = captionFrameRange({ start: 0.014, end }, fps);
        const next = captionFrameRange({ start: end, end: end + 1 }, fps);
        if (Math.round(end * fps) > first.from) {
          expect(first.from + first.durationInFrames).toBe(next.from);
        }
      }
    }
  });
  it('closes gaps without changing speech timing or the final caption', () => {
    const original = captions();
    const result = removeCaptionGaps(original);
    expect(result[0].end).toBe(4);
    expect(result[0].words).toEqual(original[0].words);
    expect(result[1]).toEqual(original[1]);
  });

  it('shifts imported captions and both word time representations uniformly', () => {
    const original = captions();
    const result = shiftCaptions(original, 0.5);
    expect(result.map((c) => [c.start, c.end])).toEqual([[1.5, 2.5], [4.5, 5.5]]);
    expect(result[0].words[0].start).toBe(1.5);
    expect(result[0].words[0].start_ms).toBe(1500);
    expect(original[0].start).toBe(1);
  });

  it('clamps the whole track at zero without crushing durations or spacing', () => {
    const result = shiftCaptions(captions(), -10);
    expect(result.map((c) => [c.start, c.end])).toEqual([[0, 1], [3, 4]]);
    const original = captions();
    expect(shiftCaptions(original, NaN)).toBe(original);
  });
});
