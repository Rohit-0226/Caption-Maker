import type { TranscriptWord } from '../../../src/core/types/project';
import { isUnambiguousHindiToken } from '../../../src/core/transcription/hinglishLexicon';
import { canonicalEnglish } from '../../../src/core/transcription/englishLexicon';
import { speechRangesIn, type SpeechInterval, type SpeechMap } from '../../../src/core/speech/speechMap';
import { allocateTokens, buildPhrases, finaliseTimeline } from '../../../src/core/speech/timing';
import { defaultSettingsStore } from '../configStore';

/**
 * Hindi speech into English captions, one spoken phrase at a time.
 *
 * The previous version translated 35 words at once and spread the English
 * evenly across the batch. On an English video in this project that produced
 * forty runs of identical 0.29 s words marching straight through the speaker's
 * pauses — and it only happened because "are" was taken for Hindi.
 *
 * Now a phrase is the words said between two pauses. English phrases are left
 * exactly as transcribed, timing included. A Hindi phrase is translated on its
 * own and its English laid across that phrase's own speech, so a caption can
 * never drift past the pause that ends it.
 */

const resolveEndpointAndModels = (key: string) => {
  const geminiKey = defaultSettingsStore.getGeminiKey();
  if (key.startsWith('AQ.') || key.startsWith('AIza') || (geminiKey && key === geminiKey)) {
    return {
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      models: [defaultSettingsStore.getGeminiModel() || 'gemini-3.5-flash-lite'],
    };
  }
  return {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
  };
};

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/** True when any word is recognisably Hindi or Hinglish. */
export const containsHindiOrHinglish = (words: TranscriptWord[]): boolean =>
  words.some((word) => isUnambiguousHindiToken(word.text));

/**
 * Hindi grammar words. Loanwords like "reels" or "startup" are used in Hindi
 * sentences but are English, so they are not evidence; these words are.
 * Anything that is also a common English word ("the", "main", "to") is left out.
 */
const HINDI_GRAMMAR_WORDS = new Set([
  'hai', 'hain', 'hoon', 'hun', 'tha', 'thi', 'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'aur', 'toh',
  'bhi', 'nahi', 'nahin', 'kya', 'kyun', 'kyunki', 'kyonki', 'yeh', 'ye', 'woh', 'wo', 'aap', 'hum',
  'tum', 'mera', 'meri', 'mere', 'tera', 'teri', 'tere', 'apna', 'apni', 'apne', 'uska', 'uski',
  'uske', 'iska', 'iski', 'iske', 'unka', 'unki', 'unke', 'kuch', 'sab', 'bahut', 'kaise', 'kab',
  'kahan', 'agar', 'lekin', 'magar', 'raha', 'rahi', 'rahe', 'karna', 'karte', 'karta', 'karti',
  'kiya', 'kar', 'liye', 'wala', 'wali', 'wale', 'abhi', 'phir', 'sirf', 'chahiye', 'sakte',
  'sakta', 'sakti', 'gaya', 'gayi', 'gaye', 'diya', 'liya', 'hota', 'hoti', 'hote', 'jaise',
  'matlab', 'yaar', 'bhai', 'accha', 'achha', 'acha', 'theek', 'haan', 'isliye', 'aisa', 'aise',
  'kaun', 'kitna', 'kitne', 'humein', 'mujhe', 'tumhe', 'unhe', 'wahan', 'yahan', 'dekho', 'suno',
  'chalo', 'batao', 'samajh', 'pata',
]);

/** How strongly a token signals Hindi: 0 for English, 1 for unmistakable Hindi. */
export const hindiEvidence = (token: string): number => {
  const core = token.replace(/[^\p{L}\p{M}\p{N}]/gu, '');
  if (!core) return 0;
  // Devanagari is Hindi unless it is an English word spelled in it (वीडियो)
  if (/[ऀ-ॿ]/u.test(core)) return canonicalEnglish(core) ? 0 : 1;
  const lower = core.toLocaleLowerCase('en');
  if (HINDI_GRAMMAR_WORDS.has(lower)) return 1;
  if (isUnambiguousHindiToken(lower) && !canonicalEnglish(lower)) return 0.5;
  return 0;
};

/** A phrase is translated only on real evidence of Hindi, so English speech keeps its exact timing. */
export const phraseNeedsTranslation = (tokens: string[]): boolean => {
  if (tokens.length === 0) return false;
  const evidence = tokens.reduce((sum, token) => sum + hindiEvidence(token), 0);
  return evidence >= 2 || evidence / tokens.length >= 0.3;
};

const systemPrompt = (terms?: string[]) =>
  [
    'You translate spoken Hindi and Hinglish into natural English subtitles.',
    'Each phrase is one stretch of speech between two pauses, from the same video and in order. Translate each phrase on its own, using the others only as context.',
    'Keep words that were already spoken in English. Keep names and brands exactly as written.',
    'Do not add, explain or summarise anything, and do not merge or split phrases.',
    'Use normal subtitle punctuation.',
    ...(terms && terms.length > 0 ? [`Spell these exactly: ${terms.slice(0, 40).join(', ')}.`] : []),
    'Return one translation for every id.',
  ].join('\n');

const RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'phrase_translations',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        translations: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, english: { type: 'string' } },
            required: ['id', 'english'],
            additionalProperties: false,
          },
        },
      },
      required: ['translations'],
      additionalProperties: false,
    },
  },
};

const translateBatch = async (
  phrases: Array<{ id: string; text: string }>,
  apiKey: string,
  terms: string[] | undefined,
  signal?: AbortSignal,
): Promise<Map<string, string>> => {
  const { endpoint, models } = resolveEndpointAndModels(apiKey);
  const ids = new Set(phrases.map((phrase) => phrase.id));
  const failures: string[] = [];

  for (const model of models) {
    if (signal?.aborted) break;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: systemPrompt(terms) },
            { role: 'user', content: JSON.stringify({ phrases }) },
          ],
          response_format: RESPONSE_FORMAT,
        }),
      });

      if (!response.ok) {
        failures.push(`${model}: HTTP ${response.status}`);
        continue;
      }

      const json = (await response.json()) as ChatResponse;
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        failures.push(`${model}: empty answer`);
        continue;
      }

      const parsed = JSON.parse(content) as { translations?: Array<{ id?: unknown; english?: unknown }> };
      const out = new Map<string, string>();
      for (const item of parsed.translations ?? []) {
        if (typeof item.id === 'string' && ids.has(item.id) && typeof item.english === 'string' && item.english.trim()) {
          out.set(item.id, item.english.trim());
        }
      }
      if (out.size > 0) return out;
      failures.push(`${model}: no usable translations`);
    } catch (error) {
      if (signal?.aborted) break;
      failures.push(`${model}: ${(error as Error).message}`);
    }
  }

  if (failures.length > 0 && !signal?.aborted) {
    // eslint-disable-next-line no-console
    console.warn(`[translation] Phrases left untranslated — ${failures.join('; ')}`);
  }
  return new Map();
};

const BATCH_PHRASES = 20;

/**
 * Translates the Hindi phrases in a transcript into English.
 *
 * `speechMap`, when given, places each translated phrase's words on the speech
 * inside that phrase. Without it, the source words' own spans stand in.
 */
export const translateTranscriptWordsToEnglishWithGroq = async (options: {
  sourceWords: TranscriptWord[];
  apiKey: string;
  terms?: string[];
  signal?: AbortSignal;
  onProgress?: (progress: number, message: string) => void;
  speechMap?: SpeechMap;
}): Promise<TranscriptWord[]> => {
  const { sourceWords, apiKey, terms, signal, onProgress, speechMap } = options;
  if (sourceWords.length === 0) return [];

  const words = finaliseTimeline(sourceWords);
  const effectiveKey = defaultSettingsStore.getGeminiKey() || apiKey || defaultSettingsStore.getGroqKey() || '';
  const phrases = buildPhrases(words);

  const jobs = phrases
    .map((phrase, i) => ({ id: `p${i}`, phrase, tokens: words.slice(phrase.from, phrase.to).map((w) => w.text) }))
    .filter((job) => phraseNeedsTranslation(job.tokens));

  if (jobs.length === 0 || !effectiveKey) return words;

  const translations = new Map<string, string>();
  for (let i = 0; i < jobs.length; i += BATCH_PHRASES) {
    if (signal?.aborted) break;
    onProgress?.(
      i / jobs.length,
      `Translating Hindi speech to English (${Math.min(jobs.length, i + BATCH_PHRASES)} of ${jobs.length} phrases)`,
    );
    const batch = jobs.slice(i, i + BATCH_PHRASES).map((job) => ({ id: job.id, text: job.tokens.join(' ') }));
    for (const [id, text] of await translateBatch(batch, effectiveKey, terms, signal)) translations.set(id, text);
  }

  const jobByStart = new Map(jobs.map((job) => [job.phrase.from, job]));
  const out: TranscriptWord[] = [];

  for (const phrase of phrases) {
    const source = words.slice(phrase.from, phrase.to);
    const job = jobByStart.get(phrase.from);
    const english = job ? translations.get(job.id) : undefined;

    if (!english) {
      out.push(...source);
      continue;
    }

    const span = { start: phrase.start, end: phrase.end };
    const speech: SpeechInterval[] = speechMap?.reliable
      ? speechRangesIn(speechMap, span.start, span.end)
      : source.map((word) => ({ start: word.start, end: word.end }));
    out.push(...allocateTokens(english.split(/\s+/), span, speech));
  }

  return finaliseTimeline(out);
};
