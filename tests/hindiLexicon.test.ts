import { describe, expect, it } from 'vitest';
import {
  HINDI_VOCABULARY,
  HINDI_SPELLING_NORMALISATIONS,
  normalizeHindiToken,
  normalizeHindiText,
  isHindiWord,
  HINDI_VOCABULARY_PROMPT_SAMPLE,
} from '../src/core/transcription/hindiLexicon';

describe('Hindi vocabulary lexicon', () => {
  it('contains core pronouns, question words and verbs', () => {
    expect(HINDI_VOCABULARY.has('मैं')).toBe(true);
    expect(HINDI_VOCABULARY.has('आप')).toBe(true);
    expect(HINDI_VOCABULARY.has('क्या')).toBe(true);
    expect(HINDI_VOCABULARY.has('करना')).toBe(true);
    expect(HINDI_VOCABULARY.has('होना')).toBe(true);
    expect(HINDI_VOCABULARY.has('देखना')).toBe(true);
  });

  it('contains modern business, creator and tech nouns', () => {
    expect(HINDI_VOCABULARY.has('व्यापार')).toBe(true);
    expect(HINDI_VOCABULARY.has('रणनीति')).toBe(true);
    expect(HINDI_VOCABULARY.has('वीडियो')).toBe(true);
    expect(HINDI_VOCABULARY.has('चैनल')).toBe(true);
    expect(HINDI_VOCABULARY.has('ग्राहक')).toBe(true);
    expect(HINDI_VOCABULARY.has('इंटरनेट')).toBe(true);
  });

  it('verifies Hindi words with isHindiWord helper', () => {
    expect(isHindiWord('नमस्ते')).toBe(true);
    expect(isHindiWord('व्यापार')).toBe(true);
    expect(isHindiWord('business')).toBe(false);
  });
});

describe('Hindi ASR spelling normalisations', () => {
  it('corrects missing anusvaras and bindus', () => {
    expect(normalizeHindiToken('नही')).toBe('नहीं');
    expect(normalizeHindiToken('हू')).toBe('हूँ');
    expect(normalizeHindiToken('क्यो')).toBe('क्यों');
    expect(normalizeHindiToken('कहा')).toBe('कहाँ');
  });

  it('corrects colloquial/archaic verb endings to modern standard', () => {
    expect(normalizeHindiToken('हुवा')).toBe('हुआ');
    expect(normalizeHindiToken('कीया')).toBe('किया');
    expect(normalizeHindiToken('गयी')).toBe('गई');
    expect(normalizeHindiToken('गये')).toBe('गए');
  });

  it('standardises polite imperatives (-इये to -इए)', () => {
    expect(normalizeHindiToken('दीजिये')).toBe('दीजिए');
    expect(normalizeHindiToken('कीजिये')).toBe('कीजिए');
    expect(normalizeHindiToken('लीजिये')).toBe('लीजिए');
    expect(normalizeHindiToken('बताइये')).toBe('बताइए');
  });

  it('standardises loanword nuqtas', () => {
    expect(normalizeHindiToken('जरूर')).toBe('ज़रूर');
    expect(normalizeHindiToken('जिंदगी')).toBe('ज़िंदगी');
    expect(normalizeHindiToken('ज्यादा')).toBe('ज़्यादा');
    expect(normalizeHindiToken('फैसला')).toBe('फ़ैसला');
  });

  it('preserves leading and trailing punctuation', () => {
    expect(normalizeHindiToken('"नही!"')).toBe('"नहीं!"');
    expect(normalizeHindiToken('(दीजिये)')).toBe('(दीजिए)');
  });
});

describe('Hindi text normalisation', () => {
  it('converts ASCII pipe | to Devanagari danda ।', () => {
    expect(normalizeHindiText('यह काम अच्छा है |')).toBe('यह काम अच्छा है ।');
  });

  it('normalises full sentences with ASR errors and punctuation', () => {
    const raw = 'यह काम नही हुवा | कृपया फैसला कीजिये |';
    const clean = normalizeHindiText(raw);
    expect(clean).toBe('यह काम नहीं हुआ । कृपया फ़ैसला कीजिए ।');
  });

  it('provides a natural Hindi Whisper priming sample', () => {
    expect(HINDI_VOCABULARY_PROMPT_SAMPLE).toContain('व्यापार');
    expect(HINDI_VOCABULARY_PROMPT_SAMPLE).toContain('चैनल');
  });
});
