import { describe, expect, it, vi } from 'vitest';
import { AIOrchestrator } from '../server/services/ai/orchestrator';
import type { AIProvider, CaptionProcessingResponse } from '../server/services/ai/types';
import { VocabularyStore } from '../src/core/vocabulary/vocabularyStore';
import { VocabularyValidator } from '../src/core/vocabulary/validator';
import { buildGroqPrompt, GROQ_PROMPT_MAX_CHARACTERS } from '../server/services/providers/groq';
import type { TranscriptWord } from '../src/core/types/project';

const createWord = (text: string, start = 0, end = 0.5): TranscriptWord => ({
  text,
  start,
  end,
  confidence: null,
});

const sampleVocabDb = {
  version: 1,
  description: 'Test Hinglish DB',
  entries: [
    {
      word: 'bahut',
      approved_form: 'bahut',
      alternatives: [],
      rejected_forms: ['bohot', 'bohut', 'bht'],
      context: 'general',
      examples: ['bahut accha'],
      confidence: 1.0,
    },
    {
      word: 'accha',
      approved_form: 'accha',
      alternatives: ['achha'],
      rejected_forms: ['acha'],
      context: 'general',
      examples: ['accha hai'],
      confidence: 1.0,
    },
    {
      word: 'video',
      approved_form: 'video',
      alternatives: [],
      rejected_forms: ['vidio', 'vedio'],
      context: 'media',
      examples: ['video dekho'],
      confidence: 1.0,
    },
    {
      word: 'main',
      approved_form: 'main',
      alternatives: [],
      rejected_forms: [],
      context: 'pronoun',
      examples: ['main karta hoon'],
      confidence: 0.9,
    },
  ],
};

describe('Dual-AI Architecture (Groq + OpenRouter Orchestrator)', () => {
  it('returns provider statuses correctly', () => {
    const mockGroq: AIProvider = {
      id: 'groq',
      name: 'Groq Cloud',
      status: () => ({
        id: 'groq',
        name: 'Groq Cloud',
        role: 'primary',
        configured: true,
        model: 'llama-3.3-70b-versatile',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn(),
    };

    const mockOpenRouter: AIProvider = {
      id: 'openrouter',
      name: 'OpenRouter AI',
      status: () => ({
        id: 'openrouter',
        name: 'OpenRouter AI',
        role: 'secondary',
        configured: true,
        model: 'openrouter/free',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn(),
    };

    const orchestrator = new AIOrchestrator(
      new VocabularyStore(sampleVocabDb),
      new VocabularyValidator(new VocabularyStore(sampleVocabDb)),
      mockGroq,
      mockOpenRouter,
    );

    const statuses = orchestrator.getProviderStatuses();
    expect(statuses).toHaveLength(2);
    expect(statuses[0].id).toBe('groq');
    expect(statuses[0].role).toBe('primary');
    expect(statuses[1].id).toBe('openrouter');
    expect(statuses[1].role).toBe('secondary');
  });

  it('preserves free tier quota by NOT calling OpenRouter when Groq confidence is high', async () => {
    const mockGroq: AIProvider = {
      id: 'groq',
      name: 'Groq Cloud',
      status: () => ({
        id: 'groq',
        name: 'Groq Cloud',
        role: 'primary',
        configured: true,
        model: 'llama-3.3-70b-versatile',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        tokens: ['bahut', 'accha', 'video'],
        caption: 'bahut accha video',
        changes: [],
        needs_review: false,
        responseTimeMs: 250,
      } satisfies CaptionProcessingResponse),
    };

    const mockOpenRouterProcess = vi.fn();
    const mockOpenRouter: AIProvider = {
      id: 'openrouter',
      name: 'OpenRouter AI',
      status: () => ({
        id: 'openrouter',
        name: 'OpenRouter AI',
        role: 'secondary',
        configured: true,
        model: 'openrouter/free',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        reason: null,
      }),
      processCaption: mockOpenRouterProcess,
    };

    const store = new VocabularyStore(sampleVocabDb);
    const orchestrator = new AIOrchestrator(
      store,
      new VocabularyValidator(store),
      mockGroq,
      mockOpenRouter,
    );

    const words = [createWord('bahut'), createWord('accha'), createWord('video')];
    const result = await orchestrator.orchestrateCaption({
      sourceWords: words,
      fallbackWords: words,
      enableDebugTrace: true,
    });

    expect(result.caption).toBe('bahut accha video');
    expect(result.providerUsed).toBe('groq');
    expect(result.fallbackUsed).toBe(false);
    expect(result.secondOpinionUsed).toBe(false);
    expect(result.confidence).toBeGreaterThanOrEqual(0.88);
    // Secondary model was NOT called, saving token budget!
    expect(mockOpenRouterProcess).not.toHaveBeenCalled();
    expect(orchestrator.getRecentLogs()).toHaveLength(1);
    expect(orchestrator.getRecentLogs()[0].secondOpinionUsed).toBe(false);
  });

  it('falls back automatically to OpenRouter when primary Groq fails with 429 rate limit or timeout', async () => {
    const mockGroq: AIProvider = {
      id: 'groq',
      name: 'Groq Cloud',
      status: () => ({
        id: 'groq',
        name: 'Groq Cloud',
        role: 'primary',
        configured: true,
        model: 'llama-3.3-70b-versatile',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockRejectedValue(new Error('Groq 429: Rate limit reached')),
    };

    const mockOpenRouter: AIProvider = {
      id: 'openrouter',
      name: 'OpenRouter AI',
      status: () => ({
        id: 'openrouter',
        name: 'OpenRouter AI',
        role: 'secondary',
        configured: true,
        model: 'openrouter/free',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        model: 'openrouter/free',
        tokens: ['bahut', 'accha', 'video'],
        caption: 'bahut accha video',
        changes: [],
        needs_review: false,
        responseTimeMs: 500,
      } satisfies CaptionProcessingResponse),
    };

    const store = new VocabularyStore(sampleVocabDb);
    const orchestrator = new AIOrchestrator(
      store,
      new VocabularyValidator(store),
      mockGroq,
      mockOpenRouter,
    );

    const words = [createWord('bahut'), createWord('accha'), createWord('video')];
    const result = await orchestrator.orchestrateCaption({
      sourceWords: words,
      fallbackWords: words,
      enableDebugTrace: true,
    });

    expect(result.caption).toBe('bahut accha video');
    expect(result.providerUsed).toBe('openrouter');
    expect(result.fallbackUsed).toBe(true);
    expect(result.secondOpinionUsed).toBe(false);
    expect(mockOpenRouter.processCaption).toHaveBeenCalledTimes(1);

    const logs = orchestrator.getRecentLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].fallbackUsed).toBe(true);
    expect(logs[0].provider).toBe('openrouter');
  });

  it('triggers second-opinion arbitration on low confidence or uncertain words', async () => {
    // Primary Groq returns un-normalized rejected word 'bohot' which drops validator confidence
    const mockGroq: AIProvider = {
      id: 'groq',
      name: 'Groq Cloud',
      status: () => ({
        id: 'groq',
        name: 'Groq Cloud',
        role: 'primary',
        configured: true,
        model: 'llama-3.3-70b-versatile',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        tokens: ['bohot', 'unknowntoken123', 'video'],
        caption: 'bohot unknowntoken123 video',
        changes: [],
        needs_review: true,
        responseTimeMs: 300,
      } satisfies CaptionProcessingResponse),
    };

    const mockOpenRouter: AIProvider = {
      id: 'openrouter',
      name: 'OpenRouter AI',
      status: () => ({
        id: 'openrouter',
        name: 'OpenRouter AI',
        role: 'secondary',
        configured: true,
        model: 'openrouter/free',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        model: 'openrouter/free',
        tokens: ['bahut', 'unknowntoken123', 'video'],
        caption: 'bahut unknowntoken123 video',
        changes: [],
        needs_review: false,
        responseTimeMs: 650,
      } satisfies CaptionProcessingResponse),
    };

    const store = new VocabularyStore(sampleVocabDb);
    const orchestrator = new AIOrchestrator(
      store,
      new VocabularyValidator(store),
      mockGroq,
      mockOpenRouter,
    );

    const words = [createWord('bohot'), createWord('unknowntoken123'), createWord('video')];
    const result = await orchestrator.orchestrateCaption({
      sourceWords: words,
      fallbackWords: words,
      enableDebugTrace: true,
    });

    expect(result.secondOpinionUsed).toBe(true);
    expect(result.providerUsed).toBe('hybrid');
    expect(mockOpenRouter.processCaption).toHaveBeenCalledTimes(1);
    // Project vocabulary rule overrides 'bohot' -> 'bahut'
    expect(result.tokens[0]).toBe('bahut');
  });

  it('boosts confidence when primary and secondary models agree', async () => {
    const mockGroq: AIProvider = {
      id: 'groq',
      name: 'Groq Cloud',
      status: () => ({
        id: 'groq',
        name: 'Groq Cloud',
        role: 'primary',
        configured: true,
        model: 'llama-3.3-70b-versatile',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        tokens: ['unusualterm', 'video'],
        caption: 'unusualterm video',
        changes: [],
        needs_review: true,
        responseTimeMs: 200,
      } satisfies CaptionProcessingResponse),
    };

    const mockOpenRouter: AIProvider = {
      id: 'openrouter',
      name: 'OpenRouter AI',
      status: () => ({
        id: 'openrouter',
        name: 'OpenRouter AI',
        role: 'secondary',
        configured: true,
        model: 'openrouter/free',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        model: 'openrouter/free',
        tokens: ['unusualterm', 'video'],
        caption: 'unusualterm video',
        changes: [],
        needs_review: false,
        responseTimeMs: 400,
      } satisfies CaptionProcessingResponse),
    };

    const store = new VocabularyStore(sampleVocabDb);
    const orchestrator = new AIOrchestrator(
      store,
      new VocabularyValidator(store),
      mockGroq,
      mockOpenRouter,
    );

    const words = [createWord('unusualterm'), createWord('video')];
    const result = await orchestrator.orchestrateCaption({
      sourceWords: words,
      fallbackWords: words,
      enableDebugTrace: true,
    });

    expect(result.secondOpinionUsed).toBe(true);
    expect(result.modelAgreementCount).toBe(2);
    expect(result.modelDisagreementCount).toBe(0);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('strictly prioritizes project vocabulary rules above both AI model outputs', async () => {
    // Both Groq and OpenRouter hallucinate/propose the rejected form "bohot"
    const mockGroq: AIProvider = {
      id: 'groq',
      name: 'Groq Cloud',
      status: () => ({
        id: 'groq',
        name: 'Groq Cloud',
        role: 'primary',
        configured: true,
        model: 'llama-3.3-70b-versatile',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        tokens: ['bohot', 'accha'],
        caption: 'bohot accha',
        changes: [],
        needs_review: false,
        responseTimeMs: 200,
      } satisfies CaptionProcessingResponse),
    };

    const mockOpenRouter: AIProvider = {
      id: 'openrouter',
      name: 'OpenRouter AI',
      status: () => ({
        id: 'openrouter',
        name: 'OpenRouter AI',
        role: 'secondary',
        configured: true,
        model: 'openrouter/free',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        model: 'openrouter/free',
        tokens: ['bohot', 'accha'],
        caption: 'bohot accha',
        changes: [],
        needs_review: false,
        responseTimeMs: 350,
      } satisfies CaptionProcessingResponse),
    };

    const store = new VocabularyStore(sampleVocabDb);
    const orchestrator = new AIOrchestrator(
      store,
      new VocabularyValidator(store),
      mockGroq,
      mockOpenRouter,
    );

    const words = [createWord('bohot'), createWord('accha')];
    const result = await orchestrator.orchestrateCaption({
      sourceWords: words,
      fallbackWords: words,
    });

    // Vocabulary rule overrides "bohot" to approved "bahut"
    expect(result.tokens[0]).toBe('bahut');
    expect(result.caption).toBe('bahut accha');
  });

  it('compares providers side-by-side with latency and agreement stats', async () => {
    const mockGroq: AIProvider = {
      id: 'groq',
      name: 'Groq Cloud',
      status: () => ({
        id: 'groq',
        name: 'Groq Cloud',
        role: 'primary',
        configured: true,
        model: 'llama-3.3-70b-versatile',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        tokens: ['bahut', 'accha'],
        caption: 'bahut accha',
        changes: [],
        needs_review: false,
        responseTimeMs: 180,
      } satisfies CaptionProcessingResponse),
    };

    const mockOpenRouter: AIProvider = {
      id: 'openrouter',
      name: 'OpenRouter AI',
      status: () => ({
        id: 'openrouter',
        name: 'OpenRouter AI',
        role: 'secondary',
        configured: true,
        model: 'openrouter/free',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        model: 'openrouter/free',
        tokens: ['bahut', 'achha'],
        caption: 'bahut achha',
        changes: [],
        needs_review: false,
        responseTimeMs: 420,
      } satisfies CaptionProcessingResponse),
    };

    const store = new VocabularyStore(sampleVocabDb);
    const orchestrator = new AIOrchestrator(
      store,
      new VocabularyValidator(store),
      mockGroq,
      mockOpenRouter,
    );

    const comparison = await orchestrator.compareProviders('bohot accha');
    expect(comparison.original).toBe('bohot accha');
    expect(comparison.groq.caption).toBe('bahut accha');
    expect(comparison.groq.responseTimeMs).toBe(180);
    expect(comparison.openrouter.caption).toBe('bahut achha');
    expect(comparison.openrouter.responseTimeMs).toBe(420);
    expect(comparison.finalSelected.caption).toBe('bahut accha');
  });

  it('runs benchmark across multiple test sentences and outputs accuracy metrics', async () => {
    const mockGroq: AIProvider = {
      id: 'groq',
      name: 'Groq Cloud',
      status: () => ({
        id: 'groq',
        name: 'Groq Cloud',
        role: 'primary',
        configured: true,
        model: 'llama-3.3-70b-versatile',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        tokens: ['bahut', 'accha', 'video'],
        caption: 'bahut accha video',
        changes: [],
        needs_review: false,
        responseTimeMs: 200,
      } satisfies CaptionProcessingResponse),
    };

    const mockOpenRouter: AIProvider = {
      id: 'openrouter',
      name: 'OpenRouter AI',
      status: () => ({
        id: 'openrouter',
        name: 'OpenRouter AI',
        role: 'secondary',
        configured: true,
        model: 'openrouter/free',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        reason: null,
      }),
      processCaption: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        model: 'openrouter/free',
        tokens: ['bahut', 'accha', 'video'],
        caption: 'bahut accha video',
        changes: [],
        needs_review: false,
        responseTimeMs: 500,
      } satisfies CaptionProcessingResponse),
    };

    const store = new VocabularyStore(sampleVocabDb);
    const orchestrator = new AIOrchestrator(
      store,
      new VocabularyValidator(store),
      mockGroq,
      mockOpenRouter,
    );

    const testCases = [
      { input: 'bohot acha vidio', expected: 'bahut accha video' },
      { input: 'bahut accha video', expected: 'bahut accha video' },
    ];

    const benchmark = await orchestrator.benchmarkProviders(testCases);
    expect(benchmark.casesCount).toBe(2);
    expect(benchmark.hybridAccuracy).toBe(100);
    expect(benchmark.averageLatencyGroqMs).toBe(200);
    expect(benchmark.averageLatencyOpenRouterMs).toBe(500);
    expect(benchmark.recommendation).toBeDefined();
  });

  it('buildGroqPrompt accepts vocabulary hints and strictly respects 896 character limit', () => {
    const hints = ['bahut', 'accha', 'video', 'karenge', 'zyada', 'chahiye'];
    const prompt = buildGroqPrompt('Base prompt for Hinglish.', null, ['BrandOne'], hints);

    expect(prompt.startsWith('Base prompt for Hinglish.')).toBe(true);
    expect(prompt).toContain('BrandOne');
    expect(prompt).toContain('bahut');
    expect(prompt.length).toBeLessThanOrEqual(GROQ_PROMPT_MAX_CHARACTERS);

    // Extreme case: 3,000 characters base + hints
    const hugePrompt = buildGroqPrompt('x'.repeat(2000), 'y'.repeat(2000), hints);
    expect(hugePrompt.length).toBeLessThanOrEqual(GROQ_PROMPT_MAX_CHARACTERS);
  });
});
