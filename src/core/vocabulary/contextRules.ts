import type { TranscriptWord } from '../types/project';

export interface ContextCorrection {
  index: number;
  original: string;
  corrected: string;
  confidence: number;
  reason: string;
  needsReview: boolean;
}

/**
 * Context-aware rules for Hinglish homophones and ambiguous words.
 * Crucial rule: Never blindly replace words without inspecting neighboring words.
 */

const MAIN_FOLLOWING_INDICATORS = new Set([
  'bhi', 'ek', 'kya', 'ja', 'raha', 'rahi', 'rahe', 'hoon', 'soch', 'kar', 'karta', 'karti',
  'apne', 'chahta', 'chahti', 'bol', 'bolta', 'bolti', 'dekh', 'dekhta', 'dekhti', 'nahi',
  'toh', 'to', 'is', 'us', 'yeh', 'woh', 'aur', 'pehle', 'koshish', 'aaj', 'kal',
]);

const MEIN_PRECEDING_INDICATORS = new Set([
  'video', 'ghar', 'office', 'room', 'duniya', 'life', 'baat', 'meeting', 'case', 'dimaag',
  'shahar', 'phone', 'camera', 'system', 'market', 'stock', 'channel', 'screen', 'project',
  'budget', 'saal', 'hafte', 'din', 'time', 'end', 'start', 'beginning', 'shuruat', 'comments',
  'comment', 'app', 'browser', 'folder', 'desh', 'dost', 'family', 'company', 'hospital',
  'class', 'college', 'school', 'car', 'bus', 'train', 'flight', 'is', 'us', 'kis', 'jis',
]);

const HAIN_RESPECT_PRECEDING = new Set([
  'aap', 'sir', 'maam', 'madam', 'teacher', 'doctor', 'prof', 'professor', 'ji', 'amitji',
  'modiji', 'papa', 'mummy', 'bhaiya', 'didi', 'boss', 'unhone', 'inhone', 'yeh', 'ye', 'woh',
  'log', 'doston', 'creators', 'companies', 'stocks', 'ideas', 'shares', 'users', 'viewers',
]);

/**
 * Disambiguates "main" (pronoun 'I') vs "mein" (locative preposition 'in/inside').
 */
export const disambiguateMainMein = (
  words: string[],
  index: number,
): { corrected: string; confidence: number; reason: string; needsReview: boolean } | null => {
  const current = words[index]?.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (current !== 'main' && current !== 'mein' && current !== 'mai' && current !== 'me') {
    return null;
  }

  const prev = index > 0 ? words[index - 1].toLowerCase().replace(/[^\p{L}]/gu, '') : '';
  const next = index < words.length - 1 ? words[index + 1].toLowerCase().replace(/[^\p{L}]/gu, '') : '';

  // Look ahead in the clause for copula 'hoon' (which strongly requires subject 'main')
  let clauseHasHoon = false;
  for (let i = index + 1; i < Math.min(words.length, index + 8); i++) {
    const w = words[i].toLowerCase().replace(/[^\p{L}]/gu, '');
    if (w === 'hoon' || w === 'hun') {
      clauseHasHoon = true;
      break;
    }
    if (w === 'hai' || w === 'hain' || w === 'tha' || w === 'the') break;
  }

  // Locative preposition triggers: preceding noun/place/container (e.g. "video mein", "ghar mein")
  if (MEIN_PRECEDING_INDICATORS.has(prev)) {
    return {
      corrected: 'mein',
      confidence: 0.96,
      reason: `Locative preposition after "${prev}" ('in/inside')`,
      needsReview: false,
    };
  }

  // Pronoun triggers: starts sentence, or followed by first-person verb / clause with 'hoon'
  if (clauseHasHoon || MAIN_FOLLOWING_INDICATORS.has(next) || index === 0) {
    return {
      corrected: 'main',
      confidence: 0.95,
      reason: clauseHasHoon ? 'First-person subject agreeing with "hoon"' : 'First-person pronoun subject ("I")',
      needsReview: false,
    };
  }

  // Ambiguous: do not blindly force; keep original with medium confidence if valid, flag if chat 'me'/'mai'
  if (current === 'me' || current === 'mai') {
    return {
      corrected: current === 'mai' ? 'main' : 'mein',
      confidence: 0.72,
      reason: 'Probable transliteration of ' + (current === 'mai' ? 'main' : 'mein'),
      needsReview: true,
    };
  }

  return null;
};

/**
 * Disambiguates "hai" (singular copula) vs "hain" (plural or respectful copula).
 */
export const disambiguateHaiHain = (
  words: string[],
  index: number,
): { corrected: string; confidence: number; reason: string; needsReview: boolean } | null => {
  const current = words[index]?.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (current !== 'hai' && current !== 'hain' && current !== 'h') {
    return null;
  }

  const prev = index > 0 ? words[index - 1].toLowerCase().replace(/[^\p{L}]/gu, '') : '';
  const prev2 = index > 1 ? words[index - 2].toLowerCase().replace(/[^\p{L}]/gu, '') : '';

  // Abbreviation 'h' always expands
  if (current === 'h') {
    const isPluralOrRespect = HAIN_RESPECT_PRECEDING.has(prev) || HAIN_RESPECT_PRECEDING.has(prev2);
    return {
      corrected: isPluralOrRespect ? 'hain' : 'hai',
      confidence: 0.95,
      reason: 'Standardized chat abbreviation "h"',
      needsReview: false,
    };
  }

  // Respect honorific or plural subjects trigger 'hain'
  if (HAIN_RESPECT_PRECEDING.has(prev) || HAIN_RESPECT_PRECEDING.has(prev2)) {
    if (current === 'hai') {
      return {
        corrected: 'hain',
        confidence: 0.94,
        reason: 'Honorific respect / plural agreement (e.g. Aap/Sir/Log)',
        needsReview: false,
      };
    }
  }

  return null;
};

/**
 * Checks for English 'or' vs Hindi 'aur'.
 */
export const disambiguateOrAur = (
  words: string[],
  index: number,
): { corrected: string; confidence: number; reason: string; needsReview: boolean } | null => {
  const current = words[index]?.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (current !== 'or') return null;

  const prev = index > 0 ? words[index - 1].toLowerCase().replace(/[^\p{L}]/gu, '') : '';
  const next = index < words.length - 1 ? words[index + 1].toLowerCase().replace(/[^\p{L}]/gu, '') : '';

  // English fixed idioms
  if ((prev === 'either' || prev === 'whether') || (prev === 'yes' && next === 'no') || next === 'else') {
    return null; // English 'or'
  }

  // Hindi conjunction between Hindi / Hinglish tokens
  return {
    corrected: 'aur',
    confidence: 0.92,
    reason: 'Hindi conjunction "aur" (avoiding English "or" in Hinglish context)',
    needsReview: false,
  };
};

/**
 * Applies all deterministic context rules across a sequence of words.
 */
export const applyContextRules = (words: TranscriptWord[]): {
  words: TranscriptWord[];
  corrections: ContextCorrection[];
} => {
  const tokens = words.map((w) => w.text);
  const corrections: ContextCorrection[] = [];
  const updatedWords = [...words];

  for (let i = 0; i < words.length; i++) {
    // 1. main vs mein
    const mainMein = disambiguateMainMein(tokens, i);
    if (mainMein && mainMein.corrected !== tokens[i].toLowerCase().replace(/[^\p{L}]/gu, '')) {
      const originalText = words[i].text;
      const cleanLead = originalText.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
      const cleanTrail = originalText.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
      const isCapitalized = /^[A-Z]/.test(originalText);
      const replaced = cleanLead + (isCapitalized ? mainMein.corrected.charAt(0).toUpperCase() + mainMein.corrected.slice(1) : mainMein.corrected) + cleanTrail;

      updatedWords[i] = { ...updatedWords[i], text: replaced };
      corrections.push({
        index: i,
        original: originalText,
        corrected: replaced,
        confidence: mainMein.confidence,
        reason: mainMein.reason,
        needsReview: mainMein.needsReview,
      });
      continue;
    }

    // 2. hai vs hain
    const haiHain = disambiguateHaiHain(tokens, i);
    if (haiHain && haiHain.corrected !== tokens[i].toLowerCase().replace(/[^\p{L}]/gu, '')) {
      const originalText = words[i].text;
      const cleanLead = originalText.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
      const cleanTrail = originalText.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
      const isCapitalized = /^[A-Z]/.test(originalText);
      const replaced = cleanLead + (isCapitalized ? haiHain.corrected.charAt(0).toUpperCase() + haiHain.corrected.slice(1) : haiHain.corrected) + cleanTrail;

      updatedWords[i] = { ...updatedWords[i], text: replaced };
      corrections.push({
        index: i,
        original: originalText,
        corrected: replaced,
        confidence: haiHain.confidence,
        reason: haiHain.reason,
        needsReview: haiHain.needsReview,
      });
      continue;
    }

    // 3. or vs aur
    const orAur = disambiguateOrAur(tokens, i);
    if (orAur && orAur.corrected !== tokens[i].toLowerCase().replace(/[^\p{L}]/gu, '')) {
      const originalText = words[i].text;
      const cleanLead = originalText.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
      const cleanTrail = originalText.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
      const isCapitalized = /^[A-Z]/.test(originalText);
      const replaced = cleanLead + (isCapitalized ? orAur.corrected.charAt(0).toUpperCase() + orAur.corrected.slice(1) : orAur.corrected) + cleanTrail;

      updatedWords[i] = { ...updatedWords[i], text: replaced };
      corrections.push({
        index: i,
        original: originalText,
        corrected: replaced,
        confidence: orAur.confidence,
        reason: orAur.reason,
        needsReview: orAur.needsReview,
      });
    }
  }

  return { words: updatedWords, corrections };
};
