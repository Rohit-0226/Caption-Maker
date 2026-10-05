import { describe, expect, it } from 'vitest';
import {
  HINGLISH_VOCABULARY,
  normalizeHinglishToken,
  isHinglishWord,
  HINGLISH_VOCABULARY_PROMPT_SAMPLE,
} from '../src/core/transcription/hinglishLexicon';

describe('Hinglish vocabulary lexicon', () => {
  it('contains core pronouns, question words and verbs', () => {
    expect(HINGLISH_VOCABULARY.has('aapne')).toBe(true);
    expect(HINGLISH_VOCABULARY.has('hum')).toBe(true);
    expect(HINGLISH_VOCABULARY.has('kaise')).toBe(true);
    expect(HINGLISH_VOCABULARY.has('karna')).toBe(true);
    expect(HINGLISH_VOCABULARY.has('dekhna')).toBe(true);
    expect(HINGLISH_VOCABULARY.has('samajh')).toBe(true);
  });

  it('contains common discourse markers and colloquialisms', () => {
    expect(HINGLISH_VOCABULARY.has('yaar')).toBe(true);
    expect(HINGLISH_VOCABULARY.has('bhai')).toBe(true);
    expect(HINGLISH_VOCABULARY.has('matlab')).toBe(true);
    expect(HINGLISH_VOCABULARY.has('achha')).toBe(true);
    expect(HINGLISH_VOCABULARY.has('chalu')).toBe(true);
    expect(HINGLISH_VOCABULARY.has('pakka')).toBe(true);
  });

  it('verifies Hinglish words with isHinglishWord helper', () => {
    expect(isHinglishWord('aapne')).toBe(true);
    expect(isHinglishWord('bohot')).toBe(true); // matches canonical mapping
    expect(isHinglishWord('matlab')).toBe(true);
    expect(isHinglishWord('zyada')).toBe(true);
    expect(isHinglishWord('synergy')).toBe(false);
  });
});

describe('Hinglish canonical spelling normalisations', () => {
  it('corrects over-extended schwas', () => {
    expect(normalizeHinglishToken('apane')).toBe('aapne');
    expect(normalizeHinglishToken('pahale')).toBe('pehle');
    expect(normalizeHinglishToken('karane')).toBe('karne');
    expect(normalizeHinglishToken('usake')).toBe('uske');
  });

  it('corrects common phonetic and texting shortcuts', () => {
    expect(normalizeHinglishToken('bohot')).toBe('bahut');
    expect(normalizeHinglishToken('bhot')).toBe('bahut');
    expect(normalizeHinglishToken('jyada')).toBe('zyada');
    expect(normalizeHinglishToken('kese')).toBe('kaise');
    expect(normalizeHinglishToken('kyu')).toBe('kyun');
    expect(normalizeHinglishToken('hmesha')).toBe('hamesha');
    expect(normalizeHinglishToken('accha')).toBe('achha');
    expect(normalizeHinglishToken('thik')).toBe('theek');
    expect(normalizeHinglishToken('jarur')).toBe('zaroor');
  });

  it('standardises Roman Hindi nouns and verbs', () => {
    expect(normalizeHinglishToken('kosis')).toBe('koshish');
    expect(normalizeHinglishToken('suruaat')).toBe('shuruat');
    expect(normalizeHinglishToken('sukriya')).toBe('shukriya');
    expect(normalizeHinglishToken('jindagi')).toBe('zindagi');
    expect(normalizeHinglishToken('smjh')).toBe('samajh');
    expect(normalizeHinglishToken('btaya')).toBe('bataya');
  });

  it('converts Devanagari Hindi words like मैं, क्या, करूँ into standard Hinglish', () => {
    expect(normalizeHinglishToken('मैं')).toBe('main');
    expect(normalizeHinglishToken('क्या')).toBe('kya');
    expect(normalizeHinglishToken('करूँ')).toBe('karun');
    expect(normalizeHinglishToken('"करूँ?"')).toBe('"karun?"');
    expect(normalizeHinglishToken('करूँगा')).toBe('karunga');
    expect(normalizeHinglishToken('करुंगा')).toBe('karunga');
    expect(normalizeHinglishToken('करूँगी')).toBe('karungi');
    expect(normalizeHinglishToken('करेंगे')).toBe('karenge');
    expect(normalizeHinglishToken('रहा')).toBe('raha');
    expect(normalizeHinglishToken('सकूँ')).toBe('sakun');
    expect(normalizeHinglishToken('चाहिए')).toBe('chahiye');
    expect(normalizeHinglishToken('लगता')).toBe('lagta');
  });

  it('preserves casing style', () => {
    expect(normalizeHinglishToken('Bohot')).toBe('Bahut');
    expect(normalizeHinglishToken('JYADA')).toBe('ZYADA');
    expect(normalizeHinglishToken('kese')).toBe('kaise');
  });

  it('preserves leading and trailing punctuation', () => {
    expect(normalizeHinglishToken('"kese?"')).toBe('"kaise?"');
    expect(normalizeHinglishToken('(bohot)')).toBe('(bahut)');
  });

  it('provides a natural code-switched Whisper priming sample', () => {
    expect(HINGLISH_VOCABULARY_PROMPT_SAMPLE).toContain('YouTube');
    expect(HINGLISH_VOCABULARY_PROMPT_SAMPLE).toContain('Danube');
    expect(HINGLISH_VOCABULARY_PROMPT_SAMPLE).toContain('bahut');
  });
});
