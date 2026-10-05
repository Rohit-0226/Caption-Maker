import type { LanguageCode } from '../../../src/core/types/project';
import { defaultSettingsStore } from '../configStore';

/**
 * Gemini as an independent listener.
 *
 * Unlike the text-only arbiter this module sends Gemini the audio itself, so it
 * hears the speech with a different model from Whisper and makes different
 * mistakes. On a real clip from this project it corrected three of Whisper's:
 * "Franchise" for "Frankly", "reel" for "real", and "Gemini themselves" for
 * "getting themselves". It returns text only — its timestamps are not reliable
 * enough to caption with, so timing always comes from Whisper and the audio.
 */

export interface GeminiListenRequest {
  /** a mono 16-bit PCM WAV */
  wav: Uint8Array;
  language: LanguageCode;
  terms?: string[];
  signal?: AbortSignal;
  /** per attempt */
  timeoutMs?: number;
}

export interface GeminiListenResult {
  text: string;
  model: string;
  elapsedMs: number;
}

export class GeminiListenError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'GeminiListenError';
  }
}

const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export const isGeminiListenerConfigured = (): boolean => Boolean(defaultSettingsStore.getGeminiKey());

export const buildListeningPrompt = (language: LanguageCode, terms: string[] = []): string => {
  const lines = [
    'Transcribe every spoken word in this audio verbatim, in the order it is said.',
    'Keep English words in normal English spelling. Brand and product names keep their official spelling (Netflix, YouTube, iPhone).',
    language === 'hi'
      ? 'Write Hindi words in Devanagari script.'
      : 'Write Hindi and Urdu words in Roman script (Hinglish). Never use Devanagari.',
    'Do not translate, summarise, correct grammar, or drop repeated words and fillers.',
    'If a stretch is unintelligible, leave it out rather than guessing.',
    'Output only the transcript text, with normal punctuation.',
  ];

  const clean = [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, 40);
  if (clean.length > 0) {
    lines.push(`Names and terms that may occur, spelled as they should be written: ${clean.join(', ')}.`);
  }

  return lines.join('\n');
};

interface GenerateResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string; status?: string };
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new GeminiListenError('Cancelled', false));
      },
      { once: true },
    );
  });

export const listenWithGemini = async (request: GeminiListenRequest): Promise<GeminiListenResult> => {
  const key = defaultSettingsStore.getGeminiKey();
  if (!key) throw new GeminiListenError('No Gemini API key is configured.', false);

  const model = defaultSettingsStore.getGeminiModel();
  const body = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'audio/wav', data: Buffer.from(request.wav).toString('base64') } },
          { text: buildListeningPrompt(request.language, request.terms) },
        ],
      },
    ],
    generationConfig: { temperature: 0 },
  });

  const attempts = 2;
  let lastError: GeminiListenError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (request.signal?.aborted) throw new GeminiListenError('Cancelled', false);

    const started = Date.now();
    const timeout = AbortSignal.timeout(request.timeoutMs ?? 90_000);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(endpointFor(model), {
        method: 'POST',
        // the key travels in a header, never the URL, so it cannot end up in a log
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body,
        signal,
      });
    } catch (error) {
      if (request.signal?.aborted) throw new GeminiListenError('Cancelled', false);
      lastError = new GeminiListenError(
        timeout.aborted ? 'Gemini took too long to answer.' : `Could not reach Gemini: ${(error as Error).message}`,
        true,
      );
      if (attempt < attempts) await wait(1500, request.signal);
      continue;
    }

    const payload = (await response.json().catch(() => ({}))) as GenerateResponse;

    if (!response.ok) {
      const detail = payload.error?.message?.slice(0, 200) ?? `HTTP ${response.status}`;
      lastError = new GeminiListenError(`Gemini error ${response.status}: ${detail}`, RETRYABLE_STATUS.has(response.status));
      if (lastError.retryable && attempt < attempts) {
        await wait(response.status === 429 ? 4000 : 1500, request.signal);
        continue;
      }
      throw lastError;
    }

    const candidate = payload.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('').trim();

    if (!text) {
      throw new GeminiListenError(
        candidate?.finishReason && candidate.finishReason !== 'STOP'
          ? `Gemini stopped without a transcript (${candidate.finishReason}).`
          : 'Gemini returned no transcript.',
        false,
      );
    }

    return { text, model, elapsedMs: Date.now() - started };
  }

  throw lastError ?? new GeminiListenError('Gemini did not answer.', true);
};
