import { describe, expect, it } from 'vitest';
import {
  buildGroqPrompt,
  GROQ_PROMPT_MAX_CHARACTERS,
  inspectWordTimeline,
  preferRecoveryTimeline,
  resolveGroqModel,
} from '../server/services/providers/groq';
import { getHinglishPrompt } from '../src/core/transcription/languages';

describe('Groq transcription prompt', () => {
  it('never exceeds the provider character limit', () => {
    const prompt = buildGroqPrompt('Hinglish language sample.', 'z'.repeat(2_000));
    expect(prompt).toHaveLength(GROQ_PROMPT_MAX_CHARACTERS);
    expect(prompt.startsWith('Hinglish language sample.')).toBe(true);
  });

  it('also clips a terminology-only prompt', () => {
    expect(buildGroqPrompt(null, 'a'.repeat(1_000))).toHaveLength(896);
  });

  it('incorporates custom vocabulary terms into the prompt', () => {
    const prompt = buildGroqPrompt('Base prompt.', null, ['Danube', 'Rohit', 'Hinglish']);
    expect(prompt).toContain('Danube, Rohit, Hinglish');
    expect(prompt.startsWith('Base prompt.')).toBe(true);
  });

  it('supports all Hinglish domain presets within Groq character limits', () => {
    const domains = ['general', 'tech', 'business', 'vlog', 'education'] as const;
    for (const domain of domains) {
      const basePrompt = getHinglishPrompt(domain);
      const built = buildGroqPrompt(basePrompt, 'Additional PDF vocabulary context.', ['BrandX', 'AppY']);
      expect(built.length).toBeLessThanOrEqual(GROQ_PROMPT_MAX_CHARACTERS);
      expect(built.length).toBeGreaterThan(150);
    }
  });
});

describe('Groq transcription model selection', () => {
  it('defaults to turbo for all languages to avoid initial 10s audio drop', () => {
    // whisper-large-v3-turbo is used for ALL languages by default because
    // whisper-large-v3 was documented to drop the first 10s of conversational speech.
    expect(resolveGroqModel('hinglish', undefined)).toBe('whisper-large-v3-turbo');
    expect(resolveGroqModel('hi', undefined)).toBe('whisper-large-v3-turbo');
    expect(resolveGroqModel('en', undefined)).toBe('whisper-large-v3-turbo');
  });

  it('respects an explicit model override', () => {
    expect(resolveGroqModel('hinglish', 'whisper-large-v3-turbo')).toBe(
      'whisper-large-v3-turbo',
    );
    expect(resolveGroqModel('hinglish', 'whisper-large-v3')).toBe('whisper-large-v3');
  });
});

describe('Groq word-timeline recovery', () => {
  it('detects a word timestamp that would freeze captions', () => {
    const health = inspectWordTimeline([
      { start: 0, end: 0.4 },
      { start: 0.4, end: 18.9 },
      { start: 19, end: 19.4 },
    ]);
    expect(health.broken).toBe(true);
    expect(health.longestWordDuration).toBeCloseTo(18.5);
  });

  it('prefers a complete recovery timeline over a frozen one', () => {
    expect(
      preferRecoveryTimeline(
        [{ start: 0, end: 18 }],
        [
          { start: 0, end: 0.4 },
          { start: 0.4, end: 0.8 },
        ],
      ),
    ).toBe(true);
  });
});
