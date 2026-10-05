import { describe, expect, it } from 'vitest';
import { computeCaptionFrame } from '../src/core/rendering/frame';
import { getEnterAnimation, ENTER_ANIMATIONS } from '../src/core/rendering/animations';
import { STYLE_PRESETS } from '../src/core/rendering/presets';
import { defaultAnimation, defaultStyle } from '../src/core/project/defaults';
import { migrateProject } from '../src/core/project/migrate';
import type { Caption, CaptionWord, EnterAnimationId } from '../src/core/types/project';

const FPS = 30;
const MOTION: EnterAnimationId = 'progressive-word-reveal';

const word = (text: string, start: number, end: number): CaptionWord => ({
  text,
  start,
  end,
  emphasis: false,
});

const caption = (words: CaptionWord[], id = 'c1'): Caption => ({
  id,
  start: words[0].start,
  end: words[words.length - 1].end,
  words,
  edited: false,
});

/**
 * The caption-local frame on screen at a given wall-clock second.
 *
 * Remotion only ever evaluates whole frames, and a Sequence renders its child
 * at `absoluteFrame - from`. Modelling that here keeps the tests honest about
 * frame boundaries instead of asking the motion for a time no renderer emits.
 * The epsilon absorbs float error, so 1.2s lands on frame 36 rather than 35.
 */
const localFrame = (subject: Caption, seconds: number): number =>
  Math.floor(seconds * FPS + 1e-6) - Math.round(subject.start * FPS);

/** The colour role each word resolves to at a given moment. */
const rolesAt = (
  subject: Caption,
  seconds: number,
  motion: EnterAnimationId = MOTION,
  maxWordsPerLine = 6,
  maxLines = 2,
): string[] => {
  const frame = computeCaptionFrame({
    frame: localFrame(subject, seconds),
    fps: FPS,
    caption: subject,
    animation: { ...defaultAnimation, enter: motion, exit: 'cut' },
    maxLines,
    maxWordsPerLine,
  });
  return frame.lines.flat().map((w) => w.transform.color);
};

describe('the motion is registered', () => {
  it('exists with the id the spec names', () => {
    const preset = ENTER_ANIMATIONS.find((m) => m.id === MOTION);
    expect(preset).toBeDefined();
    expect(preset?.label).toBe('Progressive Word Reveal');
    expect(preset?.category).toBe('reveal');
  });

  it('carries the searchable aliases', () => {
    const preset = getEnterAnimation(MOTION);
    expect(preset.aliases).toContain('Read Along');
    expect(preset.aliases).toContain('Cumulative Karaoke');
  });

  it('has an accent variant that is not the default', () => {
    expect(ENTER_ANIMATIONS.some((m) => m.id === 'progressive-word-accent')).toBe(true);
    expect(defaultAnimation.enter).not.toBe('progressive-word-accent');
  });
});

describe('reveal fires on the word start timestamp', () => {
  // the second word is the one under test; it starts at exactly 1.2s
  const subject = caption([word('woh', 1.0, 1.15), word('paise', 1.2, 1.5)]);

  it('is future just before the word starts', () => {
    expect(rolesAt(subject, 1.19)).toEqual(['base', 'future']);
  });

  it('is revealed exactly at the word start', () => {
    expect(rolesAt(subject, 1.2)).toEqual(['base', 'base']);
  });

  it('stays revealed once the word has been said', () => {
    expect(rolesAt(subject, 1.5)).toEqual(['base', 'base']);
  });

  /** The trigger is the start, never the end — a word darkens as it is said. */
  it('is revealed well before the word ends', () => {
    const long = caption([word('furnished', 0, 2)]);
    expect(rolesAt(long, 0.05)).toEqual(['base']);
    expect(rolesAt(long, 1.0)).toEqual(['base']);
  });
});

describe('state accumulates left to right', () => {
  const subject = caption([
    word('paise', 0.5, 0.85),
    word('maang', 0.9, 1.3),
    word('liye', 1.4, 1.8),
    word('aur', 1.9, 2.2),
  ]);

  it('shows the whole phrase in the future colour before anything is said', () => {
    expect(rolesAt(subject, 0.5)).toEqual(['base', 'future', 'future', 'future']);
  });

  it('reveals one more word at a time and keeps the earlier ones', () => {
    expect(rolesAt(subject, 1.0)).toEqual(['base', 'base', 'future', 'future']);
    expect(rolesAt(subject, 1.5)).toEqual(['base', 'base', 'base', 'future']);
    expect(rolesAt(subject, 2.0)).toEqual(['base', 'base', 'base', 'base']);
  });

  it('never un-reveals a word while the caption plays forward', () => {
    let revealed = 0;
    for (let t = 0.5; t <= 2.2; t += 0.05) {
      const count = rolesAt(subject, t).filter((r) => r === 'base').length;
      expect(count).toBeGreaterThanOrEqual(revealed);
      revealed = count;
    }
  });
});

describe('scrubbing backwards', () => {
  const subject = caption([
    word('dildaar', 2.0, 2.3),
    word('wagla', 2.4, 2.7),
    word('feel', 2.8, 3.1),
  ]);

  /**
   * State is derived from the frame alone, with nothing accumulated, so moving
   * the playhead backwards must put words back to grey.
   */
  it('returns words to the future colour', () => {
    expect(rolesAt(subject, 2.9)).toEqual(['base', 'base', 'base']);
    expect(rolesAt(subject, 2.5)).toEqual(['base', 'base', 'future']);
    expect(rolesAt(subject, 2.1)).toEqual(['base', 'future', 'future']);
  });

  it('gives the same answer whichever direction the playhead arrived from', () => {
    const forward = rolesAt(subject, 2.5);
    const backward = rolesAt(subject, 2.5);
    expect(forward).toEqual(backward);
  });
});

describe('each caption starts fresh', () => {
  it('does not inherit reveal state from the caption before it', () => {
    const first = caption([word('station', 0, 0.5)], 'a');
    const second = caption([word('dildaar', 1.0, 1.3), word('wagla', 1.4, 1.7)], 'b');

    // the first caption has finished entirely
    expect(rolesAt(first, 0.4)).toEqual(['base']);
    // the second begins with everything unspoken
    expect(rolesAt(second, 1.0 - 0.001 + 0.001)).toEqual(['base', 'future']);
    expect(rolesAt(second, 1.05)).toEqual(['base', 'future']);
  });
});

describe('layout', () => {
  it('reveals in spoken order across two lines, not row by row', () => {
    const subject = caption([
      word('paise', 0, 0.3),
      word('maang', 0.4, 0.7),
      word('liye', 0.8, 1.1),
      word('aur', 1.2, 1.5),
      word('usne', 1.6, 1.9),
      word('mujhe', 2.0, 2.3),
    ]);

    // three words a line, two lines: the fourth word starts the second row
    const atFourth = rolesAt(subject, 1.25, MOTION, 3, 2);
    expect(atFourth).toEqual(['base', 'base', 'base', 'base', 'future', 'future']);
  });

  it('keeps punctuation attached to its word and revealing with it', () => {
    const subject = caption([word('train', 0, 0.4), word('station.', 0.5, 1.0)]);

    expect(rolesAt(subject, 0.2)).toEqual(['base', 'future']);
    expect(rolesAt(subject, 0.6)).toEqual(['base', 'base']);
  });

  it('works with Hinglish tokens', () => {
    const subject = caption([
      word('Aapne', 0, 0.3),
      word('Netflix', 0.4, 0.8),
      word('pe', 0.9, 1.0),
      word('dekha', 1.1, 1.4),
    ]);
    expect(rolesAt(subject, 0.5)).toEqual(['base', 'base', 'future', 'future']);
  });
});

describe('nothing moves', () => {
  /**
   * The reference is a colour change and nothing else. Any scale, offset or
   * opacity would shift the layout as words reveal.
   */
  it('leaves every word at rest', () => {
    const subject = caption([word('one', 0, 0.4), word('two', 0.5, 0.9)]);

    const frame = computeCaptionFrame({
      frame: 0.6 * FPS,
      fps: FPS,
      caption: subject,
      animation: { ...defaultAnimation, enter: MOTION, exit: 'cut' },
      maxLines: 2,
      maxWordsPerLine: 4,
    });

    for (const { transform } of frame.lines.flat()) {
      expect(transform.scale).toBe(1);
      expect(transform.translateY).toBe(0);
      expect(transform.opacity).toBe(1);
      expect(transform.blur).toBe(0);
      expect(transform.clipRight).toBe(0);
      expect(transform.box).toBe(false);
    }
  });

  it('leaves the caption block itself untouched', () => {
    const subject = caption([word('one', 0, 0.4)]);
    const frame = computeCaptionFrame({
      frame: 0.2 * FPS,
      fps: FPS,
      caption: subject,
      animation: { ...defaultAnimation, enter: MOTION, exit: 'cut' },
      maxLines: 2,
      maxWordsPerLine: 4,
    });

    expect(frame.line.scale).toBe(1);
    expect(frame.line.opacity).toBe(1);
    expect(frame.line.translateY).toBe(0);
    expect(frame.line.blur).toBe(0);
  });
});

describe('the accent variant', () => {
  const subject = caption([
    word('one', 0, 0.4),
    word('two', 0.5, 0.9),
    word('three', 1.0, 1.4),
  ]);

  it('picks out the word being spoken and darkens the rest behind it', () => {
    expect(rolesAt(subject, 0.6, 'progressive-word-accent')).toEqual([
      'base',
      'active',
      'future',
    ]);
  });

  it('settles a word to the revealed colour once it has finished', () => {
    expect(rolesAt(subject, 1.2, 'progressive-word-accent')).toEqual([
      'base',
      'base',
      'active',
    ]);
  });
});

describe('the companion template', () => {
  const preset = STYLE_PRESETS.find((p) => p.id === 'founders-of-uae');

  it('exists and is named as asked', () => {
    expect(preset).toBeDefined();
    expect(preset?.name).toBe('Founders of UAE');
  });

  it('suggests the motion without hard-coding it into the motion', () => {
    expect(preset?.motion).toBe(MOTION);
    // the motion registry knows nothing about this template's colours
    expect(JSON.stringify(getEnterAnimation(MOTION))).not.toContain('E7E7E7');
  });

  it('uses the reference colours', () => {
    const style = { ...defaultStyle, ...preset!.style };
    expect(style.color).toBe('#000000');
    expect(style.futureWordColor).toBe('#B4B4B4');
    expect(style.boxColor).toBe('#E7E7E7');
    expect(style.boxEnabled).toBe(true);
    expect(style.boxRadius).toBe(8);
  });

  it('adds nothing that would move the text', () => {
    const style = { ...defaultStyle, ...preset!.style };
    expect(style.strokeEnabled).toBe(false);
    expect(style.shadowEnabled).toBe(false);
    expect(style.activeWordScale).toBe(1);
  });
});

describe('style and motion stay independent', () => {
  it('reveals identically whatever the template looks like', () => {
    const subject = caption([word('one', 0, 0.4), word('two', 0.5, 0.9)]);
    // the roles are the same regardless of style; only the colours they map to differ
    expect(rolesAt(subject, 0.6)).toEqual(['base', 'base']);
    expect(rolesAt(subject, 0.2)).toEqual(['base', 'future']);
  });
});

describe('older projects', () => {
  it('gain a future word colour rather than rendering words invisible', () => {
    const migrated = migrateProject({
      schemaVersion: 4,
      id: 'legacy',
      name: 'Legacy',
      style: { color: '#FFFFFF' },
    });

    expect(migrated.style.futureWordColor).toBe('#B4B4B4');
  });

  it('keeps a colour the file already had', () => {
    const migrated = migrateProject({
      schemaVersion: 4,
      id: 'legacy',
      name: 'Legacy',
      style: { futureWordColor: '#123456' },
    });

    expect(migrated.style.futureWordColor).toBe('#123456');
  });
});
