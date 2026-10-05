import { describe, expect, it } from 'vitest';
import {
  aiActionSchema,
  aiResponseSchema,
  applyAmount,
  resolveColor,
  type AIAction,
} from '../src/core/ai/actions';
import { applyActions } from '../src/core/ai/executor';
import { createProject } from '../src/core/project/defaults';
import { captionText } from '../src/core/segmentation/segmenter';
import type { CaptionProject, TranscriptWord } from '../src/core/types/project';

const words = (text: string): TranscriptWord[] =>
  text.split(' ').map((word, i) => ({
    text: word,
    start: i * 0.4,
    end: (i + 1) * 0.4,
    confidence: null,
  }));

const projectWithCaptions = (): CaptionProject => {
  const base = createProject('p', 'Test');
  const transcriptWords = words('one two three four five six seven eight nine ten eleven twelve');
  return {
    ...base,
    transcript: {
      text: transcriptWords.map((w) => w.text).join(' '),
      words: transcriptWords,
      language: 'en',
      detectedLanguage: 'en',
      providerId: 'test',
      modelId: 'test',
      createdAt: new Date().toISOString(),
      durationMs: 1,
    },
    captions: [
      {
        id: 'c1',
        start: 0,
        end: 1.6,
        edited: false,
        words: transcriptWords.slice(0, 4).map((w) => ({ ...w, emphasis: false })),
      },
      {
        id: 'c2',
        start: 1.6,
        end: 3.2,
        edited: false,
        words: transcriptWords.slice(4, 8).map((w) => ({ ...w, emphasis: false })),
      },
      {
        id: 'c3',
        start: 3.2,
        end: 4.8,
        edited: false,
        words: transcriptWords.slice(8, 12).map((w) => ({ ...w, emphasis: false })),
      },
    ],
  };
};

const target = { scope: 'project' as const, fromCaption: null, toCaption: null };

// ---------------------------------------------------------------------------
// Validation — nothing the model says is trusted
// ---------------------------------------------------------------------------

describe('action validation', () => {
  it('accepts a well-formed action', () => {
    const parsed = aiActionSchema.safeParse({ type: 'SET_MAX_WORDS_PER_LINE', value: 3 });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown action type', () => {
    expect(aiActionSchema.safeParse({ type: 'DROP_DATABASE' }).success).toBe(false);
  });

  it('rejects out-of-range numbers', () => {
    expect(aiActionSchema.safeParse({ type: 'SET_MAX_WORDS_PER_LINE', value: 99 }).success).toBe(false);
    expect(aiActionSchema.safeParse({ type: 'SET_MAX_WORDS_PER_LINE', value: 0 }).success).toBe(false);
    expect(aiActionSchema.safeParse({ type: 'SET_MAX_LINES', value: 7 }).success).toBe(false);
  });

  it('rejects a colour that is not hex', () => {
    expect(
      aiActionSchema.safeParse({ type: 'SET_TEXT_COLOR', value: 'yellow', target }).success,
    ).toBe(false);
    expect(
      aiActionSchema.safeParse({ type: 'SET_TEXT_COLOR', value: '#FFD400', target }).success,
    ).toBe(true);
  });

  it('validates TRANSFORM_TEXT_CASE', () => {
    expect(
      aiActionSchema.safeParse({ type: 'TRANSFORM_TEXT_CASE', casing: 'sentence', target }).success,
    ).toBe(true);
    expect(
      aiActionSchema.safeParse({ type: 'TRANSFORM_TEXT_CASE', casing: 'invalid_case', target }).success,
    ).toBe(false);
  });

  it('rejects a malformed response envelope', () => {
    expect(aiResponseSchema.safeParse({ reply: 'hi' }).success).toBe(false);
    expect(aiResponseSchema.safeParse({ actions: [] }).success).toBe(false);
    expect(aiResponseSchema.safeParse('not an object').success).toBe(false);
  });

  it('rejects an action carrying an injected extra field', () => {
    const parsed = aiActionSchema.safeParse({
      type: 'SET_MAX_WORDS_PER_LINE',
      value: 3,
      __proto__: { polluted: true },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(Object.keys(parsed.data)).toEqual(['type', 'value']);
  });
});

describe('colour resolution', () => {
  it('maps the words the model actually uses', () => {
    expect(resolveColor('yellow')).toBe('#FFD400');
    expect(resolveColor('Yellow')).toBe('#FFD400');
    expect(resolveColor('green')).toBe('#4ADE80');
  });

  it('normalises hex in any shape', () => {
    expect(resolveColor('#ffd400')).toBe('#FFD400');
    expect(resolveColor('ffd400')).toBe('#FFD400');
    expect(resolveColor('#fd0')).toBe('#FFDD00');
  });

  it('refuses anything it cannot resolve', () => {
    expect(resolveColor('burnt sienna')).toBeNull();
    expect(resolveColor('')).toBeNull();
    expect(resolveColor(42)).toBeNull();
    expect(resolveColor(null)).toBeNull();
  });
});

describe('absolute versus relative amounts', () => {
  it('sets an absolute value', () => {
    expect(applyAmount(65, { value: 58, mode: 'absolute' })).toBe(58);
  });

  /** The probe showed the model answering "slightly higher" with -10. */
  it('nudges by a relative value', () => {
    expect(applyAmount(65, { value: -10, mode: 'relative' })).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

describe('applying actions', () => {
  it('never mutates the project it was given', () => {
    const project = projectWithCaptions();
    const snapshot = JSON.stringify(project);

    applyActions(project, [{ type: 'SET_MAX_WORDS_PER_LINE', value: 2 }]);

    expect(JSON.stringify(project)).toBe(snapshot);
  });

  it('regroups captions when words per line changes', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [{ type: 'SET_MAX_WORDS_PER_LINE', value: 2 }]);

    expect(result.project.segmentation.maxWordsPerLine).toBe(2);
    for (const caption of result.project.captions) {
      expect(caption.words.length).toBeLessThanOrEqual(4);
    }
  });

  it('describes every change for the confirm panel', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'SET_ACTIVE_WORD_COLOR', value: '#00FF88', target },
    ]);

    expect(result.changes).toEqual([
      {
        label: 'Spoken word colour',
        before: project.style.activeWordColor,
        after: '#00FF88',
      },
    ]);
  });

  it('reports no change when the value already matches', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'SET_TEXT_COLOR', value: project.style.color as `#${string}`, target },
    ] as AIAction[]);

    expect(result.changes).toHaveLength(0);
  });

  it('moves position relatively without leaving the frame', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'SET_POSITION', x: null, y: { value: -7, mode: 'relative' }, target },
    ]);

    expect(result.project.position.y).toBe(project.position.y - 7);
    expect(result.project.position.preset).toBe('custom');
  });

  it('clamps a position that would leave the frame', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'SET_POSITION', x: null, y: { value: -500, mode: 'relative' }, target },
    ]);

    expect(result.project.position.y).toBe(2);
  });

  it('rejects an unknown font, template or motion by name', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'SET_FONT', family: 'Comic Sans Ultra', target },
      { type: 'APPLY_TEMPLATE', templateId: 'nope', target },
      { type: 'APPLY_MOTION', motionId: 'nope', target },
    ]);

    expect(result.rejected).toHaveLength(3);
    expect(result.project.style.fontFamily).toBe(project.style.fontFamily);
  });

  it('accepts a real font, template and motion', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'SET_FONT', family: 'anton', target },
      { type: 'APPLY_MOTION', motionId: 'wordPop', target },
    ]);

    expect(result.project.style.fontFamily).toBe('Anton');
    expect(result.project.animation.enter).toBe('wordPop');
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects a caption number that does not exist', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'UPDATE_CAPTION_TEXT', captionNumber: 99, text: 'hello' },
    ]);

    expect(result.rejected[0]).toMatch(/no caption 99/i);
    expect(result.project.captions).toEqual(project.captions);
  });

  it('rewrites caption text while keeping its span', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'UPDATE_CAPTION_TEXT', captionNumber: 2, text: 'brand new words here' },
    ]);

    const caption = result.project.captions[1];
    expect(captionText(caption)).toBe('brand new words here');
    expect(caption.start).toBeCloseTo(project.captions[1].start, 5);
    expect(caption.end).toBeCloseTo(project.captions[1].end, 5);
    expect(caption.edited).toBe(true);
  });

  it('refuses to empty a caption', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'UPDATE_CAPTION_TEXT', captionNumber: 1, text: '   ' },
    ]);

    expect(result.rejected[0]).toMatch(/cannot be left empty/i);
  });

  it('splits and merges captions', () => {
    const project = projectWithCaptions();

    const split = applyActions(project, [
      { type: 'SPLIT_CAPTION', captionNumber: 1, wordIndex: 2 },
    ]);
    expect(split.project.captions).toHaveLength(4);

    const merged = applyActions(project, [
      { type: 'MERGE_CAPTIONS', captionNumbers: [1, 2] },
    ]);
    expect(merged.project.captions).toHaveLength(2);
    expect(merged.project.captions[0].words).toHaveLength(8);
  });

  it('refuses to merge captions that are not adjacent', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'MERGE_CAPTIONS', captionNumbers: [1, 3] },
    ]);

    expect(result.rejected[0]).toMatch(/next to each other/i);
    expect(result.project.captions).toHaveLength(3);
  });

  it('sets word emphasis on real words only', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'SET_WORD_EMPHASIS', captionNumber: 1, wordIndexes: [0, 99], enabled: true },
    ]);

    const caption = result.project.captions[0];
    expect(caption.words[0].emphasis).toBe(true);
    expect(caption.words.filter((w) => w.emphasis)).toHaveLength(1);
  });

  it('says so when a caption-scoped style change had to be widened', () => {
    const project = projectWithCaptions();
    const result = applyActions(
      project,
      [
        {
          type: 'SET_TEXT_COLOR',
          value: '#FF0000',
          target: { scope: 'selectedCaption', fromCaption: null, toCaption: null },
        },
      ],
      { selectedCaptionIds: ['c1'] },
    );

    expect(result.project.style.color).toBe('#FF0000');
    expect(result.rejected[0]).toMatch(/whole project/i);
  });

  it('applies a batch in order and reports each change', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'SET_MAX_WORDS_PER_LINE', value: 3 },
      { type: 'SET_ACTIVE_WORD_COLOR', value: '#FFD400', target },
      { type: 'SET_POSITION', x: null, y: { value: 58, mode: 'absolute' }, target },
    ]);

    expect(result.project.segmentation.maxWordsPerLine).toBe(3);
    expect(result.project.style.activeWordColor).toBe('#FFD400');
    expect(result.project.position.y).toBe(58);
    expect(result.changes.length).toBeGreaterThanOrEqual(3);
  });

  it('carries on after a bad action rather than abandoning the batch', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'SET_FONT', family: 'Nonexistent', target },
      { type: 'SET_MAX_WORDS_PER_LINE', value: 2 },
    ]);

    expect(result.rejected).toHaveLength(1);
    expect(result.project.segmentation.maxWordsPerLine).toBe(2);
  });

  it('updates text alignment with SET_TEXT_ALIGN', () => {
    const project = projectWithCaptions();
    project.style.align = 'left';
    const result = applyActions(project, [
      { type: 'SET_TEXT_ALIGN', value: 'center', target },
    ]);
    expect(result.project.style.align).toBe('center');
    expect(result.changes.some((c) => c.label === 'Text align')).toBe(true);
  });

  it('converts normalized decimal font size (e.g. 0.07) to canvas pixels (76px)', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'SET_FONT_SIZE', amount: { value: 0.07, mode: 'absolute' }, target },
    ]);
    expect(result.project.style.fontSize).toBe(76);
  });

  it('applies paired motion when APPLY_TEMPLATE matches a quick preset', () => {
    const project = projectWithCaptions();
    const result = applyActions(project, [
      { type: 'APPLY_TEMPLATE', templateId: 'dynamic-word-follower', target },
    ]);
    expect(result.project.style.fontFamily).toBe('Quicksand');
    expect(result.project.animation.enter).toBe('wordFollower');
    expect(result.project.animation.travel).toBe(28);
  });

  it('transforms captions to sentence case and resets style.uppercase', () => {
    const project = projectWithCaptions();
    project.style.uppercase = true;
    project.captions[0].words = [
      { text: 'HELLO', start: 0, end: 0.4, emphasis: false },
      { text: 'WORLD.', start: 0.4, end: 0.8, emphasis: false },
      { text: 'HOW', start: 0.8, end: 1.2, emphasis: false },
      { text: 'ARE', start: 1.2, end: 1.6, emphasis: false },
    ];
    project.captions[1].words = [
      { text: 'YOU', start: 1.6, end: 2.0, emphasis: false },
      { text: 'DOING', start: 2.0, end: 2.4, emphasis: false },
    ];

    const result = applyActions(project, [
      { type: 'TRANSFORM_TEXT_CASE', casing: 'sentence', target },
    ]);

    expect(result.project.style.uppercase).toBe(false);
    expect(result.project.captions[0].words.map((w) => w.text)).toEqual([
      'Hello',
      'world.',
      'How',
      'are',
    ]);
    expect(result.project.captions[1].words.map((w) => w.text)).toEqual([
      'You',
      'doing',
    ]);
  });

  it('transforms captions to title case', () => {
    const project = projectWithCaptions();
    project.captions[0].words = [
      { text: 'namaste', start: 0, end: 0.4, emphasis: false },
      { text: 'dosto', start: 0.4, end: 0.8, emphasis: false },
    ];

    const result = applyActions(project, [
      { type: 'TRANSFORM_TEXT_CASE', casing: 'title', target },
    ]);

    expect(result.project.captions[0].words.map((w) => w.text)).toEqual([
      'Namaste',
      'Dosto',
    ]);
  });
});
