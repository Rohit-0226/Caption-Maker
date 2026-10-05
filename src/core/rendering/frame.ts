import { Easing, interpolate, spring } from 'remotion';
import type { AnimationSettings, Caption, CaptionWord } from '../types/project';
import { wrapIntoLines } from '../segmentation/segmenter';
import {
  getEnterAnimation,
  getExitAnimation,
  neutralLine,
  neutralWord,
  type LineContext,
  type LineTransform,
  type WordContext,
  type WordTransform,
} from './animations';

export interface PositionedWord {
  word: CaptionWord;
  transform: WordTransform;
  /** index within the whole caption, not the line */
  index: number;
}

export interface CaptionFrame {
  line: LineTransform;
  lines: PositionedWord[][];
  /** for character-reveal animations; null when the animation reveals by word */
  revealedCharacters: number | null;
}

export interface CaptionFrameInput {
  frame: number;
  fps: number;
  caption: Caption;
  animation: AnimationSettings;
  maxLines: number;
  maxWordsPerLine: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Delay between words for staggered animations, in seconds. */
const STAGGER_STEP = 0.055;

/**
 * Resolves one caption at one moment in time into pure transform values.
 *
 * Remotion's `spring` and `interpolate` are plain functions, so this runs
 * happily outside a composition. That is what lets the motion gallery cards
 * animate from exactly the same code that renders the final video — there is
 * only ever one motion engine.
 */
export const computeCaptionFrame = ({
  frame,
  fps,
  caption,
  animation,
  maxLines,
  maxWordsPerLine,
}: CaptionFrameInput): CaptionFrame => {
  const t = frame / fps;
  const duration = Math.max(caption.end - caption.start, 0.001);
  const remaining = duration - t;

  const damping = interpolate(animation.bounciness, [0, 100], [200, 9], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const enterFrames = Math.max(2, Math.round(animation.enterDuration * fps));

  const lineContext: LineContext = {
    enter: interpolate(t, [0, Math.max(animation.enterDuration, 0.01)], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    }),
    enterSpring: spring({
      frame,
      fps,
      config: { damping, mass: 0.6, stiffness: 170 },
      durationInFrames: enterFrames,
    }),
    exit:
      animation.exit === 'cut'
        ? 0
        : interpolate(remaining, [0, Math.max(animation.exitDuration, 0.01)], [1, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.in(Easing.cubic),
          }),
    time: t,
    duration,
    travel: animation.travel,
  };

  const enterPreset = getEnterAnimation(animation.enter);
  const exitPreset = getExitAnimation(animation.exit);

  const line: LineTransform = { ...neutralLine, ...enterPreset.line?.(lineContext) };

  if (lineContext.exit > 0) {
    const patch = exitPreset.apply(lineContext);
    // exits multiply into whatever the enter animation left behind
    if (patch.opacity !== undefined) line.opacity *= patch.opacity;
    if (patch.scale !== undefined) line.scale *= patch.scale;
    if (patch.translateY !== undefined) line.translateY += patch.translateY;
    if (patch.translateX !== undefined) line.translateX += patch.translateX;
    if (patch.blur !== undefined) line.blur += patch.blur;
    if (patch.rotate !== undefined) line.rotate += patch.rotate;
  }

  const wrapped = wrapIntoLines(caption.words, maxLines, maxWordsPerLine);
  const count = caption.words.length;

  let index = 0;
  const lines: PositionedWord[][] = wrapped.map((lineWords) =>
    lineWords.map((word) => {
      const start = word.start - caption.start;
      const end = word.end - caption.start;
      const current = index++;

      const wordDuration = Math.max(end - start, 0.001);
      const wordPopDuration = Math.max(0.06, Math.min(animation.enterDuration * (0.22 / 0.24), wordDuration));
      const wordStaggerDuration = Math.max(0.06, Math.min(animation.enterDuration, wordDuration));
      const staggerStep = Math.max(0.015, STAGGER_STEP * (animation.enterDuration / 0.24));

      const popSpring = spring({
        frame: frame - start * fps,
        fps,
        config: { damping: 11, mass: 0.5, stiffness: 200 },
        durationInFrames: Math.max(2, Math.round(wordPopDuration * fps)),
      });

      const settleDuration = Math.max(0.06, Math.min(0.14, wordDuration * 0.5));
      const settleSpring = spring({
        frame: frame - end * fps,
        fps,
        config: { damping: 15, mass: 0.45, stiffness: 210 },
        durationInFrames: Math.max(2, Math.round(settleDuration * fps)),
      });
      const activeEnvelope = Math.max(0, popSpring - settleSpring);

      const context: WordContext = {
        spoken: t >= start,
        active: t >= start && t < end,
        progress: clamp01((t - start) / wordDuration),
        pop: popSpring,
        staggered: spring({
          frame: frame - current * staggerStep * fps,
          fps,
          config: { damping: 14, mass: 0.5, stiffness: 190 },
          durationInFrames: Math.max(2, Math.round(wordStaggerDuration * fps)),
        }),
        activeEnvelope,
        index: current,
        count,
      };

      const isNone = enterPreset.id === 'none';
      const baseWord = {
        ...neutralWord,
        color: (!isNone && context.active ? 'active' : 'base') as 'active' | 'base',
        box: !isNone && context.active,
      };

      return {
        word,
        index: current,
        transform: { ...baseWord, ...enterPreset.word?.(context, lineContext) },
      };
    }),
  );

  const revealedCharacters = enterPreset.characterReveal
    ? Math.round(
        interpolate(
          t,
          [0, Math.max(duration * 0.7, 0.2)],
          [0, caption.words.reduce((sum, w) => sum + w.text.length + 1, 0)],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        ),
      )
    : null;

  return { line, lines, revealedCharacters };
};
