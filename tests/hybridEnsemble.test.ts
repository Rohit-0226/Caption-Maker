import { describe, expect, it } from 'vitest';
import { HybridEnsembleProvider } from '../server/services/providers/hybridEnsemble';
import { reconcileTranscriptCandidates } from '../server/services/ai/consensusArbiter';
import { defaultProvider, getProvider, listProviders } from '../server/services/providers/registry';

describe('HybridEnsembleProvider', () => {
  it('has hybrid-ensemble id and descriptive label', () => {
    const provider = new HybridEnsembleProvider();
    expect(provider.id).toBe('hybrid-ensemble');
    expect(provider.label).toContain('Ultra-Accuracy Hybrid');
    expect(provider.supportedLanguages).toContain('hinglish');
    expect(provider.supportedLanguages).toContain('en');
    expect(provider.supportedLanguages).toContain('hi');
  });

  it('reports configured true if either Nemotron or Groq is available', () => {
    const provider = new HybridEnsembleProvider();
    const status = provider.status();
    // On this machine, Nemotron (E:\Handy\handy.exe) and Groq API key are available
    expect(status.configured).toBe(true);
    expect(status.reason).toBeNull();
  });

  it('is registered as the first default provider in the registry', () => {
    const allProviders = listProviders();
    expect(allProviders[0].id).toBe('hybrid-ensemble');

    const def = defaultProvider();
    expect(def.id).toBe('hybrid-ensemble');

    const found = getProvider('hybrid-ensemble');
    expect(found).toBeDefined();
    expect(found?.id).toBe('hybrid-ensemble');
  });
});

describe('Consensus Arbiter', () => {
  it('handles empty inputs gracefully', async () => {
    const result = await reconcileTranscriptCandidates({
      nemotronText: '',
      groqText: '',
      language: 'hinglish',
    });
    expect(result.caption).toBe('');
    expect(result.words).toEqual([]);
  });

  it('falls back to single candidate when other is empty and romanizes Devanagari', async () => {
    const result = await reconcileTranscriptCandidates({
      nemotronText: 'नमस्ते दुनिया',
      groqText: '',
      language: 'hinglish',
    });
    expect(result.caption).toBeTruthy();
    expect(result.words.length).toBeGreaterThan(0);
    // Should have Roman Hinglish words instead of failing
    expect(result.words.length).toBe(2);
  });

  it('reconciles candidates with proper words array', async () => {
    const result = await reconcileTranscriptCandidates({
      nemotronText: 'we are launching new product',
      groqText: 'We are launching a new product today.',
      language: 'en',
    });
    expect(result.caption).toBeTruthy();
    expect(result.words.length).toBeGreaterThanOrEqual(5);
    expect(result.caption).toContain('launching');
  });

  it('preserves exact acoustic timestamps in in-place token reconciliation', async () => {
    const { reconcileInPlaceTokens } = await import('../server/services/ai/consensusArbiter');
    const inputWords = [
      { text: 'अगर', start: 1.25, end: 1.55, confidence: null },
      { text: 'aap', start: 1.58, end: 1.80, confidence: null },
      { text: 'video', start: 1.85, end: 2.30, confidence: null },
      { text: 'बनाते', start: 2.35, end: 2.70, confidence: null },
      { text: 'ho', start: 2.72, end: 2.95, confidence: null },
    ];

    const result = await reconcileInPlaceTokens({
      words: inputWords,
      language: 'auto',
    });

    expect(result.length).toBe(5);
    // Exact acoustic timestamps must be 100% preserved
    expect(result[0].start).toBe(1.25);
    expect(result[0].end).toBe(1.55);
    expect(result[1].start).toBe(1.58);
    expect(result[2].text).toBe('video');
    expect(result[2].start).toBe(1.85);
    expect(result[2].end).toBe(2.30);
    expect(result[4].start).toBe(2.72);
    expect(result[4].end).toBe(2.95);

    // Devanagari Hindi tokens must be romanized in auto mode
    expect(/[\u0900-\u097F]/.test(result[0].text)).toBe(false);
    expect(/[\u0900-\u097F]/.test(result[3].text)).toBe(false);
  });
});
