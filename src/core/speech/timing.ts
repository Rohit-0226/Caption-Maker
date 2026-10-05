import type { TranscriptWord } from '../types/project';
import {
  isSpeechAt,
  speechRangesIn,
  speechSecondsIn,
  totalSpeechSeconds,
  type SpeechInterval,
  type SpeechMap,
} from './speechMap';

/**
 * Word timing, measured against the audio rather than trusted from a model.
 *
 * Whisper's word timestamps come from attention, not from listening for
 * onsets. Measured on this project's own videos, they place a word boundary
 * inside a real pause almost never — 0 of 23 pauses on one Hinglish clip — and
 * start up to a third of words while nobody is talking. Captions then change
 * while the speaker is silent and sit still while they talk. Everything here
 * moves boundaries to where the sound actually is, and nowhere else.
 */

const MIN_WORD_SECONDS = 0.06;
/** how far a start may move earlier to meet an audible onset */
const ONSET_LOOKBACK_SECONDS = 0.15;
/** a word keeps a sliver of tail after its sound stops */
const RELEASE_SECONDS = 0.02;
/** a silence this long inside one word means the word spans two sounds */
const SPLIT_SILENCE_SECONDS = 0.2;
/** how far a word placed in silence may travel to find its speech */
const RELOCATE_REACH_SECONDS = 1.0;
/** a single token longer than this froze a caption; it is never real */
const MAX_WORD_SECONDS = 2.5;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

const finite = (word: TranscriptWord) => Number.isFinite(word.start) && Number.isFinite(word.end);

export interface RetimeStats {
  startsMoved: number;
  endsTrimmed: number;
  relocated: number;
  runsRealigned: number;
}

/**
 * Makes timestamps run forwards and removes overlaps by trimming the earlier
 * word, never by delaying the later one — the moment a word starts is what a
 * viewer notices.
 *
 * The array order is the spoken order and is never changed. Whisper sometimes
 * stamps a word earlier than the one before it ("afloat. I" came back with
 * "I" 0.16 s before "afloat."); sorting by time would then rewrite the
 * sentence. A backwards timestamp is the model's mistake, so the word is moved
 * to follow its predecessor instead.
 */
export const finaliseTimeline = (input: TranscriptWord[]): TranscriptWord[] => {
  const words = input.filter(finite).map((word) => ({ ...word }));

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    word.start = Math.max(0, word.start);
    const prev = words[i - 1];
    if (prev && word.start < prev.end) {
      if (word.start - prev.start >= MIN_WORD_SECONDS) prev.end = round3(word.start);
      else word.start = prev.end;
    }
    if (word.end < word.start + MIN_WORD_SECONDS) word.end = word.start + MIN_WORD_SECONDS;
    if (word.end - word.start > MAX_WORD_SECONDS) word.end = word.start + MAX_WORD_SECONDS;
    word.start = round3(word.start);
    word.end = round3(word.end);
  }

  return words;
};

/**
 * Adds words recovered from elsewhere into a timeline at their times, without
 * reordering the words already there.
 */
export const mergeByTime = (base: TranscriptWord[], additions: TranscriptWord[]): TranscriptWord[] => {
  const extra = additions.filter(finite).slice().sort((a, b) => a.start - b.start);
  const out: TranscriptWord[] = [];
  let k = 0;
  for (const word of base) {
    while (k < extra.length && extra[k].start < word.start) out.push(extra[k++]);
    out.push(word);
  }
  while (k < extra.length) out.push(extra[k++]);
  return finaliseTimeline(out);
};

/** Rough spoken length of a token, so allocation gives "identify" more time than "a". */
export const spokenWeight = (token: string): number => {
  const core = token.replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  if (!core) return 0.5;
  if (/[ऀ-ॿ]/u.test(core)) return Math.max(1, Math.ceil(Array.from(core).length / 2.5));
  // "2026" is said as several syllables
  if (/^\d+$/.test(core)) return Math.max(1, core.length);
  const groups = core.toLowerCase().match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : Math.ceil(core.length / 3));
};

const totalSeconds = (ranges: SpeechInterval[]) => ranges.reduce((sum, r) => sum + (r.end - r.start), 0);

/**
 * Places tokens with no timing of their own across the speech inside a span,
 * in proportion to how long each is to say. Silences inside the span are
 * skipped, so no token lands in a pause.
 *
 * `speech` is usually the speech map clipped to the span. Without audio, the
 * source words' own spans serve the same purpose.
 */
export const allocateTokens = (
  tokens: string[],
  span: SpeechInterval,
  speech: SpeechInterval[],
): TranscriptWord[] => {
  const texts = tokens.map((token) => token.trim()).filter(Boolean);
  if (texts.length === 0 || !(span.end > span.start)) {
    return texts.map((text) => ({ text, start: round3(span.start), end: round3(span.start + MIN_WORD_SECONDS), confidence: null }));
  }

  const clipped = speech
    .map((range) => ({ start: Math.max(range.start, span.start), end: Math.min(range.end, span.end) }))
    .filter((range) => range.end - range.start > 0.01)
    .sort((a, b) => a.start - b.start);

  // Too little speech to hold the tokens means the map missed quiet speech;
  // spreading across the whole span is the honest fallback.
  const enough = totalSeconds(clipped) >= Math.min(texts.length * 0.05, (span.end - span.start) * 0.3);
  const ranges = clipped.length > 0 && enough ? clipped : [{ start: span.start, end: span.end }];

  const available = totalSeconds(ranges);
  const weights = texts.map(spokenWeight);
  const weightTotal = weights.reduce((sum, w) => sum + w, 0);

  /** Maps a position along the concatenated speech back to a clock time. */
  const toClock = (position: number): number => {
    let consumed = 0;
    for (const range of ranges) {
      const length = range.end - range.start;
      if (position <= consumed + length) return range.start + (position - consumed);
      consumed += length;
    }
    return ranges[ranges.length - 1].end;
  };

  let cursor = 0;
  return texts.map((text, i) => {
    const share = (available * weights[i]) / weightTotal;
    // nudge past a range boundary so a token begins in the next range, not at the end of the last
    const start = toClock(Math.min(available, cursor + 1e-6));
    cursor += share;
    const end = Math.max(start + MIN_WORD_SECONDS, toClock(cursor));
    return { text, start: round3(start), end: round3(end), confidence: null };
  });
};

/** Speech inside a span, joined across silences shorter than `bridge`. */
const speechSegments = (map: SpeechMap, start: number, end: number, bridge: number): SpeechInterval[] => {
  const out: SpeechInterval[] = [];
  for (const range of speechRangesIn(map, start, end)) {
    const last = out[out.length - 1];
    if (last && range.start - last.end < bridge) last.end = range.end;
    else out.push({ ...range });
  }
  return out;
};

const startsInSilence = (map: SpeechMap, word: TranscriptWord) =>
  speechSecondsIn(map, word.start, Math.min(word.end, word.start + 0.06)) === 0;

/**
 * Whisper often packs the first few words of a phrase into the silence before
 * it, then crams the rest. When several consecutive words all start in silence,
 * their order is right but their positions are not: lay them out again across
 * the speech that follows.
 */
const realignDisplacedRuns = (words: TranscriptWord[], map: SpeechMap, stats: RetimeStats) => {
  let i = 0;
  while (i < words.length) {
    if (!startsInSilence(map, words[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < words.length && startsInSilence(map, words[j + 1])) j++;

    if (j > i) {
      const next = words[j + 1];
      const floor = i > 0 ? words[i - 1].end : 0;
      const spanStart = Math.max(floor, words[i].start);
      const naturalEnd = words[j].end + 0.6;
      const spanEnd = next ? Math.max(words[j].end, Math.min(next.start, naturalEnd)) : Math.min(map.duration, naturalEnd);
      const speech = speechRangesIn(map, spanStart, spanEnd);

      if (totalSeconds(speech) >= (j - i + 1) * MIN_WORD_SECONDS) {
        const placed = allocateTokens(
          words.slice(i, j + 1).map((w) => w.text),
          { start: spanStart, end: spanEnd },
          speech,
        );
        for (let k = i; k <= j; k++) {
          words[k].start = placed[k - i].start;
          words[k].end = placed[k - i].end;
        }
        stats.runsRealigned++;
      }
    }
    i = j + 1;
  }
};

const distanceTo = (range: SpeechInterval, point: number) =>
  point < range.start ? range.start - point : point > range.end ? point - range.end : 0;

export const refineWordTimings = (
  input: TranscriptWord[],
  map: SpeechMap,
): { words: TranscriptWord[]; stats: RetimeStats } => {
  const stats: RetimeStats = { startsMoved: 0, endsTrimmed: 0, relocated: 0, runsRealigned: 0 };
  // spoken order is kept; backwards timestamps are repaired first (see finaliseTimeline)
  const words = finaliseTimeline(input);

  if (!map.reliable || words.length === 0) return { words, stats };

  realignDisplacedRuns(words, map, stats);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const prev = words[i - 1];
    const next = words[i + 1];
    const floor = prev ? prev.end : 0;
    let start = Math.max(0, word.start);
    let end = Math.max(word.end, start + MIN_WORD_SECONDS);

    const segments = speechSegments(map, start, end, SPLIT_SILENCE_SECONDS);

    if (segments.length === 0) {
      // Placed where nobody is talking: move to the nearest speech it may occupy.
      const reachStart = Math.max(floor, start - RELOCATE_REACH_SECONDS);
      const ceiling = next ? Math.max(next.start, end) : map.duration;
      const reachEnd = Math.min(ceiling, end + RELOCATE_REACH_SECONDS);
      const nearby = speechRangesIn(map, reachStart, reachEnd);
      if (nearby.length > 0) {
        const centre = (start + end) / 2;
        const target = nearby.reduce((best, range) =>
          distanceTo(range, centre) < distanceTo(best, centre) ? range : best,
        );
        const length = Math.min(end - start, target.end - target.start);
        if (target.start >= centre) {
          start = target.start;
          end = start + length;
        } else {
          end = target.end;
          start = end - length;
        }
        stats.relocated++;
      }
    } else {
      // When a pause splits the span, the word is the larger sound; the other belongs to a neighbour.
      let main = segments[0];
      for (const segment of segments) if (segment.end - segment.start > main.end - main.start) main = segment;
      const mainIndex = segments.indexOf(main);

      if (main.start > start + 0.005) {
        start = main.start;
        stats.startsMoved++;
      } else if (isSpeechAt(map, start)) {
        // Already inside speech; the audible onset may sit a little earlier.
        const limit = Math.max(floor, start - ONSET_LOOKBACK_SECONDS);
        let onset = start;
        while (onset - map.frameSeconds >= limit - 1e-9 && isSpeechAt(map, onset - map.frameSeconds)) {
          onset -= map.frameSeconds;
        }
        const reachedSilence = !isSpeechAt(map, onset - map.frameSeconds);
        if (reachedSilence && onset < start - 0.005) {
          start = onset;
          stats.startsMoved++;
        }
      }

      if (mainIndex < segments.length - 1 || main.end < end - 0.005) {
        const trimmed = Math.max(start + MIN_WORD_SECONDS, Math.min(end, main.end + RELEASE_SECONDS));
        if (trimmed < end - 0.005) {
          end = trimmed;
          stats.endsTrimmed++;
        }
      }
    }

    if (prev && start < prev.end) {
      if (start - prev.start >= MIN_WORD_SECONDS) prev.end = round3(start);
      else start = prev.end;
    }
    if (end < start + MIN_WORD_SECONDS) end = start + MIN_WORD_SECONDS;

    word.start = round3(start);
    word.end = round3(end);
  }

  return { words: finaliseTimeline(words), stats };
};

// ---------------------------------------------------------------------------
// Coverage — speech with no words on it
// ---------------------------------------------------------------------------

export interface SpeechGap {
  start: number;
  end: number;
  /** seconds of actual speech inside the gap, which can be less than its length */
  speechSeconds: number;
}

export interface GapOptions {
  /** a word covers this much audio either side of itself */
  padSeconds?: number;
  /** gaps separated by less than this merge into one */
  mergeWithinSeconds?: number;
  /** gaps holding less speech than this are ignored */
  minSpeechSeconds?: number;
}

export const findSpeechGaps = (
  words: TranscriptWord[],
  map: SpeechMap,
  { padSeconds = 0.15, mergeWithinSeconds = 0.3, minSpeechSeconds = 0.35 }: GapOptions = {},
): SpeechGap[] => {
  if (!map.reliable || map.mask.length === 0) return [];

  const covered = new Uint8Array(map.mask.length);
  const toFrame = (seconds: number) => Math.min(map.mask.length, Math.max(0, Math.round(seconds / map.frameSeconds)));
  for (const word of words) {
    if (!finite(word)) continue;
    covered.fill(1, toFrame(word.start - padSeconds), toFrame(word.end + padSeconds));
  }

  const raw: SpeechInterval[] = [];
  let k = 0;
  while (k < map.mask.length) {
    if (!(map.mask[k] && !covered[k])) {
      k++;
      continue;
    }
    let j = k;
    while (j < map.mask.length && map.mask[j] && !covered[j]) j++;
    raw.push({ start: k * map.frameSeconds, end: j * map.frameSeconds });
    k = j;
  }

  const merged: SpeechInterval[] = [];
  for (const range of raw) {
    const last = merged[merged.length - 1];
    if (last && range.start - last.end < mergeWithinSeconds) last.end = range.end;
    else merged.push({ ...range });
  }

  return merged
    .map((range) => ({
      start: round3(range.start),
      end: round3(Math.min(map.duration, range.end)),
      speechSeconds: round3(speechSecondsIn(map, range.start, range.end)),
    }))
    .filter((gap) => gap.speechSeconds >= minSpeechSeconds);
};

// ---------------------------------------------------------------------------
// Phrases — runs of words the speaker said without pausing
// ---------------------------------------------------------------------------

export interface Phrase {
  /** index of the first word */
  from: number;
  /** index one past the last word */
  to: number;
  start: number;
  end: number;
}

const SENTENCE_END = /[.!?।]["')\]]?$/u;

export const buildPhrases = (
  words: TranscriptWord[],
  { pauseSeconds = 0.25, maxWords = 12, maxSeconds = 5 } = {},
): Phrase[] => {
  const phrases: Phrase[] = [];
  let from = 0;

  for (let i = 1; i <= words.length; i++) {
    const current = words[i];
    const previous = words[i - 1];
    const breakHere =
      !current ||
      current.start - previous.end >= pauseSeconds ||
      SENTENCE_END.test(previous.text.trim()) ||
      i - from >= maxWords ||
      current.end - words[from].start > maxSeconds;

    if (breakHere) {
      phrases.push({ from, to: i, start: words[from].start, end: previous.end });
      from = i;
    }
  }

  return phrases;
};

// ---------------------------------------------------------------------------
// Measurement — the same numbers the sync audit reports
// ---------------------------------------------------------------------------

export interface TimingQuality {
  /** share of real pauses (>= 300 ms) that fall between two words; null when there are none */
  pausesRespected: number | null;
  pauseCount: number;
  /** words whose first 80 ms contain no speech */
  startsInSilence: number;
  speechSeconds: number;
  /** speech with no word within 200 ms of it */
  uncoveredSpeechSeconds: number;
  /** 0..1 */
  coverage: number;
  reliable: boolean;
}

export const measureTimingQuality = (input: TranscriptWord[], map: SpeechMap): TimingQuality => {
  const words = input.filter(finite).slice().sort((a, b) => a.start - b.start);
  const speechSeconds = totalSpeechSeconds(map);

  if (!map.reliable) {
    return { pausesRespected: null, pauseCount: 0, startsInSilence: 0, speechSeconds, uncoveredSpeechSeconds: 0, coverage: 1, reliable: false };
  }

  const pauses: SpeechInterval[] = [];
  for (let i = 1; i < map.intervals.length; i++) {
    const gap = { start: map.intervals[i - 1].end, end: map.intervals[i].start };
    if (gap.end - gap.start >= 0.3) pauses.push(gap);
  }

  let respected = 0;
  let w = 0;
  for (const pause of pauses) {
    while (w < words.length - 1 && words[w + 1].start < pause.end - 0.12) w++;
    // look at the boundaries near this pause
    for (let b = Math.max(0, w - 2); b < Math.min(words.length - 1, w + 2); b++) {
      if (words[b].end <= pause.start + 0.12 && words[b + 1].start >= pause.end - 0.12) {
        respected++;
        break;
      }
    }
  }

  const silentStarts = words.filter((word) => speechSecondsIn(map, word.start, word.start + 0.08) === 0).length;
  const uncovered = findSpeechGaps(words, map, { padSeconds: 0.2, mergeWithinSeconds: 0, minSpeechSeconds: 0 })
    .reduce((sum, gap) => sum + gap.speechSeconds, 0);

  return {
    pausesRespected: pauses.length > 0 ? respected / pauses.length : null,
    pauseCount: pauses.length,
    startsInSilence: silentStarts,
    speechSeconds: round3(speechSeconds),
    uncoveredSpeechSeconds: round3(uncovered),
    coverage: speechSeconds > 0 ? Math.max(0, Math.min(1, 1 - uncovered / speechSeconds)) : 1,
    reliable: true,
  };
};
