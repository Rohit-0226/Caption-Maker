import { describe, expect, it } from 'vitest';
import { applyRomanHinglishCorrections } from '../server/services/providers/hinglishCleanup';
import type { TranscriptWord } from '../src/core/types/project';

const words: TranscriptWord[] = [
  { text: 'मैंने', start: 0, end: 0.4, confidence: null },
  { text: 'उसको', start: 0.4, end: 0.8, confidence: null },
  { text: 'नेटफ्लिक्स', start: 0.8, end: 1.2, confidence: null },
];

const fallback: TranscriptWord[] = [
  { ...words[0], text: 'mainne' },
  { ...words[1], text: 'usako' },
  { ...words[2], text: 'netaphliks' },
];

describe('Roman Hinglish cleanup mapping', () => {
  it('changes text while preserving Whisper timestamps', () => {
    expect(
      applyRomanHinglishCorrections(words, fallback, ['Maine', 'usko', 'Netflix']),
    ).toEqual([
      { ...words[0], text: 'Maine' },
      { ...words[1], text: 'usko' },
      { ...words[2], text: 'Netflix' },
    ]);
  });

  it('rejects a response that changes the token count', () => {
    expect(applyRomanHinglishCorrections(words, fallback, ['Maine', 'usko'])).toBeNull();
  });

  it('uses the deterministic fallback for an invalid multi-word token', () => {
    expect(
      applyRomanHinglishCorrections(words, fallback, ['Maine', 'us ko', 'Netflix'])?.[1].text,
    ).toBe('usako');
  });
});
