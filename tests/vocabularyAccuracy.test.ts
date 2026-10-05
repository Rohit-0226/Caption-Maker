import { describe, expect, it } from 'vitest';
import { VocabularyEvaluator } from '../src/core/vocabulary/evaluator';
import datasetJson from './fixtures/vocabulary-dataset.json';
import { defaultVocabularyStore } from '../src/core/vocabulary/vocabularyStore';
import { disambiguateMainMein, disambiguateHaiHain, disambiguateOrAur } from '../src/core/vocabulary/contextRules';
import { defaultValidator } from '../src/core/vocabulary/validator';
import type { TranscriptWord } from '../src/core/types/project';

describe('Controlled Hinglish Vocabulary & Regression Suite', () => {
  const evaluator = new VocabularyEvaluator();

  it('evaluates regression test dataset with high accuracy metrics', () => {
    const report = evaluator.evaluateDataset(datasetJson.cases as any);

    // Diagnostic logging for development insight
    console.log('\n--- Vocabulary Regression Evaluation Report ---');
    console.log(`Total Cases: ${report.totalCases}`);
    console.log(`Passed Cases: ${report.passedCases}/${report.totalCases}`);
    console.log(`Vocabulary Accuracy: ${report.vocabularyAccuracy}%`);
    console.log(`Rejected-Word Detection: ${report.rejectedWordDetection}%`);
    console.log(`Correction Accuracy: ${report.correctionAccuracy}%`);
    console.log(`Unchanged-Word Accuracy: ${report.unchangedWordAccuracy}%`);
    console.log(`JSON Output Validity: ${report.jsonOutputValidity}%`);
    console.log(`Low-Confidence Rate: ${report.lowConfidenceRate}%`);
    if (report.failures.length > 0) {
      console.log('Failures:', JSON.stringify(report.failures, null, 2));
    }
    console.log('------------------------------------------------\n');

    expect(report.jsonOutputValidity).toBe(100);
    expect(report.vocabularyAccuracy).toBeGreaterThanOrEqual(95);
    expect(report.rejectedWordDetection).toBeGreaterThanOrEqual(95);
    expect(report.unchangedWordAccuracy).toBeGreaterThanOrEqual(95);
  });

  it('correctly maps rejected spellings to approved forms from central vocabulary', () => {
    const res1 = defaultVocabularyStore.lookup('bohot');
    expect(res1?.resolved).toBe('bahut');
    expect(res1?.isCorrection).toBe(true);

    const res2 = defaultVocabularyStore.lookup('jyada');
    expect(res2?.resolved).toBe('zyada');

    const res3 = defaultVocabularyStore.lookup('jarur');
    expect(res3?.resolved).toBe('zaroor');

    const res4 = defaultVocabularyStore.lookup('chaiye');
    expect(res4?.resolved).toBe('chahiye');

    const res5 = defaultVocabularyStore.lookup('esliye');
    expect(res5?.resolved).toBe('isliye');
  });

  it('disambiguates contextual homophones "main" vs "mein"', () => {
    // "Is video mein main bataunga"
    const sentence = ['Is', 'video', 'me', 'main', 'bataunga'];
    const meinCheck = disambiguateMainMein(sentence, 2);
    expect(meinCheck?.corrected).toBe('mein');
    expect(meinCheck?.confidence).toBeGreaterThanOrEqual(0.9);

    // "Main ghar ja raha hoon"
    const sentence2 = ['mai', 'ghar', 'ja', 'raha', 'hoon'];
    const mainCheck = disambiguateMainMein(sentence2, 0);
    expect(mainCheck?.corrected).toBe('main');
  });

  it('disambiguates contextual copula "hai" vs "hain"', () => {
    // Honorific respect: "Aap kaise hain?"
    const sentence1 = ['Aap', 'kaise', 'hai'];
    const res1 = disambiguateHaiHain(sentence1, 2);
    expect(res1?.corrected).toBe('hain');

    // Single entity: "Ram ghar par hai"
    const sentence2 = ['Ram', 'ghar', 'par', 'hai'];
    const res2 = disambiguateHaiHain(sentence2, 3);
    expect(res2).toBeNull(); // remains 'hai'
  });

  it('disambiguates English "or" vs Hindi "aur"', () => {
    // "Video aur audio"
    const res = disambiguateOrAur(['video', 'or', 'audio'], 1);
    expect(res?.corrected).toBe('aur');

    // English idiom: "yes or no"
    const resEng = disambiguateOrAur(['yes', 'or', 'no'], 1);
    expect(resEng).toBeNull(); // remains 'or'
  });

  it('safely handles new unindexed words without blind rejection', () => {
    const rawWords: TranscriptWord[] = [
      { text: 'humne', start: 0, end: 0.5, confidence: null },
      { text: 'charcha', start: 0.5, end: 1.0, confidence: null },
    ];
    const validation = defaultValidator.validateTokens(rawWords, ['humne', 'charcha']);
    expect(validation.words[1].text).toBe('charcha');
    expect(validation.results[1].isNewWord).toBe(true);
    expect(validation.results[1].needsReview).toBe(false); // Valid phonetics
  });
});
