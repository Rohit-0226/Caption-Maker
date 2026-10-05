import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normaliseAction, responseSchema, ACTION_TYPES, type FlatAction } from '../server/ai/schemas';
import { aiStatus, redact } from '../server/ai/aiClient';
import { aiActionSchema } from '../src/core/ai/actions';
import { runCaptionQA } from '../src/core/captions/qa';
import { createProject } from '../src/core/project/defaults';
import type { CaptionProject } from '../src/core/types/project';

const blank: FlatAction = {
  type: '',
  scope: 'project',
  fromCaption: null,
  toCaption: null,
  family: null,
  templateId: null,
  motionId: null,
  color: null,
  backgroundMode: null,
  casing: null,
  number: null,
  numberMode: null,
  x: null,
  xMode: null,
  y: null,
  yMode: null,
  align: null,
  enabled: null,
  text: null,
  captionNumber: null,
  captionNumbers: null,
  wordIndex: null,
  wordIndexes: null,
};

const flat = (patch: Partial<FlatAction>): FlatAction => ({ ...blank, ...patch });

/** The round trip the server does on every action the model returns. */
const roundTrip = (patch: Partial<FlatAction>) => {
  const shaped = normaliseAction(flat(patch));
  if (shaped === null) return { ok: false as const, reason: 'unknown type' };
  const parsed = aiActionSchema.safeParse(shaped);
  return parsed.success
    ? { ok: true as const, action: parsed.data }
    : { ok: false as const, reason: parsed.error.issues[0]?.message ?? 'invalid' };
};

// ---------------------------------------------------------------------------
// Schema sent to the model
// ---------------------------------------------------------------------------

describe('the schema handed to the model', () => {
  /**
   * Strict JSON-schema mode refuses a schema where a declared property is not
   * also listed in `required`. Getting this wrong is a 400 from the provider,
   * so it is worth asserting rather than discovering at runtime.
   */
  it('lists every property as required, as strict mode demands', () => {
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const schema = node as Record<string, unknown>;

      if (schema.type === 'object' && schema.properties) {
        const properties = Object.keys(schema.properties as object);
        const required = (schema.required as string[]) ?? [];
        expect(required.slice().sort()).toEqual(properties.slice().sort());
        expect(schema.additionalProperties).toBe(false);
      }

      for (const value of Object.values(schema)) walk(value);
    };

    walk(responseSchema);
  });

  it('advertises every action the executor understands', () => {
    for (const type of ACTION_TYPES) {
      expect(normaliseAction(flat({ type })), `${type} has no normaliser`).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Normalisation and validation
// ---------------------------------------------------------------------------

describe('turning model output into validated actions', () => {
  it('accepts a well-formed change', () => {
    const result = roundTrip({ type: 'SET_MAX_WORDS_PER_LINE', number: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action).toEqual({ type: 'SET_MAX_WORDS_PER_LINE', value: 3 });
  });

  it('rejects an action type it has never heard of', () => {
    expect(roundTrip({ type: 'DELETE_EVERYTHING' }).ok).toBe(false);
    expect(roundTrip({ type: 'eval' }).ok).toBe(false);
  });

  it('resolves a colour word into hex', () => {
    const result = roundTrip({ type: 'SET_ACTIVE_WORD_COLOR', color: 'yellow' });
    expect(result.ok).toBe(true);
    if (result.ok && result.action.type === 'SET_ACTIVE_WORD_COLOR') {
      expect(result.action.value).toBe('#FFD400');
    }
  });

  it('normalises and validates TRANSFORM_TEXT_CASE', () => {
    const result = roundTrip({ type: 'TRANSFORM_TEXT_CASE', casing: 'sentence' });
    expect(result.ok).toBe(true);
    if (result.ok && result.action.type === 'TRANSFORM_TEXT_CASE') {
      expect(result.action.casing).toBe('sentence');
      expect(result.action.target.scope).toBe('project');
    }
  });

  it('rejects a colour it cannot resolve rather than guessing', () => {
    expect(roundTrip({ type: 'SET_TEXT_COLOR', color: 'burnt sienna' }).ok).toBe(false);
    expect(roundTrip({ type: 'SET_TEXT_COLOR', color: null }).ok).toBe(false);
  });

  /** The live model answered "slightly higher" with a delta, not a position. */
  it('keeps relative and absolute apart', () => {
    const relative = roundTrip({ type: 'SET_POSITION', y: -5, yMode: 'relative' });
    expect(relative.ok).toBe(true);
    if (relative.ok && relative.action.type === 'SET_POSITION') {
      expect(relative.action.y).toEqual({ value: -5, mode: 'relative' });
    }

    const absolute = roundTrip({ type: 'SET_POSITION', y: 58, yMode: 'absolute' });
    if (absolute.ok && absolute.action.type === 'SET_POSITION') {
      expect(absolute.action.y).toEqual({ value: 58, mode: 'absolute' });
    }
  });

  it('defaults to absolute when the model omits the mode', () => {
    const result = roundTrip({ type: 'SET_FONT_SIZE', number: 80 });
    if (result.ok && result.action.type === 'SET_FONT_SIZE') {
      expect(result.action.amount.mode).toBe('absolute');
    }
  });

  it('rejects values outside the allowed range', () => {
    expect(roundTrip({ type: 'SET_MAX_WORDS_PER_LINE', number: 40 }).ok).toBe(false);
    expect(roundTrip({ type: 'SET_MAX_LINES', number: 9 }).ok).toBe(false);
    expect(roundTrip({ type: 'SET_READING_SPEED', number: 100 }).ok).toBe(false);
    expect(roundTrip({ type: 'SET_FONT_WEIGHT', number: 5000 }).ok).toBe(false);
  });

  it('rejects a missing required value', () => {
    expect(roundTrip({ type: 'SET_MAX_WORDS_PER_LINE', number: null }).ok).toBe(false);
    expect(roundTrip({ type: 'UPDATE_CAPTION_TEXT', captionNumber: null, text: 'x' }).ok).toBe(false);
    expect(roundTrip({ type: 'SET_FONT', family: null }).ok).toBe(false);
  });

  it('rounds a float the model sends for an integer field', () => {
    const result = roundTrip({ type: 'SET_MAX_WORDS_PER_LINE', number: 3.0 });
    expect(result.ok).toBe(true);
  });

  it('carries the scope and range through', () => {
    const result = roundTrip({
      type: 'SET_TEXT_COLOR',
      color: '#FF0000',
      scope: 'range',
      fromCaption: 12,
      toCaption: 20,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.action.type === 'SET_TEXT_COLOR') {
      expect(result.action.target).toEqual({ scope: 'range', fromCaption: 12, toCaption: 20 });
    }
  });

  it('accepts and validates SET_TEXT_ALIGN', () => {
    const result = roundTrip({ type: 'SET_TEXT_ALIGN', align: 'center' });
    expect(result.ok).toBe(true);
    if (result.ok && result.action.type === 'SET_TEXT_ALIGN') {
      expect(result.action.value).toBe('center');
    }
    expect(roundTrip({ type: 'SET_TEXT_ALIGN', align: 'justified' as any }).ok).toBe(false);
  });

  it('rejects an unknown scope', () => {
    expect(roundTrip({ type: 'SET_TEXT_COLOR', color: '#FFFFFF', scope: 'everything' }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Key handling
// ---------------------------------------------------------------------------

describe('provider configuration', () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.AI_API_KEY;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('reports not configured with no key', () => {
    const status = aiStatus();
    expect(status.configured).toBe(false);
    expect(status.reason).toMatch(/AI_API_KEY/);
  });

  /** Groq and xAI are different companies; a mixed-up key must never be sent. */
  it('refuses an xAI key when the provider is Groq', () => {
    process.env.AI_PROVIDER = 'groq';
    process.env.AI_API_KEY = 'xai-abcdefghijklmnop';

    const status = aiStatus();
    expect(status.configured).toBe(false);
    expect(status.reason).toMatch(/xAI key/i);
    expect(status.reason).toMatch(/AI_PROVIDER=xai/);
  });

  it('refuses a Groq key when the provider is xAI', () => {
    process.env.AI_PROVIDER = 'xai';
    process.env.AI_API_KEY = 'gsk_abcdefghijklmnop';

    const status = aiStatus();
    expect(status.configured).toBe(false);
    expect(status.reason).toMatch(/Groq key/i);
  });

  it('accepts a matching key', () => {
    process.env.AI_PROVIDER = 'groq';
    process.env.AI_API_KEY = 'gsk_abcdefghijklmnop';

    const status = aiStatus();
    expect(status.configured).toBe(true);
    expect(status.reason).toBeNull();
  });

  it('never reports the key itself', () => {
    process.env.AI_PROVIDER = 'groq';
    process.env.AI_API_KEY = 'xai-supersecretvalue123';

    expect(JSON.stringify(aiStatus())).not.toContain('supersecretvalue123');
  });
});

describe('redaction', () => {
  it('masks keys and bearer tokens in anything logged', () => {
    expect(redact('key gsk_abcdef1234567890 failed')).toBe('key gsk_*** failed');
    expect(redact('key xai-abcdef1234567890 failed')).toBe('key xai-*** failed');
    expect(redact('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer ***');
  });

  it('leaves ordinary text alone', () => {
    expect(redact('nothing secret here')).toBe('nothing secret here');
  });
});

// ---------------------------------------------------------------------------
// Caption QA
// ---------------------------------------------------------------------------

const projectWith = (captions: CaptionProject['captions']): CaptionProject => ({
  ...createProject('p', 'QA'),
  media: {
    path: 'x.mp4',
    fileName: 'x.mp4',
    kind: 'video',
    size: 1,
    duration: 30,
    hasAudio: true,
    width: 1080,
    height: 1920,
    fps: 30,
    aspectRatio: '9:16',
    videoCodec: 'h264',
    audioCodec: 'aac',
    importedAt: new Date().toISOString(),
  },
  captions,
});

const cue = (id: string, start: number, end: number, count: number) => ({
  id,
  start,
  end,
  edited: false,
  words: Array.from({ length: count }, (_, i) => ({
    text: `w${i}`,
    start: start + (i * (end - start)) / count,
    end: start + ((i + 1) * (end - start)) / count,
    emphasis: false,
  })),
});

describe('caption quality check', () => {
  it('passes a clean project', () => {
    const report = runCaptionQA(projectWith([cue('a', 0, 2, 4), cue('b', 2, 4, 4)]));
    expect(report.status).toBe('good');
    expect(report.issues).toHaveLength(0);
    expect(report.checked).toBe(2);
  });

  it('flags an empty project', () => {
    const report = runCaptionQA(projectWith([]));
    expect(report.issues.some((i) => i.code === 'no-captions')).toBe(true);
  });

  it('flags overlapping captions', () => {
    const report = runCaptionQA(projectWith([cue('a', 0, 3, 3), cue('b', 2, 4, 3)]));
    expect(report.issues.some((i) => i.code === 'overlap')).toBe(true);
  });

  it('flags a caption with too many words for the layout', () => {
    const report = runCaptionQA(projectWith([cue('a', 0, 6, 20)]));
    expect(report.issues.some((i) => i.code === 'too-many-words')).toBe(true);
  });

  it('flags a caption that reads too fast', () => {
    const report = runCaptionQA(projectWith([cue('a', 0, 0.5, 8)]));
    expect(report.issues.some((i) => i.code === 'too-fast')).toBe(true);
  });

  it('flags a caption that is barely on screen', () => {
    const report = runCaptionQA(projectWith([cue('a', 0, 0.15, 1)]));
    expect(report.issues.some((i) => i.code === 'very-short')).toBe(true);
  });

  it('flags an unknown font as fixable', () => {
    const project = projectWith([cue('a', 0, 2, 3)]);
    const report = runCaptionQA({
      ...project,
      style: { ...project.style, fontFamily: 'Nonexistent Face' },
    });
    const issue = report.issues.find((i) => i.code === 'missing-font');
    expect(issue?.fixable).toBe(true);
  });

  it('accepts an uploaded font as known', () => {
    const project = projectWith([cue('a', 0, 2, 3)]);
    const report = runCaptionQA(
      { ...project, style: { ...project.style, fontFamily: 'My Brand Face' } },
      { customFonts: ['My Brand Face'] },
    );
    expect(report.issues.some((i) => i.code === 'missing-font')).toBe(false);
  });

  it('flags captions sitting under a platform interface', () => {
    const project = projectWith([cue('a', 0, 2, 3)]);
    const report = runCaptionQA(
      { ...project, position: { ...project.position, y: 92 } },
      { safeZone: 'tiktok' },
    );
    expect(report.issues.some((i) => i.code === 'outside-safe-zone')).toBe(true);
  });
});
