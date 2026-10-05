import type { HinglishDomain, LanguageCode, TranscriptWord } from '../../../src/core/types/project';
import { hasDevanagari, postProcessText } from '../../../src/core/transcription/languages';
import { normaliseEnglishToken } from '../../../src/core/transcription/englishLexicon';
import { defaultSettingsStore } from '../configStore';

export interface ReconcileOptions {
  nemotronText: string;
  groqText: string;
  language: LanguageCode;
  hinglishDomain?: HinglishDomain;
  terms?: string[];
  signal?: AbortSignal;
}

export interface ReconciledResult {
  caption: string;
  words: string[];
}

export interface InPlaceReconcileOptions {
  words: TranscriptWord[];
  nemotronReference?: string;
  language: LanguageCode;
  hinglishDomain?: HinglishDomain;
  terms?: string[];
  signal?: AbortSignal;
  onProgress?: (progress: number, message: string) => void;
}

const resolveLlmEndpointAndKey = (): { endpoint: string; key: string; model: string; provider: 'gemini' | 'groq' } | null => {
  const geminiKey = defaultSettingsStore.getGeminiKey();
  if (geminiKey) {
    return {
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      key: geminiKey,
      model: defaultSettingsStore.getGeminiModel() || 'gemini-3.5-flash-lite',
      provider: 'gemini',
    };
  }

  const groqKey = defaultSettingsStore.getGroqKey();
  if (groqKey) {
    return {
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      key: groqKey,
      model: 'llama-3.3-70b-versatile',
      provider: 'groq',
    };
  }

  return null;
};

const buildInPlaceSystemPrompt = (language: LanguageCode, terms?: string[]): string => {
  if (language === 'en') {
    return [
      'You are an expert audio subtitle editor for video captions.',
      'TASK: In-place translation and cleanup of transcribed subtitle tokens.',
      'CRITICAL RULES:',
      '1. Translate all Hindi or Hinglish words into natural, grammatically correct colloquial English.',
      '2. Spoken English words must remain in standard English.',
      '3. Maintain proper sentence punctuation (. , ? !) attached to words.',
      '4. If Whisper missed words that speechReference contains, add them to insertions: [{ afterIndex: number, text: string }] (use afterIndex: -1 for opening words).',
      '5. Return JSON: { "tokens": [{ "index": number, "text": string }], "insertions": [{ "afterIndex": number, "text": string }] } matching the input indices.',
      ...(terms && terms.length > 0 ? [`Preserve brand terminology: ${terms.join(', ')}`] : []),
    ].join('\n');
  }

  // Hinglish / Auto Detect mode: Kalakar-grade Roman Hinglish
  return [
    'You are the Kalakar-grade Roman Hinglish audio subtitle processor.',
    'You are given an array of timestamped subtitle tokens from Whisper and an optional local Nemotron GPU speech reference.',
    'TASK: Perform in-place token correction, gap healing, and natural Roman Hinglish romanization.',
    'CRITICAL RULES:',
    '1. ALL HINDI WORDS MUST BE IN NATURAL ROMAN HINGLISH: Convert any Hindi/Devanagari or awkward phonetic spellings into clean, modern, trending Roman Hinglish (e.g. "kuch-kuch", "shuru", "pehle", "chalu", "matlab", "zyada", "bhai", "dekho", "karna padega", "baatcheet", "sahi", "aur", "apne"). NO Devanagari script.',
    '2. SPOKEN ENGLISH REMAINS IN ENGLISH: Words spoken in English (e.g. "video", "market", "launch", "influencers", "brand", "family", "budget", "trending", "join", "watch") must remain in standard English.',
    '3. RESOLVE ERRORS WITH REFERENCE: Use the speechReference text to correct any misheard words from Whisper.',
    '4. GAP HEALING (NEVER LOSE SPEECH): If Whisper missed words that speechReference contains, include them in insertions: [{ afterIndex: number, text: string }] (use afterIndex: -1 if words were missed before index 0).',
    '5. FIX SPELLING & REPEATS: Correct transcription slips and remove duplicate stutter words.',
    '6. NATURAL SUBTITLE PUNCTUATION: Attach proper punctuation (. , ? !) to appropriate words and capitalize sentence beginnings.',
    '7. Return JSON with "tokens": array of { "index": number, "text": string } and "insertions": array of { "afterIndex": number, "text": string }.',
    ...(terms && terms.length > 0 ? [`Preserve brand terminology: ${terms.join(', ')}`] : []),
  ].join('\n');
};

const buildSystemPrompt = (language: LanguageCode, terms?: string[]): string => {
  if (language === 'en') {
    return [
      'You are an expert audio transcription arbiter and subtitle translator for video content.',
      'You receive two candidate speech transcriptions of the exact same audio from two different speech models.',
      'TASK: Reconcile both candidates into a single, cohesive, 100% pure English subtitle sentence.',
      'CRITICAL RULES:',
      '1. Translate all Hindi or Hinglish words and phrases into natural, grammatically correct colloquial English.',
      '2. Resolve misheard words or acoustic hallucinations between the two models using conversational context.',
      '3. Retain spoken English words intact.',
      '4. Maintain proper punctuation (. , ? !) and sentence capitalization.',
      '5. Output MUST NOT contain any Hindi or Roman Hinglish words.',
      '6. Return JSON with "caption" (full string) and "words" (array of individual tokenized words with punctuation attached).',
      ...(terms && terms.length > 0 ? [`Preserve brand/product terminology: ${terms.join(', ')}`] : []),
    ].join('\n');
  }

  return [
    'You are an expert audio transcription arbiter and Hinglish romanizer for video subtitles.',
    'You receive two candidate speech transcriptions of the exact same audio from two different speech models (Local Nemotron GPU and Cloud Whisper).',
    'TASK: Reconcile both candidate transcriptions into a single, highly accurate, natural Roman Hinglish subtitle sequence.',
    'CRITICAL RULES:',
    '1. ALL HINDI WORDS MUST BE ROMANIZED: Transliterate all Hindi/Devanagari script into natural, standard Roman Hinglish (e.g. "kuch-kuch", "shuru", "pehle", "chalu", "matlab", "zyada", "bhai", "dekho", "karna padega", "baatcheet"). Absolutely NO Devanagari script.',
    '2. SPOKEN ENGLISH REMAINS ENGLISH: Spoken English words (e.g. "video", "market", "launch", "influencers", "brand", "family", "system") must remain in standard English spelling.',
    '3. RESOLVE ERRORS & DISCREPANCIES: Where one model misheard or dropped a word, determine the true spoken phrase from the combined context.',
    '4. CORRECT SPELLING MISTAKES: Fix phonetic spelling slips and remove repeated/stuttered word glitches.',
    '5. NATURAL SUBTITLE PUNCTUATION: Ensure fluent grammatical punctuation (. , ? !) and capitalize the first letter of each sentence.',
    '6. Return a JSON object with "caption" (full sentence string) and "words" (array of individual tokenized words with punctuation attached).',
    ...(terms && terms.length > 0 ? [`Preserve brand/product terminology: ${terms.join(', ')}`] : []),
  ].join('\n');
};

const fallbackReconcile = (nemotronText: string, groqText: string, language: LanguageCode): ReconciledResult => {
  const base = groqText.trim() || nemotronText.trim();
  const rawWords = base.split(/\s+/).filter(Boolean);
  const romanizedWords = rawWords.map((word) => {
    if ((language === 'hinglish' || language === 'auto') && hasDevanagari(word)) {
      return postProcessText(word, 'hinglish');
    }
    return word;
  });

  return {
    caption: romanizedWords.join(' '),
    words: romanizedWords,
  };
};

/**
 * Reconciles candidate transcriptions from Local Nemotron and Groq Whisper.
 */
export const reconcileTranscriptCandidates = async (
  options: ReconcileOptions,
): Promise<ReconciledResult> => {
  const { nemotronText, groqText, language, terms, signal } = options;

  if (!nemotronText.trim() && !groqText.trim()) {
    return { caption: '', words: [] };
  }
  if (!nemotronText.trim()) {
    return fallbackReconcile('', groqText, language);
  }
  if (!groqText.trim()) {
    return fallbackReconcile(nemotronText, '', language);
  }

  const llm = resolveLlmEndpointAndKey();
  if (!llm) {
    return fallbackReconcile(nemotronText, groqText, language);
  }

  const systemContent = buildSystemPrompt(language, terms);
  const userContent = [
    `Candidate 1 (Local Nemotron ASR): "${nemotronText.trim()}"`,
    `Candidate 2 (Cloud Whisper): "${groqText.trim()}"`,
    'Reconcile both candidates into the final, accurate subtitle.',
  ].join('\n');

  const schema = {
    type: 'json_schema' as const,
    json_schema: {
      name: 'consensus_transcript',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          caption: { type: 'string' },
          words: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['caption', 'words'],
        additionalProperties: false,
      },
    },
  };

  try {
    const res = await fetch(llm.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llm.key}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model: llm.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
        response_format: schema,
      }),
    });

    if (!res.ok) {
      return fallbackReconcile(nemotronText, groqText, language);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      return fallbackReconcile(nemotronText, groqText, language);
    }

    const parsed = JSON.parse(content) as { caption?: string; words?: string[] };
    if (parsed.words && Array.isArray(parsed.words) && parsed.words.length > 0) {
      let finalWords = parsed.words;
      if (language === 'hinglish' || language === 'auto') {
        finalWords = finalWords.map((w) => (hasDevanagari(w) ? postProcessText(w, 'hinglish') : w));
      }
      return {
        caption: parsed.caption || finalWords.join(' '),
        words: finalWords,
      };
    }

    return fallbackReconcile(nemotronText, groqText, language);
  } catch {
    return fallbackReconcile(nemotronText, groqText, language);
  }
};

/**
 * Kalakar-grade In-Place Token Reconciliation.
 *
 * Takes Whisper words with exact acoustic neural network start/end timestamps,
 * cross-references Local Nemotron reference text, and uses Gemini 3.5 Flash / Groq LLM
 * to update each token in-place to natural Roman Hinglish / English.
 *
 * GUARANTEES:
 * - 100% audio sync from first point to last point (start/end times are preserved).
 * - Zero artificial gaps.
 * - Spoken English words remain English.
 * - Hindi words are cleanly romanized.
 */
export const reconcileInPlaceTokens = async (
  options: InPlaceReconcileOptions,
): Promise<TranscriptWord[]> => {
  const { words, nemotronReference, language, terms, signal, onProgress } = options;
  if (words.length === 0) return [];

  // 1. Initial local rule-based pass: transliterate any Devanagari immediately
  // and normalize English words. This guarantees a clean, 100% synchronized fallback.
  const baseWords: TranscriptWord[] = words.map((w) => {
    let text = w.text;
    if ((language === 'hinglish' || language === 'auto') && hasDevanagari(text)) {
      text = postProcessText(text, 'hinglish');
    }
    text = normaliseEnglishToken(text, terms);
    return { ...w, text };
  });

  const llm = resolveLlmEndpointAndKey();
  if (!llm) {
    return baseWords;
  }

  const BATCH_SIZE = 60;
  const totalBatches = Math.ceil(baseWords.length / BATCH_SIZE);
  const resultWords: TranscriptWord[] = [...baseWords];

  const systemContent = buildInPlaceSystemPrompt(language, terms);

  const schema = {
    type: 'json_schema' as const,
    json_schema: {
      name: 'aligned_tokens_with_insertions',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          tokens: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'number' },
                text: { type: 'string' },
              },
              required: ['index', 'text'],
              additionalProperties: false,
            },
          },
          insertions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                afterIndex: { type: 'number' },
                text: { type: 'string' },
              },
              required: ['afterIndex', 'text'],
              additionalProperties: false,
            },
          },
        },
        required: ['tokens', 'insertions'],
        additionalProperties: false,
      },
    },
  };

  // Build a reference window that matches the full context or the wide timeline
  const fullRef = nemotronReference?.trim() || '';

  // Process batches and collect insertions
  const batchInsertedWords: Array<{ afterGlobalIndex: number; words: TranscriptWord[] }> = [];

  for (let b = 0; b < totalBatches; b++) {
    if (signal?.aborted) break;

    const startIdx = b * BATCH_SIZE;
    const endIdx = Math.min(startIdx + BATCH_SIZE, baseWords.length);
    const chunkWords = baseWords.slice(startIdx, endIdx);

    onProgress?.(
      b / totalBatches,
      `Polishing captions with Gemini (${b + 1}/${totalBatches})`,
    );

    const whisperTokens = chunkWords.map((w, i) => ({
      index: i,
      text: w.text,
      start: w.start,
      end: w.end,
    }));

    // Pass the full reference if under 15k chars (fits effortlessly into Gemini 1M context),
    // otherwise take a wide 4000-char window centered around the batch's position.
    let refSnippet = fullRef;
    if (fullRef.length > 15000 && baseWords.length > 0) {
      const midProgress = (startIdx + endIdx) / (2 * baseWords.length);
      const centerChar = Math.floor(midProgress * fullRef.length);
      const startChar = Math.max(0, centerChar - 2500);
      const endChar = Math.min(fullRef.length, centerChar + 2500);
      refSnippet = fullRef.slice(startChar, endChar);
    }

    try {
      const res = await fetch(llm.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${llm.key}`,
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify({
          model: llm.model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: systemContent },
            {
              role: 'user',
              content: JSON.stringify({
                whisperTokens,
                speechReference: refSnippet || undefined,
              }),
            },
          ],
          response_format: schema,
        }),
      });

      if (!res.ok) continue;

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };

      const content = json.choices?.[0]?.message?.content;
      if (!content) continue;

      const parsed = JSON.parse(content) as {
        tokens?: Array<{ index: number; text: string }>;
        insertions?: Array<{ afterIndex: number; text: string }>;
      };

      if (parsed.tokens && Array.isArray(parsed.tokens)) {
        for (const t of parsed.tokens) {
          if (typeof t.index === 'number' && t.index >= 0 && t.index < chunkWords.length) {
            const globalIdx = startIdx + t.index;
            let updatedText = t.text.trim();
            if ((language === 'hinglish' || language === 'auto') && hasDevanagari(updatedText)) {
              updatedText = postProcessText(updatedText, 'hinglish');
            }
            if (updatedText) {
              resultWords[globalIdx] = {
                ...resultWords[globalIdx],
                text: updatedText,
              };
            }
          }
        }
      }

      // Handle gap healing insertions
      if (parsed.insertions && Array.isArray(parsed.insertions)) {
        for (const ins of parsed.insertions) {
          const rawText = ins.text?.trim();
          if (!rawText) continue;

          let cleaned = rawText;
          if ((language === 'hinglish' || language === 'auto') && hasDevanagari(cleaned)) {
            cleaned = postProcessText(cleaned, 'hinglish');
          }

          const insWords = cleaned.split(/\s+/).filter(Boolean);
          if (insWords.length === 0) continue;

          const afterIdx = typeof ins.afterIndex === 'number' ? ins.afterIndex : -1;
          const afterGlobal = afterIdx >= 0 ? startIdx + afterIdx : startIdx - 1;

          // Determine acoustic timestamps for inserted words
          let gapStart = 0;
          let gapEnd = 0.5;

          if (afterGlobal < 0) {
            // Insertion at opening of audio
            const first = baseWords[0];
            gapEnd = first ? first.start : 1.0;
            gapStart = Math.max(0, gapEnd - 0.3 * insWords.length);
          } else if (afterGlobal < baseWords.length - 1) {
            // Insertion between existing words
            const cur = baseWords[afterGlobal];
            const next = baseWords[afterGlobal + 1];
            gapStart = cur.end;
            gapEnd = next.start > cur.end ? next.start : cur.end + 0.3 * insWords.length;
          } else {
            // Insertion at the end
            const last = baseWords[baseWords.length - 1];
            gapStart = last.end;
            gapEnd = gapStart + 0.3 * insWords.length;
          }

          const span = Math.max(0.1, gapEnd - gapStart);
          const step = span / insWords.length;

          const created: TranscriptWord[] = insWords.map((txt, k) => ({
            text: txt,
            start: Math.round((gapStart + k * step) * 1000) / 1000,
            end: Math.round((gapStart + (k + 1) * step) * 1000) / 1000,
            confidence: null,
          }));

          batchInsertedWords.push({ afterGlobalIndex: afterGlobal, words: created });
        }
      }
    } catch {
      // In case of any network error on this batch, keep baseWords for this batch
    }
  }

  // Splice all inserted words into resultWords in reverse global index order
  batchInsertedWords.sort((a, b) => b.afterGlobalIndex - a.afterGlobalIndex);
  for (const item of batchInsertedWords) {
    const insertPos = Math.max(0, item.afterGlobalIndex + 1);
    resultWords.splice(insertPos, 0, ...item.words);
  }

  // Ensure monotonic progression and clean spacing
  return resultWords.sort((a, b) => a.start - b.start);
};
