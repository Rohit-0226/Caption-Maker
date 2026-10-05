import { describe, it, expect } from 'vitest';
import type { TranscriptWord } from '../src/core/types/project';
import {
  classifyScript,
  isWordLocked,
  splitAndTransliterateRuns,
  assertProtectedTermsIntegrity,
  IntegrityAssertionError,
  enrichWords,
} from '../src/core/transcription/scriptClassifier';

describe('scriptClassifier', () => {
  it('classifies pure numbers as num', () => {
    expect(classifyScript('1080')).toBe('num');
    expect(classifyScript('9:16')).toBe('num');
    expect(classifyScript('1st')).toBe('num');
    expect(classifyScript('60fps')).toBe('num');
  });

  it('classifies pure punctuation as punct', () => {
    expect(classifyScript('.')).toBe('punct');
    expect(classifyScript('...')).toBe('punct');
    expect(classifyScript('!')).toBe('punct');
    expect(classifyScript('—')).toBe('punct');
  });

  it('classifies English words and creator loanwords as en', () => {
    expect(classifyScript('video')).toBe('en');
    expect(classifyScript('YouTube')).toBe('en');
    expect(classifyScript('marketing')).toBe('en');
    expect(classifyScript('algorithm')).toBe('en');
    expect(classifyScript('welcome')).toBe('en');
    expect(classifyScript('client')).toBe('en');
    expect(classifyScript('developer')).toBe('en');
  });

  it('classifies Romanised Hindi words as hi', () => {
    expect(classifyScript('kya')).toBe('hi');
    expect(classifyScript('hum')).toBe('hi');
    expect(classifyScript('aapne')).toBe('hi');
    expect(classifyScript('karenge')).toBe('hi');
    expect(classifyScript('baat')).toBe('hi');
    expect(classifyScript('chaliye')).toBe('hi');
    expect(classifyScript('namaste')).toBe('hi');
  });

  it('segments Devanagari runs while leaving Latin runs byte-for-byte untouched', () => {
    const input = 'Namaste dosto welcome to my YouTube channel';
    const output = splitAndTransliterateRuns(input);
    expect(output).toBe('Namaste dosto welcome to my YouTube channel');

    // Devanagari runs get transliterated
    const mixed = 'नमस्ते dosto welcome to my चैनल';
    const transliterated = splitAndTransliterateRuns(mixed);
    expect(transliterated).toContain('namaste');
    expect(transliterated).toContain('channel');
    expect(transliterated).toContain('dosto welcome to my');
  });

  it('asserts protected terms integrity', () => {
    const protectedTerms = ['YouTube', 'algorithm', 'video'];
    const input = 'Aaj hum YouTube video ke algorithm ke baare mein baat karenge';
    const validOutput = 'Aaj hum YouTube video ke algorithm ke baare mein baat karenge';

    expect(() => {
      assertProtectedTermsIntegrity(input, validOutput, protectedTerms);
    }).not.toThrow();

    const corruptedOutput = 'Aaj hum Yutub video ke baare mein baat karenge'; // algorithm missing!
    expect(() => {
      assertProtectedTermsIntegrity(input, corruptedOutput, protectedTerms);
    }).toThrow(IntegrityAssertionError);
  });

  it('enriches words with start_ms, end_ms, script, and locked', () => {
    const rawWords: TranscriptWord[] = [
      { text: 'Namaste', start: 0, end: 0.5, confidence: 0.95 },
      { text: 'video', start: 0.5, end: 1.0, confidence: 0.98 },
      { text: '1080', start: 1.0, end: 1.4, confidence: 0.99 },
    ];
    const enriched = enrichWords(rawWords);

    expect(enriched[0].start_ms).toBe(0);
    expect(enriched[0].end_ms).toBe(500);
    expect(enriched[0].script).toBe('hi');

    expect(enriched[1].start_ms).toBe(500);
    expect(enriched[1].end_ms).toBe(1000);
    expect(enriched[1].script).toBe('en');
    expect(enriched[1].locked).toBe(true);

    expect(enriched[2].script).toBe('num');
  });
});
