import type { AIProvider, CaptionProcessingRequest, CaptionProcessingResponse, ProviderStatus } from './types';
import { postProcessText } from '../../../src/core/transcription/languages';
import { defaultSettingsStore } from '../configStore';

const DEFAULT_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export class GroqProvider implements AIProvider {
  readonly id = 'groq' as const;
  readonly name = 'Groq Cloud';

  private get apiKey(): string | undefined {
    return defaultSettingsStore.getGroqKey();
  }

  get model(): string {
    return (
      process.env.PRIMARY_AI_MODEL?.trim() ||
      process.env.AI_MODEL?.trim() ||
      process.env.GROQ_HINGLISH_MODEL?.trim() ||
      'openai/gpt-oss-120b'
    );
  }

  status(): ProviderStatus {
    const key = this.apiKey;
    const isConfigured = Boolean(key && key.startsWith('gsk_'));
    return {
      id: this.id,
      name: this.name,
      role: 'primary',
      configured: isConfigured,
      model: this.model,
      endpoint: DEFAULT_ENDPOINT,
      reason: isConfigured
        ? null
        : 'Missing or invalid GROQ_API_KEY. Must start with "gsk_".',
    };
  }

  async processCaption(req: CaptionProcessingRequest): Promise<CaptionProcessingResponse> {
    const key = this.apiKey;
    if (!key) {
      throw new Error('Groq is not configured with a valid GROQ_API_KEY.');
    }

    const startTime = Date.now();
    const vocabText = req.relevantVocabRules.length > 0
      ? '\nPROJECT APPROVED VOCABULARY FOR THIS CHUNK (FOLLOW STRICTLY):\n' +
        req.relevantVocabRules
          .map(
            (v) =>
              `- approved: "${v.approved_form}" | avoid/rejected: [${(v.rejected_forms || []).join(', ')}] | context: ${v.context}`,
          )
          .join('\n')
      : '';

    const systemContent =
      'You are an expert transcript editor and normalizer for Roman Hindi / Hinglish captions.\n' +
      'MANDATORY RULES:\n' +
      '1. This is Roman Hindi / Hinglish. All output tokens MUST be in the Latin / Roman alphabet. NEVER output Devanagari script.\n' +
      '2. FOLLOW THE PROJECT APPROVED VOCABULARY STRICTLY. Use approved forms (e.g. "bahut", "zyada", "zaroor", "accha", "chahiye", "cheez", "isliye", "ekdum", "hamara", "shuru", "koshish", "zindagi"). NEVER output rejected forms (do NOT write "bohot", "jyada", "jarur", "chaiye", "chiz", "esliye", "humara", "suru", "jindagi").\n' +
      '3. CONTEXT MATTERS. Do NOT blindly replace homophones:\n' +
      '   - "main" = first-person pronoun ("I", e.g. "main kar raha hoon")\n' +
      '   - "mein" = locative preposition ("in/inside", e.g. "video mein", "ghar mein")\n' +
      '   - "hai" = singular copula (1 person/thing/idea)\n' +
      '   - "hain" = plural or honorific respect (Aap, Sir, Teacher, log)\n' +
      '   - "aur" = Hindi conjunction ("and", e.g. "video aur audio")\n' +
      '4. PRESERVE ENGLISH WORDS: Genuinely spoken English creator, business, and technical terms MUST ALWAYS remain in standard English spelling (e.g. "basically", "strategy", "timeline", "camera", "subscribe", "algorithm", "marketing", "system", "office", "content", "podcast"). Never transliterate English into phonetics (do NOT write "sistam", "kemra", "taimlain").\n' +
      '5. DO NOT TRANSLATE Hindi words into English. Preserve the speaker\'s exact spoken words, phrasing, and natural conversational tone.\n' +
      '6. DO NOT "improve" wording or rewrite into stiff English. The output must sound like the speaker.\n' +
      '7. PRESERVE NAMES, BRANDS, AND PROPER NOUNS exactly as given.\n' +
      '8. ONE TOKEN CONTRACT: Return exactly one output token for every input token in the exact same order (length must be ' +
      req.tokens.length +
      '). Keep punctuation attached to its token. No spaces inside any token.\n' +
      '9. WHEN UNCERTAIN: Do not guess. Preserve the original token or use a high-probability Roman spelling.\n' +
      '10. Output MUST be valid JSON: {"caption": "full caption text", "tokens": ["word1", "word2"], "needs_review": false}\n' +
      vocabText;

    const candidateModels = [
      this.model,
      'openai/gpt-oss-120b',
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
    ];
    const modelsToTry = [...new Set(candidateModels)];
    let lastError: Error | null = null;

    for (const modelToUse of modelsToTry) {
      if (req.signal?.aborted) throw new Error('Cancelled');
      try {
        const timeoutSignal = AbortSignal.timeout(10000);
        const effectiveSignal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;

        const response = await fetch(DEFAULT_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          signal: effectiveSignal,
          body: JSON.stringify({
            model: modelToUse,
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemContent },
              { role: 'user', content: JSON.stringify({ tokens: req.tokens, preferredSpellings: req.properNouns }) },
            ],
          }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          lastError = new Error(`Groq API (${modelToUse}) error ${response.status}: ${errText.slice(0, 300)}`);
          continue;
        }

        const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = body.choices?.[0]?.message?.content;
        if (!content) continue;

        const parsed = JSON.parse(content) as { caption?: string; tokens?: string[]; needs_review?: boolean };
        if (!Array.isArray(parsed.tokens) || parsed.tokens.length !== req.tokens.length) {
          lastError = new Error(`Groq token length mismatch: expected ${req.tokens.length}, got ${parsed.tokens?.length}`);
          continue;
        }

        const cleanedTokens = parsed.tokens.map((t) => postProcessText(t.trim(), 'hinglish'));
        const duration = Date.now() - startTime;

        const changes = cleanedTokens
          .map((tok, idx) => ({
            original: req.tokens[idx],
            corrected: tok,
            confidence: 0.95,
            reason: `Groq (${modelToUse}) Hinglish normalizer`,
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
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw lastError || new Error('Groq failed across all candidate models.');
  }
}
