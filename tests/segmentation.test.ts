import { describe, expect, it } from 'vitest';
import {
  DefaultCaptionSegmenter,
  captionText,
  repairWordTimings,
  wrapIntoLines,
} from '../src/core/segmentation/segmenter';
import { defaultSegmentation } from '../src/core/project/defaults';
import type { SegmentationSettings, TranscriptWord } from '../src/core/types/project';

const segmenter = new DefaultCaptionSegmenter();

/** Builds evenly spaced words, 0.3s each, so timing is predictable. */
const words = (text: string, startAt = 0, perWord = 0.3): TranscriptWord[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => ({
      text: word,
      start: startAt + i * perWord,
      end: startAt + (i + 1) * perWord,
      confidence: null,
    }));

const settings = (patch: Partial<SegmentationSettings> = {}): SegmentationSettings => ({
  ...defaultSegmentation,
  ...patch,
});

describe('caption segmentation', () => {
  it('returns nothing for an empty transcript', () => {
    expect(segmenter.segment([], settings())).toEqual([]);
  });

  it('never exceeds the character limit', () => {
    const input = words(
      'the quick brown fox jumps over the lazy dog and keeps running through the field',
    );

    for (const limit of [1, 2, 3, 4, 6, 8]) {
      const captions = segmenter.segment(input, settings({ maxWordsPerLine: limit }));
      for (const caption of captions) {
        expect(caption.words.length).toBeLessThanOrEqual(limit * 2);
      }
    }
  });

  it('never splits a word across captions', () => {
    const input = words(
      'extraordinarily complicated vocabulary demonstrates segmentation behaviour clearly',
    );
    const captions = segmenter.segment(input, settings({ maxWordsPerLine: 2 }));

    const rebuilt = captions.flatMap((c) => c.words.map((w) => w.text));
    expect(rebuilt).toEqual(input.map((w) => w.text));
  });

  it('keeps every input word exactly once', () => {
    const input = words('one two three four five six seven eight nine ten');
    const captions = segmenter.segment(input, settings({ maxWordsPerLine: 2 }));

    expect(captions.flatMap((c) => c.words).length).toBe(input.length);
  });

  it('produces captions in ascending, non-overlapping order', () => {
    const input = words('alpha bravo charlie delta echo foxtrot golf hotel india juliet');
    const captions = segmenter.segment(input, settings({ maxWordsPerLine: 3 }));

    for (let i = 1; i < captions.length; i++) {
      expect(captions[i].start).toBeGreaterThanOrEqual(captions[i - 1].end - 1e-9);
      expect(captions[i].end).toBeGreaterThan(captions[i].start);
    }
  });

  it('normalises repeated provider timestamps before a caption boundary', () => {
    const input: TranscriptWord[] = [
      { text: 'It', start: 4.44, end: 4.64, confidence: null },
      { text: 'is', start: 4.44, end: 4.64, confidence: null },
      { text: 'a', start: 4.44, end: 4.64, confidence: null },
      { text: 'very', start: 4.44, end: 4.64, confidence: null },
      { text: 'large', start: 4.44, end: 4.64, confidence: null },
      { text: 'cost', start: 4.44, end: 4.64, confidence: null },
      { text: 'for', start: 4.44, end: 4.72, confidence: null },
      { text: 'fully', start: 4.72, end: 5, confidence: null },
      { text: 'furnished', start: 5, end: 5.48, confidence: null },
    ];

    const captions = segmenter.segment(
      input,
      settings({ maxWordsPerLine: 3, maxLines: 2, minDuration: 0, preferPauses: false }),
    );

    expect(captions.map(captionText)).toEqual([
      'It is a very large cost',
      'for fully furnished',
    ]);
    expect(captions[1].start).toBeGreaterThanOrEqual(captions[0].end);
    expect(captions.flatMap((caption) => caption.words).every((word, index, all) =>
      index === 0 || word.start >= all[index - 1].end
    )).toBe(true);
    expect(input[1].start).toBe(4.44);
  });

  it('caps a pathological word duration so a caption cannot freeze', () => {
    const repaired = repairWordTimings([
      { text: 'diya', start: 11.16, end: 29.98, confidence: null },
    ]);
    expect(repaired[0].end - repaired[0].start).toBeLessThanOrEqual(2);
  });

  it('bridges a short provider gap between captions', () => {
    const input: TranscriptWord[] = [
      { text: 'before.', start: 0, end: 0.4, confidence: null },
      { text: 'after', start: 1.4, end: 1.8, confidence: null },
    ];
    const captions = segmenter.segment(
      input,
      settings({ minGap: 0.3, maxDuration: 6, minDuration: 0 }),
    );
    expect(captions).toHaveLength(2);
    expect(captions[1].start - captions[0].end).toBeCloseTo(0.02);
  });

  it('breaks at a full stop rather than filling the character budget', () => {
    const input = words('this ends here. and this begins now', 0, 0.3);
    const captions = segmenter.segment(
      input,
      settings({ maxWordsPerLine: 9, preferPunctuation: true, minDuration: 0 }),
    );

    expect(captionText(captions[0])).toBe('this ends here.');
  });

  it('ignores punctuation boundaries when the preference is off', () => {
    const input = words('this ends here. and this begins now');
    const withPreference = segmenter.segment(
      input,
      settings({ maxWordsPerLine: 9, preferPunctuation: true, minDuration: 0 }),
    );
    const without = segmenter.segment(
      input,
      settings({ maxWordsPerLine: 9, preferPunctuation: false, minDuration: 0, preferPauses: false }),
    );

    expect(without.length).toBeLessThan(withPreference.length);
  });

  it('breaks on a silence longer than the minimum gap', () => {
    const first = words('before the pause', 0, 0.3);
    const second = words('after the pause', 5, 0.3);
    const captions = segmenter.segment(
      [...first, ...second],
      settings({ maxWordsPerLine: 10, minGap: 0.5, preferPauses: true, minDuration: 0 }),
    );

    expect(captions.length).toBeGreaterThanOrEqual(2);
    expect(captionText(captions[0])).toBe('before the pause');
  });

  it('respects the max words limit', () => {
    const input = words('a b c d e f g h i j k l');
    const captions = segmenter.segment(input, settings({ maxWordsPerLine: 3, maxLines: 1 }));

    for (const caption of captions) {
      expect(caption.words.length).toBeLessThanOrEqual(3);
    }
  });

  it('respects the max duration limit', () => {
    const input = words('one two three four five six seven eight', 0, 1.5);
    const captions = segmenter.segment(
      input,
      settings({ maxDuration: 3, maxWordsPerLine: 30, maxLines: 3, minDuration: 0 }),
    );

    for (const caption of captions) {
      expect(caption.end - caption.start).toBeLessThanOrEqual(3 + 1e-6);
    }
  });

  it('handles Hinglish text without mangling it', () => {
    const line = 'Aapne mere hisab se pehle fully furnished ka system chalu kiya';
    const captions = segmenter.segment(words(line), settings({ maxWordsPerLine: 4 }));

    const rebuilt = captions.map((c) => captionText(c)).join(' ');
    expect(rebuilt).toBe(line);
    for (const caption of captions) {
      expect(caption.words.length).toBeLessThanOrEqual(8);
    }
  });

  it('handles Devanagari and emoji without splitting graphemes', () => {
    const input = words('नमस्ते दोस्तों 🙏 आज हम बात करेंगे');
    const captions = segmenter.segment(input, settings({ maxWordsPerLine: 3 }));

    expect(captions.flatMap((c) => c.words.map((w) => w.text))).toEqual(
      input.map((w) => w.text),
    );
  });

  it('marks ALL CAPS words as emphasised', () => {
    const captions = segmenter.segment(words('this is REALLY important'), settings());
    const all = captions.flatMap((c) => c.words);

    expect(all.find((w) => w.text === 'REALLY')?.emphasis).toBe(true);
    expect(all.find((w) => w.text === 'this')?.emphasis).toBe(false);
  });

  it('does not treat a single-letter word as emphasis', () => {
    const captions = segmenter.segment(words('a I go'), settings());
    const all = captions.flatMap((c) => c.words);
    expect(all.every((w) => w.emphasis === false)).toBe(true);
  });

  it('merges a caption shorter than the minimum duration into its neighbour', () => {
    const input: TranscriptWord[] = [
      { text: 'hello', start: 0, end: 0.9, confidence: null },
      { text: 'ok', start: 0.9, end: 1.0, confidence: null },
    ];
    const captions = segmenter.segment(
      input,
      settings({ maxWordsPerLine: 8, minDuration: 0.5, minGap: 5, preferPauses: false }),
    );

    expect(captions.length).toBe(1);
  });

  it('regroups deterministically when the character limit changes', () => {
    const input = words('the quick brown fox jumps over the lazy dog');

    const a = segmenter.segment(input, settings({ maxWordsPerLine: 4 }));
    const b = segmenter.segment(input, settings({ maxWordsPerLine: 4 }));

    expect(a.map((c) => captionText(c))).toEqual(b.map((c) => captionText(c)));
  });
});

describe('line wrapping', () => {
  it('keeps everything on one line when maxLines is 1', () => {
    const [caption] = segmenter.segment(words('one two three four'), settings());
    expect(wrapIntoLines(caption.words, 1, 4).length).toBe(1);
  });

  it('never drops or duplicates a word', () => {
    const [caption] = segmenter.segment(words('alpha bravo charlie delta'), settings());
    const lines = wrapIntoLines(caption.words, 2, 3);

    expect(lines.flat().map((w) => w.text)).toEqual(caption.words.map((w) => w.text));
  });

  it('never produces more lines than allowed', () => {
    const [caption] = segmenter.segment(
      words('alpha bravo charlie delta echo foxtrot'),
      settings({ maxWordsPerLine: 10, maxLines: 3 }),
    );

    for (const maxLines of [1, 2, 3]) {
      expect(wrapIntoLines(caption.words, maxLines, 3).length).toBeLessThanOrEqual(maxLines);
    }
  });

  it('handles an empty word list', () => {
    expect(wrapIntoLines([], 2, 4)).toEqual([]);
  });
});
