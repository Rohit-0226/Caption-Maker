import { HinglishPipeline, type PipelineOutput } from './pipeline';
import type { TranscriptWord } from '../types/project';

export interface TestCase {
  id: string;
  category: 'approved' | 'rejected' | 'homophone_context' | 'mixed_english' | 'proper_nouns' | 'numbers_punctuation';
  input: string;
  expected: string;
  notes?: string;
}

export interface AccuracyReport {
  totalCases: number;
  passedCases: number;
  totalTokens: number;
  vocabularyAccuracy: number;
  rejectedWordDetection: number;
  correctionAccuracy: number;
  unchangedWordAccuracy: number;
  jsonOutputValidity: number;
  lowConfidenceRate: number;
  failures: Array<{
    id: string;
    category: string;
    input: string;
    expected: string;
    actual: string;
  }>;
}

export class VocabularyEvaluator {
  constructor(private pipeline = new HinglishPipeline()) {}

  public evaluateDataset(dataset: TestCase[]): AccuracyReport {
    let passedCases = 0;
    let totalTokens = 0;
    let correctTokens = 0;

    let rejectedWordsCount = 0;
    let rejectedWordsCaught = 0;

    let correctionsExpected = 0;
    let correctionsAccurate = 0;

    let unchangedExpected = 0;
    let unchangedPreserved = 0;

    let validJsonCount = 0;
    let lowConfidenceTokens = 0;

    const failures: AccuracyReport['failures'] = [];

    for (const testCase of dataset) {
      const inputTokens = testCase.input.split(/\s+/).filter(Boolean);
      const expectedTokens = testCase.expected.split(/\s+/).filter(Boolean);

      const words: TranscriptWord[] = inputTokens.map((t, idx) => ({
        text: t,
        start: idx * 0.4,
        end: idx * 0.4 + 0.35,
        confidence: null,
      }));

      const output: PipelineOutput = this.pipeline.execute(words);

      // JSON / Structured Output Validity Check
      if (
        output &&
        typeof output.caption === 'string' &&
        Array.isArray(output.words) &&
        Array.isArray(output.changes) &&
        typeof output.needs_review === 'boolean'
      ) {
        validJsonCount++;
      }

      const actualTokens = output.words.map((w) => w.text);
      const isMatch = output.caption.trim().toLowerCase() === testCase.expected.trim().toLowerCase();

      if (isMatch) {
        passedCases++;
      } else {
        failures.push({
          id: testCase.id,
          category: testCase.category,
          input: testCase.input,
          expected: testCase.expected,
          actual: output.caption,
        });
      }

      // Token-level metric computation
      const len = Math.min(inputTokens.length, expectedTokens.length, actualTokens.length);
      for (let i = 0; i < len; i++) {
        totalTokens++;
        const inp = inputTokens[i];
        const exp = expectedTokens[i];
        const act = actualTokens[i];

        if (act.toLowerCase() === exp.toLowerCase()) {
          correctTokens++;
        }

        if (inp.toLowerCase() !== exp.toLowerCase()) {
          // Expected a correction
          correctionsExpected++;
          if (testCase.category === 'rejected') rejectedWordsCount++;

          if (act.toLowerCase() === exp.toLowerCase()) {
            correctionsAccurate++;
            if (testCase.category === 'rejected') rejectedWordsCaught++;
          }
        } else {
          // Expected token to remain unchanged
          unchangedExpected++;
          if (act.toLowerCase() === inp.toLowerCase()) {
            unchangedPreserved++;
          }
        }
      }

      // Check confidence triage
      for (const ch of output.changes) {
        if (ch.confidence < 0.75) {
          lowConfidenceTokens++;
        }
      }
    }

    return {
      totalCases: dataset.length,
      passedCases,
      totalTokens,
      vocabularyAccuracy: totalTokens > 0 ? Number(((correctTokens / totalTokens) * 100).toFixed(2)) : 100,
      rejectedWordDetection: rejectedWordsCount > 0 ? Number(((rejectedWordsCaught / rejectedWordsCount) * 100).toFixed(2)) : 100,
      correctionAccuracy: correctionsExpected > 0 ? Number(((correctionsAccurate / correctionsExpected) * 100).toFixed(2)) : 100,
      unchangedWordAccuracy: unchangedExpected > 0 ? Number(((unchangedPreserved / unchangedExpected) * 100).toFixed(2)) : 100,
      jsonOutputValidity: dataset.length > 0 ? Number(((validJsonCount / dataset.length) * 100).toFixed(2)) : 100,
      lowConfidenceRate: totalTokens > 0 ? Number(((lowConfidenceTokens / totalTokens) * 100).toFixed(2)) : 0,
      failures,
    };
  }
}
