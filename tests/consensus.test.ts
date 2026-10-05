import { describe, expect, it } from 'vitest';
import {
  alignTokens,
  buildConsensus,
  chooseTextBackbone,
  matchKey,
  timeTokensAgainst,
  tokenSimilarity,
  type Listener,
} from '../src/core/speech/consensus';
import { speechMapFromIntervals } from '../src/core/speech/speechMap';
import type { TranscriptWord } from '../src/core/types/project';

const word = (text: string, start: number, end: number): TranscriptWord => ({ text, start, end, confidence: null });
const texts = (words: TranscriptWord[]) => words.map((w) => w.text);

describe('matching words across engines', () => {
  it('matches a word written in Devanagari by one engine and Roman by another', () => {
    expect(tokenSimilarity(matchKey('वीडियो'), matchKey('video'))).toBeGreaterThanOrEqual(0.8);
  });

  it('keeps genuinely different words apart', () => {
    expect(tokenSimilarity(matchKey('Frankly'), matchKey('Franchise'))).toBeLessThan(0.8);
  });

  it('aligns an extra word as an insertion rather than shifting everything after it', () => {
    const pairs = alignTokens(['a', 'b', 'c'].map(matchKey), ['a', 'x', 'b', 'c'].map(matchKey));
    expect(pairs).toEqual([
      { ref: 0, hyp: 0, similarity: 1 },
      { ref: null, hyp: 1, similarity: 0 },
      { ref: 1, hyp: 2, similarity: 1 },
      { ref: 2, hyp: 3, similarity: 1 },
    ]);
  });
});

describe('choosing which engine leads', () => {
  const listener = (engine: string, text: string, extra: Partial<Listener> = {}): Listener => ({
    engine,
    tokens: text.split(' '),
    weight: 1,
    eligible: true,
    timed: false,
    ...extra,
  });

  it('lets the engine everyone else agrees with lead when Whisper misheard', () => {
    const { index } = chooseTextBackbone([
      listener('whisper', 'he joke ya thai ki ayrin station e traen station', { timed: true }),
      listener('gemini', 'arre wo joke tha ki ye mere station me na station'),
      // as in production: Nemotron votes but doesn't lead Roman captions
      listener('nemotron', 'arre wo joke tha ki mere station me na station', { eligible: false }),
    ]);
    expect(index).toBe(1);
  });

  it('keeps the default leader on a near-tie', () => {
    const { index } = chooseTextBackbone([
      listener('whisper', 'if you call the tea boy and ask him', { timed: true }),
      listener('whisper-2', 'if you called the tea boy and asked him', { timed: true }),
      listener('gemini', 'if you called the tea boy and asked him'),
      listener('nemotron', 'if you call the tea boy and ask him'),
    ]);
    expect(index).toBe(0);
  });

  it('never picks an ineligible engine while an eligible one spoke', () => {
    const { index } = chooseTextBackbone([
      listener('whisper', 'garbled words here', { timed: true }),
      listener('nemotron', 'अरे वो जो', { eligible: false }),
    ]);
    expect(index).toBe(0);
  });
});

describe('timing an untimed transcript against Whisper', () => {
  it('reuses Whisper times for shared words and places the rest on speech between them', () => {
    const timed = [word('ek', 1, 1.3), word('xyz', 1.3, 1.8), word('bacha', 2, 2.4)];
    const out = timeTokensAgainst(['ek', 'chota', 'bacha'], timed, { start: 0, end: 3 }, () => [{ start: 1.3, end: 1.8 }]);

    expect(texts(out)).toEqual(['ek', 'chota', 'bacha']);
    expect([out[0].start, out[0].end]).toEqual([1, 1.3]);
    expect(out[1].start).toBeGreaterThanOrEqual(1.3);
    expect(out[1].end).toBeLessThanOrEqual(1.8);
    expect([out[2].start, out[2].end]).toEqual([2, 2.4]);
  });
});

describe('word-level vote', () => {
  it('corrects a word two engines heard differently, keeping its timing and punctuation', () => {
    const { words, stats } = buildConsensus({
      backbone: [word('Franchise,', 2.4, 3), word('I', 3, 3.1), word('think', 3.1, 3.4)],
      backboneEngine: 'whisper',
      hypotheses: [
        { engine: 'whisper-2', tokens: ['Frankly', 'I', 'think'], weight: 0.9 },
        { engine: 'gemini', tokens: ['Frankly,', 'I', 'think'], weight: 1.1 },
      ],
    });

    expect(texts(words)).toEqual(['Frankly,', 'I', 'think']);
    expect(words[0].start).toBe(2.4);
    expect(words[0].end).toBe(3);
    expect(stats.substituted).toBe(1);
  });

  it('never lets one engine overrule the backbone alone, and asks instead', () => {
    const { words, disputes } = buildConsensus({
      backbone: [word('brand', 0, 0.4)],
      backboneEngine: 'whisper',
      hypotheses: [{ engine: 'gemini', tokens: ['trend'], weight: 1.1 }],
    });

    expect(texts(words)).toEqual(['brand']);
    expect(disputes).toEqual([
      { index: 0, length: 1, kind: 'substitution', options: { whisper: 'brand', gemini: 'trend' } },
    ]);
  });

  it('prefers the Roman spelling of a word the engines agree on', () => {
    const { words } = buildConsensus({
      backbone: [word('वीडियो', 0, 0.5)],
      backboneEngine: 'whisper',
      hypotheses: [{ engine: 'gemini', tokens: ['video'], weight: 1.1 }],
      preferRoman: true,
    });
    expect(texts(words)).toEqual(['video']);
  });

  it('fills a gap with words two engines heard, placed on the speech in that gap', () => {
    const speech = speechMapFromIntervals(
      [
        { start: 0, end: 0.4 },
        { start: 0.6, end: 1.5 },
        { start: 1.6, end: 2 },
      ],
      2.5,
    );
    const { words, stats } = buildConsensus({
      backbone: [word('agar', 0, 0.4), word('saal', 1.6, 2)],
      backboneEngine: 'whisper',
      hypotheses: [
        { engine: 'whisper-2', tokens: ['agar', 'aap', 'agle', 'saal'], weight: 0.9 },
        { engine: 'gemini', tokens: ['agar', 'aap', 'agle', 'saal'], weight: 1.1 },
      ],
      speech,
      window: { start: 0, end: 2.5 },
    });

    expect(texts(words)).toEqual(['agar', 'aap', 'agle', 'saal']);
    expect(words[1].start).toBeGreaterThanOrEqual(0.59);
    expect(words[2].end).toBeLessThanOrEqual(1.51);
    expect(stats.inserted).toBe(2);
  });

  it('drops a word nobody else heard where the audio is silent', () => {
    const speech = speechMapFromIntervals([{ start: 0.4, end: 1.6 }], 4);
    const { words, stats } = buildConsensus({
      backbone: [word('hello', 0.5, 1), word('world', 1, 1.5), word('Thank', 3, 3.3), word('you.', 3.3, 3.6)],
      backboneEngine: 'whisper',
      hypotheses: [
        { engine: 'whisper-2', tokens: ['hello', 'world'], weight: 0.9 },
        { engine: 'gemini', tokens: ['hello', 'world'], weight: 1.1 },
      ],
      speech,
    });

    expect(texts(words)).toEqual(['hello', 'world']);
    expect(stats.dropped).toBe(2);
  });

  it('ignores a word only one engine heard where there is no unclaimed speech', () => {
    const speech = speechMapFromIntervals([{ start: 0, end: 0.5 }, { start: 0.6, end: 1 }], 1.5);
    const { words } = buildConsensus({
      backbone: [word('one', 0, 0.5), word('two', 0.6, 1)],
      backboneEngine: 'whisper',
      hypotheses: [{ engine: 'gemini', tokens: ['one', 'extra', 'two'], weight: 1.1 }],
      speech,
    });
    expect(texts(words)).toEqual(['one', 'two']);
  });

  it('treats a name other engines split in two as one word, not a missed word', () => {
    const { words, stats } = buildConsensus({
      backbone: [word('apne', 0, 0.3), word('karanaojla', 0.3, 1.1), word('ka', 1.1, 1.3)],
      backboneEngine: 'whisper',
      hypotheses: [
        { engine: 'whisper-2', tokens: ['apne', 'Karan', 'Aujla', 'ka'], weight: 0.9 },
        { engine: 'gemini', tokens: ['apne', 'Karan', 'Aujla', 'ka'], weight: 1.1 },
      ],
    });

    expect(texts(words)).toEqual(['apne', 'Karan', 'Aujla', 'ka']);
    expect(words[1].start).toBe(0.3);
    expect(words[2].end).toBe(1.1);
    expect(words[1].end).toBeLessThanOrEqual(words[2].start);
    expect(stats.inserted).toBe(0);
  });

  it('never inserts the front half of a neighbouring word', () => {
    const speech = speechMapFromIntervals([{ start: 0, end: 2 }], 2);
    const { words } = buildConsensus({
      backbone: [word('apne', 0, 0.3), word('deepakalala', 0.9, 1.6)],
      backboneEngine: 'whisper',
      hypotheses: [
        { engine: 'gemini', tokens: ['apne', 'Deepak', 'Kalal', 'ji'], weight: 1.1 },
        { engine: 'nemotron', tokens: ['apne', 'Deepak'], weight: 0.8 },
      ],
      speech,
    });
    expect(texts(words).filter((t) => t.toLowerCase() === 'deepak')).toHaveLength(0);
  });

  it('inserts a word only one engine heard into unclaimed speech, flagged for review', () => {
    const speech = speechMapFromIntervals(
      [
        { start: 0, end: 0.5 },
        { start: 0.9, end: 1.6 },
        { start: 2, end: 2.5 },
      ],
      3,
    );
    const { words, disputes } = buildConsensus({
      backbone: [word('one', 0, 0.5), word('two', 2, 2.5)],
      backboneEngine: 'whisper',
      hypotheses: [{ engine: 'gemini', tokens: ['one', 'extra', 'two'], weight: 1.1 }],
      speech,
    });

    expect(texts(words)).toEqual(['one', 'extra', 'two']);
    expect(words[1].start).toBeGreaterThanOrEqual(0.89);
    expect(disputes[0]).toMatchObject({ index: 1, length: 1, kind: 'insertion' });
  });
});
