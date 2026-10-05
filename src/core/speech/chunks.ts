import type { SpeechInterval, SpeechMap } from './speechMap';

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Splits a recording into parts no longer than `maxSeconds`, cutting in the
 * longest pause near each limit so no word is split between two parts.
 *
 * Every engine gets the same parts, which is what lets their transcripts be
 * compared part by part instead of across the whole file.
 */
export const planChunks = (map: SpeechMap, maxSeconds = 90, searchSeconds = 20): SpeechInterval[] => {
  const chunks: SpeechInterval[] = [];
  const duration = map.duration;
  if (!(duration > 0)) return chunks;

  let start = 0;
  while (duration - start > maxSeconds) {
    const limit = start + maxSeconds;
    const from = Math.max(start + maxSeconds / 2, limit - searchSeconds);
    let cut = limit;
    let longest = -1;

    for (let i = 1; i < map.intervals.length; i++) {
      const pauseStart = map.intervals[i - 1].end;
      const pauseEnd = map.intervals[i].start;
      const middle = (pauseStart + pauseEnd) / 2;
      if (middle <= from || middle >= limit) continue;
      if (pauseEnd - pauseStart > longest) {
        longest = pauseEnd - pauseStart;
        cut = middle;
      }
    }

    chunks.push({ start: round3(start), end: round3(cut) });
    start = cut;
  }

  chunks.push({ start: round3(start), end: duration });
  return chunks;
};
