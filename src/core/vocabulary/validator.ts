import type { TranscriptWord } from '../types/project';
import { defaultVocabularyStore, type VocabularyStore } from './vocabularyStore';
import { isHinglishWord, isUnambiguousHindiToken } from '../transcription/hinglishLexicon';
import { ENGLISH_LEXICON } from '../transcription/englishLexicon';

const ENGLISH_WORD_SET = new Set(ENGLISH_LEXICON.flatMap((term) => term.toLowerCase().split(/\s+/)));

export const isKnownEnglishWord = (word: string): boolean => {
  const clean = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return ENGLISH_WORD_SET.has(clean);
};

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface TokenValidationResult {
  index: number;
  original: string;
  validated: string;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  reason: string;
  needsReview: boolean;
  isNewWord: boolean;
  isRejected: boolean;
}

export interface ValidationSummary {
  words: TranscriptWord[];
  results: TokenValidationResult[];
  hasRejectedWords: boolean;
  needsReviewCount: number;
  newWordsCount: number;
}

export const getConfidenceLevel = (score: number): ConfidenceLevel => {
  if (score >= 0.9) return 'HIGH';
  if (score >= 0.7) return 'MEDIUM';
  return 'LOW';
};

/**
 * Deterministic Vocabulary & Token Validator.
 * Acts as the final quality and safety gate after AI processing.
 */
export class VocabularyValidator {
  constructor(private store: VocabularyStore = defaultVocabularyStore) {}

  /**
   * Validates tokens against project vocabulary, detects rejected spellings,
   * preserves proper nouns and English words, and flags new or uncertain words.
   */
  public validateTokens(
    sourceWords: TranscriptWord[],
    candidateTokens: string[],
    properNouns: string[] = []
  ): ValidationSummary {
    const properNounSet = new Set(properNouns.map((p) => p.toLowerCase().trim()));
    const results: TokenValidationResult[] = [];
    const outputWords: TranscriptWord[] = [];
    let hasRejected = false;
    let reviewCount = 0;
    let newWordCount = 0;

    for (let i = 0; i < sourceWords.length; i++) {
      const source = sourceWords[i];
      const token = candidateTokens[i] ?? source.text;
      const cleanToken = token.replace(/[^\p{L}\p{N}-]/gu, '').trim();
      const lower = cleanToken.toLowerCase();

      // Case preservation helper
      const preserveCasing = (target: string): string => {
        const lead = token.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
        const trail = token.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
        if (/^[A-Z][a-z]+$/.test(cleanToken)) {
          return lead + target.charAt(0).toUpperCase() + target.slice(1).toLowerCase() + trail;
        }
        if (/^[A-Z0-9]+$/.test(cleanToken) && cleanToken.length > 1) {
          return lead + target.toUpperCase() + trail;
        }
        return lead + target.toLowerCase() + trail;
      };

      // 1. Check for Proper Nouns (brands, creator names, user terms)
      if (properNounSet.has(lower)) {
        const validated = source.text; // Preserve original exact proper noun casing
        outputWords.push({ ...source, text: validated });
        results.push({
          index: i,
          original: source.text,
          validated,
          confidence: 1.0,
          confidenceLevel: 'HIGH',
          reason: 'Preserved proper noun / brand name',
          needsReview: false,
          isNewWord: false,
          isRejected: false,
        });
        continue;
      }

      // 2. Check for Controlled Vocabulary (Approved, Rejected, or Alternative)
      const vocabRes = this.store.lookup(cleanToken);
      if (vocabRes) {
        const finalWord = preserveCasing(vocabRes.resolved);
        const isRej = this.store.isRejected(cleanToken);
        if (isRej) hasRejected = true;
        if (vocabRes.needsReview) reviewCount++;

        outputWords.push({ ...source, text: finalWord });
        results.push({
          index: i,
          original: source.text,
          validated: finalWord,
          confidence: vocabRes.confidence,
          confidenceLevel: getConfidenceLevel(vocabRes.confidence),
          reason: vocabRes.reason,
          needsReview: vocabRes.needsReview,
          isNewWord: false,
          isRejected: isRej,
        });
        continue;
      }

      // 3. Keep English Words
      if (isKnownEnglishWord(cleanToken)) {
        outputWords.push({ ...source, text: token });
        results.push({
          index: i,
          original: source.text,
          validated: token,
          confidence: 0.95,
          confidenceLevel: 'HIGH',
          reason: 'Preserved English word in Hinglish context',
          needsReview: false,
          isNewWord: false,
          isRejected: false,
        });
        continue;
      }

      // 4. Known Hinglish Word (from high-frequency lexicon)
      if (isHinglishWord(cleanToken) || isUnambiguousHindiToken(cleanToken)) {
        outputWords.push({ ...source, text: token });
        results.push({
          index: i,
          original: source.text,
          validated: token,
          confidence: 0.9,
          confidenceLevel: 'HIGH',
          reason: 'High-frequency Roman Hinglish vocabulary',
          needsReview: false,
          isNewWord: false,
          isRejected: false,
        });
        continue;
      }

      // 5. New Word Detector (Not in controlled DB or base lexicon)
      // Check heuristics: does it look like reasonable Roman Hindi phonetics?
      const isRomanHindiPhonetic = /^[a-z]+$/i.test(cleanToken) && /[aeiou]/i.test(cleanToken);
      const isUncertain = cleanToken.length < 2 || /(.)\1\1/.test(cleanToken) || !isRomanHindiPhonetic;

      newWordCount++;
      const confidence = isUncertain ? 0.6 : 0.82;
      const needsReview = isUncertain;
      if (needsReview) reviewCount++;

      outputWords.push({ ...source, text: token });
      results.push({
        index: i,
        original: source.text,
        validated: token,
        confidence,
        confidenceLevel: getConfidenceLevel(confidence),
        reason: isUncertain
          ? 'Unindexed word with unusual phonetic pattern; review suggested'
          : 'New unindexed Hinglish word (valid phonetics)',
        needsReview,
        isNewWord: true,
        isRejected: false,
      });
    }

    return {
      words: outputWords,
      results,
      hasRejectedWords: hasRejected,
      needsReviewCount: reviewCount,
      newWordsCount: newWordCount,
    };
  }
}

export const defaultValidator = new VocabularyValidator();
