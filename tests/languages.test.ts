import { describe, expect, it } from 'vitest';
import {
  LANGUAGES,
  hasDevanagari,
  postProcessText,
  normaliseRomanHinglish,
  romaniseDevanagari,
  getHinglishPrompt,
  HINGLISH_DOMAINS,
  LANGUAGE_ORDER,
} from '../src/core/transcription/languages';

describe('language configuration', () => {
  it('offers exactly the expected languages', () => {
    expect(Object.keys(LANGUAGES).sort()).toEqual(
      ['auto', 'bn', 'en', 'en-IN', 'gu', 'hi', 'hinglish', 'kn', 'ml', 'mr', 'pa', 'ta', 'te', 'ur'].sort(),
    );
  });

  it('configures Hindi for pure Devanagari output', () => {
    expect(LANGUAGES.hi.whisperLanguage).toBe('hi');
    expect(LANGUAGES.hi.romanise).toBe(false);
    expect(LANGUAGES.hi.prompt).toBeTruthy();
  });

  it('recognises Hinglish as Hindi, then romanises the result', () => {
    expect(LANGUAGES.hinglish.whisperLanguage).toBe('hi');
    expect(LANGUAGES.hinglish.romanise).toBe(true);
    expect(LANGUAGES.hinglish.prompt).toBeTruthy();
  });

  /**
   * Whisper treats `prompt` as preceding context, not as instructions. An early
   * version said "Do not translate the Hindi into English" and the model
   * transcribed that sentence into the captions. Prompts must be samples of the
   * wanted output instead.
   */
  it('primes with a sample sentence rather than an instruction', () => {
    const instructionWords = /\b(do not|don't|please|you must|never|always|ensure|write|keep)\b/i;

    for (const config of Object.values(LANGUAGES)) {
      if (!config.prompt) continue;
      expect(config.prompt).not.toMatch(instructionWords);
    }
  });

  it('primes Hinglish with genuinely code-switched Roman text', () => {
    const prompt = LANGUAGES.hinglish.prompt ?? '';
    // Hindi words in Roman script...
    expect(prompt).toMatch(/\b(main|gaya|maine|rupaye|baare)\b/i);
    // ...alongside English left as English
    expect(prompt).toMatch(/\b(marketing strategy|ad revenue|project timeline|Netflix)\b/i);
  });

  it('lets auto detect run without a language hint and places it first in LANGUAGE_ORDER', () => {
    expect(LANGUAGES.auto.whisperLanguage).toBeNull();
    expect(LANGUAGES.auto.label).toBe('Auto Detect');
    expect(LANGUAGE_ORDER[0]).toBe('auto');
    expect(LANGUAGE_ORDER).toContain('hinglish');
    expect(LANGUAGE_ORDER).toContain('en');
  });

  it('treats English (India) as English with a steering prompt', () => {
    expect(LANGUAGES['en-IN'].whisperLanguage).toBe('en');
    expect(LANGUAGES['en-IN'].prompt).toBeTruthy();
  });

  it('provides rich domain-specific Hinglish prompts', () => {
    expect(HINGLISH_DOMAINS).toHaveLength(5);
    expect(getHinglishPrompt('tech')).toContain('React');
    expect(getHinglishPrompt('business')).toContain('startup');
    expect(getHinglishPrompt('vlog')).toContain('vlog');
    expect(getHinglishPrompt('education')).toContain('lecture');
    expect(getHinglishPrompt('general')).toContain('YouTube');
  });
});

describe('Devanagari detection', () => {
  it('spots Devanagari', () => {
    expect(hasDevanagari('नमस्ते')).toBe(true);
    expect(hasDevanagari('mixed नमस्ते text')).toBe(true);
  });

  it('leaves plain Latin alone', () => {
    expect(hasDevanagari('fully furnished')).toBe(false);
    expect(hasDevanagari('')).toBe(false);
  });
});

describe('romanisation', () => {
  it('drops the inherent vowel at the end of a word', () => {
    expect(romaniseDevanagari('काम')).toBe('kaam');
  });

  it('keeps the inherent vowel between consonants', () => {
    expect(romaniseDevanagari('कमल')).toBe('kamal');
  });

  it('handles a conjunct through the virama', () => {
    expect(romaniseDevanagari('सिस्टम')).toBe('sistam');
  });

  it('maps the anusvara to n', () => {
    expect(romaniseDevanagari('हिंदी')).toBe('hindee');
  });

  it('converts Devanagari digits', () => {
    expect(romaniseDevanagari('२०२४')).toBe('2024');
  });

  it('passes Latin characters and spacing through untouched', () => {
    expect(romaniseDevanagari('fully furnished')).toBe('fully furnished');
    expect(romaniseDevanagari('का system')).toBe('kaa system');
  });

  it('preserves punctuation', () => {
    expect(romaniseDevanagari('नमस्ते, दोस्तों!')).toContain(',');
    expect(romaniseDevanagari('नमस्ते, दोस्तों!')).toContain('!');
  });
});

describe('post processing', () => {
  it('romanises only for Hinglish', () => {
    expect(postProcessText('काम', 'hinglish')).toBe('kaam');
    expect(postProcessText('काम', 'hi')).toBe('काम');
    expect(postProcessText('काम', 'en')).toBe('काम');
    expect(postProcessText('काम', 'auto')).toBe('काम');
  });

  it('leaves Roman Hinglish exactly as it arrived', () => {
    const text = 'Aapne fully furnished ka system chalu kiya';
    expect(postProcessText(text, 'hinglish')).toBe(text);
  });

  it('normalises common Roman Hindi and English loanword spellings without an SOP', () => {
    expect(normaliseRomanHinglish('mainne usako tren steshan aur netaphliks dikhaayaa')).toBe(
      'maine usko train station aur Netflix dikhaayaa',
    );
  });

  it('normalises punctuation-bearing words after Devanagari conversion', () => {
    expect(postProcessText('उसने Netflix देखा।', 'hinglish')).toContain('usne Netflix');
  });

  it('normalises Hindi text when language is hi', () => {
    expect(postProcessText('यह काम नही हुवा |', 'hi')).toBe('यह काम नहीं हुआ ।');
  });

  it('romanises Hindi words like मैं क्या करूँ into clean Hinglish while preserving English words', () => {
    expect(postProcessText('मैं क्या करूँ', 'hinglish')).toBe('main kya karu');
    expect(postProcessText('मैं क्या करूँगा', 'hinglish')).toBe('main kya karunga');
    expect(postProcessText('मैं क्या करूँ, sir my camera and video system is ready', 'hinglish')).toBe(
      'main kya karu, sir my camera and video system is ready',
    );
  });

  it('normalises conversational shortcuts like bohot, kese, and hmesha', () => {
    expect(normaliseRomanHinglish('yeh bohot achha hai')).toBe('yeh bahut achha hai');
    expect(normaliseRomanHinglish('aapne kese kiya?')).toBe('aapne kaise kiya?');
    expect(normaliseRomanHinglish('hmesha koshish karo')).toBe('hamesha koshish karo');
  });
});
