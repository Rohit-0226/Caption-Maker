import { describe, expect, it } from 'vitest';
import {
  canonicalEnglish,
  editDistance,
  normaliseEnglishToken,
  phoneticKey,
} from '../src/core/transcription/englishLexicon';

describe('phonetic key', () => {
  it('collapses the ways Hindi romanisation drifts from English', () => {
    expect(phoneticKey('Instagraam')).toBe(phoneticKey('Instagram'));
    expect(phoneticKey('Netflics')).toBe(phoneticKey('Netflix'));
    expect(phoneticKey('Whatsapp')).toBe(phoneticKey('WhatsApp'));
  });

  /**
   * Some spellings only come close — "yootyoob" keeps an extra glide. The key
   * narrows the field; the edit-distance step closes the gap.
   */
  it('brings near-misses within one edit', () => {
    expect(editDistance(phoneticKey('yootyoob'), phoneticKey('YouTube'), 3)).toBeLessThanOrEqual(1);
    expect(editDistance(phoneticKey('googal'), phoneticKey('Google'), 3)).toBeLessThanOrEqual(1);
  });

  it('ignores case and punctuation', () => {
    expect(phoneticKey('NETFLIX,')).toBe(phoneticKey('netflix'));
  });

  it('returns nothing for a token with no letters', () => {
    expect(phoneticKey('123')).toBe('');
    expect(phoneticKey('—')).toBe('');
  });
});

describe('edit distance', () => {
  it('measures single edits', () => {
    expect(editDistance('netflix', 'netflix')).toBe(0);
    // x becomes cs: one substitution plus one insertion
    expect(editDistance('netflix', 'netflics')).toBe(2);
    expect(editDistance('google', 'googel')).toBe(2);
    expect(editDistance('cat', 'dog')).toBeGreaterThan(2);
  });

  it('gives up early past the limit', () => {
    expect(editDistance('a', 'abcdefgh', 2)).toBeGreaterThan(2);
  });
});

describe('recovering English spellings', () => {
  /** The exact complaint: brands must come out spelled in English. */
  it('repairs phonetically-spelled brand names', () => {
    expect(canonicalEnglish('Netflics')).toBe('Netflix');
    expect(canonicalEnglish('netflix')).toBe('Netflix');
    expect(canonicalEnglish('Yutub')).toBe('YouTube');
    expect(canonicalEnglish('yootyoob')).toBe('YouTube');
    expect(canonicalEnglish('Instagraam')).toBe('Instagram');
    expect(canonicalEnglish('Whatsapp')).toBe('WhatsApp');
    expect(canonicalEnglish('Gugal')).toBe('Google');
    expect(canonicalEnglish('googal')).toBe('Google');
  });

  it('repairs Devanagari brand names exactly', () => {
    expect(canonicalEnglish('नेटफ्लिक्स')).toBe('Netflix');
    expect(canonicalEnglish('यूट्यूब')).toBe('YouTube');
    expect(canonicalEnglish('इंस्टाग्राम')).toBe('Instagram');
    expect(canonicalEnglish('गूगल')).toBe('Google');
    expect(canonicalEnglish('व्हाट्सएप')).toBe('WhatsApp');
  });

  it('repairs the mangled output of the transliterator', () => {
    // exactly what romaniseDevanagari produced before this existed
    expect(canonicalEnglish('netaphliks')).toBe('Netflix');
    expect(canonicalEnglish('instaagraam')).toBe('Instagram');
  });

  it('repairs everyday English words', () => {
    expect(canonicalEnglish('documentry')).toBe('documentary');
    expect(canonicalEnglish('profesional')).toBe('professional');
    expect(canonicalEnglish('bussiness')).toBe('business');
    expect(canonicalEnglish('फर्नीचर')).toBe('furniture');
    expect(canonicalEnglish('सर')).toBe('sir');
    expect(canonicalEnglish('कैमरा')).toBe('camera');
    expect(canonicalEnglish('सिस्टम')).toBe('system');
  });

  /**
   * The dangerous failure is the opposite one: turning a real Hindi word into
   * an English one nobody said.
   */
  it('leaves genuine Hindi words alone', () => {
    for (const word of [
      'hisab', 'vyakti', 'jinhonne', 'chalu', 'kiya', 'bahut', 'jyaada',
      'badha', 'deta', 'uske', 'bavjud', 'karte', 'hain', 'maine', 'mujhe',
      'aapne', 'pehle', 'thoda', 'banana', 'matlab', 'sabse', 'paisa',
    ]) {
      expect(canonicalEnglish(word), `${word} was wrongly changed`).toBeNull();
    }
  });

  it('leaves short tokens alone, where a guess would be reckless', () => {
    expect(canonicalEnglish('ka')).toBeNull();
    expect(canonicalEnglish('hai')).toBeNull();
    expect(canonicalEnglish('to')).toBeNull();
  });

  it('refuses a word that merely starts the same', () => {
    expect(canonicalEnglish('bharat')).toBeNull();
    expect(canonicalEnglish('paneer')).toBeNull();
  });

  it('accepts extra project terms', () => {
    expect(canonicalEnglish('Skyline', ['Skyline Properties'])).toBeNull();
    expect(canonicalEnglish('Rizwaan', ['Rizwan'])).toBe('Rizwan');
  });
});

describe('normalising a token in place', () => {
  it('keeps attached punctuation', () => {
    expect(normaliseEnglishToken('Netflics,')).toBe('Netflix,');
    expect(normaliseEnglishToken('"Yutub"')).toBe('"YouTube"');
    expect(normaliseEnglishToken('Instagraam.')).toBe('Instagram.');
  });

  it('always uses the brand’s own casing', () => {
    expect(normaliseEnglishToken('iphone')).toBe('iPhone');
    expect(normaliseEnglishToken('whatsapp')).toBe('WhatsApp');
    expect(normaliseEnglishToken('youtube')).toBe('YouTube');
  });

  it('follows the sentence casing for ordinary words', () => {
    expect(normaliseEnglishToken('documentry')).toBe('documentary');
    expect(normaliseEnglishToken('Documentry')).toBe('Documentary');
  });

  it('leaves a token it does not recognise exactly as it was', () => {
    expect(normaliseEnglishToken('jinhonne')).toBe('jinhonne');
    expect(normaliseEnglishToken('—')).toBe('—');
    expect(normaliseEnglishToken('')).toBe('');
  });

  it('handles a whole Hinglish sentence without touching the Hindi', () => {
    const input = 'Maine Netflics pe ek documentry dekhi aur Instagraam pe share kiya';
    const output = input
      .split(' ')
      .map((token) => normaliseEnglishToken(token))
      .join(' ');

    expect(output).toBe('Maine Netflix pe ek documentary dekhi aur Instagram pe share kiya');
  });
});
