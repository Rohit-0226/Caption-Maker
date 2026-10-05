import type {
  Caption,
  CaptionWord,
  SegmentationSettings,
  TranscriptWord,
} from '../types/project';
import { classifyScript, isWordLocked } from '../transcription/scriptClassifier';

/**
 * Turns a flat list of timed words into captions.
 *
 * Implementations must never split a word across two captions, and must return
 * captions in ascending, non-overlapping time order.
 */
export interface CaptionSegmenter {
  readonly id: string;
  segment(words: TranscriptWord[], settings: SegmentationSettings): Caption[];
}

const SENTENCE_END = /[.!?…]["')\]]?$/;
const CLAUSE_END = /[,;:—–-]$/;

/** Characters a caption would occupy if this word were appended. */
const lengthWith = (currentLength: number, word: string) =>
  currentLength === 0 ? word.length : currentLength + 1 + word.length;

const normalise = (raw: string) => raw.trim();

/**
 * Some speech engines return several consecutive words with the same segment
 * timestamp.  A character-limit break can then put those words in different
 * captions whose ranges overlap.  Keep the raw transcript untouched, but make
 * the caption copy monotonic so every generated caption is safe to export.
 */
const MAX_WORD_DURATION = 2;

export const repairWordTimings = (words: TranscriptWord[]): TranscriptWord[] => {
  const repaired = words.map((word) => ({ ...word }));

  for (let i = 0; i < repaired.length; i++) {
    const word = repaired[i];
    const previous = repaired[i - 1];
    if (previous && word.start < previous.end) {
      // Trim the earlier word rather than delaying this one when there is
      // room: the moment a word starts is what a viewer notices, and delaying
      // it pushes every caption after it late.
      if (word.start - previous.start >= 0.01) previous.end = word.start;
      else word.start = previous.end;
    }
    word.end = Math.min(Math.max(word.end, word.start + 0.01), word.start + MAX_WORD_DURATION);
  }

  return repaired;
};

/** ALL-CAPS words in the source are treated as emphasised by default. */
const looksEmphasised = (text: string) => {
  const letters = text.replace(/[^\p{L}]/gu, '');
  return letters.length > 1 && letters === letters.toUpperCase() && /\p{L}/u.test(letters);
};

let counter = 0;
const nextId = () => `cap_${Date.now().toString(36)}_${(counter++).toString(36)}`;

/** Reset between test runs so ids are reproducible. */
export const __resetIdCounter = () => {
  counter = 0;
};

interface Pending {
  words: TranscriptWord[];
  length: number;
}

/**
 * The default segmenter.
 *
 * It walks the words once, accumulating them into a caption, and breaks when
 * either a hard limit is reached or a preferred boundary appears late enough in
 * the caption to be worth taking. Preference order matches the product spec:
 * punctuation, then phrase/pause boundaries, then the raw character limit.
 */
export class DefaultCaptionSegmenter implements CaptionSegmenter {
  readonly id = 'default';

  segment(words: TranscriptWord[], settings: SegmentationSettings): Caption[] {
    const cleaned = repairWordTimings(words
      .map((w) => ({ ...w, text: normalise(w.text) }))
      .filter((w) => w.text.length > 0)
      .sort((a, b) => a.start - b.start));

    if (cleaned.length === 0) return [];

    // Words per line is the control the user actually sets; the caption's word
    // budget is that multiplied by the number of lines it may occupy.
    const perLine = Math.max(1, Math.round(settings.maxWordsPerLine));
    const maxWords = perLine * Math.max(1, settings.maxLines);
    // Characters are only a backstop against a run of very long words.
    const maxChars = Math.max(1, settings.maxCharacters);
    const readingSpeed = Math.max(0.5, settings.maxReadingSpeed);

    // taking a soft boundary before this fill ratio makes captions choppy
    const softFloor = Math.max(1, Math.ceil(maxWords * 0.5));

    const out: Caption[] = [];
    let pending: Pending = { words: [], length: 0 };

    const flush = () => {
      if (pending.words.length === 0) return;
      out.push(this.toCaption(pending.words));
      pending = { words: [], length: 0 };
    };

    for (let i = 0; i < cleaned.length; i++) {
      const word = cleaned[i];
      const prev = pending.words[pending.words.length - 1];

      if (prev) {
        const gap = word.start - prev.end;
        const wouldExceedChars = lengthWith(pending.length, word.text) > maxChars;
        const wouldExceedWords = pending.words.length + 1 > maxWords;
        const wouldExceedDuration =
          word.end - pending.words[0].start > settings.maxDuration;
        const silenceBreak = settings.preferPauses && gap >= settings.minGap;

        if (wouldExceedChars || wouldExceedWords || wouldExceedDuration || silenceBreak) {
          flush();
        }
      }

      pending.length = lengthWith(pending.length, word.text);
      pending.words.push(word);

      // A sentence ending is always a good place to stop. A clause ending only
      // if the caption is already substantial, otherwise we get stutter.
      if (settings.preferPunctuation) {
        if (SENTENCE_END.test(word.text)) {
          flush();
          continue;
        }
        if (CLAUSE_END.test(word.text) && pending.words.length >= softFloor) {
          flush();
          continue;
        }
      }

      // A long pause after this word is a natural boundary too.
      if (settings.preferPauses && pending.words.length >= softFloor) {
        const next = cleaned[i + 1];
        if (next && next.start - word.end >= settings.minGap) {
          flush();
        }
      }
    }

    flush();

    const merged = this.enforceDurations(out, settings, maxChars, maxWords);
    const readable = this.enforceReadingSpeed(merged, readingSpeed);
    return this.bridgeShortGaps(readable, settings.maxDuration);
  }

  /** Holds the previous caption briefly so small ASR gaps never look broken. */
  private bridgeShortGaps(captions: Caption[], maxDuration: number): Caption[] {
    const VISUAL_GAP = 0.02;
    const MAX_BRIDGE = 2.5;

    return captions.map((caption, index) => {
      const next = captions[index + 1];
      if (!next) return caption;
      const gap = next.start - caption.end;
      if (gap <= VISUAL_GAP || gap > MAX_BRIDGE) return caption;
      const end = Math.min(next.start - VISUAL_GAP, caption.start + maxDuration);
      return end > caption.end ? { ...caption, end } : caption;
    });
  }

  /**
   * Gives a dense caption more time on screen by holding it into the silence
   * that follows.
   *
   * Splitting cannot fix a fast caption — speech delivered at four words a
   * second still displays at four words a second however it is grouped. What
   * genuinely helps is leaving the caption up longer, so this extends the end
   * time into any gap before the next caption, never past it, and never touches
   * the spoken word timings underneath.
   */
  private enforceReadingSpeed(captions: Caption[], readingSpeed: number): Caption[] {
    // keep a sliver of gap so consecutive captions never touch or overlap
    const GAP = 0.02;

    return captions.map((caption, index) => {
      const span = caption.end - caption.start;
      if (span <= 0) return caption;

      const needed = caption.words.length / readingSpeed;
      if (needed <= span) return caption;

      const next = captions[index + 1];
      const ceiling = next ? next.start - GAP : caption.start + needed;
      const end = Math.min(caption.start + needed, ceiling);

      return end > caption.end ? { ...caption, end } : caption;
    });
  }

  private toCaption(words: TranscriptWord[]): Caption {
    const captionWords: CaptionWord[] = words.map((w) => ({
      text: w.text,
      start: w.start,
      end: w.end,
      start_ms: w.start_ms ?? Math.round(w.start * 1000),
      end_ms: w.end_ms ?? Math.round(w.end * 1000),
      script: w.script ?? classifyScript(w.text),
      locked: w.locked ?? isWordLocked(w.text),
      confidence: w.confidence ?? null,
      emphasis: looksEmphasised(w.text),
    }));

    return {
      id: nextId(),
      start: captionWords[0].start,
      end: captionWords[captionWords.length - 1].end,
      words: captionWords,
      edited: false,
    };
  }

  /**
   * Fold captions that came out shorter than minDuration into a neighbour,
   * as long as the merge does not break the character or word budget.
   */
  private enforceDurations(
    captions: Caption[],
    settings: SegmentationSettings,
    maxChars: number,
    maxWords: number,
  ): Caption[] {
    if (captions.length < 2) return captions;

    const result: Caption[] = [];

    for (const caption of captions) {
      const previous = result[result.length - 1];
      const tooShort = caption.end - caption.start < settings.minDuration;

      if (previous && tooShort) {
        const mergedText = [...previous.words, ...caption.words]
          .map((w) => w.text)
          .join(' ');
        const mergedWordCount = previous.words.length + caption.words.length;
        const mergedDuration = caption.end - previous.start;

        const fits =
          mergedText.length <= maxChars &&
          mergedWordCount <= maxWords &&
          mergedDuration <= settings.maxDuration;

        if (fits) {
          previous.words = [...previous.words, ...caption.words];
          previous.end = caption.end;
          continue;
        }
      }

      result.push(caption);
    }

    return result;
  }
}

/**
 * Wraps a caption's words into display lines.
 *
 * Shared by the editor and the renderer so both agree on where lines break.
 * Balances line lengths rather than greedily filling the first line, which
 * reads better for short captions.
 */
export const wrapIntoLines = (
  words: CaptionWord[],
  maxLines: number,
  maxWordsPerLine: number,
): CaptionWord[][] => {
  if (words.length === 0) return [];

  const perLine = Math.max(1, Math.round(maxWordsPerLine));
  const lineLimit = Math.max(1, maxLines);

  if (lineLimit <= 1) return [words];

  // Spread the words evenly rather than filling the first line to the brim:
  // five words over two lines reads better as 3 + 2 than 4 + 1.
  const lineCount = Math.min(lineLimit, Math.max(1, Math.ceil(words.length / perLine)));
  if (lineCount <= 1) return [words];

  const perLineBalanced = Math.ceil(words.length / lineCount);
  const lines: CaptionWord[][] = [];

  for (let i = 0; i < words.length; i += perLineBalanced) {
    lines.push(words.slice(i, i + perLineBalanced));
  }

  return lines;
};

export const captionText = (caption: Caption) => caption.words.map((w) => w.text).join(' ');

export const defaultSegmenter = new DefaultCaptionSegmenter();
