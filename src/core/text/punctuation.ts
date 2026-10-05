import type { Caption, CaptionWord, TranscriptWord } from '../types/project';
import { endsSentence, transformWordCasing } from './casing';

/**
 * Common question starter words in English and Roman Hindi (Hinglish).
 */
const QUESTION_STARTERS = new Set([
  // English
  'who', 'whom', 'whose', 'what', 'which', 'where', 'when', 'why', 'how',
  'is', 'isn\'t', 'are', 'aren\'t', 'am', 'was', 'wasn\'t', 'were', 'weren\'t',
  'do', 'don\'t', 'does', 'doesn\'t', 'did', 'didn\'t',
  'can', 'can\'t', 'cannot', 'could', 'couldn\'t',
  'will', 'won\'t', 'would', 'wouldn\'t',
  'shall', 'should', 'shouldn\'t',
  'may', 'might', 'must',
  // Hindi / Hinglish
  'kya', 'kyun', 'kyu', 'kaise', 'kab', 'kahan', 'kaha', 'kidhar', 'kaun', 'kis', 'kisko', 'kisse', 'kitna', 'kitne', 'kitni',
]);

/**
 * Strips leading and trailing punctuation from a token while preserving
 * interior letters, numbers, and hyphens (e.g. "state-of-the-art" -> "state-of-the-art", "hello!" -> "hello").
 */
export const stripPunctuation = (text: string): string => {
  if (!text) return '';
  return text.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
};

/**
 * Extracts the trailing punctuation from a token (e.g. "hello!?" -> "!?").
 */
export const getTrailingPunctuation = (text: string): string => {
  const match = text.match(/[^\p{L}\p{N}\s]+$/u);
  return match ? match[0] : '';
};

/**
 * Checks if a word token has any sentence-ending punctuation (. ? !).
 */
export const hasSentencePunctuation = (text: string): boolean => {
  return /[.!?]+["')\]}]*$/.test(text.trim());
};

/**
 * Capitalizes the first letter of a word while preserving leading punctuation/symbols.
 */
export const capitalizeWord = (text: string): string => {
  return transformWordCasing(text, 'sentence', true);
};

/**
 * Lowercases the first letter of a word while preserving leading punctuation/symbols.
 */
export const lowercaseWord = (text: string): string => {
  return transformWordCasing(text, 'lower', false);
};

/**
 * Aligns Whisper segment-level punctuated text onto word tokens.
 * Whisper provides `response.segments` with rich punctuation (periods, commas, question marks),
 * but often strips punctuation from `response.words`.
 * This transfers the punctuation from segment tokens to corresponding words.
 */
export const alignPunctuation = (
  words: TranscriptWord[],
  referenceSegments: Array<{ text: string; start?: number; end?: number }>,
): TranscriptWord[] => {
  if (!words || words.length === 0) return [];
  if (!referenceSegments || referenceSegments.length === 0) return words;

  // Collect all punctuated tokens from reference segments in order
  const segmentTokens: Array<{ raw: string; clean: string; trail: string; lead: string }> = [];
  for (const seg of referenceSegments) {
    const rawTokens = (seg.text || '').trim().split(/\s+/).filter(Boolean);
    for (const raw of rawTokens) {
      const clean = stripPunctuation(raw).toLowerCase();
      if (!clean) continue;
      const lead = raw.match(/^[^\p{L}\p{N}]+/u)?.[0] ?? '';
      const trail = raw.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? '';
      segmentTokens.push({ raw, clean, trail, lead });
    }
  }

  if (segmentTokens.length === 0) return words;

  let segIdx = 0;
  return words.map((word) => {
    const cleanWord = stripPunctuation(word.text).toLowerCase();
    if (!cleanWord) return word;

    // Search within a small window around segIdx for matching token
    const searchWindow = 6;
    let matchIdx = -1;
    for (let offset = 0; offset < searchWindow && segIdx + offset < segmentTokens.length; offset++) {
      if (segmentTokens[segIdx + offset].clean === cleanWord) {
        matchIdx = segIdx + offset;
        break;
      }
    }

    if (matchIdx !== -1) {
      const matched = segmentTokens[matchIdx];
      segIdx = matchIdx + 1;

      // Attach trailing punctuation if the word didn't already have it
      let newText = word.text;
      const existingTrail = getTrailingPunctuation(newText);
      if (!existingTrail && matched.trail) {
        newText = `${newText}${matched.trail}`;
      }

      // If matched segment token was capitalized and word wasn't, inherit capitalization
      const matchedFirstChar = matched.clean.charAt(0);
      const isSegmentCapitalized = matched.raw.includes(matchedFirstChar.toUpperCase());
      if (isSegmentCapitalized && !word.text.charAt(0).match(/[A-Z]/)) {
        newText = capitalizeWord(newText);
      }

      return {
        ...word,
        text: newText,
      };
    }

    return word;
  });
};

/**
 * Checks whether a caption or phrase starts with a question starter word.
 */
export const isQuestionSentence = (firstWordText: string): boolean => {
  const clean = stripPunctuation(firstWordText).toLowerCase();
  return QUESTION_STARTERS.has(clean);
};

/**
 * Applies or restores punctuation across all captions:
 * 1. Attaches appropriate sentence/clause punctuation where missing (. or ?).
 * 2. Crucial: CAPITALIZES the first letter of the word immediately following
 *    any sentence-terminating punctuation (. ? !) and at each caption/sentence start.
 * 3. Saves cached `punctuatedText` and `unpunctuatedText` on each CaptionWord.
 */
/**
 * Common clause connectors and introductory phrases that take a comma in English & Hinglish.
 */
const CLAUSE_CONNECTORS = new Set([
  'but', 'because', 'although', 'while', 'whereas', 'however',
  'lekin', 'kyunki', 'parantu', 'magar', 'isliye', 'jabki', 'waise',
]);

const INTRO_MARKERS = new Set([
  'basically', 'actually', 'honestly', 'matlab', 'dekho', 'suno', 'doston', 'bhai',
]);

/**
 * Applies or restores punctuation across all captions:
 * 1. If transcriptText is available, aligns exact commas, question marks, periods, and exclamations.
 * 2. If missing, applies natural punctuation heuristics (clause commas, question marks, sentence periods).
 * 3. Crucial: CAPITALIZES the first letter of the word immediately following
 *    any sentence-terminating punctuation (. ? !) and at each caption/sentence start.
 * 4. Saves cached `punctuatedText` and `unpunctuatedText` on each CaptionWord.
 */
export const applyCaptionPunctuation = (
  captions: Caption[],
  transcriptText?: string,
): Caption[] => {
  if (!captions || captions.length === 0) return [];

  // Reference tokens from transcript text if available
  const refTokens = transcriptText
    ? transcriptText.trim().split(/\s+/).filter(Boolean)
    : [];
  let refIdx = 0;

  let prevEndedSentence = true; // First caption starts a sentence

  return captions.map((caption, captionIdx) => {
    const words = caption.words;
    if (words.length === 0) return caption;

    // Check if the caption as a whole sounds like a question
    const startsWithQuestion = isQuestionSentence(words[0].text);

    const updatedWords: CaptionWord[] = [];
    for (let wIdx = 0; wIdx < words.length; wIdx++) {
      const w = words[wIdx];
      const isFirstWordOfCaption = wIdx === 0;

      // Determine text: prefer cached punctuatedText if present and has punctuation
      let text = (w as any).punctuatedText || w.text;
      const unpunctuated = (w as any).unpunctuatedText || stripPunctuation(w.text);
      const cleanLower = stripPunctuation(w.text).toLowerCase();

      // 1. Align with reference transcript tokens if provided
      if (refTokens.length > 0) {
        let matchIdx = -1;
        for (let off = 0; off < 80 && refIdx + off < refTokens.length; off++) {
          if (stripPunctuation(refTokens[refIdx + off]).toLowerCase() === cleanLower) {
            matchIdx = refIdx + off;
            break;
          }
        }

        if (matchIdx !== -1) {
          const matchedToken = refTokens[matchIdx];
          refIdx = matchIdx + 1;
          const trail = getTrailingPunctuation(matchedToken);
          // Transfer trailing punctuation from transcript
          if (trail && !getTrailingPunctuation(text)) {
            text = `${stripPunctuation(text)}${trail}`;
          }
        }
      }

      // 2. Natural introductory marker comma (e.g. "basically,", "doston,")
      if (INTRO_MARKERS.has(cleanLower) && !getTrailingPunctuation(text) && wIdx < words.length - 1) {
        text = `${text},`;
      }

      // 3. Natural clause connector comma on previous word (e.g. "..., but", "..., lekin")
      if (wIdx > 0 && CLAUSE_CONNECTORS.has(cleanLower)) {
        const prevWord = updatedWords[wIdx - 1];
        if (prevWord && !getTrailingPunctuation(prevWord.text)) {
          prevWord.text = `${prevWord.text},`;
        }
      }

      // 4. Last word of caption punctuation if still missing
      const isLastWordOfCaption = wIdx === words.length - 1;
      const isLastCaption = captionIdx === captions.length - 1;

      if (isLastWordOfCaption && !hasSentencePunctuation(text) && !getTrailingPunctuation(text)) {
        if (startsWithQuestion) {
          text = `${text}?`;
        } else if (isLastCaption || caption.end - w.end > 0.4) {
          text = `${text}.`;
        }
      }

      // 5. Capitalize first letter if this word follows sentence punctuation (. ? !) or starts sentence
      const shouldCapitalize = isFirstWordOfCaption ? prevEndedSentence : prevEndedSentence;
      if (shouldCapitalize) {
        text = capitalizeWord(text);
      }

      // Update state for next word: check if CURRENT word ends a sentence (. ? !)
      prevEndedSentence = endsSentence(text);

      updatedWords.push({
        ...w,
        text,
        punctuatedText: text,
        unpunctuatedText: unpunctuated,
      } as CaptionWord & { punctuatedText: string; unpunctuatedText: string });
    }

    return {
      ...caption,
      words: updatedWords,
      edited: true,
    };
  });
};

/**
 * Removes punctuation marks from all captions in one click:
 * 1. Strips all trailing and leading punctuation marks.
 * 2. Reverts capitalization following punctuation back to normal unpunctuated style.
 * 3. Keeps cached `punctuatedText` so the user can re-enable punctuation in one click.
 */
export const stripCaptionPunctuation = (captions: Caption[]): Caption[] => {
  if (!captions || captions.length === 0) return [];

  return captions.map((caption) => {
    const updatedWords: CaptionWord[] = caption.words.map((w, wIdx) => {
      const currentText = w.text;
      const cachedPunctuated = (w as any).punctuatedText || currentText;
      const stripped = stripPunctuation(currentText);

      // In unpunctuated normal mode:
      // First word of caption may stay capitalized or lowercase depending on original
      let normalText = (w as any).unpunctuatedText || stripped;
      if (!normalText) normalText = stripped;

      // If normalText has trailing punctuation, strip it
      normalText = stripPunctuation(normalText);

      // Only first word of caption retains initial capital if it was capitalized originally;
      // internal words that were capitalized purely due to punctuation revert to lowercase
      // unless they are proper nouns / acronyms (e.g. "AI", "Netflix", "Delhi")
      if (wIdx > 0 && /^[A-Z][a-z]+$/.test(normalText)) {
        normalText = normalText.toLowerCase();
      }

      return {
        ...w,
        text: normalText,
        punctuatedText: cachedPunctuated,
        unpunctuatedText: normalText,
      } as CaptionWord & { punctuatedText: string; unpunctuatedText: string };
    });

    return {
      ...caption,
      words: updatedWords,
      edited: true,
    };
  });
};

/**
 * Toggles caption punctuation on or off in one click.
 */
export const toggleCaptionPunctuation = (
  captions: Caption[],
  enabled: boolean,
  transcriptText?: string,
): Caption[] => {
  if (enabled) {
    return applyCaptionPunctuation(captions, transcriptText);
  } else {
    return stripCaptionPunctuation(captions);
  }
};
