import { describe, expect, it } from 'vitest';
import { containsHindiOrHinglish } from '../server/services/providers/englishTranslation';
import type { TranscriptWord } from '../src/core/types/project';

describe('containsHindiOrHinglish', () => {
  it('detects Roman Hinglish words', () => {
    const words: TranscriptWord[] = [
      { text: 'aapne', start: 0, end: 0.5, confidence: null },
      { text: 'mere', start: 0.5, end: 1.0, confidence: null },
      { text: 'pehle', start: 1.0, end: 1.5, confidence: null },
      { text: 'started', start: 1.5, end: 2.0, confidence: null },
    ];
    expect(containsHindiOrHinglish(words)).toBe(true);
  });

  it('detects Devanagari Hindi characters', () => {
    const words: TranscriptWord[] = [
      { text: 'नमस्ते', start: 0, end: 0.5, confidence: null },
      { text: 'welcome', start: 0.5, end: 1.0, confidence: null },
    ];
    expect(containsHindiOrHinglish(words)).toBe(true);
  });

  it('returns false for pure English sentences', () => {
    const words: TranscriptWord[] = [
      { text: 'Welcome', start: 0, end: 0.5, confidence: null },
      { text: 'to', start: 0.5, end: 0.8, confidence: null },
      { text: 'the', start: 0.8, end: 1.0, confidence: null },
      { text: 'show', start: 1.0, end: 1.5, confidence: null },
      { text: 'today', start: 1.5, end: 2.0, confidence: null },
    ];
    expect(containsHindiOrHinglish(words)).toBe(false);
  });
});
