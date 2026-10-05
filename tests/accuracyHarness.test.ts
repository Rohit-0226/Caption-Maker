import { describe, expect, it } from 'vitest';
import { runBenchmark, dumpFixturesToDisk, REFERENCE_FIXTURES } from '../eval/accuracyHarness';

describe('Hinglish Caption Studio — Accuracy Evaluation Harness (Section 10)', () => {
  it('contains 10 reference clips covering tech, vlog, interview, and reels', () => {
    expect(REFERENCE_FIXTURES.length).toBe(10);
    const categories = new Set(REFERENCE_FIXTURES.map((f) => f.category));
    expect(categories.has('tech')).toBe(true);
    expect(categories.has('vlog')).toBe(true);
    expect(categories.has('interview')).toBe(true);
    expect(categories.has('reel')).toBe(true);
  });

  it('runs benchmark across all reference fixtures and passes Section 10 thresholds', () => {
    const summary = runBenchmark();
    expect(summary.totalFixtures).toBe(10);
    // English term integrity must be >= 95% (target >= 98%)
    expect(summary.overallEnglishIntegrity).toBeGreaterThanOrEqual(0.98);
    // Script accuracy target >= 95%
    expect(summary.overallScriptAccuracy).toBeGreaterThanOrEqual(0.95);
    // Romanisation consistency target >= 90%
    expect(summary.overallRomanisationConsistency).toBeGreaterThanOrEqual(0.90);
    // All fixtures must pass thresholds
    expect(summary.allPassed).toBe(true);
  });

  it('dumps JSON fixtures to disk without error', () => {
    expect(() => dumpFixturesToDisk()).not.toThrow();
  });
});
