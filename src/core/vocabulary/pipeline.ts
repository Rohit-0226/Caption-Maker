import type { TranscriptWord } from '../types/project';
import { defaultVocabularyStore, type VocabularyStore } from './vocabularyStore';
import { defaultValidator, type ValidationSummary } from './validator';
import { applyContextRules } from './contextRules';
import { postProcessText } from '../transcription/languages';
import { normaliseEnglishToken } from '../transcription/englishLexicon';
import { isHinglishWord } from '../transcription/hinglishLexicon';

export interface ChangeLogItem {
  index: number;
  original: string;
  corrected: string;
  confidence: number;
  reason: string;
  needsReview: boolean;
}

export interface PipelineOutput {
  caption: string;
  words: TranscriptWord[];
  changes: ChangeLogItem[];
  needs_review: boolean;
  stageResults: {
    rawCount: number;
    cleanedCount: number;
    normalizedCount: number;
    validatedCount: number;
  };
}

/**
 * 6-Stage Modular Hinglish Transcription Pipeline:
 *
 * 1. RAW TRANSCRIPT (Tokenized Whisper speech stream)
 * 2. TEXT CLEANING (Trimming, NFC normalization, whitespace standardization)
 * 3. VOCABULARY NORMALIZATION (Pre-Groq deterministic normalization & context disambiguation)
 * 4. GROQ AI PROCESSING (Context-aware LLM pass with structured schema)
 * 5. VOCABULARY VALIDATION (Deterministic validation against approved DB, rejected forms & proper nouns)
 * 6. FINAL CAPTION (Timestamped tokens, full caption string, and review triage)
 */
export class HinglishPipeline {
  constructor(
    private store: VocabularyStore = defaultVocabularyStore,
    private validator = defaultValidator
  ) {}

  /**
   * Stage 1 & 2: Clean input text and tokens.
   */
  public cleanText(sourceWords: TranscriptWord[]): TranscriptWord[] {
    return sourceWords.map((word) => {
      const raw = word.text ?? '';
      const normalized = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
      return {
        ...word,
        text: postProcessText(normalized, 'hinglish'),
      };
    });
  }

  /**
   * Stage 3: Deterministic Vocabulary Pre-Normalization & Context Disambiguation.
   * Runs before the LLM pass to catch unambiguous errors and context homophones early.
   */
  public normalizeVocabulary(words: TranscriptWord[], properNouns: string[] = []): {
    words: TranscriptWord[];
    changes: ChangeLogItem[];
  } {
    const changes: ChangeLogItem[] = [];
    const properNounSet = new Set(properNouns.map((p) => p.toLowerCase().trim()));

    // 3a. Merge compound rejected phrases like "ek dam" -> "ekdum"
    const mergedWords: TranscriptWord[] = [];
    for (let i = 0; i < words.length; i++) {
      const current = words[i];
      const next = words[i + 1];
      if (
        current &&
        next &&
        current.text.toLowerCase().replace(/[^\p{L}]/gu, '') === 'ek' &&
        next.text.toLowerCase().replace(/[^\p{L}]/gu, '') === 'dam'
      ) {
        mergedWords.push({
          ...current,
          text: 'ekdum',
          end: next.end,
        });
        changes.push({
          index: i,
          original: current.text + ' ' + next.text,
          corrected: 'ekdum',
          confidence: 0.98,
          reason: 'Merged compound "ek dam" into approved "ekdum"',
          needsReview: false,
        });
        i++; // skip next
        continue;
      }
      mergedWords.push(current);
    }

    // 3b. Context Rules (e.g. main vs mein, hai vs hain, or vs aur)
    const contextRun = applyContextRules(mergedWords);
    for (const corr of contextRun.corrections) {
      changes.push({
        index: corr.index,
        original: corr.original,
        corrected: corr.corrected,
        confidence: corr.confidence,
        reason: corr.reason,
        needsReview: corr.needsReview,
      });
    }

    // 3c. Direct Vocabulary Normalization (Approved vs Rejected)
    const updated = contextRun.words.map((w, idx) => {
      const clean = w.text.replace(/[^\p{L}\p{N}-]/gu, '').trim();
      const lower = clean.toLowerCase();
      if (!clean || properNounSet.has(lower)) return w;

      // Check controlled vocabulary
      const vocabRes = this.store.lookup(clean);
      if (vocabRes) {
        if (vocabRes.isCorrection && vocabRes.confidence >= 0.85) {
          const lead = w.text.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
          const trail = w.text.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
          const isCap = /^[A-Z]/.test(clean);
          const resolved = vocabRes.resolved;
          const formatted = lead + (isCap ? resolved.charAt(0).toUpperCase() + resolved.slice(1) : resolved) + trail;

          if (formatted !== w.text) {
            changes.push({
              index: idx,
              original: w.text,
              corrected: formatted,
              confidence: vocabRes.confidence,
              reason: vocabRes.reason,
              needsReview: vocabRes.needsReview,
            });
            return { ...w, text: formatted };
          }
        }
        // Protected Hinglish word in vocabulary - NEVER pass to English phonetic normalizer
        return w;
      }

      // If it is already a known Hinglish word, protect it from English phonetic distortion
      const isKnownHinglish = this.store.isApproved(clean) || this.store.getEntry(clean) || isHinglishWord(clean);
      if (isKnownHinglish) return w;

      // Only normalize English tokens for non-Hinglish words
      const eng = normaliseEnglishToken(w.text, properNouns);
      if (eng !== w.text && eng.toLowerCase() !== w.text.toLowerCase()) {
        const isSuspiciousForHindi = /^[aeiou]/i.test(clean) && clean.length > 5;
        if (!isSuspiciousForHindi) {
          changes.push({
            index: idx,
            original: w.text,
            corrected: eng,
            confidence: 0.95,
            reason: 'English vocabulary normalisation',
            needsReview: false,
          });
          return { ...w, text: eng };
        }
      }

      return w;
    });

    return { words: updated, changes };
  }

  /**
   * Stage 5: Deterministic Post-Groq Validation.
   */
  public validateVocabulary(
    sourceWords: TranscriptWord[],
    candidateTokens: string[],
    properNouns: string[] = []
  ): ValidationSummary {
    return this.validator.validateTokens(sourceWords, candidateTokens, properNouns);
  }

  /**
   * Stage 6: Build Final Caption and structured changes log.
   */
  public generateFinalCaption(
    sourceWords: TranscriptWord[],
    validation: ValidationSummary,
    initialChanges: ChangeLogItem[] = []
  ): PipelineOutput {
    const finalWords = validation.words;
    const combinedChanges: Map<number, ChangeLogItem> = new Map();

    for (const ch of initialChanges) {
      combinedChanges.set(ch.index, ch);
    }

    for (const res of validation.results) {
      if (res.original !== res.validated || res.needsReview) {
        combinedChanges.set(res.index, {
          index: res.index,
          original: res.original,
          corrected: res.validated,
          confidence: res.confidence,
          reason: res.reason,
          needsReview: res.needsReview,
        });
      }
    }

    const captionText = finalWords.map((w) => w.text).join(' ');
    const changeList = Array.from(combinedChanges.values()).sort((a, b) => a.index - b.index);
    const needsReview = changeList.some((c) => c.needsReview);

    return {
      caption: captionText,
      words: finalWords,
      changes: changeList,
      needs_review: needsReview,
      stageResults: {
        rawCount: sourceWords.length,
        cleanedCount: sourceWords.length,
        normalizedCount: finalWords.length,
        validatedCount: finalWords.length,
      },
    };
  }

  /**
   * Complete pipeline execution (deterministic stages with optional AI tokens).
   */
  public execute(
    rawWords: TranscriptWord[],
    aiTokens?: string[],
    properNouns: string[] = []
  ): PipelineOutput {
    // 1 & 2: Clean
    const cleaned = this.cleanText(rawWords);

    // 3: Normalize
    const { words: normalized, changes: normChanges } = this.normalizeVocabulary(cleaned, properNouns);

    // 4: Groq AI Processing tokens (if supplied, otherwise normalized)
    const tokensToValidate = aiTokens && aiTokens.length === normalized.length
      ? aiTokens
      : normalized.map((w) => w.text);

    // 5: Validate
    const validation = this.validateVocabulary(normalized, tokensToValidate, properNouns);

    // 6: Final Caption
    return this.generateFinalCaption(normalized, validation, normChanges);
  }
}

export const defaultPipeline = new HinglishPipeline();
