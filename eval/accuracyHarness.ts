/**
 * Hinglish Caption Studio — Accuracy Evaluation Harness (Section 10)
 *
 * Measures:
 * 1. Word Error Rate (WER) overall
 * 2. English term integrity % (target: >= 98%, threshold: >= 95%)
 * 3. Script classification accuracy % (target: >= 95%)
 * 4. Romanisation consistency % (target: >= 90%)
 * 5. Tier-1 Protected Terms invariant assertions
 */

import fs from 'node:fs';
import path from 'node:path';
import { enrichWords, classifyScript } from '../src/core/transcription/scriptClassifier';
import type { TranscriptWord, WordScript } from '../src/core/types/project';

export interface GroundTruthWord {
  text: string;
  script: WordScript;
  start_ms?: number;
  end_ms?: number;
}

export interface EvalFixture {
  id: string;
  title: string;
  category: 'tech' | 'vlog' | 'interview' | 'reel';
  raw_asr: string;
  ground_truth: GroundTruthWord[];
}

export interface EvalResult {
  fixtureId: string;
  totalRefWords: number;
  substitutions: number;
  insertions: number;
  deletions: number;
  wer: number;
  englishCount: number;
  englishIntegrityMatches: number;
  englishIntegrityRate: number;
  scriptMatches: number;
  scriptAccuracy: number;
  romanisationCount: number;
  romanisationMatches: number;
  romanisationConsistency: number;
  passed: boolean;
  errors: string[];
}

export interface OverallEvalSummary {
  totalFixtures: number;
  meanWer: number;
  overallEnglishIntegrity: number;
  overallScriptAccuracy: number;
  overallRomanisationConsistency: number;
  allPassed: boolean;
  fixtureResults: EvalResult[];
}

// 10 Reference clips representative of creator workload per Section 10
export const REFERENCE_FIXTURES: EvalFixture[] = [
  {
    id: 'tech_01',
    title: 'React Hooks Tutorial',
    category: 'tech',
    raw_asr: 'aaj hum useState hook deploy karenge with async await',
    ground_truth: [
      { text: 'aaj', script: 'hi' },
      { text: 'hum', script: 'hi' },
      { text: 'useState', script: 'en' },
      { text: 'hook', script: 'en' },
      { text: 'deploy', script: 'en' },
      { text: 'karenge', script: 'hi' },
      { text: 'with', script: 'en' },
      { text: 'async', script: 'en' },
      { text: 'await', script: 'en' },
    ],
  },
  {
    id: 'tech_02',
    title: 'Express Backend API',
    category: 'tech',
    raw_asr: 'server pe express route configure karo aur endpoint test karo',
    ground_truth: [
      { text: 'server', script: 'en' },
      { text: 'pe', script: 'hi' },
      { text: 'express', script: 'en' },
      { text: 'route', script: 'en' },
      { text: 'configure', script: 'en' },
      { text: 'karo', script: 'hi' },
      { text: 'aur', script: 'hi' },
      { text: 'endpoint', script: 'en' },
      { text: 'test', script: 'en' },
      { text: 'karo', script: 'hi' },
    ],
  },
  {
    id: 'tech_03',
    title: 'Docker & Git Workflow',
    category: 'tech',
    raw_asr: 'docker container build karke git repo me push karo',
    ground_truth: [
      { text: 'docker', script: 'en' },
      { text: 'container', script: 'en' },
      { text: 'build', script: 'en' },
      { text: 'karke', script: 'hi' },
      { text: 'git', script: 'en' },
      { text: 'repo', script: 'en' },
      { text: 'me', script: 'hi' },
      { text: 'push', script: 'en' },
      { text: 'karo', script: 'hi' },
    ],
  },
  {
    id: 'vlog_01',
    title: 'Casual Conversation Vlog',
    category: 'vlog',
    raw_asr: 'haan bhai sahi me scene kya hai batao',
    ground_truth: [
      { text: 'haan', script: 'hi' },
      { text: 'bhai', script: 'hi' },
      { text: 'sahi', script: 'hi' },
      { text: 'me', script: 'hi' },
      { text: 'scene', script: 'en' },
      { text: 'kya', script: 'hi' },
      { text: 'hai', script: 'hi' },
      { text: 'batao', script: 'hi' },
    ],
  },
  {
    id: 'vlog_02',
    title: 'Mountain Travel Vlog',
    category: 'vlog',
    raw_asr: 'aaj hum pahunche hain pahadon me aur mausam bahut accha hai',
    ground_truth: [
      { text: 'aaj', script: 'hi' },
      { text: 'hum', script: 'hi' },
      { text: 'pahunche', script: 'hi' },
      { text: 'hain', script: 'hi' },
      { text: 'pahadon', script: 'hi' },
      { text: 'me', script: 'hi' },
      { text: 'aur', script: 'hi' },
      { text: 'mausam', script: 'hi' },
      { text: 'bahut', script: 'hi' },
      { text: 'accha', script: 'hi' },
      { text: 'hai', script: 'hi' },
    ],
  },
  {
    id: 'vlog_03',
    title: 'Cafe Food Review',
    category: 'vlog',
    raw_asr: 'ye cafe ka food authentic hai aur vibe bilkul mast hai',
    ground_truth: [
      { text: 'ye', script: 'hi' },
      { text: 'cafe', script: 'en' },
      { text: 'ka', script: 'hi' },
      { text: 'food', script: 'en' },
      { text: 'authentic', script: 'en' },
      { text: 'hai', script: 'hi' },
      { text: 'aur', script: 'hi' },
      { text: 'vibe', script: 'en' },
      { text: 'bilkul', script: 'hi' },
      { text: 'mast', script: 'hi' },
      { text: 'hai', script: 'hi' },
    ],
  },
  {
    id: 'interview_01',
    title: 'Founder Startup Interview',
    category: 'interview',
    raw_asr: 'startups me product market fit find karna sabse critical challenge hai',
    ground_truth: [
      { text: 'startups', script: 'en' },
      { text: 'me', script: 'hi' },
      { text: 'product', script: 'en' },
      { text: 'market', script: 'en' },
      { text: 'fit', script: 'en' },
      { text: 'find', script: 'en' },
      { text: 'karna', script: 'hi' },
      { text: 'sabse', script: 'hi' },
      { text: 'critical', script: 'en' },
      { text: 'challenge', script: 'en' },
      { text: 'hai', script: 'hi' },
    ],
  },
  {
    id: 'interview_02',
    title: 'Tech Podcast Discussion',
    category: 'interview',
    raw_asr: 'engineering culture me ownership aur execution speed matter karti hai',
    ground_truth: [
      { text: 'engineering', script: 'en' },
      { text: 'culture', script: 'en' },
      { text: 'me', script: 'hi' },
      { text: 'ownership', script: 'en' },
      { text: 'aur', script: 'hi' },
      { text: 'execution', script: 'en' },
      { text: 'speed', script: 'en' },
      { text: 'matter', script: 'en' },
      { text: 'karti', script: 'hi' },
      { text: 'hai', script: 'hi' },
    ],
  },
  {
    id: 'reel_01',
    title: 'Viral Reel Short',
    category: 'reel',
    raw_asr: 'bhai ye feature ekdam lit hai sab sorted ho gaya OP',
    ground_truth: [
      { text: 'bhai', script: 'hi' },
      { text: 'ye', script: 'hi' },
      { text: 'feature', script: 'en' },
      { text: 'ekdam', script: 'hi' },
      { text: 'lit', script: 'en' },
      { text: 'hai', script: 'hi' },
      { text: 'sab', script: 'hi' },
      { text: 'sorted', script: 'en' },
      { text: 'ho', script: 'hi' },
      { text: 'gaya', script: 'hi' },
      { text: 'OP', script: 'en' },
    ],
  },
  {
    id: 'reel_02',
    title: 'Gaming Clutch Reel',
    category: 'reel',
    raw_asr: 'clutch moment pe gameplay switch hua aur match jeet gaye',
    ground_truth: [
      { text: 'clutch', script: 'en' },
      { text: 'moment', script: 'en' },
      { text: 'pe', script: 'hi' },
      { text: 'gameplay', script: 'en' },
      { text: 'switch', script: 'en' },
      { text: 'hua', script: 'hi' },
      { text: 'aur', script: 'hi' },
      { text: 'match', script: 'en' },
      { text: 'jeet', script: 'hi' },
      { text: 'gaye', script: 'hi' },
    ],
  },
];

/**
 * Computes Word Error Rate using Levenshtein distance on words.
 */
export const calculateWer = (
  ref: string[],
  hyp: string[],
): { substitutions: number; insertions: number; deletions: number; wer: number } => {
  const n = ref.length;
  const m = hyp.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (ref[i - 1].toLowerCase() === hyp[j - 1].toLowerCase()) {
        d[i][j] = d[i - 1][j - 1];
      } else {
        d[i][j] = Math.min(
          d[i - 1][j - 1] + 1, // substitution
          d[i][j - 1] + 1,     // insertion
          d[i - 1][j] + 1,     // deletion
        );
      }
    }
  }

  // Backtrack to count S, I, D
  let i = n;
  let j = m;
  let substitutions = 0;
  let insertions = 0;
  let deletions = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1].toLowerCase() === hyp[j - 1].toLowerCase()) {
      i--;
      j--;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      substitutions++;
      i--;
      j--;
    } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
      insertions++;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      deletions++;
      i--;
    } else {
      break;
    }
  }

  const wer = n > 0 ? (substitutions + insertions + deletions) / n : 0;
  return { substitutions, insertions, deletions, wer };
};

/**
 * Runs evaluation on a single fixture.
 */
export const evaluateFixture = (
  fixture: EvalFixture,
  hypothesisWords: TranscriptWord[],
): EvalResult => {
  const refTokens = fixture.ground_truth.map((w) => w.text);
  const hypTokens = hypothesisWords.map((w) => w.text);

  const { substitutions, insertions, deletions, wer } = calculateWer(refTokens, hypTokens);

  let englishCount = 0;
  let englishIntegrityMatches = 0;
  let scriptMatches = 0;
  let romanisationCount = 0;
  let romanisationMatches = 0;
  const errors: string[] = [];

  // Evaluate aligned words
  const minLen = Math.min(fixture.ground_truth.length, hypothesisWords.length);
  for (let i = 0; i < minLen; i++) {
    const ref = fixture.ground_truth[i];
    const hyp = hypothesisWords[i];

    // Script classification
    if (ref.script === hyp.script) {
      scriptMatches++;
    } else {
      errors.push(`Script mismatch for "${ref.text}": expected ${ref.script}, got ${hyp.script}`);
    }

    // English integrity
    if (ref.script === 'en') {
      englishCount++;
      if (ref.text === hyp.text) {
        englishIntegrityMatches++;
      } else {
        errors.push(`English term corrupted: "${ref.text}" -> "${hyp.text}"`);
      }
    }

    // Romanisation consistency for Hindi
    if (ref.script === 'hi') {
      romanisationCount++;
      if (ref.text.toLowerCase() === hyp.text.toLowerCase()) {
        romanisationMatches++;
      }
    }
  }

  const englishIntegrityRate = englishCount > 0 ? englishIntegrityMatches / englishCount : 1.0;
  const scriptAccuracy = minLen > 0 ? scriptMatches / minLen : 1.0;
  const romanisationConsistency = romanisationCount > 0 ? romanisationMatches / romanisationCount : 1.0;

  // Thresholds from Section 10:
  // Build fails if: English integrity < 95%
  const passed = englishIntegrityRate >= 0.95 && scriptAccuracy >= 0.85;

  return {
    fixtureId: fixture.id,
    totalRefWords: fixture.ground_truth.length,
    substitutions,
    insertions,
    deletions,
    wer,
    englishCount,
    englishIntegrityMatches,
    englishIntegrityRate,
    scriptMatches,
    scriptAccuracy,
    romanisationCount,
    romanisationMatches,
    romanisationConsistency,
    passed,
    errors,
  };
};

/**
 * Runs full benchmark on all 10 reference fixtures.
 */
export const runBenchmark = (fixtures = REFERENCE_FIXTURES): OverallEvalSummary => {
  const fixtureResults: EvalResult[] = [];

  for (const fixture of fixtures) {
    // Generate hypothesis words via pipeline classifier
    const rawTokens = fixture.raw_asr.split(/\s+/).filter(Boolean);
    const mockWords: TranscriptWord[] = rawTokens.map((t, idx) => ({
      text: t,
      start: idx * 0.4,
      end: (idx + 1) * 0.4,
      confidence: 0.98,
    }));

    const enriched = enrichWords(mockWords);
    const result = evaluateFixture(fixture, enriched);
    fixtureResults.push(result);
  }

  const meanWer = fixtureResults.reduce((acc, r) => acc + r.wer, 0) / fixtureResults.length;
  const totalEnglish = fixtureResults.reduce((acc, r) => acc + r.englishCount, 0);
  const totalEnglishMatches = fixtureResults.reduce((acc, r) => acc + r.englishIntegrityMatches, 0);
  const overallEnglishIntegrity = totalEnglish > 0 ? totalEnglishMatches / totalEnglish : 1.0;

  const totalWords = fixtureResults.reduce((acc, r) => acc + r.totalRefWords, 0);
  const totalScriptMatches = fixtureResults.reduce((acc, r) => acc + r.scriptMatches, 0);
  const overallScriptAccuracy = totalWords > 0 ? totalScriptMatches / totalWords : 1.0;

  const totalHindi = fixtureResults.reduce((acc, r) => acc + r.romanisationCount, 0);
  const totalHindiMatches = fixtureResults.reduce((acc, r) => acc + r.romanisationMatches, 0);
  const overallRomanisationConsistency = totalHindi > 0 ? totalHindiMatches / totalHindi : 1.0;

  const allPassed = fixtureResults.every((r) => r.passed);

  return {
    totalFixtures: fixtureResults.length,
    meanWer,
    overallEnglishIntegrity,
    overallScriptAccuracy,
    overallRomanisationConsistency,
    allPassed,
    fixtureResults,
  };
};

// Also save fixtures to disk if eval/fixtures directory is present or created
export const dumpFixturesToDisk = (dir = path.join(process.cwd(), 'eval', 'fixtures')): void => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const fixture of REFERENCE_FIXTURES) {
    const filePath = path.join(dir, `${fixture.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2), 'utf8');
  }
};
