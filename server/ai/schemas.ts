import { resolveColor } from '../../src/core/ai/actions';

/**
 * The JSON Schema handed to the model, and the translation back into the typed
 * actions the executor understands.
 *
 * Two things forced this shape, both found by probing the live API:
 *
 *  - Parallel tool calls are unreliable. Asked for three changes, the model
 *    returned one. A single response containing an array of actions returns
 *    all of them, every time.
 *  - Strict schema mode requires every property to appear in `required`, so
 *    optional fields have to be nullable rather than absent. Hence one flat
 *    action shape with many nullable fields, normalised back into the tagged
 *    union here.
 */

export const ACTION_TYPES = [
  'SET_FONT',
  'SET_FONT_SIZE',
  'SET_FONT_WEIGHT',
  'SET_UPPERCASE',
  'TRANSFORM_TEXT_CASE',
  'SET_TEXT_COLOR',
  'SET_ACTIVE_WORD_COLOR',
  'SET_EMPHASIS_COLOR',
  'SET_POSITION',
  'SET_TEXT_ALIGN',
  'APPLY_TEMPLATE',
  'APPLY_MOTION',
  'SET_BACKGROUND',
  'SET_MAX_WORDS_PER_LINE',
  'SET_MAX_LINES',
  'SET_READING_SPEED',
  'UPDATE_CAPTION_TEXT',
  'SPLIT_CAPTION',
  'MERGE_CAPTIONS',
  'SET_WORD_EMPHASIS',
  'RUN_CAPTION_QA',
] as const;

const SCOPES = ['project', 'selectedCaption', 'selectedCaptions', 'selectedWords', 'range'] as const;

const nullable = (type: string) => ({ type: [type, 'null'] });

const flatAction = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ACTION_TYPES },
    scope: {
      type: 'string',
      enum: SCOPES,
      description: 'Who the change applies to. Use "project" unless the user clearly meant a selection or a numbered range.',
    },
    fromCaption: { ...nullable('integer'), description: 'First caption number for scope "range", 1-based.' },
    toCaption: { ...nullable('integer'), description: 'Last caption number for scope "range", 1-based.' },

    family: { ...nullable('string'), description: 'Font family name, for SET_FONT.' },
    templateId: { ...nullable('string'), description: 'Template id, for APPLY_TEMPLATE.' },
    motionId: { ...nullable('string'), description: 'Motion id, for APPLY_MOTION.' },
    color: { ...nullable('string'), description: 'Colour as hex (#FFD400) or a common name.' },
    backgroundMode: { type: ['string', 'null'], enum: ['source', 'solid', 'transparent', null] },
    casing: {
      type: ['string', 'null'],
      enum: ['sentence', 'title', 'lower', 'upper', null],
      description: 'Text casing mode: "sentence" (capitalize first letter of each caption), "title" (capitalize every word), "lower" (all lowercase), "upper" (all uppercase).',
    },

    number: { ...nullable('number'), description: 'The numeric value for size, weight, words per line, lines or reading speed.' },
    numberMode: {
      type: ['string', 'null'],
      enum: ['absolute', 'relative', null],
      description: 'Use "relative" when the user asked for a nudge such as "a bit bigger" or "slightly higher".',
    },
    x: { ...nullable('number'), description: 'Horizontal position, percent of frame width.' },
    xMode: { type: ['string', 'null'], enum: ['absolute', 'relative', null] },
    y: { ...nullable('number'), description: 'Vertical position, percent of frame height. Lower number is higher up the frame.' },
    yMode: { type: ['string', 'null'], enum: ['absolute', 'relative', null] },
    align: {
      type: ['string', 'null'],
      enum: ['left', 'center', 'right', null],
      description: 'Text alignment, for SET_TEXT_ALIGN.',
    },

    enabled: { ...nullable('boolean') },
    text: { ...nullable('string'), description: 'Replacement caption text, for UPDATE_CAPTION_TEXT.' },
    captionNumber: { ...nullable('integer'), description: '1-based caption number, as shown in the list.' },
    captionNumbers: { type: ['array', 'null'], items: { type: 'integer' } },
    wordIndex: { ...nullable('integer'), description: '0-based word index to split before.' },
    wordIndexes: { type: ['array', 'null'], items: { type: 'integer' } },
  },
  required: [
    'type', 'scope', 'fromCaption', 'toCaption',
    'family', 'templateId', 'motionId', 'color', 'backgroundMode', 'casing',
    'number', 'numberMode', 'x', 'xMode', 'y', 'yMode', 'align',
    'enabled', 'text', 'captionNumber', 'captionNumbers', 'wordIndex', 'wordIndexes',
  ],
  additionalProperties: false,
};

export const responseSchema = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'One short sentence for the user, in plain language. No markdown.',
    },
    actions: { type: 'array', items: flatAction },
  },
  required: ['reply', 'actions'],
  additionalProperties: false,
};

export interface FlatAction {
  type: string;
  scope: string;
  fromCaption: number | null;
  toCaption: number | null;
  family: string | null;
  templateId: string | null;
  motionId: string | null;
  color: string | null;
  backgroundMode: string | null;
  casing: 'sentence' | 'title' | 'lower' | 'upper' | null;
  number: number | null;
  numberMode: string | null;
  x: number | null;
  xMode: string | null;
  y: number | null;
  yMode: string | null;
  align: 'left' | 'center' | 'right' | null;
  enabled: boolean | null;
  text: string | null;
  captionNumber: number | null;
  captionNumbers: number[] | null;
  wordIndex: number | null;
  wordIndexes: number[] | null;
}

const amount = (value: number | null, mode: string | null) =>
  value === null ? null : { value, mode: mode === 'relative' ? 'relative' : 'absolute' };

const target = (flat: FlatAction) => ({
  scope: flat.scope,
  fromCaption: flat.fromCaption,
  toCaption: flat.toCaption,
});

/**
 * Reshapes one flat action into the tagged form the Zod union validates.
 *
 * Returns `null` for a type it does not know — the caller reports that as a
 * rejected action rather than guessing at intent.
 */
export const normaliseAction = (flat: FlatAction): unknown => {
  switch (flat.type) {
    case 'SET_FONT':
      return { type: flat.type, family: flat.family ?? '', target: target(flat) };

    case 'SET_FONT_SIZE':
      return { type: flat.type, amount: amount(flat.number, flat.numberMode), target: target(flat) };

    case 'SET_FONT_WEIGHT':
      return { type: flat.type, value: flat.number, target: target(flat) };

    case 'SET_UPPERCASE':
      return { type: flat.type, value: flat.enabled, target: target(flat) };

    case 'TRANSFORM_TEXT_CASE':
      return {
        type: flat.type,
        casing: flat.casing ?? 'sentence',
        target: target(flat),
      };

    case 'SET_TEXT_COLOR':
    case 'SET_ACTIVE_WORD_COLOR':
    case 'SET_EMPHASIS_COLOR':
      // the model says "yellow" as often as "#FFD400"; resolve before validating
      return { type: flat.type, value: resolveColor(flat.color), target: target(flat) };

    case 'SET_POSITION':
      return {
        type: flat.type,
        x: amount(flat.x, flat.xMode),
        y: amount(flat.y, flat.yMode),
        target: target(flat),
      };

    case 'SET_TEXT_ALIGN':
      return {
        type: flat.type,
        value: flat.align,
        target: target(flat),
      };

    case 'APPLY_TEMPLATE':
      return { type: flat.type, templateId: flat.templateId ?? '', target: target(flat) };

    case 'APPLY_MOTION':
      return { type: flat.type, motionId: flat.motionId ?? '', target: target(flat) };

    case 'SET_BACKGROUND':
      return {
        type: flat.type,
        mode: flat.backgroundMode,
        color: flat.color ? resolveColor(flat.color) : null,
      };

    case 'SET_MAX_WORDS_PER_LINE':
    case 'SET_MAX_LINES':
      return { type: flat.type, value: flat.number === null ? null : Math.round(flat.number) };

    case 'SET_READING_SPEED':
      return { type: flat.type, value: flat.number };

    case 'UPDATE_CAPTION_TEXT':
      return { type: flat.type, captionNumber: flat.captionNumber, text: flat.text ?? '' };

    case 'SPLIT_CAPTION':
      return { type: flat.type, captionNumber: flat.captionNumber, wordIndex: flat.wordIndex };

    case 'MERGE_CAPTIONS':
      return { type: flat.type, captionNumbers: flat.captionNumbers ?? [] };

    case 'SET_WORD_EMPHASIS':
      return {
        type: flat.type,
        captionNumber: flat.captionNumber,
        wordIndexes: flat.wordIndexes ?? [],
        enabled: flat.enabled ?? true,
      };

    case 'RUN_CAPTION_QA':
      return { type: flat.type };

    default:
      return null;
  }
};
