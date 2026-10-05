import type { Caption } from '../types/project';

/** Quantize both boundaries on the same clock, avoiding one-frame flashes. */
export const captionFrameRange = (caption: Pick<Caption, 'start' | 'end'>, fps: number) => {
  const from = Math.round(caption.start * fps);
  return { from, durationInFrames: Math.max(1, Math.round(caption.end * fps) - from) };
};

/** Hold each caption until the next begins, without shifting spoken words. */
export const removeCaptionGaps = (captions: Caption[]): Caption[] => {
  const ordered = [...captions].sort((a, b) => a.start - b.start);
  return ordered.map((caption, index) => {
    const next = ordered[index + 1];
    return next && caption.end < next.start
      ? { ...caption, gapRestoreEnd: caption.gapRestoreEnd ?? caption.end, end: next.start, edited: true }
      : caption;
  });
};

export const restoreCaptionGaps = (captions: Caption[]): Caption[] => captions.map((caption) => {
  if (caption.gapRestoreEnd === undefined) return caption;
  const { gapRestoreEnd, ...rest } = caption;
  return { ...rest, end: Math.max(caption.start + 0.001, Math.min(caption.end, gapRestoreEnd)), edited: true };
});

/** Shift the entire track uniformly; never clip words at time zero. */
export const shiftCaptions = (captions: Caption[], seconds: number): Caption[] => {
  if (!captions.length || !Number.isFinite(seconds)) return captions;
  const earliest = captions.reduce(
    (min, c) => c.words.reduce((t, w) => Math.min(t, w.start), Math.min(min, c.start)),
    Infinity,
  );
  const delta = Math.max(-earliest, seconds);
  if (delta === 0) return captions;
  const shift = (time: number) => Math.round((time + delta) * 1e6) / 1e6;
  return captions.map((caption) => ({
    ...caption,
    start: shift(caption.start),
    end: shift(caption.end),
    ...(caption.gapRestoreEnd === undefined ? {} : { gapRestoreEnd: shift(caption.gapRestoreEnd) }),
    edited: true,
    words: caption.words.map((word) => ({
      ...word,
      start: shift(word.start),
      end: shift(word.end),
      start_ms: Math.round(shift(word.start) * 1000),
      end_ms: Math.round(shift(word.end) * 1000),
    })),
  }));
};
