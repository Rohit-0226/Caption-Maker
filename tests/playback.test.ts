import { describe, expect, it, beforeEach } from 'vitest';
import {
  activeWordIndex,
  captionAt,
  playbackClock,
} from '../src/app/playbackClock';
import type { Caption } from '../src/core/types/project';

const caption = (id: string, start: number, end: number, words: string[]): Caption => {
  const per = (end - start) / Math.max(1, words.length);
  return {
    id,
    start,
    end,
    edited: false,
    words: words.map((text, i) => ({
      text,
      start: start + i * per,
      end: start + (i + 1) * per,
      emphasis: false,
    })),
  };
};

const captions: Caption[] = [
  caption('a', 0, 1, ['one', 'two']),
  caption('b', 1, 2, ['three', 'four']),
  caption('c', 2, 3.5, ['five', 'six']),
  caption('d', 5, 6, ['seven']),
];

describe('finding the caption under the playhead', () => {
  it('finds the caption covering a time', () => {
    expect(captionAt(captions, 0.5)?.id).toBe('a');
    expect(captionAt(captions, 1.5)?.id).toBe('b');
    expect(captionAt(captions, 3.4)?.id).toBe('c');
    expect(captionAt(captions, 5.5)?.id).toBe('d');
  });

  it('treats the start as inside and the end as outside', () => {
    expect(captionAt(captions, 1)?.id).toBe('b');
    // 2 belongs to c, not b
    expect(captionAt(captions, 2)?.id).toBe('c');
  });

  it('returns nothing in a gap or outside the range', () => {
    expect(captionAt(captions, 4)).toBeNull();
    expect(captionAt(captions, -1)).toBeNull();
    expect(captionAt(captions, 99)).toBeNull();
  });

  it('handles an empty list', () => {
    expect(captionAt([], 1)).toBeNull();
  });

  it('agrees with a linear scan across the whole timeline', () => {
    for (let t = -0.5; t < 7; t += 0.05) {
      const linear = captions.find((c) => t >= c.start && t < c.end) ?? null;
      expect(captionAt(captions, t)?.id ?? null).toBe(linear?.id ?? null);
    }
  });
});

describe('finding the spoken word', () => {
  it('tracks the word across a caption', () => {
    const c = captions[0];
    expect(activeWordIndex(c, 0.1)).toBe(0);
    expect(activeWordIndex(c, 0.6)).toBe(1);
  });

  it('returns -1 outside the caption or with no caption', () => {
    expect(activeWordIndex(captions[0], 9)).toBe(-1);
    expect(activeWordIndex(null, 1)).toBe(-1);
  });
});

describe('the clock stays out of React state', () => {
  beforeEach(() => playbackClock.reset());

  it('notifies subscribers when the time moves', () => {
    let calls = 0;
    const stop = playbackClock.subscribe(() => calls++);

    playbackClock.setTime(1);
    playbackClock.setTime(2);
    expect(calls).toBe(2);

    stop();
    playbackClock.setTime(3);
    expect(calls, 'should not fire after unsubscribe').toBe(2);
  });

  it('does not notify when the time has not actually changed', () => {
    playbackClock.setTime(1);
    let calls = 0;
    const stop = playbackClock.subscribe(() => calls++);

    playbackClock.setTime(1);
    expect(calls).toBe(0);

    stop();
  });

  it('tracks play state separately', () => {
    playbackClock.setPlaying(true);
    expect(playbackClock.isPlaying()).toBe(true);
    playbackClock.reset();
    expect(playbackClock.isPlaying()).toBe(false);
    expect(playbackClock.getTime()).toBe(0);
  });
});
