import { z } from 'zod';

/**
 * The complete vocabulary the assistant is allowed to speak.
 *
 * Model output is never executed. It is parsed into one of these shapes,
 * validated, and only then handed to a pure reducer. An unknown action, an
 * out-of-range number or an unknown id is rejected before it can touch a
 * project.
 */

export const scopeSchema = z.enum([
  'project',
  'selectedCaption',
  'selectedCaptions',
  'selectedWords',
  'range',
]);

export type Scope = z.infer<typeof scopeSchema>;

/** Where a scoped action applies. `range` uses 1-based caption numbers. */
export const targetSchema = z.object({
  scope: scopeSchema,
  /** inclusive, 1-based, as the user sees them in the list */
  fromCaption: z.number().int().positive().nullable(),
  toCaption: z.number().int().positive().nullable(),
});

export type Target = z.infer<typeof targetSchema>;

const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a 6-digit hex value like #FFD400');

/**
 * Numbers can be absolute or a nudge.
 *
 * The probe showed the model answering "move captions slightly higher" with
 * -10, meaning a delta rather than a position. Making the mode explicit stops
 * that being silently misread as "put the caption at -10%".
 */
const amountSchema = z.object({
  value: z.number(),
  mode: z.enum(['absolute', 'relative']),
});

export type Amount = z.infer<typeof amountSchema>;

export const aiActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SET_FONT'), family: z.string().min(1), target: targetSchema }),
  z.object({ type: z.literal('SET_FONT_SIZE'), amount: amountSchema, target: targetSchema }),
  z.object({ type: z.literal('SET_FONT_WEIGHT'), value: z.number().int().min(100).max(900), target: targetSchema }),
  z.object({ type: z.literal('SET_UPPERCASE'), value: z.boolean(), target: targetSchema }),
  z.object({
    type: z.literal('TRANSFORM_TEXT_CASE'),
    casing: z.enum(['sentence', 'title', 'lower', 'upper']),
    target: targetSchema,
  }),
  z.object({ type: z.literal('SET_TEXT_COLOR'), value: hex, target: targetSchema }),
  z.object({ type: z.literal('SET_ACTIVE_WORD_COLOR'), value: hex, target: targetSchema }),
  z.object({ type: z.literal('SET_EMPHASIS_COLOR'), value: hex, target: targetSchema }),
  z.object({
    type: z.literal('SET_POSITION'),
    x: amountSchema.nullable(),
    y: amountSchema.nullable(),
    target: targetSchema,
  }),
  z.object({ type: z.literal('SET_TEXT_ALIGN'), value: z.enum(['left', 'center', 'right']), target: targetSchema }),
  z.object({ type: z.literal('APPLY_TEMPLATE'), templateId: z.string().min(1), target: targetSchema }),
  z.object({ type: z.literal('APPLY_MOTION'), motionId: z.string().min(1), target: targetSchema }),
  z.object({ type: z.literal('SET_BACKGROUND'), mode: z.enum(['source', 'solid', 'transparent']), color: hex.nullable() }),
  z.object({ type: z.literal('SET_MAX_WORDS_PER_LINE'), value: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal('SET_MAX_LINES'), value: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ type: z.literal('SET_READING_SPEED'), value: z.number().min(1).max(6) }),
  z.object({ type: z.literal('UPDATE_CAPTION_TEXT'), captionNumber: z.number().int().positive(), text: z.string() }),
  z.object({ type: z.literal('SPLIT_CAPTION'), captionNumber: z.number().int().positive(), wordIndex: z.number().int().min(1) }),
  z.object({ type: z.literal('MERGE_CAPTIONS'), captionNumbers: z.array(z.number().int().positive()).min(2) }),
  z.object({
    type: z.literal('SET_WORD_EMPHASIS'),
    captionNumber: z.number().int().positive(),
    wordIndexes: z.array(z.number().int().min(0)),
    enabled: z.boolean(),
  }),
  z.object({ type: z.literal('RUN_CAPTION_QA') }),
]);

export type AIAction = z.infer<typeof aiActionSchema>;

export const aiResponseSchema = z.object({
  reply: z.string(),
  actions: z.array(aiActionSchema),
});

export type AIResponse = z.infer<typeof aiResponseSchema>;

/** Colour words the model reaches for, so "make it yellow" does not fail. */
export const NAMED_COLORS: Record<string, string> = {
  white: '#FFFFFF',
  black: '#000000',
  yellow: '#FFD400',
  gold: '#FFC300',
  amber: '#FF9F1C',
  red: '#FF3B3B',
  crimson: '#FF3B5C',
  pink: '#FF2D55',
  magenta: '#FF2D55',
  green: '#4ADE80',
  lime: '#A3E635',
  blue: '#5B8CFF',
  cyan: '#22D3EE',
  teal: '#2DD4BF',
  orange: '#FF9F1C',
  purple: '#A78BFA',
  violet: '#A78BFA',
  grey: '#9AA1B1',
  gray: '#9AA1B1',
};

/**
 * Turns whatever the model said about a colour into a hex value.
 *
 * Returns null when it cannot be resolved, so validation rejects rather than
 * guessing at something the user did not ask for.
 */
export const resolveColor = (input: unknown): string | null => {
  if (typeof input !== 'string') return null;
  const raw = input.trim();

  const named = NAMED_COLORS[raw.toLowerCase()];
  if (named) return named;

  const withHash = raw.startsWith('#') ? raw : `#${raw}`;
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) return withHash.toUpperCase();

  // #abc shorthand
  const short = /^#([0-9a-fA-F]{3})$/.exec(withHash);
  if (short) {
    return (
      '#' +
      short[1]
        .split('')
        .map((c) => c + c)
        .join('')
        .toUpperCase()
    );
  }

  return null;
};

/** Resolves an amount against the current value. */
export const applyAmount = (current: number, amount: Amount): number =>
  amount.mode === 'absolute' ? amount.value : current + amount.value;
