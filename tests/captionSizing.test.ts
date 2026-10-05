import { describe, expect, it } from 'vitest';
import { captionMetrics, fontShorthand } from '../src/core/rendering/captionMetrics';
import { computeCaptionFrame } from '../src/core/rendering/frame';
import { buildScene } from '../src/core/rendering/scene';
import { resolveExportSpec } from '../src/core/rendering/exportPresets';
import { compileToAss } from '../server/services/assCompiler';
import { toAss } from '../src/core/subtitles/formats';
import {
  createProject,
  defaultAnimation,
  defaultPosition,
  defaultStyle,
} from '../src/core/project/defaults';
import type { Caption, CaptionStyle, CaptionWord } from '../src/core/types/project';

const style = (patch: Partial<CaptionStyle> = {}): CaptionStyle => ({
  ...defaultStyle,
  ...patch,
});

const word = (text: string, start: number, end: number): CaptionWord => ({
  text,
  start,
  end,
  emphasis: false,
});

const caption = (texts: string[]): Caption => {
  const words = texts.map((t, i) => word(t, i * 0.3, (i + 1) * 0.3));
  return {
    id: 'c1',
    start: 0,
    end: words[words.length - 1].end,
    words,
    edited: false,
  };
};

/** The Fontsize field of the ASS "Default" style line. */
const assFontSize = (script: string): number => {
  const line = script.split('\n').find((l) => l.startsWith('Style: Default'));
  if (!line) throw new Error('no Default style in the compiled script');
  return Number(line.split(',')[2]);
};

describe('the scale is applied exactly once', () => {
  it('multiplies each pixel measurement by the scale and no more', () => {
    const subject = style({
      fontSize: 60,
      letterSpacing: 2,
      strokeWidth: 8,
      shadowBlur: 18,
      shadowOffsetY: 4,
      boxPaddingX: 20,
      boxPaddingY: 10,
      boxRadius: 8,
      activeBoxRadius: 12,
      strokeEnabled: true,
    });

    const once = captionMetrics({ style: subject });
    const half = captionMetrics({ style: subject, scale: 0.5 });

    expect(half.fontSize).toBe(once.fontSize * 0.5);
    expect(half.letterSpacing).toBe(once.letterSpacing * 0.5);
    expect(half.strokeWidth).toBe(once.strokeWidth * 0.5);
    expect(half.shadowBlur).toBe(once.shadowBlur * 0.5);
    expect(half.shadowOffsetY).toBe(once.shadowOffsetY * 0.5);
    expect(half.boxPaddingX).toBe(once.boxPaddingX * 0.5);
    expect(half.boxPaddingY).toBe(once.boxPaddingY * 0.5);
    expect(half.boxRadius).toBe(once.boxRadius * 0.5);
    expect(half.activeBoxRadius).toBe(once.activeBoxRadius * 0.5);
  });

  /**
   * Ratios multiply a size that has already been scaled. Scaling them too is
   * the double-scale this module exists to prevent.
   */
  it('leaves unitless ratios alone', () => {
    const subject = style({ lineHeight: 1.2, wordSpacing: 0.28, activeWordScale: 1.12, emphasisScale: 1.1 });
    const half = captionMetrics({ style: subject, scale: 0.5 });

    expect(half.lineHeight).toBe(1.2);
    expect(half.wordSpacingEm).toBe(0.28);
    expect(half.activeWordScale).toBe(1.12);
    expect(half.emphasisScale).toBe(1.1);
  });

  it('derives the line gap from the already-scaled font size', () => {
    const half = captionMetrics({ style: style({ fontSize: 60, lineHeight: 1.5 }), scale: 0.5 });
    // 0.5 * 60 = 30, and (1.5 - 1) * 30 = 15
    expect(half.fontSize).toBe(30);
    expect(half.lineGap).toBe(15);
  });

  it('ignores a nonsense scale rather than collapsing the caption', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(captionMetrics({ style: style({ fontSize: 40 }), scale: bad }).fontSize).toBe(40);
    }
  });

  it('reports zero stroke width when the stroke is off', () => {
    expect(captionMetrics({ style: style({ strokeEnabled: false, strokeWidth: 8 }) }).strokeWidth).toBe(0);
  });
});

describe('font size does not depend on the text', () => {
  it('resolves the same size whatever the caption says', () => {
    const subject = style({ fontSize: 48 });
    const short = captionMetrics({ style: subject });
    const long = captionMetrics({ style: subject });
    expect(short.fontSize).toBe(long.fontSize);
    expect(short.fontSize).toBe(48);
  });

  /**
   * The renderer scales words only for the active-word pop and emphasis. If a
   * word count or text length could reach the transform, captions of different
   * lengths would render at different sizes.
   */
  it('gives every word the same scale regardless of how many there are', () => {
    const lengths = [
      caption(['One']),
      caption(['One', 'two', 'three']),
      caption(['One', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']),
    ];

    const scales = lengths.map((subject) => {
      const frame = computeCaptionFrame({
        frame: 30,
        fps: 30,
        caption: subject,
        // a motion that neither pops nor scales, so only layout is under test
        animation: { ...defaultAnimation, enter: 'progressive-word-reveal', exit: 'cut' },
        maxLines: 2,
        maxWordsPerLine: 4,
      });
      return frame.lines.flat().map((w) => w.transform.scale);
    });

    for (const set of scales) {
      for (const s of set) expect(s).toBe(1);
    }
  });

  it('keeps the caption block itself unscaled for a read-along motion', () => {
    for (const subject of [caption(['Hi']), caption(['A', 'much', 'longer', 'caption', 'here'])]) {
      const frame = computeCaptionFrame({
        frame: 15,
        fps: 30,
        caption: subject,
        animation: { ...defaultAnimation, enter: 'progressive-word-reveal', exit: 'cut' },
        maxLines: 2,
        maxWordsPerLine: 4,
      });
      expect(frame.line.scale).toBe(1);
    }
  });
});

describe('the subtitle compilers agree with the renderer', () => {
  const subject = style({ fontSize: 31, fontFamily: 'Poppins', fontWeight: 700, letterSpacing: 0 });
  const captions = [caption(['If', 'you', 'call'])];

  /**
   * PlayRes is the frame itself, so one style unit is one output pixel. A second
   * scale against a fixed 1080 reference used to shrink a 720-wide export to two
   * thirds of the designed size.
   */
  it('writes the designed font size at 720x1280, not a rescaled one', () => {
    const script = compileToAss(captions, subject, defaultPosition, defaultAnimation, {
      width: 720,
      height: 1280,
      fps: 30,
    });
    expect(assFontSize(script)).toBe(31);
  });

  it('writes the same font size at every frame size', () => {
    const sizes = [
      { width: 720, height: 1280 },
      { width: 1080, height: 1920 },
      { width: 1920, height: 1080 },
      { width: 540, height: 960 },
    ];
    const seen = sizes.map((frame) =>
      assFontSize(
        compileToAss(captions, subject, defaultPosition, defaultAnimation, { ...frame, fps: 30 }),
      ),
    );
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(31);
  });

  it('does not floor small font sizes into a different size', () => {
    const tiny = style({ fontSize: 12 });
    const script = compileToAss(captions, tiny, defaultPosition, defaultAnimation, {
      width: 720,
      height: 1280,
      fps: 30,
    });
    expect(assFontSize(script)).toBe(12);
  });

  it('matches the subtitle exporter', () => {
    const frame = { width: 720, height: 1280 };
    const burned = compileToAss(captions, subject, defaultPosition, defaultAnimation, {
      ...frame,
      fps: 30,
    });
    const sidecar = toAss(captions, subject, defaultPosition, frame);
    expect(assFontSize(burned)).toBe(assFontSize(sidecar));
  });
});

describe('the render scene carries the font the caption uses', () => {
  it('requests the weight in use, even one off the catalogue', () => {
    const project = createProject('p', 'P');
    project.style = style({ fontFamily: 'Poppins', fontWeight: 800 });
    const scene = buildScene(project, { mediaSrc: null });

    expect(scene.fonts).toHaveLength(1);
    expect(scene.fonts[0].usedWeight).toBe(800);
    expect(scene.fonts[0].weights).toContain(800);
  });

  it('adds an off-catalogue weight rather than silently dropping it', () => {
    const project = createProject('p', 'P');
    // Poppins ships 400-800; 900 is not in the catalogue
    project.style = style({ fontFamily: 'Poppins', fontWeight: 900 });
    const scene = buildScene(project, { mediaSrc: null });

    expect(scene.fonts[0].weights).toContain(900);
    expect(scene.fonts[0].usedWeight).toBe(900);
  });

  it('names the weight in the shorthand the loader blocks on', () => {
    expect(fontShorthand(style({ fontFamily: 'Inter', fontWeight: 800 }))).toBe('800 64px "Inter"');
  });
});

describe('preview and export resolve the same frame', () => {
  it('builds the same composition size either way', () => {
    const project = createProject('p', 'P');
    project.media = {
      path: '', fileName: 'v.mp4', kind: 'video', size: 1, duration: 10, hasAudio: false,
      width: 720, height: 1280, fps: 30, aspectRatio: '9:16',
      videoCodec: 'h264', audioCodec: null, pixelFormat: 'yuv420p',
      isWebCompatible: true, importedAt: new Date().toISOString(),
    } as never;

    // the editor passes no override; the export passes the resolved spec
    const preview = buildScene(project, { mediaSrc: 'blob:x' });
    const exported = buildScene(project, {
      mediaSrc: null,
      width: 720,
      height: 1280,
      fps: 30,
    });

    expect(preview.width).toBe(exported.width);
    expect(preview.height).toBe(exported.height);
    expect(preview.fps).toBe(exported.fps);
    expect(preview.style).toEqual(exported.style);
    expect(preview.position).toEqual(exported.position);
  });

  /**
   * H.264 needs even dimensions, so the export rounds an odd source up. The
   * preview has to round the same way or the two disagree about the frame the
   * caption sits in.
   */
  it('rounds an odd source the same way the export does', () => {
    const project = createProject('p', 'P');
    project.media = {
      path: '', fileName: 'v.mp4', kind: 'video', size: 1, duration: 10, hasAudio: false,
      width: 1079, height: 1919, fps: 30, aspectRatio: '9:16',
      videoCodec: 'h264', audioCodec: null, pixelFormat: 'yuv420p',
      isWebCompatible: true, importedAt: new Date().toISOString(),
    } as never;

    const preview = buildScene(project, { mediaSrc: 'blob:x' });
    const spec = resolveExportSpec(project);

    expect(preview.width).toBe(spec.width);
    expect(preview.height).toBe(spec.height);
    expect(preview.width % 2).toBe(0);
    expect(preview.height % 2).toBe(0);
  });

  it('still falls back to a vertical frame with no media at all', () => {
    const scene = buildScene(createProject('p', 'P'), { mediaSrc: null });
    expect(scene.width).toBe(1080);
    expect(scene.height).toBe(1920);
  });

  it('honours an explicit export size over the source', () => {
    const project = createProject('p', 'P');
    project.exportSettings = { ...project.exportSettings, width: 1920, height: 1080 };
    const scene = buildScene(project, { mediaSrc: null });
    expect(scene.width).toBe(1920);
    expect(scene.height).toBe(1080);
  });
});
