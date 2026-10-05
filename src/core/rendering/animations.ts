import type { EnterAnimationId, ExitAnimationId } from '../types/project';

/** Everything an animation can react to at the whole-caption level. */
export interface LineContext {
  /** 0..1, eased */
  enter: number;
  /** 0..1, springy — overshoots past 1 when bounciness is high */
  enterSpring: number;
  /** 0..1 as the caption leaves; 0 while it is fully on screen */
  exit: number;
  /** seconds since the caption appeared */
  time: number;
  /** how long the caption is on screen, in seconds */
  duration: number;
  travel: number;
}

/** Everything an animation can react to for one word. */
export interface WordContext {
  /** the playhead has reached this word */
  spoken: boolean;
  /** the playhead is inside this word */
  active: boolean;
  /** 0..1 across this word's own span */
  progress: number;
  /** a spring that fires when the word starts, 0..1 */
  pop: number;
  /** a spring that fires on a per-word delay, for staggered effects */
  staggered: number;
  /** a smooth spring envelope (0..1) that rises on word start and gently relaxes after word end */
  activeEnvelope: number;
  index: number;
  /** how many words the caption holds */
  count: number;
}

export interface LineTransform {
  scale: number;
  translateX: number;
  translateY: number;
  opacity: number;
  rotate: number;
  blur: number;
}

/**
 * Which colour a word takes.
 *
 * 'future' exists for read-along motions, where the whole phrase is on screen
 * from the start and unspoken words wait in a muted colour.
 */
export type ColorRole = 'base' | 'active' | 'future';

export interface WordTransform {
  scale: number;
  translateY: number;
  opacity: number;
  blur: number;
  color: ColorRole;
  /** percentage of the word clipped from the right, for wipe effects */
  clipRight: number;
  /** draw the active-word highlight box behind this word */
  box: boolean;
}

export const neutralLine: LineTransform = {
  scale: 1,
  translateX: 0,
  translateY: 0,
  opacity: 1,
  rotate: 0,
  blur: 0,
};

export const neutralWord: WordTransform = {
  scale: 1,
  translateY: 0,
  opacity: 1,
  blur: 0,
  color: 'base',
  clipRight: 0,
  box: false,
};

export type MotionCategory = 'basic' | 'pop' | 'word' | 'reveal' | 'dynamic';

export interface EnterAnimationPreset {
  id: EnterAnimationId;
  label: string;
  category: MotionCategory;
  description: string;
  /** searchable alternative names; never shown as the label */
  aliases?: string[];
  /** how the caption block as a whole moves */
  line?: (ctx: LineContext) => Partial<LineTransform>;
  /** how each word behaves; omitted means every word renders plainly */
  word?: (word: WordContext, line: LineContext) => Partial<WordTransform>;
  /** reveal character by character across the caption rather than word by word */
  characterReveal?: boolean;
  /**
   * The whole phrase is on screen from the start and words change colour as
   * they are spoken. Read-along motions use `futureWordColor`, so the editor
   * shows that control only for them.
   */
  readAlong?: boolean;
}

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/**
 * The enter animations.
 *
 * Each is a plain data object: a line function, a word function, or both. One
 * registry drives the motion gallery previews, the editor preview and the final
 * render, so a card can never disagree with the export. Adding a motion means
 * adding an entry here plus its id in the EnterAnimationId union — never new
 * rendering code.
 */
export const ENTER_ANIMATIONS: EnterAnimationPreset[] = [
  // --- basic ---------------------------------------------------------------
  {
    id: 'none',
    label: 'None',
    category: 'basic',
    description: 'Captions cut straight in. Nothing moves.',
  },
  {
    id: 'fade',
    label: 'Fade',
    category: 'basic',
    description: 'A plain fade up. Quiet and unobtrusive.',
    line: (c) => ({ opacity: c.enter }),
  },
  {
    id: 'scale',
    label: 'Scale',
    category: 'basic',
    description: 'Grows gently into place with no bounce.',
    line: (c) => ({ scale: lerp(0.86, 1, c.enter), opacity: c.enter }),
  },
  {
    id: 'slideUp',
    label: 'Slide Up',
    category: 'basic',
    description: 'Rises into place. Calm and editorial.',
    line: (c) => ({ translateY: lerp(c.travel, 0, c.enter), opacity: c.enter }),
  },
  {
    id: 'slideDown',
    label: 'Slide Down',
    category: 'basic',
    description: 'Drops in from above.',
    line: (c) => ({ translateY: lerp(-c.travel, 0, c.enter), opacity: c.enter }),
  },
  {
    id: 'slideLeft',
    label: 'Slide Left',
    category: 'basic',
    description: 'Enters from the right edge.',
    line: (c) => ({ translateX: lerp(c.travel, 0, c.enter), opacity: c.enter }),
  },
  {
    id: 'slideRight',
    label: 'Slide Right',
    category: 'basic',
    description: 'Enters from the left edge.',
    line: (c) => ({ translateX: lerp(-c.travel, 0, c.enter), opacity: c.enter }),
  },

  // --- pop -----------------------------------------------------------------
  {
    id: 'softPop',
    label: 'Soft Pop',
    category: 'pop',
    description: 'A gentle spring up from small. The safe default.',
    line: (c) => ({ scale: lerp(0.8, 1, c.enterSpring), opacity: c.enter }),
  },
  {
    id: 'hardPop',
    label: 'Hard Pop',
    category: 'pop',
    description: 'Snaps in from much smaller. More aggressive.',
    line: (c) => ({ scale: lerp(0.55, 1, c.enterSpring), opacity: c.enter }),
  },
  {
    id: 'springPop',
    label: 'Spring Pop',
    category: 'pop',
    description: 'Overshoots and settles. Bouncy without being silly.',
    line: (c) => ({ scale: lerp(0.65, 1, c.enterSpring), opacity: Math.min(1, c.enter * 1.6) }),
  },
  {
    id: 'bounce',
    label: 'Bounce',
    category: 'pop',
    description: 'Drops in and bounces on landing.',
    line: (c) => ({
      translateY: lerp(-c.travel, 0, c.enterSpring),
      scale: lerp(0.9, 1, c.enterSpring),
      opacity: c.enter,
    }),
  },
  {
    id: 'elastic',
    label: 'Elastic',
    category: 'pop',
    description: 'Overshooting scale with a rotation kick.',
    line: (c) => ({
      scale: lerp(0.5, 1, c.enterSpring),
      rotate: lerp(-7, 0, c.enterSpring),
      opacity: c.enter,
    }),
  },
  {
    id: 'punch',
    label: 'Punch',
    category: 'pop',
    description: 'Starts oversized and slams down to size.',
    line: (c) => ({ scale: lerp(1.45, 1, c.enterSpring), opacity: Math.min(1, c.enter * 2) }),
  },

  // --- word ----------------------------------------------------------------
  {
    id: 'wordPop',
    label: 'Word Pop',
    category: 'word',
    description: 'Each word pops in as it is spoken.',
    line: (c) => ({ opacity: c.enter }),
    word: (w) => ({
      opacity: w.spoken ? 1 : 0,
      scale: w.spoken ? lerp(0.7, 1, w.pop) : 0.7,
      color: w.active ? 'active' : 'base',
    }),
  },
  {
    id: 'wordScale',
    label: 'Word Scale',
    category: 'word',
    description: 'The whole line is visible; the spoken word swells smoothly with spring physics.',
    line: (c) => ({ opacity: c.enter }),
    word: (w) => ({
      scale: lerp(1, 1.15, w.activeEnvelope),
      color: w.active ? 'active' : 'base',
    }),
  },
  {
    id: 'wordBounce',
    label: 'Word Bounce',
    category: 'word',
    description: 'Each word bounces up as it lands.',
    line: (c) => ({ opacity: c.enter }),
    word: (w) => ({
      opacity: w.spoken ? 1 : 0.22,
      scale: w.spoken ? lerp(0.6, 1, w.pop) : 0.6,
      translateY: w.spoken ? lerp(10, 0, w.pop) : 10,
      color: w.active ? 'active' : 'base',
    }),
  },
  {
    id: 'wordRise',
    label: 'Word Rise',
    category: 'word',
    description: 'Words lift into place one at a time.',
    line: (c) => ({ opacity: c.enter }),
    word: (w) => ({
      opacity: w.spoken ? 1 : 0,
      translateY: w.spoken ? lerp(22, 0, w.pop) : 22,
      color: w.active ? 'active' : 'base',
    }),
  },
  {
    id: 'wordFade',
    label: 'Word Fade',
    category: 'word',
    description: 'Words simply fade on in time with the speech.',
    line: (c) => ({ opacity: c.enter }),
    word: (w) => ({ opacity: w.spoken ? 1 : 0, color: w.active ? 'active' : 'base' }),
  },
  {
    id: 'wordHighlight',
    label: 'Word Highlight',
    category: 'word',
    description: 'Line holds still; the spoken word changes colour. Karaoke.',
    line: (c) => ({ opacity: c.enter }),
    word: (w) => ({ color: w.active ? 'active' : 'base' }),
  },
  {
    id: 'activeWordPunch',
    label: 'Active Word Punch',
    category: 'word',
    description: 'A coloured block snaps behind the word being said with organic spring decay.',
    line: (c) => ({ scale: lerp(0.9, 1, c.enterSpring), opacity: c.enter }),
    word: (w) => ({
      color: w.active ? 'active' : 'base',
      scale: lerp(1, 1.14, w.activeEnvelope),
      box: w.active || w.activeEnvelope > 0.08,
    }),
  },

  // --- reveal --------------------------------------------------------------
  {
    id: 'typewriter',
    label: 'Typewriter',
    category: 'reveal',
    description: 'Characters type out across the caption.',
    line: (c) => ({ opacity: c.enter }),
    characterReveal: true,
  },
  {
    id: 'wipe',
    label: 'Wipe',
    category: 'reveal',
    description: 'A wipe sweeps across each word to reveal it.',
    line: (c) => ({ opacity: c.enter }),
    word: (w) => ({
      clipRight: w.spoken ? (w.active ? (1 - w.progress) * 100 : 0) : 100,
      color: w.active ? 'active' : 'base',
    }),
  },
  {
    /**
     * Read-along. The whole phrase is on screen from the first frame; each word
     * flips from the muted future colour to the normal text colour the instant
     * the speaker reaches it, and stays there.
     *
     * `spoken` is already `time >= word.start`, so the switch happens on the
     * word's real start timestamp — not its end, and never on a share of the
     * caption's duration. Nothing here animates over time, which is why
     * scrubbing backwards puts words back to grey with no state to unwind.
     */
    id: 'progressive-word-reveal',
    label: 'Progressive Word Reveal',
    category: 'reveal',
    description:
      'The whole line shows in grey, and each word turns solid as it is spoken. Read-along.',
    aliases: ['Cumulative Karaoke', 'Read Along', 'Progressive Highlight', 'Word Reveal'],
    readAlong: true,
    // colour only: no box, no scale, nothing that could shift the layout
    word: (w) => ({ color: w.spoken ? 'base' : 'future', box: false }),
  },
  {
    /** The same, plus the word being said right now taking the accent colour. */
    id: 'progressive-word-accent',
    label: 'Progressive Reveal + Accent',
    category: 'reveal',
    description:
      'Read-along, with the word being spoken picked out in the accent colour.',
    aliases: ['Read Along Accent', 'Progressive Highlight Accent'],
    readAlong: true,
    word: (w) => ({
      color: w.active ? 'active' : w.spoken ? 'base' : 'future',
      box: false,
    }),
  },
  {
    id: 'maskReveal',
    label: 'Mask Reveal',
    category: 'reveal',
    description: 'The whole line uncovers left to right.',
    line: (c) => ({ opacity: c.enter > 0 ? 1 : 0 }),
    word: (w, l) => {
      // one shared sweep across the caption, split across its words
      const share = 1 / Math.max(1, w.count);
      const local = (l.enter - w.index * share) / share;
      return { clipRight: Math.max(0, Math.min(1, 1 - local)) * 100 };
    },
  },
  {
    id: 'blurReveal',
    label: 'Blur Reveal',
    category: 'reveal',
    description: 'Words resolve out of a blur as they are spoken.',
    line: (c) => ({ opacity: c.enter }),
    word: (w) => ({
      opacity: w.spoken ? 1 : 0.12,
      blur: w.spoken ? lerp(12, 0, w.pop) : 12,
      color: w.active ? 'active' : 'base',
    }),
  },
  {
    id: 'riseReveal',
    label: 'Rise Reveal',
    category: 'reveal',
    description: 'The line rises out of a blur together.',
    line: (c) => ({
      translateY: lerp(c.travel * 0.6, 0, c.enter),
      blur: lerp(10, 0, c.enter),
      opacity: c.enter,
    }),
  },

  // --- dynamic -------------------------------------------------------------
  {
    id: 'stagger',
    label: 'Stagger',
    category: 'dynamic',
    description: 'Words arrive in quick succession, not on the speech.',
    line: (c) => ({ opacity: c.enter > 0 ? 1 : 0 }),
    word: (w) => ({
      opacity: w.staggered,
      translateY: lerp(16, 0, w.staggered),
      scale: lerp(0.86, 1, w.staggered),
      color: w.active ? 'active' : 'base',
    }),
  },
  {
    id: 'wave',
    label: 'Wave',
    category: 'dynamic',
    description: 'A gentle wave travels along the line.',
    line: (c) => ({ opacity: c.enter }),
    word: (w, l) => ({
      translateY: Math.sin(l.time * 6 - w.index * 0.7) * 4,
      color: w.active ? 'active' : 'base',
    }),
  },
  {
    id: 'pulse',
    label: 'Pulse',
    category: 'dynamic',
    description: 'The line breathes slowly while it is on screen.',
    line: (c) => ({
      scale: lerp(0.92, 1, c.enterSpring) * (1 + Math.sin(c.time * 4) * 0.02),
      opacity: c.enter,
    }),
  },
  {
    id: 'drop',
    label: 'Drop',
    category: 'dynamic',
    description: 'Falls in hard from above and settles.',
    line: (c) => ({
      translateY: lerp(-c.travel * 1.8, 0, c.enterSpring),
      opacity: Math.min(1, c.enter * 2),
    }),
  },
  {
    id: 'zoom',
    label: 'Zoom',
    category: 'dynamic',
    description: 'Rushes in from far away.',
    line: (c) => ({ scale: lerp(0.2, 1, c.enter), opacity: c.enter }),
  },
  {
    id: 'wordFollower',
    label: 'Word Follower',
    category: 'dynamic',
    description: 'Upward slide transition with blur burst and organic active word tracking.',
    line: (c) => ({
      translateY: lerp(c.travel * 0.85, 0, c.enterSpring),
      blur: lerp(20, 0, Math.min(1, c.enter * 1.35)),
      opacity: Math.min(1, c.enter * 1.5),
    }),
    word: (w) => ({
      color: w.active ? 'active' : 'base',
      scale: lerp(1, 1.16, w.activeEnvelope),
      translateY: lerp(0, -3, w.activeEnvelope),
    }),
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    category: 'dynamic',
    description: 'Dims inactive words to 35% opacity while spotlighting the active word in high contrast.',
    line: (c) => ({
      translateY: lerp(c.travel * 0.5, 0, c.enter),
      opacity: c.enter,
    }),
    word: (w) => ({
      opacity: w.active ? 1 : 0.35,
      scale: lerp(1, 1.14, w.activeEnvelope),
      color: w.active ? 'active' : 'base',
    }),
  },
  {
    id: 'flashPunch',
    label: 'Flash Punch',
    category: 'dynamic',
    description: 'High-energy scale burst with rapid lift on the spoken word for viral Reels.',
    line: (c) => ({
      scale: lerp(0.92, 1, c.enterSpring),
      opacity: Math.min(1, c.enter * 2),
    }),
    word: (w) => ({
      color: w.active ? 'active' : 'base',
      scale: lerp(1, 1.22, w.activeEnvelope),
      translateY: lerp(0, -4, w.activeEnvelope),
      box: w.active || w.activeEnvelope > 0.1,
    }),
  },
];

export const MOTION_CATEGORIES: { id: MotionCategory; label: string }[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'pop', label: 'Pop' },
  { id: 'word', label: 'Word' },
  { id: 'reveal', label: 'Reveal' },
  { id: 'dynamic', label: 'Dynamic' },
];

export interface ExitAnimationPreset {
  id: ExitAnimationId;
  label: string;
  apply: (ctx: LineContext) => Partial<LineTransform>;
}

export const EXIT_ANIMATIONS: ExitAnimationPreset[] = [
  { id: 'cut', label: 'Cut', apply: () => ({}) },
  { id: 'fade', label: 'Fade', apply: (c) => ({ opacity: 1 - c.exit }) },
  {
    id: 'scaleDown',
    label: 'Scale Down',
    apply: (c) => ({ scale: lerp(1, 0.75, c.exit), opacity: 1 - c.exit }),
  },
  {
    id: 'slideDown',
    label: 'Slide Down',
    apply: (c) => ({ translateY: lerp(0, c.travel, c.exit), opacity: 1 - c.exit }),
  },
  {
    id: 'blurOut',
    label: 'Blur Out',
    apply: (c) => ({ blur: lerp(0, 16, c.exit), opacity: 1 - c.exit }),
  },
];

export const getEnterAnimation = (id: EnterAnimationId): EnterAnimationPreset =>
  ENTER_ANIMATIONS.find((a) => a.id === id) ?? ENTER_ANIMATIONS[0];

/**
 * Whether a motion keeps unspoken words on screen in the future colour. The
 * editor uses this to decide whether the 'Not yet spoken' control is relevant.
 */
export const isReadAlong = (id: EnterAnimationId): boolean =>
  Boolean(getEnterAnimation(id).readAlong);

export const getExitAnimation = (id: ExitAnimationId): ExitAnimationPreset =>
  EXIT_ANIMATIONS.find((a) => a.id === id) ?? EXIT_ANIMATIONS[0];

export interface AnimationSpeedPreset {
  id: string;
  label: string;
  duration: number;
  icon: string;
  hint: string;
}

export const ANIMATION_SPEED_PRESETS: AnimationSpeedPreset[] = [
  { id: 'hyper', label: 'Hyper', duration: 0.10, icon: 'zap', hint: 'Ultra fast (100ms) for high-energy viral reels' },
  { id: 'snappy', label: 'Snappy', duration: 0.18, icon: 'burst', hint: 'Punchy & crisp (180ms) for dynamic speech' },
  { id: 'balanced', label: 'Balanced', duration: 0.24, icon: 'scale', hint: 'Natural default pace (240ms)' },
  { id: 'smooth', label: 'Smooth', duration: 0.38, icon: 'wave', hint: 'Flowing & calm (380ms) for talking-head videos' },
  { id: 'cinematic', label: 'Cinematic', duration: 0.55, icon: 'film', hint: 'Slow dramatic reveal (550ms)' },
];

export const EXIT_ANIMATION_OPTIONS: { value: ExitAnimationId; label: string; hint: string }[] = [
  { value: 'cut', label: 'Cut (Instant)', hint: 'Disappears immediately' },
  { value: 'fade', label: 'Fade Out', hint: 'Gentle opacity dissolve' },
  { value: 'scaleDown', label: 'Scale Down', hint: 'Shrinks into background' },
  { value: 'slideDown', label: 'Slide Down', hint: 'Drops down below frame' },
  { value: 'blurOut', label: 'Blur Out', hint: 'Cinematic defocus blur' },
];
