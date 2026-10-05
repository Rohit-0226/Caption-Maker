import { responseSchema } from './schemas';
import { defaultSettingsStore } from '../services/configStore';

export type AIProviderId = 'groq' | 'openai' | 'openrouter' | 'xai' | 'ollama' | 'gemini';

export interface AIClientStatus {
  configured: boolean;
  provider: AIProviderId;
  model: string;
  reason: string | null;
}

export class AIError extends Error {
  constructor(
    message: string,
    readonly code: 'not-configured' | 'network' | 'provider-error' | 'invalid-output' | 'timeout',
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

const ENDPOINTS: Record<AIProviderId, string> = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions',
  ollama: 'http://localhost:11434/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};

const KEY_PREFIX: Partial<Record<AIProviderId, string>> = {
  groq: 'gsk_',
  xai: 'xai-',
  openai: 'sk-',
  openrouter: 'sk-or-',
  gemini: 'AQ.',
};

const DEFAULT_MODEL: Record<AIProviderId, string> = {
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  xai: 'grok-4.6',
  ollama: 'llama3.2',
  gemini: 'gemini-3.5-flash-lite',
};

const REQUEST_TIMEOUT_MS = 45_000;

/** Never let a key reach a log line, an error message or a response body. */
export const redact = (text: string): string =>
  text
    .replace(/\b(gsk_|xai-|sk-ant-|sk-or-|sk-)[A-Za-z0-9_-]{8,}/g, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***');

const provider = (): AIProviderId => {
  const envProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (envProvider && (envProvider === 'groq' || envProvider === 'openai' || envProvider === 'openrouter' || envProvider === 'xai' || envProvider === 'ollama' || envProvider === 'gemini')) {
    return envProvider;
  }
  const settings = defaultSettingsStore.getSettings();
  const configProvider = settings.defaultProvider?.trim().toLowerCase();
  if (configProvider && (configProvider === 'groq' || configProvider === 'openai' || configProvider === 'openrouter' || configProvider === 'xai' || configProvider === 'ollama' || configProvider === 'gemini')) {
    return configProvider;
  }
  return 'groq';
};

const apiKey = (): string | undefined => {
  const explicit = process.env.AI_API_KEY?.trim();
  if (explicit) return explicit;
  const p = provider();
  if (p === 'groq') return process.env.GROQ_API_KEY?.trim() || defaultSettingsStore.getGroqKey();
  if (p === 'openrouter') return process.env.OPENROUTER_API_KEY?.trim() || defaultSettingsStore.getOpenRouterKey();
  if (p === 'openai') return process.env.OPENAI_API_KEY?.trim() || defaultSettingsStore.getOpenAiKey();
  if (p === 'gemini') return process.env.GEMINI_API_KEY?.trim() || defaultSettingsStore.getGeminiKey();
  if (p === 'ollama') return 'ollama';
  return undefined;
};

const model = (): string => process.env.AI_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL[provider()];

/**
 * Groq and xAI are different companies whose names invite exactly this mistake.
 * Sending one's key to the other would hand a live credential to a third party,
 * so a mismatched prefix is refused rather than attempted.
 */
export const aiStatus = (): AIClientStatus => {
  const id = provider();
  const key = apiKey();
  const base = { provider: id, model: model() };

  if (!key) {
    return {
      ...base,
      configured: false,
      reason:
        id === 'groq'
          ? 'No AI key. Set GROQ_API_KEY or AI_API_KEY in your .env file.'
          : 'No AI key. Set AI_API_KEY in your .env file.',
    };
  }

  const isGeminiValid = id === 'gemini' && (key.startsWith('AQ.') || key.startsWith('AIza'));
  const expected = KEY_PREFIX[id];
  const other = (Object.entries(KEY_PREFIX) as [AIProviderId, string][]).find(
    ([, prefix]) => key.startsWith(prefix),
  );

  if (id === 'gemini') {
    if (!isGeminiValid) {
      return {
        ...base,
        configured: false,
        reason: 'Gemini API key should start with "AQ." or "AIza".',
      };
    }
  } else if (expected && !key.startsWith(expected)) {
    const hint =
      other && other[0] !== id
        ? ` That looks like a ${other[0] === 'groq' ? 'Groq' : other[0] === 'xai' ? 'xAI' : other[0]} key — set AI_PROVIDER=${other[0]}.`
        : '';
    return {
      ...base,
      configured: false,
      reason: `AI_API_KEY does not look like a ${id} key; those start with "${expected}".${hint}`,
    };
  }

  return { ...base, configured: true, reason: null };
};

export interface AIRequest {
  system: string;
  user: string;
  signal?: AbortSignal;
}

export interface AIRawResponse {
  reply: string;
  actions: unknown[];
  model: string;
}

interface ChatCompletion {
  model?: string;
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/**
 * One call to the configured chat provider, constrained by a strict JSON
 * schema. Returns parsed-but-unvalidated actions; the caller validates them
 * against the Zod union before anything touches a project.
 */
export const requestActions = async ({
  system,
  user,
  signal,
}: AIRequest): Promise<AIRawResponse> => {
  const status = aiStatus();
  if (!status.configured) {
    throw new AIError(status.reason ?? 'AI is not configured', 'not-configured', false);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort(), { once: true });

  const endpoint = process.env.AI_BASE_URL || ENDPOINTS[status.provider] || ENDPOINTS.groq;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const key = apiKey();
  if (key && key !== 'ollama') {
    headers.Authorization = `Bearer ${key}`;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: status.model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'caption_maker_actions', strict: true, schema: responseSchema },
        },
      }),
      signal: controller.signal,
    });

    // If provider rejected strict json_schema, retry with standard json_object format
    if (response.status === 400) {
      const errBody = await response.clone().text();
      if (errBody.includes('json_schema') || errBody.includes('response_format')) {
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: status.model,
            temperature: 0,
            messages: [
              { role: 'system', content: `${system}\n\nIMPORTANT: Respond in valid JSON matching { "reply": string, "actions": [...] }` },
              { role: 'user', content: user },
            ],
            response_format: { type: 'json_object' },
          }),
          signal: controller.signal,
        });
      }
    }
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new AIError('The assistant took too long to answer. Try again.', 'timeout');
    }
    if (signal?.aborted) throw new AIError('Cancelled', 'provider-error', false);
    throw new AIError(redact(`Could not reach the AI provider: ${(error as Error).message}`), 'network');
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.text();

  if (!response.ok) {
    let detail = redact(body).slice(0, 300);
    try {
      const parsed = JSON.parse(body) as ChatCompletion;
      if (parsed.error?.message) detail = redact(parsed.error.message);
    } catch {
      // keep the raw, redacted body
    }

    if (response.status === 401 || response.status === 403) {
      throw new AIError('The AI provider rejected the key. Check AI_API_KEY.', 'not-configured', false);
    }
    if (response.status === 429) {
      throw new AIError('The AI provider is rate limiting. Wait a moment and try again.', 'provider-error');
    }
    throw new AIError(`AI provider error ${response.status}: ${detail}`, 'provider-error');
  }

  let completion: ChatCompletion;
  try {
    completion = JSON.parse(body) as ChatCompletion;
  } catch {
    throw new AIError('The AI provider returned something that was not JSON.', 'invalid-output');
  }

  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new AIError('The assistant returned an empty answer.', 'invalid-output');
  }

  let parsed: { reply?: unknown; actions?: unknown };
  try {
    parsed = JSON.parse(content) as { reply?: unknown; actions?: unknown };
  } catch {
    throw new AIError('The assistant did not return valid JSON.', 'invalid-output');
  }

  return {
    reply: typeof parsed.reply === 'string' ? parsed.reply : '',
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    model: completion.model ?? status.model,
  };
};
