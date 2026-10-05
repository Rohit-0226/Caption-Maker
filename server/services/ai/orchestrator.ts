import type { TranscriptWord } from '../../../src/core/types/project';
import { defaultVocabularyStore, type VocabularyStore } from '../../../src/core/vocabulary/vocabularyStore';
import { defaultValidator, type VocabularyValidator } from '../../../src/core/vocabulary/validator';
import { GroqProvider } from './groqProvider';
import { OpenRouterProvider } from './openRouterProvider';
import type {
  AIProvider,
  CaptionProcessingRequest,
  CaptionProcessingResponse,
  ComparisonResult,
  DebugTraceStep,
  ModelLogEntry,
  OrchestratedCaptionResult,
  ProviderStatus,
} from './types';

export class AIOrchestrator {
  private primary: AIProvider;
  private secondary: AIProvider;
  private logs: ModelLogEntry[] = [];
  private readonly MAX_LOGS = 100;
  private readonly HIGH_CONFIDENCE_THRESHOLD = 0.88;

  constructor(
    private store: VocabularyStore = defaultVocabularyStore,
    private validator: VocabularyValidator = defaultValidator,
    primaryProvider?: AIProvider,
    secondaryProvider?: AIProvider,
  ) {
    this.primary = primaryProvider ?? new GroqProvider();
    this.secondary = secondaryProvider ?? new OpenRouterProvider();
  }

  public getProviderStatuses(): ProviderStatus[] {
    return [this.primary.status(), this.secondary.status()];
  }

  public getRecentLogs(): ModelLogEntry[] {
    return [...this.logs];
  }

  private recordLog(entry: ModelLogEntry): void {
    this.logs.unshift(entry);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.pop();
    }
  }

  /**
   * Main dual-provider caption processing orchestration:
   * 1. Primary (Groq) execution.
   * 2. Automatic fallback to OpenRouter on error / 429 rate limit.
   * 3. Deterministic post-validation and confidence scoring.
   * 4. Second-opinion arbitration only on low-confidence or conflict.
   * 5. Strict priority: Vocabulary DB > Validator > Agreement > Primary > Secondary.
   */
  public async orchestrateCaption(options: {
    sourceWords: TranscriptWord[];
    fallbackWords: TranscriptWord[];
    properNouns?: string[];
    signal?: AbortSignal;
    enableDebugTrace?: boolean;
  }): Promise<OrchestratedCaptionResult> {
    const { sourceWords, fallbackWords, signal, enableDebugTrace } = options;
    const properNouns = options.properNouns ?? [];
    const debugTrace: DebugTraceStep[] = [];
    const inputTokens = sourceWords.map((w) => w.text);

    if (enableDebugTrace) {
      debugTrace.push({
        stage: '1. RAW_TRANSCRIPT',
        description: 'Input tokens from Whisper speech recognition',
        data: inputTokens,
      });
    }

    // Retrieve matching vocabulary rules dynamically (Token Efficiency)
    const relevantVocab = this.store.getRelevantEntries(inputTokens, 35);
    if (enableDebugTrace) {
      debugTrace.push({
        stage: '2. VOCABULARY_MATCHES',
        description: 'Dynamically retrieved matching project vocabulary rules',
        data: relevantVocab.map((v) => ({ word: v.word, approved: v.approved_form, rejected: v.rejected_forms })),
      });
    }

    const req: CaptionProcessingRequest = {
      tokens: inputTokens,
      sourceWords,
      fallbackWords,
      relevantVocabRules: relevantVocab,
      properNouns,
      signal,
    };

    let primaryRes: CaptionProcessingResponse | null = null;
    let fallbackUsed = false;
    let providerUsed: 'groq' | 'openrouter' | 'hybrid' = 'groq';

    // Step 1: Call Primary Model (Groq)
    try {
      primaryRes = await this.primary.processCaption(req);
      if (enableDebugTrace) {
        debugTrace.push({
          stage: '3. PRIMARY_AI_OUTPUT',
          description: `Primary provider (${primaryRes.provider} - ${primaryRes.model}) completed in ${primaryRes.responseTimeMs}ms`,
          data: { caption: primaryRes.caption, tokens: primaryRes.tokens, changes: primaryRes.changes },
        });
      }
    } catch (primaryErr) {
      // Primary model failed (e.g. rate limit 429, timeout, network error)
      const secStatus = this.secondary.status();
      if (secStatus.configured) {
        fallbackUsed = true;
        providerUsed = 'openrouter';
        try {
          primaryRes = await this.secondary.processCaption(req);
          if (enableDebugTrace) {
            debugTrace.push({
              stage: '3. FALLBACK_TRIGGERED',
              description: `Primary failed (${(primaryErr as Error).message}); fell back to ${primaryRes.provider} (${primaryRes.model})`,
              data: { caption: primaryRes.caption, tokens: primaryRes.tokens },
            });
          }
        } catch {
          // Both failed: fall back to deterministic pipeline
          primaryRes = null;
        }
      }
    }

    // Safe fallback if all external AI failed
    const workingTokens = primaryRes ? primaryRes.tokens : inputTokens;

    // Step 2: Deterministic Validation & Confidence Scoring
    const validation = this.validator.validateTokens(sourceWords, workingTokens, properNouns);

    let confidence = 1.0;
    let uncertainCount = 0;

    for (const res of validation.results) {
      if (res.needsReview) {
        confidence -= 0.12;
        uncertainCount++;
      }
      if (res.isRejected) {
        confidence -= 0.10;
      }
      if (res.isNewWord) {
        confidence -= 0.08;
        if (res.needsReview) {
          confidence -= 0.08;
        }
      }
    }

    if (primaryRes?.needs_review) {
      confidence -= 0.15;
      uncertainCount++;
    }

    confidence = Math.max(0.1, Math.min(1.0, Number(confidence.toFixed(2))));

    if (enableDebugTrace) {
      debugTrace.push({
        stage: '4. DETERMINISTIC_VALIDATION',
        description: `Validator computed confidence ${Math.round(confidence * 100)}% (${uncertainCount} uncertain words)`,
        data: {
          confidence,
          needsReviewCount: validation.needsReviewCount,
          hasRejectedWords: validation.hasRejectedWords,
          tokens: validation.words.map((w) => w.text),
        },
      });
    }

    let secondOpinionUsed = false;
    let agreementCount = 0;
    let disagreementCount = 0;
    let finalTokens = validation.words.map((w) => w.text);

    // Step 3: High vs Low Confidence Check
    const secStatus = this.secondary.status();
    const needsSecondOpinion =
      !fallbackUsed &&
      secStatus.configured &&
      (confidence < this.HIGH_CONFIDENCE_THRESHOLD ||
        validation.needsReviewCount > 0 ||
        primaryRes?.needs_review === true);

    if (needsSecondOpinion) {
      try {
        const secondaryRes = await this.secondary.processCaption(req);
        secondOpinionUsed = true;
        providerUsed = 'hybrid';

        const reconciledTokens: string[] = [];

        for (let i = 0; i < finalTokens.length; i++) {
          const prim = finalTokens[i];
          const sec = secondaryRes.tokens[i] ?? prim;
          const primClean = prim.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '');
          const secClean = sec.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '');

          // Case A: Agreement
          if (primClean === secClean) {
            agreementCount++;
            reconciledTokens.push(prim);
            continue;
          }

          // Case B: Disagreement -> Strict Vocabulary Priority Hierarchy
          disagreementCount++;

          // 1. Check Project Controlled Vocabulary Rule
          const primLookup = this.store.lookup(primClean);
          const secLookup = this.store.lookup(secClean);

          if (this.store.isApproved(primClean) && this.store.isRejected(secClean)) {
            reconciledTokens.push(prim);
            continue;
          }
          if (this.store.isApproved(secClean) && this.store.isRejected(primClean)) {
            reconciledTokens.push(sec);
            continue;
          }
          if (primLookup && !primLookup.isCorrection) {
            reconciledTokens.push(prim);
            continue;
          }
          if (secLookup && !secLookup.isCorrection) {
            reconciledTokens.push(sec);
            continue;
          }

          // 2. Fall back to Primary Model
          reconciledTokens.push(prim);
        }

        finalTokens = reconciledTokens;

        // Agreement increases confidence
        if (agreementCount > 0 && disagreementCount === 0) {
          confidence = Math.min(1.0, confidence + 0.15);
        }

        if (enableDebugTrace) {
          debugTrace.push({
            stage: '5. SECOND_OPINION_ARBITRATION',
            description: `OpenRouter second opinion completed. Agreement: ${agreementCount}, Disagreement: ${disagreementCount}`,
            data: {
              secondaryModel: secondaryRes.model,
              agreementCount,
              disagreementCount,
              reconciledTokens,
            },
          });
        }
      } catch {
        // Second opinion failed, proceed with validated primary
      }
    }

    // Step 4: Final Validation Gate
    const finalValidation = this.validator.validateTokens(sourceWords, finalTokens, properNouns);
    const finalWords = finalValidation.words;
    const finalCaption = finalWords.map((w) => w.text).join(' ');

    const changes = finalWords
      .map((w, idx) => ({
        original: sourceWords[idx].text,
        corrected: w.text,
        confidence,
        reason:
          sourceWords[idx].text !== w.text
            ? `${providerUsed.toUpperCase()} normalization (confidence ${Math.round(confidence * 100)}%)`
            : 'Unchanged',
        needsReview: finalValidation.results[idx]?.needsReview || false,
      }))
      .filter((c) => c.original !== c.corrected || c.needsReview);

    const logEntry: ModelLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      provider: providerUsed,
      primaryModel: this.primary.status().model,
      secondaryModel: secondOpinionUsed ? this.secondary.status().model : undefined,
      responseTimeMs: primaryRes ? primaryRes.responseTimeMs : 0,
      confidence,
      fallbackUsed,
      secondOpinionUsed,
      correctionsCount: changes.length,
      uncertainWordsCount: finalValidation.needsReviewCount,
      tokensCount: finalWords.length,
    };
    this.recordLog(logEntry);

    if (enableDebugTrace) {
      debugTrace.push({
        stage: '6. FINAL_OUTPUT',
        description: 'Synchronized caption with Whisper timing preserved',
        data: {
          caption: finalCaption,
          confidence,
          needs_review: finalValidation.needsReviewCount > 0,
        },
      });
    }

    return {
      tokens: finalWords.map((w) => w.text),
      caption: finalCaption,
      words: finalWords,
      confidence,
      providerUsed,
      primaryModel: this.primary.status().model,
      secondaryModel: secondOpinionUsed ? this.secondary.status().model : undefined,
      fallbackUsed,
      secondOpinionUsed,
      modelAgreementCount: agreementCount,
      modelDisagreementCount: disagreementCount,
      changes,
      needs_review: finalValidation.needsReviewCount > 0,
      debugTrace: enableDebugTrace ? debugTrace : undefined,
    };
  }

  /**
   * Side-by-side comparison mode for testing and benchmarking.
   */
  public async compareProviders(sentence: string, properNouns: string[] = []): Promise<ComparisonResult> {
    const tokens = sentence.trim().split(/\s+/).filter(Boolean);
    const words: TranscriptWord[] = tokens.map((t, idx) => ({
      text: t,
      start: idx * 0.4,
      end: idx * 0.4 + 0.35,
      confidence: null,
    }));

    const relevantVocab = this.store.getRelevantEntries(tokens, 35);
    const req: CaptionProcessingRequest = {
      tokens,
      sourceWords: words,
      fallbackWords: words,
      relevantVocabRules: relevantVocab,
      properNouns,
    };

    let groqRes: CaptionProcessingResponse | null = null;
    let groqError: string | undefined;
    try {
      groqRes = await this.primary.processCaption(req);
    } catch (e) {
      groqError = (e as Error).message;
    }

    let openRouterRes: CaptionProcessingResponse | null = null;
    let openRouterError: string | undefined;
    try {
      openRouterRes = await this.secondary.processCaption(req);
    } catch (e) {
      openRouterError = (e as Error).message;
    }

    // Run full arbitration
    const orchestrated = await this.orchestrateCaption({
      sourceWords: words,
      fallbackWords: words,
      properNouns,
      enableDebugTrace: true,
    });

    return {
      original: sentence,
      groq: {
        caption: groqRes?.caption || 'Unavailable',
        tokens: groqRes?.tokens || [],
        confidence: groqRes ? 0.95 : 0,
        responseTimeMs: groqRes?.responseTimeMs || 0,
        error: groqError,
      },
      openrouter: {
        caption: openRouterRes?.caption || 'Unavailable',
        tokens: openRouterRes?.tokens || [],
        confidence: openRouterRes ? 0.92 : 0,
        responseTimeMs: openRouterRes?.responseTimeMs || 0,
        error: openRouterError,
      },
      finalSelected: {
        caption: orchestrated.caption,
        tokens: orchestrated.tokens,
        confidence: orchestrated.confidence,
        reason: orchestrated.secondOpinionUsed
          ? `Synthesized via Second-Opinion Arbitration (${orchestrated.modelAgreementCount} agreements)`
          : `Primary ${orchestrated.providerUsed.toUpperCase()} resolution`,
        secondOpinionUsed: orchestrated.secondOpinionUsed,
        agreementCount: orchestrated.modelAgreementCount,
      },
    };
  }

  /**
   * Benchmark Groq vs OpenRouter across a test dataset.
   */
  public async benchmarkProviders(testCases: Array<{ input: string; expected: string }>): Promise<{
    casesCount: number;
    groqAccuracy: number;
    openRouterAccuracy: number;
    hybridAccuracy: number;
    averageLatencyGroqMs: number;
    averageLatencyOpenRouterMs: number;
    recommendation: string;
  }> {
    let groqCorrect = 0;
    let openRouterCorrect = 0;
    let hybridCorrect = 0;
    let groqLatencySum = 0;
    let openRouterLatencySum = 0;

    for (const tc of testCases) {
      const comp = await this.compareProviders(tc.input);

      if (comp.groq.caption.trim().toLowerCase() === tc.expected.trim().toLowerCase()) {
        groqCorrect++;
      }
      if (comp.openrouter.caption.trim().toLowerCase() === tc.expected.trim().toLowerCase()) {
        openRouterCorrect++;
      }
      if (comp.finalSelected.caption.trim().toLowerCase() === tc.expected.trim().toLowerCase()) {
        hybridCorrect++;
      }

      groqLatencySum += comp.groq.responseTimeMs;
      openRouterLatencySum += comp.openrouter.responseTimeMs;
    }

    const n = Math.max(1, testCases.length);
    const groqAcc = Number(((groqCorrect / n) * 100).toFixed(1));
    const openRouterAcc = Number(((openRouterCorrect / n) * 100).toFixed(1));
    const hybridAcc = Number(((hybridCorrect / n) * 100).toFixed(1));

    let recommendation = 'Groq delivers lower latency; OpenRouter provides reliable fallback resilience.';
    if (hybridAcc > groqAcc) {
      recommendation = `Hybrid second-opinion arbitration achieved highest accuracy (${hybridAcc}%), exceeding standalone models.`;
    }

    return {
      casesCount: n,
      groqAccuracy: groqAcc,
      openRouterAccuracy: openRouterAcc,
      hybridAccuracy: hybridAcc,
      averageLatencyGroqMs: Math.round(groqLatencySum / n),
      averageLatencyOpenRouterMs: Math.round(openRouterLatencySum / n),
      recommendation,
    };
  }
}

export const defaultOrchestrator = new AIOrchestrator();
