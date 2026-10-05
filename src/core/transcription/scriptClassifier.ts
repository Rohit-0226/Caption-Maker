import type { WordScript, TranscriptWord, CaptionWord } from '../types/project';
import { ENGLISH_LEXICON, DEVANAGARI_ENGLISH } from './englishLexicon';
import {
  DEVANAGARI_HINDI_TO_ROMAN,
  HINGLISH_CANONICAL_SPELLINGS,
  isHinglishWord,
  isUnambiguousHindiToken,
} from './hinglishLexicon';
import { romaniseDevanagari } from './languages';

// Comprehensive creator, tech, and business terms that must always be English
const DEFAULT_PROTECTED_TERMS = new Set([
  'video', 'youtube', 'instagram', 'channel', 'editor', 'script', 'project', 'budget',
  'client', 'marketing', 'today', 'welcome', 'content', 'camera', 'audio', 'podcast',
  'creator', 'algorithm', 'reels', 'shorts', 'tiktok', 'subscribe', 'like', 'share',
  'comment', 'photoshop', 'premiere', 'after effects', 'render', 'export', 'frame',
  'timeline', 'resolution', 'quality', 'sound', 'music', 'track', 'developer',
  'software', 'react', 'node', 'javascript', 'typescript', 'python', 'docker',
  'database', 'server', 'backend', 'frontend', 'fullstack', 'api', 'endpoint',
  'github', 'code', 'bug', 'error', 'feature', 'deploy', 'cloud', 'startup', 'startups',
  'founder', 'business', 'revenue', 'profit', 'margin', 'valuation', 'equity',
  'investor', 'funding', 'growth', 'retention', 'sales', 'review', 'update',
  'feedback', 'schedule', 'deadline', 'target', 'strategy', 'launch', 'product',
  'brand', 'analytics', 'metrics', 'dashboard', 'report', 'sponsor', 'pricing',
  'laptop', 'mobile', 'screen', 'network', 'wifi', 'internet', 'browser', 'website',
  'app', 'link', 'online', 'digital', 'story', 'post', 'feed', 'account', 'design',
  'logo', 'thumbnail', 'template', 'preset', 'motion', 'animation', 'transition',
  'title', 'caption', 'subtitle', 'viral', 'trending', 'hook', 'push', 'scene',
  'vibe', 'sorted', 'clutch', 'switch', 'match', 'gameplay', 'culture', 'fit',
  'find', 'challenge', 'speed', 'matter', 'lit', 'moment', 'test', 'build',
  'container', 'route', 'express', 'async', 'await', 'usestate', 'engineering',
  'ownership', 'execution', 'authentic', 'cafe', 'food', 'op',
]);

const ENGLISH_LEXICON_SET = new Set([
  ...ENGLISH_LEXICON.map((w) => w.toLowerCase()),
  ...DEFAULT_PROTECTED_TERMS,
]);

// Known Romanised Hindi words and values from Devanagari mappings
const ROMAN_HINDI_SET = new Set([
  ...Object.values(DEVANAGARI_HINDI_TO_ROMAN).map((w) => w.toLowerCase()),
  'namaste', 'dost', 'doston', 'bhai', 'yaar', 'shukriya', 'dhanyawad', 'swagat',
  'chaliye', 'dekhiye', 'suniye', 'baat', 'kijiye', 'kahiye', 'chalo', 'dekho',
  'samajh', 'samjha', 'samjhe', 'samjhi', 'pata', 'maloom', 'achha', 'accha', 'theek',
  'sahi', 'galat', 'zaroor', 'zaroorat', 'zyada', 'thoda', 'bahut', 'bohot',
  'me', 'mein', 'pahunche', 'pahadon', 'mausam', 'jeet', 'gaye', 'gaya', 'gayi',
  'hua', 'hue', 'hui', 'ekdam', 'bilkul', 'mast', 'sabse', 'karna', 'karti',
  'karte', 'karta', 'karenge', 'karo', 'batao', 'pahad', 'pahaad', 'aaj', 'hum',
  'hain', 'hai', 'kya', 'aur', 'pe', 'sab', 'ho', 'ye', 'yeh', 'woh', 'wo',
]);

// Basic high-frequency English stopwords (note: 'me' is reserved as Hindi locative 'में')
const COMMON_ENGLISH_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with',
  'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if',
  'about', 'who', 'get', 'which', 'go', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him',
  'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
  'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use',
  'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
  'give', 'day', 'most', 'us', 'is', 'are', 'was', 'were', 'am', 'been', 'has', 'had', 'did', 'does',
  'very', 'really', 'cool', 'awesome', 'nice', 'great', 'super', 'best', 'pro', 'level', 'game', 'play',
  'start', 'stop', 'next', 'step', 'tip', 'trick', 'hack', 'guide', 'review', 'check', 'click', 'link',
  'free', 'paid', 'tool', 'tools', 'site', 'website', 'online', 'fast', 'slow', 'high', 'low',
]);

/**
 * Classifies a single word into its detected script:
 * - 'en': English loanword or English vocabulary
 * - 'hi': Romanised Hindi or Devanagari Hindi
 * - 'num': Numeric value (digits, timecodes, measurements)
 * - 'punct': Pure punctuation or symbol
 */
export const classifyScript = (
  token: string,
  protectedTerms?: Set<string>,
): WordScript => {
  if (!token) return 'punct';

  const clean = token.replace(/[^\p{L}\p{N}]/gu, '');
  if (!clean) return 'punct';

  // Pure digits or numeric strings (e.g. 1080, 9/16, 1st, 2nd)
  if (/^\d+([.,:\-/]\d+)*$/u.test(clean) || /^\d+(st|nd|rd|th|k|m|fps|px|x|s|ms)$/iu.test(clean)) {
    return 'num';
  }

  // Devanagari is always Hindi (unless it is an English word in Devanagari)
  if (/[\u0900-\u097F\uA8E0-\uA8FF]/u.test(token)) {
    if (DEVANAGARI_ENGLISH[clean]) return 'en';
    return 'hi';
  }

  const lower = clean.toLowerCase();

  // 1. Explicitly protected terms are always English
  if (protectedTerms?.has(lower) || DEFAULT_PROTECTED_TERMS.has(lower)) {
    return 'en';
  }

  // 2. Hindi & Hinglish vocabulary check (takes precedence over fuzzy English homophones)
  if (
    ROMAN_HINDI_SET.has(lower) ||
    isUnambiguousHindiToken(clean) ||
    isHinglishWord(clean) ||
    Boolean(HINGLISH_CANONICAL_SPELLINGS[lower])
  ) {
    return 'hi';
  }

  // 3. Known canonical English vocabulary & stopwords
  if (ENGLISH_LEXICON_SET.has(lower) || COMMON_ENGLISH_WORDS.has(lower)) {
    return 'en';
  }

  // 4. Default heuristic: Roman Hindi phonotactics
  if (/(aa|ee|oo|kh|gh|ch|jh|th|dh|ph|bh|sh|zh|un|in|en)$/i.test(clean)) {
    return 'hi';
  }

  // 5. English suffixes
  if (/(ing|tion|ment|ness|able|ible|ed|ly|er|est)$/i.test(clean)) {
    return 'en';
  }

  return 'en';
};

/**
 * Checks if a word is locked by the approved protected terms lexicon.
 */
export const isWordLocked = (token: string, protectedTerms?: Set<string>): boolean => {
  if (!token) return false;
  const clean = token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (!clean) return false;
  return Boolean(
    protectedTerms?.has(clean) ||
    DEFAULT_PROTECTED_TERMS.has(clean) ||
    ENGLISH_LEXICON_SET.has(clean),
  );
};

/**
 * Script split: Segment every transcript into runs by Unicode block [\u0900-\u097F].
 * Transliterate Devanagari runs only.
 * Latin runs pass through byte-for-byte, untouched, always!
 */
export const splitAndTransliterateRuns = (
  text: string,
  devanagariRepairMap?: Record<string, string>,
): string => {
  if (!text) return '';

  return text.replace(/[\u0900-\u097F\uA8E0-\uA8FF]+/gu, (devanagariRun) => {
    // 1. Check custom repair map from protected_terms.json if provided
    if (devanagariRepairMap?.[devanagariRun]) {
      return devanagariRepairMap[devanagariRun];
    }

    // 2. Check known English loanwords in Devanagari (e.g. वीडियो -> video)
    const directEnglish =
      DEVANAGARI_ENGLISH[devanagariRun] ||
      DEVANAGARI_ENGLISH[devanagariRun.normalize('NFC')] ||
      DEVANAGARI_ENGLISH[devanagariRun.replace(/[\u093C]/g, '')];
    if (directEnglish) return directEnglish;

    // 3. Check known Hindi romanisation (e.g. मैं -> main, क्या -> kya, करूँ -> karu)
    const directHindi =
      DEVANAGARI_HINDI_TO_ROMAN[devanagariRun] ||
      DEVANAGARI_HINDI_TO_ROMAN[devanagariRun.normalize('NFC')] ||
      DEVANAGARI_HINDI_TO_ROMAN[devanagariRun.replace(/[\u093C]/g, '')];
    if (directHindi) return directHindi;

    // 4. Algorithmic transliteration fallback
    return romaniseDevanagari(devanagariRun);
  });
};

export class IntegrityAssertionError extends Error {
  public readonly missingTerm: string;
  public readonly input: string;
  public readonly output: string;

  constructor(missingTerm: string, input: string, output: string) {
    super(
      `Integrity assertion failed: Protected term "${missingTerm}" present in input was corrupted or missing in output.\nInput: "${input}"\nOutput: "${output}"`,
    );
    this.name = 'IntegrityAssertionError';
    this.missingTerm = missingTerm;
    this.input = input;
    this.output = output;
  }
}

/**
 * Integrity assertion: After every stage, assert that any protected term
 * present at input is present and correctly spelled at output.
 * Fails loudly, logs the segment, does not silently continue.
 */
export const assertProtectedTermsIntegrity = (
  input: string,
  output: string,
  protectedTerms: string[],
): void => {
  const inputLower = ` ${input.toLowerCase()} `;
  const outputLower = ` ${output.toLowerCase()} `;

  for (const term of protectedTerms) {
    const termLower = term.toLowerCase();
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(termLower)}([^\\p{L}\\p{N}]|$)`, 'u');
    if (regex.test(inputLower)) {
      if (!regex.test(outputLower)) {
        throw new IntegrityAssertionError(term, input, output);
      }
    }
  }
};

const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Enriches transcript / caption words with:
 * - exact start_ms and end_ms
 * - detected script ('en' | 'hi' | 'num' | 'punct')
 * - locked flag (if word belongs to protected lexicon)
 */
export const enrichWord = <T extends TranscriptWord | CaptionWord>(
  word: T,
  protectedTerms?: Set<string>,
): T => {
  const start_ms = word.start_ms ?? Math.round(word.start * 1000);
  const end_ms = word.end_ms ?? Math.round(word.end * 1000);
  const script = word.script ?? classifyScript(word.text, protectedTerms);
  const locked = word.locked ?? isWordLocked(word.text, protectedTerms);

  return {
    ...word,
    start_ms,
    end_ms,
    script,
    locked,
  };
};

export const enrichWords = <T extends TranscriptWord | CaptionWord>(
  words: T[],
  protectedTerms?: Set<string>,
): T[] => {
  return words.map((w) => enrichWord(w, protectedTerms));
};

