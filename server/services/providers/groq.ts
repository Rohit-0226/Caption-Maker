import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ffmpegPath } from '../ffmpeg';
import {
  TranscriptionError,
  type ProviderStatus,
  type TranscriptionProvider,
  type TranscriptionRequest,
  type TranscriptionResult,
} from '../../../src/core/transcription/types';
import { getHinglishPrompt, LANGUAGES, postProcessText } from '../../../src/core/transcription/languages';
import { normaliseEnglishToken } from '../../../src/core/transcription/englishLexicon';
import type { LanguageCode, TranscriptWord } from '../../../src/core/types/project';
import { applyPreferredTerminology } from '../terminology';
import { cleanRomanHinglishWithGroq, HINGLISH_CLEANUP_MODEL } from './hinglishCleanup';
import { translateTranscriptWordsToEnglishWithGroq } from './englishTranslation';
import { defaultVocabularyStore } from '../../../src/core/vocabulary/vocabularyStore';
import { alignPunctuation } from '../../../src/core/text/punctuation';
import { defaultSettingsStore } from '../configStore';

const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
/**
 * Turbo is the default for monolingual work. Hinglish and Hindi automatically use the
 * full model because recognition is more error-sensitive. An
 * explicit GROQ_WHISPER_MODEL value overrides that choice.
 */
const DEFAULT_MODEL = 'whisper-large-v3-turbo';
const HIGH_ACCURACY_MODEL = 'whisper-large-v3';
export const GROQ_PROMPT_MAX_CHARACTERS = 896;

/** Groq rejects Whisper prompts over 896 characters. Keep language context first. */
export const buildGroqPrompt = (
  languagePrompt: string | null,
  terminologySample: string | null | undefined,
  terms?: string[],
  vocabHints?: string[],
): string => {
  const base = languagePrompt?.trim() ?? '';
  const combinedTerms = [...(terms ?? []), ...(vocabHints ?? [])];
  const termList = combinedTerms.length > 0 ? Array.from(new Set(combinedTerms)).slice(0, 30).join(', ') : '';
  const sample = terminologySample?.trim() ?? '';
  const contextParts = [termList, sample].filter(Boolean).join('. ');

  if (!base) return contextParts.slice(0, GROQ_PROMPT_MAX_CHARACTERS);
  if (!contextParts) return base.slice(0, GROQ_PROMPT_MAX_CHARACTERS);
  const clippedBase = base.slice(0, GROQ_PROMPT_MAX_CHARACTERS);
  const room = GROQ_PROMPT_MAX_CHARACTERS - clippedBase.length - 1;
  return room > 0 ? `${clippedBase} ${contextParts.slice(0, room)}` : clippedBase;
};

export const resolveGroqModel = (
  language: LanguageCode,
  requestedModel?: string,
): string => {
  const storeModel = defaultSettingsStore.getGroqWhisperModel()?.trim();
  const requested = (requestedModel || storeModel || process.env.GROQ_WHISPER_MODEL)?.trim();
  if (requested === HIGH_ACCURACY_MODEL || requested === DEFAULT_MODEL) return requested;
  // whisper-large-v3-turbo avoids dropping the initial 10s of audio on conversational speech
  return DEFAULT_MODEL;
};

/**
 * Groq and xAI (Grok) are different companies with similar names. Their keys
 * are not interchangeable, and sending one to the other leaks a credential to a
 * third party — so refuse rather than guess.
 */
const GROQ_KEY_PREFIX = 'gsk_';
const XAI_KEY_PREFIX = 'xai-';

/**
 * Groq caps uploads at 25 MB. 16 kHz mono PCM is ~32 kB/s, so a chunk of ten
 * minutes lands around 19 MB — comfortably under the limit with headroom for
 * the WAV header and multipart overhead.
 */
const CHUNK_SECONDS = 600;
const CHUNK_OVERLAP = 0;

interface GroqWord {
  word: string;
  start: number;
  end: number;
}

interface GroqResponse {
  text?: string;
  language?: string;
  words?: GroqWord[];
  segments?: { text: string; start: number; end: number }[];
  error?: { message?: string; type?: string };
}

export interface WordTimelineHealth {
  broken: boolean;
  longestWordDuration: number;
  largestInternalGap: number;
  wordCount: number;
}

/** Detects provider timestamps that make one caption appear frozen for seconds. */
export const inspectWordTimeline = (
  input: Array<Pick<GroqWord, 'start' | 'end'>>,
): WordTimelineHealth => {
  const words = [...input]
    .filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end))
    .sort((left, right) => left.start - right.start);
  let longestWordDuration = 0;
  let largestInternalGap = 0;
  for (let index = 0; index < words.length; index++) {
    longestWordDuration = Math.max(
      longestWordDuration,
      Math.max(0, words[index].end - words[index].start),
    );
    if (index > 0) {
      largestInternalGap = Math.max(
        largestInternalGap,
        Math.max(0, words[index].start - words[index - 1].end),
      );
    }
  }
  return {
    broken: longestWordDuration > 3,
    longestWordDuration,
    largestInternalGap,
    wordCount: words.length,
  };
};

export const preferRecoveryTimeline = (
  primary: Array<Pick<GroqWord, 'start' | 'end'>>,
  recovery: Array<Pick<GroqWord, 'start' | 'end'>>,
): boolean => {
  const first = inspectWordTimeline(primary);
  const second = inspectWordTimeline(recovery);
  if (!first.broken || second.wordCount === 0) return false;
  if (!second.broken) return true;
  return (
    second.longestWordDuration < first.longestWordDuration &&
    second.wordCount >= first.wordCount
  );
};

const durationOf = async (file: string): Promise<number> => {
  const { mediaProcessor } = await import('../ffmpeg');
  const info = await mediaProcessor.probe(file);
  return info.duration;
};

const sliceAudio = (
  input: string,
  outPath: string,
  start: number,
  duration: number,
  signal?: AbortSignal,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath(),
      [
        '-y',
        '-ss', String(start),
        '-t', String(duration),
        '-i', input,
        '-ac', '1',
        '-ar', '16000',
        '-acodec', 'pcm_s16le',
        outPath,
      ],
      { signal },
    );
    child.stderr.on('data', () => {});
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(outPath) : reject(new Error('ffmpeg failed to slice audio')),
    );
  });

export class GroqTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'groq';
  readonly label = 'Groq — Whisper + Roman cleanup';
  readonly description =
    'No SOP required. Hinglish sends audio to Whisper, then sends the draft text to Groq for Roman spelling cleanup.';
  readonly requiresApiKey = true;
  readonly supportedLanguages: LanguageCode[] = [
    'auto',
    'en',
    'en-IN',
    'hinglish',
    'hi',
    'ur',
    'pa',
    'bn',
    'mr',
    'gu',
    'ta',
    'te',
    'kn',
    'ml',
  ];

  private get apiKey(): string | undefined {
    return defaultSettingsStore.getGroqKey();
  }

  status(): ProviderStatus {
    const key = this.apiKey;

    if (!key) {
      return {
        configured: false,
        reason:
          'No Groq API key. Open Settings (⚙️) to add your key or create a free key at console.groq.com/keys.',
      };
    }

    if (key.startsWith(XAI_KEY_PREFIX)) {
      return {
        configured: false,
        reason:
          'That looks like an xAI (Grok) key, not a Groq key. They are different companies. Groq keys start with "gsk_" and come from console.groq.com/keys.',
      };
    }

    if (!key.startsWith(GROQ_KEY_PREFIX)) {
      return {
        configured: false,
        reason:
          'GROQ_API_KEY does not look like a Groq key — they start with "gsk_". Check you copied the whole key from console.groq.com/keys.',
      };
    }

    return { configured: true, reason: null };
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const key = this.apiKey;
    if (!key) {
      throw new TranscriptionError(this.status().reason ?? 'Not configured', 'not-configured', false);
    }

    const model = resolveGroqModel(request.language);
    const config = LANGUAGES[request.language];
    const total = await durationOf(request.audioPath);
    const chunkCount = Math.max(1, Math.ceil(total / CHUNK_SECONDS));

    const words: TranscriptWord[] = [];
    const texts: string[] = [];
    let detected: string | null = null;
    let recoveryApplied = false;

    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cm-groq-'));

    try {
      for (let i = 0; i < chunkCount; i++) {
        if (request.signal?.aborted) {
          throw new TranscriptionError('Cancelled', 'cancelled', false);
        }

        const offset = i * CHUNK_SECONDS;
        const length = Math.min(CHUNK_SECONDS + CHUNK_OVERLAP, total - offset);

        request.onProgress?.({
          phase: 'uploading',
          progress: chunkCount === 1 ? null : i / chunkCount,
          message:
            chunkCount === 1
              ? 'Uploading audio to Groq'
              : `Transcribing part ${i + 1} of ${chunkCount}`,
        });

        const chunkPath =
          chunkCount === 1
            ? request.audioPath
            : await sliceAudio(
                request.audioPath,
                path.join(workDir, `chunk-${i}.wav`),
                offset,
                length,
                request.signal,
              );

        const basePrompt =
          request.language === 'hinglish'
            ? getHinglishPrompt(request.hinglishDomain)
            : config.prompt;
        const vocabHints =
          request.language === 'hinglish'
            ? defaultVocabularyStore.getAllEntries().slice(0, 25).map((e) => e.approved_form)
            : [];
        const prompt = buildGroqPrompt(
          basePrompt,
          request.terminology?.transcriptionSample,
          request.terminology?.terms,
          vocabHints,
        );
        let response = await this.callApi(chunkPath, config, key, model, prompt, request.signal);

        // A known code-switching failure mode is one token spanning many
        // seconds while speech continues. Retry that chunk with English-biased
        // decoding for coverage; the Roman cleanup pass reconciles its words.
        if (
          (request.language === 'hinglish' || request.language === 'auto' || request.language === 'hi') &&
          inspectWordTimeline(response.words ?? []).broken
        ) {
          request.onProgress?.({
            phase: 'transcribing',
            progress: chunkCount === 1 ? null : i / chunkCount,
            message: 'Recovering a missed section (timeline health check failed)',
          });
          const recovery = await this.callApi(
            chunkPath,
            { ...config, whisperLanguage: 'en' },
            key,
            model,
            prompt,
            request.signal,
          );
          if (preferRecoveryTimeline(response.words ?? [], recovery.words ?? [])) {
            response = recovery;
            recoveryApplied = true;
          }
        }

        if (response.text) texts.push(response.text.trim());
        if (!detected && response.language) detected = response.language;

        const chunkWords: TranscriptWord[] = [];
        for (const w of response.words ?? []) {
          const text = w.word?.trim();
          if (!text) continue;
          chunkWords.push({
            text,
            start: w.start + offset,
            end: Math.max(w.end + offset, w.start + offset + 0.01),
            confidence: null,
          });
        }

        const punctuatedChunkWords = response.segments?.length
          ? alignPunctuation(chunkWords, response.segments)
          : response.text
            ? alignPunctuation(chunkWords, [{ text: response.text }])
            : chunkWords;

        words.push(...punctuatedChunkWords);
      }
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }

    request.onProgress?.({
      phase: 'post-processing',
      progress: null,
      message: 'Tidying up the transcript',
    });

    // This deterministic version is also the safe fallback if semantic cleanup
    // is unavailable or ever returns an invalid token mapping.
    const fallbackWords = words.map((w) => ({
      ...w,
      text: postProcessText(w.text, request.language),
    }));

    /**
     * English stays English, whatever else happens.
     *
     * This runs for every language and before the model pass, so a brand name
     * is correct even when the cleanup call is rate limited, times out, or
     * returns a token count we have to reject. It used to be the model's job
     * alone, which made "Netflix" a coin flip on long transcripts.
     */
    const extraTerms = request.terminology?.terms ?? [];
    const englishFixed = fallbackWords.map((word) => ({
      ...word,
      text: normaliseEnglishToken(word.text, extraTerms),
    }));

    let languageProcessedWords = englishFixed;
    let cleanupApplied = false;

    if (request.language === 'en' || request.language === 'en-IN') {
      request.onProgress?.({
        phase: 'post-processing',
        progress: null,
        message: 'Translating Hindi/Hinglish speech to fluent English',
      });
      const translated = await translateTranscriptWordsToEnglishWithGroq({
        sourceWords: englishFixed,
        apiKey: key,
        terms: request.terminology?.terms,
        signal: request.signal,
        onProgress: (p, msg) => request.onProgress?.({ phase: 'post-processing', progress: p, message: msg }),
      }).catch(() => null);
      if (translated?.length) {
        languageProcessedWords = translated.map((word) => ({
          ...word,
          text: normaliseEnglishToken(word.text, extraTerms),
        }));
        cleanupApplied = true;
      }
    } else if (
      request.language === 'hinglish' ||
      (request.language === 'auto' && (detected === 'hi' || detected === 'hin' || words.some((w) => /[\u0900-\u097F]/.test(w.text))))
    ) {
      request.onProgress?.({
        phase: 'post-processing',
        progress: null,
        message: 'Converting to natural Roman Hinglish',
      });
      const cleaned = await cleanRomanHinglishWithGroq({
        sourceWords: englishFixed,
        fallbackWords: englishFixed,
        apiKey: key,
        terms: request.terminology?.terms,
        rules: request.terminology?.rules,
        signal: request.signal,
      }).catch(() => null);
      if (cleaned?.length) {
        languageProcessedWords = cleaned.map((word) => ({
          ...word,
          text: normaliseEnglishToken(word.text, extraTerms),
        }));
        cleanupApplied = true;
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          '[groq] Roman Hinglish cleanup did not apply; using the deterministic pass.',
        );
      }
    }

    const processedWords = applyPreferredTerminology(
      languageProcessedWords,
      request.terminology?.terms ?? [],
      request.terminology?.rules ?? [],
    );

    if (processedWords.length === 0) {
      throw new TranscriptionError(
        'Groq returned no words. The audio may be silent or contain no speech.',
        'provider-error',
      );
    }

    return {
      text:
        request.language === 'hinglish' || request.terminology?.terms.length
          ? processedWords.map((word) => word.text).join(' ')
          : postProcessText(texts.join(' ').trim(), request.language),
      words: processedWords,
      detectedLanguage: detected,
      modelId: [
        model,
        ...(recoveryApplied ? ['coverage recovery'] : []),
        ...(cleanupApplied ? [HINGLISH_CLEANUP_MODEL] : []),
      ].join(' + '),
    };
  }

  /**
   * One raw Whisper pass over WAV bytes: timed words and nothing else.
   *
   * The hybrid pipeline calls this directly, so no cleanup pass rewrites the
   * words before engines are compared, and so a short slice around a gap can
   * be transcribed on its own. Vocabulary-store hints are left out of the
   * prompt on purpose: Whisper echoes prompt words it did not hear, which is
   * how "getting themselves" once came back as "Gemini themselves".
   */
  async transcribeWav(
    wav: Uint8Array,
    options: {
      model: string;
      language: LanguageCode;
      /** undefined: the language's own setting; null: let Whisper detect it */
      whisperLanguage?: string | null;
      hinglishDomain?: TranscriptionRequest['hinglishDomain'];
      terms?: string[];
      transcriptionSample?: string | null;
      /** added to every timestamp, for slices that start partway into the file */
      offsetSeconds?: number;
      signal?: AbortSignal;
    },
  ): Promise<{ words: TranscriptWord[]; text: string; detectedLanguage: string | null }> {
    const key = this.apiKey;
    if (!key) {
      throw new TranscriptionError(this.status().reason ?? 'Not configured', 'not-configured', false);
    }

    const config = LANGUAGES[options.language];
    const whisperLanguage = options.whisperLanguage === undefined ? config.whisperLanguage : options.whisperLanguage;
    const basePrompt = options.language === 'hinglish' ? getHinglishPrompt(options.hinglishDomain) : config.prompt;
    const prompt = buildGroqPrompt(basePrompt, options.transcriptionSample, options.terms);

    const response = await this.callApiBytes(wav, 'audio.wav', whisperLanguage, key, options.model, prompt, options.signal);
    const offset = options.offsetSeconds ?? 0;

    const words: TranscriptWord[] = [];
    for (const w of response.words ?? []) {
      const text = w.word?.trim();
      if (!text) continue;
      words.push({
        text,
        start: w.start + offset,
        end: Math.max(w.end + offset, w.start + offset + 0.01),
        confidence: null,
      });
    }

    const punctuated = response.segments?.length
      ? alignPunctuation(words, response.segments)
      : response.text
        ? alignPunctuation(words, [{ text: response.text }])
        : words;

    return { words: punctuated, text: response.text?.trim() ?? '', detectedLanguage: response.language ?? null };
  }

  private async callApi(
    filePath: string,
    config: (typeof LANGUAGES)[LanguageCode],
    key: string,
    model: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<GroqResponse> {
    const bytes = await fsp.readFile(filePath);
    return this.callApiBytes(new Uint8Array(bytes), path.basename(filePath), config.whisperLanguage, key, model, prompt, signal);
  }

  private async callApiBytes(
    bytes: Uint8Array,
    fileName: string,
    whisperLanguage: string | null,
    key: string,
    model: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<GroqResponse> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), fileName);
    form.append('model', model);
    form.append('temperature', '0');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    if (whisperLanguage) form.append('language', whisperLanguage);
    if (prompt) form.append('prompt', prompt);

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new TranscriptionError('Cancelled', 'cancelled', false);
      throw new TranscriptionError(
        `Could not reach Groq: ${(error as Error).message}`,
        'network',
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      let detail = body.slice(0, 400);
      try {
        const parsed = JSON.parse(body) as GroqResponse;
        if (parsed.error?.message) detail = parsed.error.message;
      } catch {
        // keep the raw body
      }

      if (response.status === 401) {
        throw new TranscriptionError(
          'Groq rejected the API key. Check GROQ_API_KEY in your .env file.',
          'not-configured',
          false,
        );
      }
      if (response.status === 429) {
        throw new TranscriptionError(
          'Groq rate limit reached. Wait a moment and retry.',
          'provider-error',
        );
      }
      throw new TranscriptionError(`Groq error ${response.status}: ${detail}`, 'provider-error');
    }

    return (await response.json()) as GroqResponse;
  }
}
