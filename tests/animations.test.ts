import { describe, expect, it } from 'vitest';
import {
  ANIMATION_SPEED_PRESETS,
  ENTER_ANIMATIONS,
  EXIT_ANIMATIONS,
  EXIT_ANIMATION_OPTIONS,
  MOTION_CATEGORIES,
  getEnterAnimation,
  getExitAnimation,
} from '../src/core/rendering/animations';
import { computeCaptionFrame } from '../src/core/rendering/frame';
import { STYLE_PRESETS, QUICK_PRESETS, getStylePreset } from '../src/core/rendering/presets';
import { defaultAnimation, defaultStyle } from '../src/core/project/defaults';
import type { AnimationSettings, Caption, EnterAnimationId } from '../src/core/types/project';

const FPS = 30;

const caption = (text = 'one two three four'): Caption => {
  const tokens = text.split(' ');
  const per = 1.6 / tokens.length;
  return {
    id: 'c',
    start: 0,
    end: 2,
    edited: false,
    words: tokens.map((t, i) => ({
      text: t,
      start: i * per,
      end: (i + 1) * per,
      emphasis: false,
    })),
  };
};

const frameAt = (seconds: number, animation: Partial<AnimationSettings> = {}) =>
  computeCaptionFrame({
    frame: seconds * FPS,
    fps: FPS,
    caption: caption(),
    animation: { ...defaultAnimation, ...animation },
    maxLines: 2,
    maxWordsPerLine: 2,
  });

/** A single number summarising every transform in a frame. */
const fingerprint = (seconds: number, id: EnterAnimationId) => {
  const f = frameAt(seconds, { enter: id, exit: 'cut' });
  const words = f.lines.flat();
  return [
    f.line.scale,
    f.line.translateX,
    f.line.translateY,
    f.line.opacity,
    f.line.rotate,
    f.line.blur,
    f.revealedCharacters ?? -1,
    ...words.map((w) => [
      w.transform.scale,
      w.transform.opacity,
      w.transform.blur,
      w.transform.translateY,
      w.transform.clipRight,
      // all three roles are visibly distinct, so read-along motions register
      w.transform.color === 'active' ? 1 : w.transform.color === 'future' ? 2 : 0,
      w.transform.box ? 1 : 0,
    ]),
  ]
    .flat()
    .map((n) => Number(n).toFixed(4))
    .join(',');
};

describe('motion registry', () => {
  it('offers a substantial library', () => {
    expect(ENTER_ANIMATIONS.length).toBeGreaterThanOrEqual(25);
    expect(EXIT_ANIMATIONS.length).toBeGreaterThanOrEqual(5);
  });

  it('has unique ids', () => {
    const ids = ENTER_ANIMATIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every motion a label, description and known category', () => {
    const categories = new Set(MOTION_CATEGORIES.map((c) => c.id));
    for (const preset of ENTER_ANIMATIONS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(categories.has(preset.category)).toBe(true);
    }
  });

  it('covers every category with at least one motion', () => {
    for (const category of MOTION_CATEGORIES) {
      expect(ENTER_ANIMATIONS.some((a) => a.category === category.id)).toBe(true);
    }
  });

  it('falls back to a real preset for an unknown id', () => {
    expect(getEnterAnimation('nope' as EnterAnimationId).id).toBe(ENTER_ANIMATIONS[0].id);
    expect(getExitAnimation('nope' as never).id).toBe(EXIT_ANIMATIONS[0].id);
  });
});

describe('motion actually animates', () => {
  /**
   * The gallery cards and the exported video both read these transforms, so a
   * motion that never changes would be a card that never moves.
   */
  it('every motion except None changes over its first half second', () => {
    for (const preset of ENTER_ANIMATIONS) {
      const early = fingerprint(0.02, preset.id);
      const later = fingerprint(0.45, preset.id);

      if (preset.id === 'none') {
        expect(early, 'None should hold still').toBe(later);
      } else {
        expect(early, `${preset.label} produced no movement`).not.toBe(later);
      }
    }
  });

  it('settles to a steady state once the entrance is over', () => {
    // wave and pulse are deliberately continuous, so they are excluded
    const continuous = new Set<EnterAnimationId>(['wave', 'pulse']);

    for (const preset of ENTER_ANIMATIONS) {
      if (continuous.has(preset.id)) continue;
      expect(fingerprint(1.75, preset.id), `${preset.label} never settles`).toBe(
        fingerprint(1.8, preset.id),
      );
    }
  });

  it('keeps the line fully visible and unmoved at rest', () => {
    const f = frameAt(1.8, { enter: 'softPop', exit: 'cut' });
    expect(f.line.opacity).toBeCloseTo(1, 2);
    expect(f.line.scale).toBeCloseTo(1, 2);
  });

  it('applies the exit animation near the end', () => {
    const mid = frameAt(1.0, { enter: 'none', exit: 'fade' });
    const end = frameAt(1.99, { enter: 'none', exit: 'fade' });
    expect(mid.line.opacity).toBeGreaterThan(end.line.opacity);
  });

  it('leaves the line alone when the exit is a cut', () => {
    const end = frameAt(1.99, { enter: 'none', exit: 'cut' });
    expect(end.line.opacity).toBeCloseTo(1, 3);
  });

  it('reveals characters progressively for typewriter only', () => {
    expect(frameAt(0.2, { enter: 'typewriter' }).revealedCharacters).not.toBeNull();
    expect(frameAt(0.2, { enter: 'softPop' }).revealedCharacters).toBeNull();

    const early = frameAt(0.2, { enter: 'typewriter' }).revealedCharacters ?? 0;
    const late = frameAt(1.2, { enter: 'typewriter' }).revealedCharacters ?? 0;
    expect(late).toBeGreaterThan(early);
  });

  it('marks the spoken word active for word-level motions', () => {
    const f = frameAt(0.2, { enter: 'wordHighlight' });
    const active = f.lines.flat().filter((w) => w.transform.color === 'active');
    expect(active).toHaveLength(1);
    expect(active[0].index).toBe(0);
  });

  it('wraps words into at most the allowed number of lines', () => {
    const f = frameAt(1.0);
    expect(f.lines.length).toBeLessThanOrEqual(2);
    expect(f.lines.flat()).toHaveLength(4);
  });

  it('is deterministic — the same frame always resolves the same way', () => {
    for (const preset of ENTER_ANIMATIONS) {
      expect(fingerprint(0.3, preset.id)).toBe(fingerprint(0.3, preset.id));
    }
  });
});

describe('style presets', () => {
  it('offers a substantial library with unique ids', () => {
    expect(STYLE_PRESETS.length).toBeGreaterThanOrEqual(25);
    const ids = STYLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset merges into a complete, valid style', () => {
    for (const preset of STYLE_PRESETS) {
      const style = { ...defaultStyle, ...preset.style };
      expect(style.fontFamily.length).toBeGreaterThan(0);
      expect(style.fontSize).toBeGreaterThan(0);
      expect(style.opacity).toBeGreaterThan(0);
      expect(['left', 'center', 'right']).toContain(style.align);
    }
  });

  /** Style controls appearance, motion controls movement — never both. */
  it('no style preset touches animation settings', () => {
    const animationKeys = new Set(Object.keys(defaultAnimation));
    for (const preset of STYLE_PRESETS) {
      for (const key of Object.keys(preset.style)) {
        expect(animationKeys.has(key), `${preset.id} sets animation key ${key}`).toBe(false);
      }
    }
  });

  it('returns undefined for an unknown preset id', () => {
    expect(getStylePreset('does-not-exist')).toBeUndefined();
  });
});

describe('quick presets', () => {
  it('every quick preset points at a real style and a real motion', () => {
    const motionIds = new Set(ENTER_ANIMATIONS.map((a) => a.id));
    for (const quick of QUICK_PRESETS) {
      expect(getStylePreset(quick.styleId), `${quick.id} style missing`).toBeDefined();
      expect(motionIds.has(quick.motion), `${quick.id} motion missing`).toBe(true);
    }
  });

  it('includes dynamic-word-follower with Quicksand typography and wordFollower motion', () => {
    const quick = QUICK_PRESETS.find((q) => q.id === 'dynamic-word-follower-preset');
    expect(quick).toBeDefined();
    expect(quick?.motion).toBe('wordFollower');

    const style = getStylePreset('dynamic-word-follower');
    expect(style).toBeDefined();
    expect(style?.style.fontFamily).toBe('Quicksand');
    expect(style?.style.align).toBe('center');
    expect(style?.style.fontWeight).toBe(700);

    // Entrance frame at 0.05s has blur burst > 0 and upward translateY
    const early = frameAt(0.05, { enter: 'wordFollower' });
    expect(early.line.blur).toBeGreaterThan(0);
    expect(early.line.translateY).toBeGreaterThan(0);

    // Active word follow test
    const active = frameAt(0.2, { enter: 'wordFollower' });
    const activeWords = active.lines.flat().filter((w) => w.transform.color === 'active');
    expect(activeWords.length).toBeGreaterThan(0);
    expect(activeWords[0].transform.scale).toBeGreaterThan(1);
  });

  it('includes spotlight animation with inactive word dimming', () => {
    const anim = getEnterAnimation('spotlight');
    expect(anim).toBeDefined();

    const frame = frameAt(0.2, { enter: 'spotlight' });
    const words = frame.lines.flat();
    const activeWord = words.find((w) => w.transform.color === 'active');
    const inactiveWord = words.find((w) => w.transform.color === 'base');

    expect(activeWord?.transform.opacity).toBe(1);
    expect(inactiveWord?.transform.opacity).toBeCloseTo(0.35, 2);
  });

  it('includes Kalakar signature quick presets', () => {
    const kalakar = QUICK_PRESETS.find((q) => q.id === 'kalakar-viral-preset');
    expect(kalakar).toBeDefined();
    expect(kalakar?.styleId).toBe('kalakar-viral-green');

    const spotlight = QUICK_PRESETS.find((q) => q.id === 'spotlight-preset');
    expect(spotlight).toBeDefined();
    expect(spotlight?.motion).toBe('spotlight');

    const flash = QUICK_PRESETS.find((q) => q.id === 'flash-viral-preset');
    expect(flash).toBeDefined();
    expect(flash?.motion).toBe('flashPunch');
  });
});

describe('animation speed & dynamics control', () => {
  it('offers a rich set of speed presets ranging from hyper to cinematic', () => {
    expect(ANIMATION_SPEED_PRESETS.length).toBeGreaterThanOrEqual(5);
    const ids = ANIMATION_SPEED_PRESETS.map((p) => p.id);
    expect(ids).toContain('hyper');
    expect(ids).toContain('snappy');
    expect(ids).toContain('balanced');
    expect(ids).toContain('smooth');
    expect(ids).toContain('cinematic');

    // Durations should be ordered from fastest to slowest
    for (let i = 1; i < ANIMATION_SPEED_PRESETS.length; i++) {
      expect(ANIMATION_SPEED_PRESETS[i].duration).toBeGreaterThan(
        ANIMATION_SPEED_PRESETS[i - 1].duration,
      );
    }
  });

  it('covers all exit animation options', () => {
    expect(EXIT_ANIMATION_OPTIONS.length).toBeGreaterThanOrEqual(5);
    const exitIds = EXIT_ANIMATION_OPTIONS.map((o) => o.value);
    expect(exitIds).toContain('cut');
    expect(exitIds).toContain('fade');
    expect(exitIds).toContain('scaleDown');
    expect(exitIds).toContain('slideDown');
    expect(exitIds).toContain('blurOut');
  });

  it('scales word animation entrance speed according to enterDuration', () => {
    // With hyper fast speed (0.10s), the first word's spring should settle earlier
    const hyperFrame = frameAt(0.08, { enter: 'wordPop', enterDuration: 0.10 });
    const normalFrame = frameAt(0.08, { enter: 'wordPop', enterDuration: 0.40 });

    const hyperWords = hyperFrame.lines.flat();
    const normalWords = normalFrame.lines.flat();

    // At 0.08s, hyper animation has already scaled/progressed more than the slow 0.40s one
    expect(hyperWords[0].transform.scale).not.toBe(normalWords[0].transform.scale);
  });
});

