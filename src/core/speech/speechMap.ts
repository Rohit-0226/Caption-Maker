/**
 * Where speech actually is in a recording, at 10 ms resolution.
 *
 * Every timing decision downstream leans on this. A caption should appear when
 * the speaker starts talking, not when a speech model guesses they did, and a
 * stretch of real speech with no words on it is speech that was lost.
 *
 * Energy-based with an adaptive threshold rather than a fixed dB gate. A fixed
 * -32 dB gate sits inside the noise floor of a loud phone recording and above
 * the speech of a quiet one; the floors measured on real projects here ranged
 * from -43 to -36 dB, which a single number cannot serve.
 */

export const FRAME_SECONDS = 0.01;
const WINDOW_SECONDS = 0.025;

export interface SpeechInterval {
  start: number;
  end: number;
}

export interface SpeechMap {
  frameSeconds: number;
  /** 1 where the frame holds speech */
  mask: Uint8Array;
  /** the mask as sorted, non-overlapping runs */
  intervals: SpeechInterval[];
  duration: number;
  /**
   * False when the recording has too little dynamic range to tell speech from
   * background — a music bed, constant crowd noise. The whole file then counts
   * as speech, so nothing is retimed or reported lost on a guess.
   */
  reliable: boolean;
  noiseFloorDb: number;
  speechLevelDb: number;
}

export interface SpeechMapOptions {
  /** silences shorter than this belong to the speech around them (stop consonants, breaths) */
  minSilenceSeconds?: number;
  /** speech bursts shorter than this are clicks, not words */
  minSpeechSeconds?: number;
  /** soft consonants start below the energy threshold; widen each onset by this much */
  onsetPadSeconds?: number;
  /** and decays trail off after it */
  releasePadSeconds?: number;
}

const DEFAULTS: Required<SpeechMapOptions> = {
  minSilenceSeconds: 0.12,
  minSpeechSeconds: 0.06,
  onsetPadSeconds: 0.03,
  releasePadSeconds: 0.05,
};

/** Below this the recording is effectively digital silence. */
const SILENT_LEVEL_DB = -60;
/** Less spread than this between quiet and loud frames and speech cannot be located. */
const MIN_DYNAMIC_RANGE_DB = 12;

/** Loudness of each 25 ms window, hopping 10 ms. */
export const frameEnergiesDb = (samples: Int16Array | Float32Array, sampleRate: number): Float32Array => {
  const scale = samples instanceof Int16Array ? 1 / 32768 : 1;
  const hop = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const win = Math.max(hop, Math.round(sampleRate * WINDOW_SECONDS));
  const count = samples.length === 0 ? 0 : Math.max(1, Math.floor((samples.length - win) / hop) + 1);
  const out = new Float32Array(count);

  for (let frame = 0; frame < count; frame++) {
    const from = frame * hop;
    const to = Math.min(samples.length, from + win);
    let sum = 0;
    for (let i = from; i < to; i++) {
      const value = samples[i] * scale;
      sum += value * value;
    }
    out[frame] = 10 * Math.log10(sum / Math.max(1, to - from) + 1e-10);
  }

  return out;
};

const percentile = (sorted: Float32Array, p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];

/** Flips runs of `value` shorter than `maxFrames`. Interior-only leaves the file edges alone. */
const suppressShortRuns = (mask: Uint8Array, value: 0 | 1, maxFrames: number, interiorOnly: boolean) => {
  let i = 0;
  while (i < mask.length) {
    if (mask[i] !== value) {
      i++;
      continue;
    }
    let j = i;
    while (j < mask.length && mask[j] === value) j++;
    const interior = i > 0 && j < mask.length;
    if (j - i < maxFrames && (!interiorOnly || interior)) mask.fill(value === 1 ? 0 : 1, i, j);
    i = j;
  }
};

/** Widens every speech run by `before` frames at its start and `after` at its end. */
const widenRuns = (mask: Uint8Array, before: number, after: number): Uint8Array => {
  const out = new Uint8Array(mask.length);
  let i = 0;
  while (i < mask.length) {
    if (!mask[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < mask.length && mask[j]) j++;
    out.fill(1, Math.max(0, i - before), Math.min(mask.length, j + after));
    i = j;
  }
  return out;
};

const toIntervals = (mask: Uint8Array, frameSeconds: number, duration: number): SpeechInterval[] => {
  const out: SpeechInterval[] = [];
  let i = 0;
  while (i < mask.length) {
    if (!mask[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < mask.length && mask[j]) j++;
    out.push({
      start: Math.round(i * frameSeconds * 1000) / 1000,
      end: Math.round(Math.min(duration, j * frameSeconds) * 1000) / 1000,
    });
    i = j;
  }
  return out;
};

export const buildSpeechMap = (
  samples: Int16Array | Float32Array,
  sampleRate: number,
  options: SpeechMapOptions = {},
): SpeechMap => {
  const settings = { ...DEFAULTS, ...options };
  const db = frameEnergiesDb(samples, sampleRate);
  const frames = db.length;
  const duration = sampleRate > 0 ? samples.length / sampleRate : 0;
  const framesFor = (seconds: number) => Math.max(0, Math.round(seconds / FRAME_SECONDS));

  const base = {
    frameSeconds: FRAME_SECONDS,
    duration,
  };

  if (frames === 0) {
    return { ...base, mask: new Uint8Array(0), intervals: [], reliable: false, noiseFloorDb: -100, speechLevelDb: -100 };
  }

  const sorted = Float32Array.from(db).sort();
  const floor = percentile(sorted, 0.1);
  const level = percentile(sorted, 0.95);

  if (level < SILENT_LEVEL_DB) {
    return { ...base, mask: new Uint8Array(frames), intervals: [], reliable: true, noiseFloorDb: floor, speechLevelDb: level };
  }

  if (level - floor < MIN_DYNAMIC_RANGE_DB) {
    const mask = new Uint8Array(frames).fill(1);
    return {
      ...base,
      mask,
      intervals: [{ start: 0, end: duration }],
      reliable: false,
      noiseFloorDb: floor,
      speechLevelDb: level,
    };
  }

  // Hysteresis: a frame must be clearly loud to start speech, but only
  // moderately loud to continue it, so a word that trails off stays whole.
  const range = level - floor;
  const enter = floor + Math.max(8, range * 0.35);
  const stay = floor + Math.max(5, range * 0.22);

  const raw = new Uint8Array(frames);
  let active = false;
  for (let k = 0; k < frames; k++) {
    active = active ? db[k] > stay : db[k] > enter;
    raw[k] = active ? 1 : 0;
  }

  suppressShortRuns(raw, 0, framesFor(settings.minSilenceSeconds), true);
  suppressShortRuns(raw, 1, framesFor(settings.minSpeechSeconds), false);
  const mask = widenRuns(raw, framesFor(settings.onsetPadSeconds), framesFor(settings.releasePadSeconds));

  return {
    ...base,
    mask,
    intervals: toIntervals(mask, FRAME_SECONDS, duration),
    reliable: true,
    noiseFloorDb: floor,
    speechLevelDb: level,
  };
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const frameIndex = (map: SpeechMap, seconds: number) => Math.floor(seconds / map.frameSeconds + 1e-9);

export const isSpeechAt = (map: SpeechMap, seconds: number): boolean => {
  const k = frameIndex(map, seconds);
  return k >= 0 && k < map.mask.length && map.mask[k] === 1;
};

const frameRange = (map: SpeechMap, start: number, end: number): [number, number] => [
  Math.max(0, frameIndex(map, start)),
  Math.min(map.mask.length, Math.ceil(end / map.frameSeconds - 1e-9)),
];

export const speechSecondsIn = (map: SpeechMap, start: number, end: number): number => {
  if (!(end > start)) return 0;
  const [from, to] = frameRange(map, start, end);
  let count = 0;
  for (let k = from; k < to; k++) count += map.mask[k];
  return count * map.frameSeconds;
};

export const speechFraction = (map: SpeechMap, start: number, end: number): number =>
  end > start ? Math.min(1, speechSecondsIn(map, start, end) / (end - start)) : 0;

/** When speech first appears in a window, or null if it never does. */
export const firstSpeechTime = (map: SpeechMap, start: number, end: number): number | null => {
  const [from, to] = frameRange(map, start, end);
  for (let k = from; k < to; k++) if (map.mask[k]) return Math.max(start, k * map.frameSeconds);
  return null;
};

/** When the last speech in a window stops, or null if there is none. */
export const lastSpeechEnd = (map: SpeechMap, start: number, end: number): number | null => {
  const [from, to] = frameRange(map, start, end);
  for (let k = to - 1; k >= from; k--) if (map.mask[k]) return Math.min(end, (k + 1) * map.frameSeconds);
  return null;
};

/** Index of the first interval that ends after `seconds`. */
const firstIntervalEndingAfter = (intervals: SpeechInterval[], seconds: number): number => {
  let lo = 0;
  let hi = intervals.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (intervals[mid].end <= seconds) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Speech inside a window, clipped to it. */
export const speechRangesIn = (map: SpeechMap, start: number, end: number): SpeechInterval[] => {
  const out: SpeechInterval[] = [];
  if (!(end > start)) return out;
  for (let i = firstIntervalEndingAfter(map.intervals, start); i < map.intervals.length; i++) {
    const interval = map.intervals[i];
    if (interval.start >= end) break;
    const clipped = { start: Math.max(start, interval.start), end: Math.min(end, interval.end) };
    if (clipped.end - clipped.start > 1e-6) out.push(clipped);
  }
  return out;
};

export const totalSpeechSeconds = (map: SpeechMap): number =>
  map.intervals.reduce((sum, interval) => sum + (interval.end - interval.start), 0);

/**
 * A speech map from known speech spans rather than audio — for tests, and for
 * callers that only have word timings to go on.
 */
export const speechMapFromIntervals = (intervals: SpeechInterval[], duration: number): SpeechMap => {
  const frames = Math.max(0, Math.ceil(duration / FRAME_SECONDS - 1e-9));
  const mask = new Uint8Array(frames);
  for (const interval of intervals) {
    mask.fill(
      1,
      Math.max(0, Math.round(interval.start / FRAME_SECONDS)),
      Math.min(frames, Math.round(interval.end / FRAME_SECONDS)),
    );
  }
  return {
    frameSeconds: FRAME_SECONDS,
    mask,
    intervals: toIntervals(mask, FRAME_SECONDS, duration),
    duration,
    reliable: true,
    noiseFloorDb: -60,
    speechLevelDb: -20,
  };
};
