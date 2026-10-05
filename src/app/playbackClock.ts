import { useSyncExternalStore } from 'react';
import type { Caption, CaptionProject } from '../core/types/project';
import { resolveExportSpec } from '../core/rendering/exportPresets';

type Listener = () => void;

/**
 * The frame rate the preview player runs at — the one `buildScene` gives it.
 *
 * Every seek turns seconds into a frame number, so every caller must use the
 * player's own rate. Several read the source's fps (or assumed 30) instead,
 * which put the playhead in the wrong place whenever the two differed: a 60 fps
 * phone clip with the Reel preset (30 fps) seeked to twice the clicked time.
 */
export const previewFps = (project: CaptionProject | null | undefined): number =>
  project ? resolveExportSpec(project).fps : 30;

/**
 * The playhead, deliberately kept outside React state.
 *
 * The player reports a new time 30–60 times a second. Pushing that into the
 * project store re-rendered the caption list, the timeline and the preview on
 * every frame — with sixty-odd caption rows mounted, that is the single most
 * expensive thing the editor could do.
 *
 * Instead the raw time lives here, and components subscribe to exactly the
 * slice they need. `useSyncExternalStore` compares snapshots with Object.is, so
 * a component reading the active caption id only re-renders when the caption
 * actually changes — a few times a second at most, not sixty.
 */
class PlaybackClock {
  private time = 0;
  private playing = false;
  private listeners = new Set<Listener>();

  getTime = (): number => this.time;
  isPlaying = (): boolean => this.playing;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }

  setTime(next: number): void {
    if (next === this.time) return;
    this.time = next;
    this.emit();
  }

  setPlaying(next: boolean): void {
    if (next === this.playing) return;
    this.playing = next;
    this.emit();
  }

  /** Called when a project loads, so a stale playhead never leaks across. */
  reset(): void {
    this.time = 0;
    this.playing = false;
    this.emit();
  }
}

export const playbackClock = new PlaybackClock();

/**
 * The raw playhead in seconds.
 *
 * Re-renders on every frame, so only leaf components may use it — a time
 * readout, the playhead marker. Never a list.
 */
export const useCurrentTime = (): number =>
  useSyncExternalStore(playbackClock.subscribe, playbackClock.getTime, playbackClock.getTime);

export const useIsPlaying = (): boolean =>
  useSyncExternalStore(playbackClock.subscribe, playbackClock.isPlaying, playbackClock.isPlaying);

/**
 * Finds the caption covering a time. Captions are normally ordered and
 * non-overlapping, so a binary search keeps this cheap even on a long
 * transcript.
 *
 * Hand-edited timings can break that order (a start dragged back over the
 * previous caption), and then the binary search can step past a caption that
 * is on screen — the list and the caption box stopped following it. A miss
 * therefore falls back to a plain scan, which is still only a few hundred
 * comparisons.
 */
export const captionAt = (captions: Caption[], time: number): Caption | null => {
  let low = 0;
  let high = captions.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const caption = captions[mid];
    if (time < caption.start) high = mid - 1;
    else if (time >= caption.end) low = mid + 1;
    else return caption;
  }

  return captions.find((c) => time >= c.start && time < c.end) ?? null;
};

/**
 * The id of the caption under the playhead.
 *
 * Returns a string, so React bails out of the re-render until the caption
 * genuinely changes.
 */
export const useActiveCaptionId = (captions: Caption[]): string | null =>
  useSyncExternalStore(
    playbackClock.subscribe,
    () => captionAt(captions, playbackClock.getTime())?.id ?? null,
    () => null,
  );

/** Index of the spoken word within a caption, or -1. */
export const activeWordIndex = (caption: Caption | null, time: number): number => {
  if (!caption) return -1;
  return caption.words.findIndex((word) => time >= word.start && time < word.end);
};

/**
 * The spoken word, as a stable `captionId:index` key so a consumer re-renders
 * only when the word changes rather than on every frame.
 */
export const useActiveWordKey = (captions: Caption[]): string | null =>
  useSyncExternalStore(
    playbackClock.subscribe,
    () => {
      const time = playbackClock.getTime();
      const caption = captionAt(captions, time);
      if (!caption) return null;
      const index = activeWordIndex(caption, time);
      return index === -1 ? null : `${caption.id}:${index}`;
    },
    () => null,
  );
