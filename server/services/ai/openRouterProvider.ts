import type { AIProvider, CaptionProcessingRequest, CaptionProcessingResponse, ProviderStatus } from './types';
import { postProcessText } from '../../../src/core/transcription/languages';
import { defaultSettingsStore } from '../configStore';

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter' as const;
  readonly name = 'OpenRouter AI';

  private get apiKey(): string | undefined {
    return defaultSettingsStore.getOpenRouterKey();
  }

  get baseUrl(): string {
    return process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1';
  }

  get model(): string {
    return (
      process.env.SECONDARY_AI_MODEL?.trim() ||
      process.env.OPENROUTER_MODEL?.trim() ||
      'openrouter/free'
    );
  }

  status(): ProviderStatus {
    const key = this.apiKey;
    const isConfigured = Boolean(key && key.startsWith('sk-or-'));
    return {
      id: this.id,
      name: this.name,
      role: 'secondary',
      configured: isConfigured,
      model: this.model,
      endpoint: `${this.baseUrl}/chat/completions`,
      reason: isConfigured
        ? null
        : 'Missing or invalid OPENROUTER_API_KEY. Must start with "sk-or-".',
    };
  }

  async processCaption(req: CaptionProcessingRequest): Promise<CaptionProcessingResponse> {
    const key = this.apiKey;
    if (!key) {
      throw new Error('OpenRouter is not configured with a valid OPENROUTER_API_KEY.');
    }

    const startTime = Date.now();
    const endpoint = `${this.baseUrl}/chat/completions`;

    const vocabText = req.relevantVocabRules.length > 0
      ? '\nPROJECT APPROVED VOCABULARY (MUST COMPLY):\n' +
        req.relevantVocabRules
          .map(
            (v) =>
              `- approved: "${v.approved_form}" | avoid/rejected: [${(v.rejected_forms || []).join(', ')}] | context: ${v.context}`,
          )
          .join('\n')
      : '';

    const systemContent =
      'You are a precision Roman Hindi / Hinglish transcript normalizer.\n' +
      'CRITICAL INSTRUCTIONS:\n' +
      '1. Roman Hinglish only. NO Devanagari.\n' +
      '2. Adhere strictly to project approved vocabulary (e.g. "bahut", "zyada", "zaroor", "accha", "chahiye", "cheez", "isliye", "ekdum", "hamara", "shuru", "koshish", "zindagi").\n' +
      '3. Disambiguate context: "main" (I) vs "mein" (in/inside), "hai" (singular) vs "hain" (plural/respect), "aur" (and).\n' +
      '4. Keep English words in English spelling (e.g. "camera", "system", "video", "marketing", "timeline"). Never transliterate English words into Hindi phonetics.\n' +
      '5. Output MUST be valid JSON with this exact schema:\n' +
      '   {"caption": "full caption text", "tokens": ["word1", "word2"], "needs_review": false}\n' +
      '6. Exactly ' +
      req.tokens.length +
      ' tokens in the "tokens" array, preserving original punctuation and order.\n' +
      vocabText;

    const userContent = JSON.stringify({
      tokens: req.tokens,
      properNouns: req.properNouns,
    });

    const candidateModels = [
      this.model,
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemini-2.0-flash-exp:free',
      'mistralai/mistral-small-3.1:free',
      'openrouter/free',
    ];

    const modelsToTry = [...new Set(candidateModels)];
    let lastError: Error | null = null;

    for (const modelToUse of modelsToTry) {
      if (req.signal?.aborted) throw new Error('Cancelled');
      try {
        const timeoutSignal = AbortSignal.timeout(10000);
        const effectiveSignal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://captionmaker.studio',
            'X-Title': 'Caption Maker Studio',
          },
          signal: effectiveSignal,
          body: JSON.stringify({
            model: modelToUse,
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemContent },
              { role: 'user', content: userContent },
            ],
          }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          lastError = new Error(`OpenRouter (${modelToUse}) error ${response.status}: ${errText.slice(0, 200)}`);
          continue;
        }

        const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = body.choices?.[0]?.message?.content;
        if (!content) continue;

        const parsed = JSON.parse(content) as { caption?: string; tokens?: string[]; needs_review?: boolean };
        if (!Array.isArray(parsed.tokens) || parsed.tokens.length !== req.tokens.length) {
          lastError = new Error(`OpenRouter token mismatch: expected ${req.tokens.length}, got ${parsed.tokens?.length}`);
          continue;
        }

        const cleanedTokens = parsed.tokens.map((t) => postProcessText(t.trim(), 'hinglish'));
        const duration = Date.now() - startTime;

        const changes = cleanedTokens
          .map((tok, idx) => ({
            original: req.tokens[idx],
            corrected: tok,
            confidence: 0.92,
            reason: `OpenRouter (${modelToUse}) second opinion`,
          }))
          .filter((c) => c.original !== c.corrected);

        return {
          provider: this.id,
          model: modelToUse,
          tokens: cleanedTokens,
          caption: parsed.caption || cleanedTokens.join(' '),
          changes,
          needs_review: Boolean(parsed.needs_review),
          responseTimeMs: duration,
        };
      } catch (e) {
        lastError = e as Error;
      }
    }

    throw lastError || new Error('OpenRouter failed across all candidate models.');
  }
}
