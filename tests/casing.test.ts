import { describe, expect, it } from 'vitest';
import {
  endsSentence,
  transformCaptionWords,
  transformCaptions,
  transformWordCasing,
} from '../src/core/text/casing';
import type { Caption } from '../src/core/types/project';

describe('endsSentence', () => {
  it('detects sentence ending punctuation correctly', () => {
    expect(endsSentence('hello.')).toBe(true);
    expect(endsSentence('world!')).toBe(true);
    expect(endsSentence('really?')).toBe(true);
    expect(endsSentence('done.")')).toBe(true);
    expect(endsSentence('hello')).toBe(false);
    expect(endsSentence('comma,')).toBe(false);
    expect(endsSentence('semicolon;')).toBe(false);
  });
});

describe('transformWordCasing', () => {
  it('handles uppercase', () => {
    expect(transformWordCasing('hello', 'upper', false)).toBe('HELLO');
    expect(transformWordCasing('world', 'upper', true)).toBe('WORLD');
  });

  it('handles lowercase', () => {
    expect(transformWordCasing('HELLO', 'lower', false)).toBe('hello');
    expect(transformWordCasing('World', 'lower', true)).toBe('world');
  });

  it('handles sentence case with leading punctuation', () => {
    expect(transformWordCasing('hello', 'sentence', true)).toBe('Hello');
    expect(transformWordCasing('hello', 'sentence', false)).toBe('hello');
    expect(transformWordCasing('"hello"', 'sentence', true)).toBe('"Hello"');
    expect(transformWordCasing('(welcome)', 'sentence', true)).toBe('(Welcome)');
    expect(transformWordCasing('(welcome)', 'sentence', false)).toBe('(welcome)');
  });

  it('handles title case', () => {
    expect(transformWordCasing('hello', 'title', false)).toBe('Hello');
    expect(transformWordCasing('WORLD', 'title', false)).toBe('World');
    expect(transformWordCasing('"quote"', 'title', false)).toBe('"Quote"');
  });
});

describe('transformCaptionWords', () => {
  it('capitalizes first letter of caption and words following sentence end', () => {
    const input = [
      { text: 'HELLO' },
      { text: 'EVERYONE.' },
      { text: 'THIS' },
      { text: 'IS' },
      { text: 'COOL!' },
      { text: 'YES' },
      { text: 'IT' },
      { text: 'IS.' },
    ];
    const result = transformCaptionWords(input, 'sentence');
    expect(result.map((w) => w.text)).toEqual([
      'Hello',
      'everyone.',
      'This',
      'is',
      'cool!',
      'Yes',
      'it',
      'is.',
    ]);
  });
});

describe('transformCaptions', () => {
  it('transforms specific captions or all captions', () => {
    const captions: Caption[] = [
      {
        id: 'cap1',
        start: 0,
        end: 1,
        edited: false,
        words: [{ text: 'HELLO', start: 0, end: 0.5, emphasis: false }, { text: 'WORLD', start: 0.5, end: 1, emphasis: false }],
      },
      {
        id: 'cap2',
        start: 1,
        end: 2,
        edited: false,
        words: [{ text: 'SECOND', start: 1, end: 1.5, emphasis: false }, { text: 'CAPTION', start: 1.5, end: 2, emphasis: false }],
      },
    ];

    const transformedAll = transformCaptions(captions, 'sentence');
    expect(transformedAll[0].words.map((w) => w.text)).toEqual(['Hello', 'world']);
    expect(transformedAll[1].words.map((w) => w.text)).toEqual(['Second', 'caption']);

    const transformedOnlyCap2 = transformCaptions(captions, 'title', ['cap2']);
    expect(transformedOnlyCap2[0].words.map((w) => w.text)).toEqual(['HELLO', 'WORLD']);
    expect(transformedOnlyCap2[1].words.map((w) => w.text)).toEqual(['Second', 'Caption']);
  });
});
