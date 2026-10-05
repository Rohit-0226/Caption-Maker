import type { TerminologyRule, TranscriptWord } from '../../../src/core/types/project';
import { hasDevanagari, postProcessText } from '../../../src/core/transcription/languages';
import { defaultVocabularyStore } from '../../../src/core/vocabulary/vocabularyStore';
import { defaultPipeline } from '../../../src/core/vocabulary/pipeline';
import { defaultOrchestrator, AIOrchestrator } from '../ai/orchestrator';

export { defaultOrchestrator, AIOrchestrator };

export interface GroqHinglishChange {
  original: string;
  corrected: string;
  confidence: number;
  reason: string;
}

export interface GroqHinglishStructuredOutput {
  caption: string;
  tokens: string[];
  changes?: GroqHinglishChange[];
  needs_review?: boolean;
}

export const applyRomanHinglishCorrections = (
  sourceWords: TranscriptWord[],
  fallbackWords: TranscriptWord[],
  correctedTokens: unknown,
): TranscriptWord[] | null => {
  if (!Array.isArray(correctedTokens) || correctedTokens.length !== sourceWords.length) {
    return null;
  }

  const deletions = correctedTokens.filter(
    (token) => typeof token === 'string' && token.trim() === '',
  ).length;
  if (deletions > Math.max(3, Math.ceil(sourceWords.length * 0.12))) return null;

  return sourceWords.flatMap((word, index) => {
    const value = correctedTokens[index];
    if (typeof value !== 'string') return [{ ...fallbackWords[index] }];
    let token = value.trim();
    if (!token) return [];
    if (/\s/u.test(token) || token.length > 64) return [{ ...fallbackWords[index] }];
    if (hasDevanagari(token)) {
      token = postProcessText(token, 'hinglish');
    }
    return [{ ...word, text: token }];
  });
};

const preferredSpellings = (terms: string[], rules: TerminologyRule[]): string[] => {
  const candidates = [
    ...rules.map((rule) => rule.preferred),
    ...terms.filter((term) =>
      /[A-Z][A-Z]|[a-z][A-Z]|[A-Za-z]\d|\d[A-Za-z]|\s/.test(term),
    ),
  ];
  return [...new Set(candidates.map((term) => term.trim()).filter(Boolean))].slice(0, 100);
};

export const resolveHinglishModel = (): string => {
  return process.env.GROQ_HINGLISH_MODEL?.trim() || 'llama-3.3-70b-versatile';
};

export const HINGLISH_CLEANUP_MODEL = resolveHinglishModel();

/**
 * Normalises recognized tokens into natural Roman Hinglish using the dual-provider
 * AI Orchestrator (Groq primary + OpenRouter second opinion & fallback).
 */
export const cleanRomanHinglishWithGroq = async (options: {
  sourceWords: TranscriptWord[];
  fallbackWords: TranscriptWord[];
  apiKey: string;
  terms?: string[];
  rules?: TerminologyRule[];
  signal?: AbortSignal;
}): Promise<TranscriptWord[] | null> => {
  const { sourceWords, fallbackWords, signal } = options;
  if (sourceWords.length === 0) return null;

  const spellings = preferredSpellings(options.terms ?? [], options.rules ?? []);
  const BATCH_SIZE = 50;
  const result: TranscriptWord[] = [];
  let anyCleaned = false;

  for (let i = 0; i < sourceWords.length; i += BATCH_SIZE) {
    if (signal?.aborted) return null;
    const chunkSource = sourceWords.slice(i, i + BATCH_SIZE);
    const chunkFallback = fallbackWords.slice(i, i + BATCH_SIZE);

    try {
      const orchestrated = await defaultOrchestrator.orchestrateCaption({
        sourceWords: chunkSource,
        fallbackWords: chunkFallback,
        properNouns: spellings,
        signal,
      });

      if (orchestrated.words && orchestrated.words.length === chunkSource.length) {
        result.push(...orchestrated.words.map((w) => ({
          ...w,
          text: postProcessText(w.text, 'hinglish'),
        })));
        anyCleaned = true;
      } else {
        result.push(...chunkFallback.map((w) => ({
          ...w,
          text: postProcessText(w.text, 'hinglish'),
        })));
      }
    } catch {
      result.push(...chunkFallback.map((w) => ({
        ...w,
        text: postProcessText(w.text, 'hinglish'),
      })));
    }
  }

  return anyCleaned ? result : null;
};
