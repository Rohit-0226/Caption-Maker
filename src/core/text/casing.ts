import type { Caption, CaptionWord, TranscriptWord } from '../types/project';

export type TextCasing = 'sentence' | 'title' | 'lower' | 'upper';

/**
 * Checks whether a word token ends with sentence-terminating punctuation.
 */
export const endsSentence = (text: string): boolean => {
  return /[.!?]+["')\]}]*$/.test(text.trim());
};

/**
 * Transforms a single token/word according to the requested casing rule.
 * Handles leading non-letter symbols/punctuation, e.g. "(hello" -> "(Hello", "“world”" -> "“World”".
 */
export const transformWordCasing = (
  text: string,
  casing: TextCasing,
  shouldCapitalize: boolean,
): string => {
  if (!text) return text;
  if (casing === 'upper') return text.toUpperCase();
  if (casing === 'lower') return text.toLowerCase();

  // Match leading punctuation/symbols, first letter, and remainder
  const match = text.match(/^([^\p{L}\p{N}]*)(\p{L})(.*)$/u);
  if (!match) {
    return text;
  }

  const [, prefix, firstLetter, rest] = match;
  if (casing === 'title' || (casing === 'sentence' && shouldCapitalize)) {
    return prefix + firstLetter.toUpperCase() + rest.toLowerCase();
  }
  return prefix + firstLetter.toLowerCase() + rest.toLowerCase();
};

/**
 * Transforms an array of words for a single caption.
 * For 'sentence' casing:
 * - First word of the caption is capitalized.
 * - Any word immediately following a sentence-ending punctuation mark is capitalized.
 * - All other words are lowercased.
 * For 'title' casing:
 * - Every word is capitalized.
 * For 'lower':
 * - All words lowercased.
 * For 'upper':
 * - All words uppercased.
 */
export const transformCaptionWords = <T extends { text: string }>(
  words: T[],
  casing: TextCasing,
): T[] => {
  let prevEndedSentence = false;
  return words.map((w, idx) => {
    const isFirst = idx === 0;
    const shouldCapitalize = isFirst || prevEndedSentence;
    const newText = transformWordCasing(w.text, casing, shouldCapitalize);
    prevEndedSentence = endsSentence(w.text);
    return {
      ...w,
      text: newText,
    };
  });
};

/**
 * Transforms all captions in a project or a specified subset.
 */
export const transformCaptions = (
  captions: Caption[],
  casing: TextCasing,
  targetIds?: string[],
): Caption[] => {
  return captions.map((caption) => {
    if (targetIds && targetIds.length > 0 && !targetIds.includes(caption.id)) {
      return caption;
    }
    return {
      ...caption,
      words: transformCaptionWords(caption.words, casing),
      edited: true,
    };
  });
};
