import { describe, expect, it } from 'vitest';
import {
  alignPunctuation,
  applyCaptionPunctuation,
  capitalizeWord,
  getTrailingPunctuation,
  hasSentencePunctuation,
  isQuestionSentence,
  stripCaptionPunctuation,
  stripPunctuation,
  toggleCaptionPunctuation,
} from '../src/core/text/punctuation';
import type { Caption, TranscriptWord } from '../src/core/types/project';

describe('stripPunctuation & getTrailingPunctuation', () => {
  it('strips leading and trailing punctuation while preserving intra-word hyphens', () => {
    expect(stripPunctuation('hello.')).toBe('hello');
    expect(stripPunctuation('!world?')).toBe('world');
    expect(stripPunctuation('“quoted”')).toBe('quoted');
    expect(stripPunctuation('state-of-the-art')).toBe('state-of-the-art');
    expect(stripPunctuation('...')).toBe('');
  });

  it('extracts trailing punctuation correctly', () => {
    expect(getTrailingPunctuation('hello.')).toBe('.');
    expect(getTrailingPunctuation('really?!')).toBe('?!');
    expect(getTrailingPunctuation('clean')).toBe('');
    expect(getTrailingPunctuation('comma,')).toBe(',');
  });

  it('detects sentence terminating punctuation', () => {
    expect(hasSentencePunctuation('done.')).toBe(true);
    expect(hasSentencePunctuation('what?')).toBe(true);
    expect(hasSentencePunctuation('wow!')).toBe(true);
    expect(hasSentencePunctuation('almost,')).toBe(false);
    expect(hasSentencePunctuation('running')).toBe(false);
  });
});

describe('alignPunctuation', () => {
  it('transfers punctuation from Whisper segments to word tokens for Hinglish', () => {
    const rawWords: TranscriptWord[] = [
      { text: 'namaste', start: 0, end: 0.5, confidence: null },
      { text: 'doston', start: 0.5, end: 1.0, confidence: null },
      { text: 'welcome', start: 1.0, end: 1.5, confidence: null },
      { text: 'back', start: 1.5, end: 2.0, confidence: null },
      { text: 'to', start: 2.0, end: 2.3, confidence: null },
      { text: 'my', start: 2.3, end: 2.6, confidence: null },
      { text: 'channel', start: 2.6, end: 3.2, confidence: null },
    ];

    const segments = [
      { text: ' Namaste doston! Welcome back to my channel.' },
    ];

    const aligned = alignPunctuation(rawWords, segments);
    expect(aligned.map((w) => w.text)).toEqual([
      'Namaste',
      'doston!',
      'Welcome',
      'back',
      'to',
      'my',
      'channel.',
    ]);
  });

  it('transfers punctuation from English segments with questions and commas', () => {
    const rawWords: TranscriptWord[] = [
      { text: 'hello', start: 0, end: 0.4, confidence: null },
      { text: 'everyone', start: 0.4, end: 0.8, confidence: null },
      { text: 'are', start: 0.9, end: 1.2, confidence: null },
      { text: 'you', start: 1.2, end: 1.5, confidence: null },
      { text: 'ready', start: 1.5, end: 2.0, confidence: null },
      { text: 'lets', start: 2.2, end: 2.6, confidence: null },
      { text: 'go', start: 2.6, end: 3.0, confidence: null },
    ];

    const segments = [
      { text: 'Hello, everyone. Are you ready? Let\'s go!' },
    ];

    const aligned = alignPunctuation(rawWords, segments);
    expect(aligned[0].text).toBe('Hello,');
    expect(aligned[1].text).toBe('everyone.');
    expect(aligned[2].text).toBe('Are');
    expect(aligned[4].text).toBe('ready?');
    expect(aligned[6].text).toBe('go!');
  });
});

describe('applyCaptionPunctuation & post-punctuation capitalization', () => {
  it('capitalizes the first letter of words next to sentence punctuation (. ? !)', () => {
    const captions: Caption[] = [
      {
        id: 'cap1',
        start: 0,
        end: 3,
        edited: false,
        words: [
          { text: 'namaste', start: 0, end: 0.5, emphasis: false },
          { text: 'doston!', start: 0.5, end: 1.0, emphasis: false },
          { text: 'welcome', start: 1.0, end: 1.5, emphasis: false },
          { text: 'to', start: 1.5, end: 2.0, emphasis: false },
          { text: 'my', start: 2.0, end: 2.5, emphasis: false },
          { text: 'channel.', start: 2.5, end: 3.0, emphasis: false },
        ],
      },
    ];

    const punctuated = applyCaptionPunctuation(captions);
    // 'welcome' follows 'doston!' so it must be capitalized -> 'Welcome'
    expect(punctuated[0].words.map((w) => w.text)).toEqual([
      'Namaste',
      'doston!',
      'Welcome',
      'to',
      'my',
      'channel.',
    ]);
  });

  it('capitalizes words across caption boundaries when previous caption ended with sentence punctuation', () => {
    const captions: Caption[] = [
      {
        id: 'cap1',
        start: 0,
        end: 2,
        edited: false,
        words: [
          { text: 'hello', start: 0, end: 1, emphasis: false },
          { text: 'world.', start: 1, end: 2, emphasis: false },
        ],
      },
      {
        id: 'cap2',
        start: 2,
        end: 4,
        edited: false,
        words: [
          { text: 'how', start: 2, end: 3, emphasis: false },
          { text: 'are', start: 3, end: 4, emphasis: false },
          { text: 'you?', start: 4, end: 5, emphasis: false },
        ],
      },
      {
        id: 'cap3',
        start: 5,
        end: 7,
        edited: false,
        words: [
          { text: 'i', start: 5, end: 6, emphasis: false },
          { text: 'am', start: 6, end: 6.5, emphasis: false },
          { text: 'great!', start: 6.5, end: 7, emphasis: false },
        ],
      },
    ];

    const result = applyCaptionPunctuation(captions);
    expect(result[0].words.map((w) => w.text)).toEqual(['Hello', 'world.']);
    expect(result[1].words.map((w) => w.text)).toEqual(['How', 'are', 'you?']);
    expect(result[2].words.map((w) => w.text)).toEqual(['I', 'am', 'great!']);
  });
});

describe('stripCaptionPunctuation & toggleCaptionPunctuation', () => {
  it('strips punctuation in one click and reverts captions to normal unpunctuated style', () => {
    const punctuatedCaptions: Caption[] = [
      {
        id: 'cap1',
        start: 0,
        end: 2,
        edited: false,
        words: [
          { text: 'Hello,', start: 0, end: 1, emphasis: false },
          { text: 'world.', start: 1, end: 2, emphasis: false },
        ],
      },
      {
        id: 'cap2',
        start: 2,
        end: 4,
        edited: false,
        words: [
          { text: 'How', start: 2, end: 3, emphasis: false },
          { text: 'are', start: 3, end: 3.5, emphasis: false },
          { text: 'you?', start: 3.5, end: 4, emphasis: false },
        ],
      },
    ];

    const stripped = stripCaptionPunctuation(punctuatedCaptions);
    expect(stripped[0].words.map((w) => w.text)).toEqual(['Hello', 'world']);
    expect(stripped[1].words.map((w) => w.text)).toEqual(['How', 'are', 'you']);
  });

  it('losslessly toggles punctuation ON and OFF in one click', () => {
    const initialCaptions: Caption[] = [
      {
        id: 'cap1',
        start: 0,
        end: 2,
        edited: false,
        words: [
          { text: 'hello', start: 0, end: 1, emphasis: false },
          { text: 'world.', start: 1, end: 2, emphasis: false },
        ],
      },
    ];

    // 1. Enable punctuation -> adds punctuation & capitalizes
    const onResult = toggleCaptionPunctuation(initialCaptions, true);
    expect(onResult[0].words.map((w) => w.text)).toEqual(['Hello', 'world.']);

    // 2. Disable punctuation in one click -> removes punctuation, returns normally like it was
    const offResult = toggleCaptionPunctuation(onResult, false);
    expect(offResult[0].words.map((w) => w.text)).toEqual(['hello', 'world']);

    // 3. Re-enable punctuation in one click -> restores punctuation and capitalization
    const reOnResult = toggleCaptionPunctuation(offResult, true);
    expect(reOnResult[0].words.map((w) => w.text)).toEqual(['Hello', 'world.']);
  });

  it('aligns transcript commas, question marks, and capitalizes following word', () => {
    const transcript = "If you call the tea boy and ask him, what is the one thing that is very close to everybody's heart, especially the ajmal family, and what is the thing that really drives them more than anything else? It's charity.";
    const captions: Caption[] = [
      {
        id: 'c1',
        start: 0,
        end: 1,
        edited: false,
        words: [
          { text: 'if', start: 0, end: 0.3, emphasis: false },
          { text: 'you', start: 0.3, end: 0.6, emphasis: false },
          { text: 'call', start: 0.6, end: 1, emphasis: false },
        ],
      },
      {
        id: 'c2',
        start: 1,
        end: 2,
        edited: false,
        words: [
          { text: 'the', start: 1, end: 1.3, emphasis: false },
          { text: 'tea', start: 1.3, end: 1.6, emphasis: false },
          { text: 'boy', start: 1.6, end: 2, emphasis: false },
        ],
      },
      {
        id: 'c3',
        start: 2,
        end: 3,
        edited: false,
        words: [
          { text: 'and', start: 2, end: 2.3, emphasis: false },
          { text: 'ask', start: 2.3, end: 2.6, emphasis: false },
          { text: 'him', start: 2.6, end: 3, emphasis: false },
        ],
      },
      {
        id: 'c4',
        start: 10,
        end: 11.5,
        edited: false,
        words: [
          { text: 'anything', start: 10, end: 10.5, emphasis: false },
          { text: 'else', start: 10.5, end: 11, emphasis: false },
          { text: 'its', start: 11, end: 11.5, emphasis: false },
        ],
      },
    ];

    const result = applyCaptionPunctuation(captions, transcript);
    // 'if' at start is capitalized -> 'If'
    expect(result[0].words[0].text).toBe('If');
    // 'him' gets comma from transcript -> 'him,'
    expect(result[2].words[2].text).toBe('him,');
    // 'else' gets question mark from transcript -> 'else?'
    expect(result[3].words[1].text).toBe('else?');
    // 'its' follows 'else?' so it must be capitalized -> 'Its.' (and period for last word of final caption)
    expect(result[3].words[2].text).toBe('Its.');
  });
});
