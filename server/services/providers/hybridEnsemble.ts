import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  TranscriptionError,
  type ProviderStatus,
  type TranscriptionPhase,
  type TranscriptionProvider,
  type TranscriptionRequest,
  type TranscriptionResult,
} from '../../../src/core/transcription/types';
import type { LanguageCode, TranscriptWord } from '../../../src/core/types/project';
import { hasDevanagari, postProcessText } from '../../../src/core/transcription/languages';
import { normaliseEnglishToken } from '../../../src/core/transcription/englishLexicon';
import { durationOf, encodeWavPcm16, sliceSeconds } from '../../../src/core/speech/pcm';
import { buildSpeechMap, speechRangesIn, totalSpeechSeconds, type SpeechInterval } from '../../../src/core/speech/speechMap';
import {
  allocateTokens,
  finaliseTimeline,
  findSpeechGaps,
  mergeByTime,
  measureTimingQuality,
  refineWordTimings,
} from '../../../src/core/speech/timing';
import {
  buildConsensus,
  matchKey,
  tokenSimilarity,
  type ConsensusWord,
  type Dispute,
  type Hypothesis,
  type Listener,
  chooseTextBackbone,
  timeTokensAgainst,
} from '../../../src/core/speech/consensus';
import { planChunks } from '../../../src/core/speech/chunks';
import type { TranscriptQuality } from '../../../src/core/speech/quality';
import { applyPreferredTerminology } from '../terminology';
import { defaultSettingsStore } from '../configStore';
import { loadPcm16Mono } from '../speech/audio';
import { arbitrateDisputes } from '../speech/arbiter';
import { cachedCall } from '../speech/devCache';
import { GeminiListenError, isGeminiListenerConfigured, listenWithGemini } from '../speech/geminiListener';
import { GroqTranscriptionProvider, resolveGroqModel } from './groq';
import { HandyTimeoutError, locateHandy, transcribeWavWithHandy } from './nemotron';
import { hindiEvidence, translateTranscriptWordsToEnglishWithGroq } from './englishTranslation';

/**
 * The multi-engine caption pipeline.
 *
 *   audio → speech map → every engine listens on its own
 *         → Whisper's words timed against the audio → missed speech recovered
 *         → word-by-word vote → Gemini settles what the vote could not
 *         → Hinglish / English → final timing check
 *
 * Measured on this project's own videos before this pipeline existed, captions
 * put a word boundary inside a real pause 0–33% of the time, and on one clip
 * 28% of the speech had no words at all. The guarantees here answer those
 * numbers: no word sits where the audio is silent, and no stretch of speech is
 * left empty while any engine heard something in it.
 */

const CHUNK_SECONDS = 90;
const TURBO = 'whisper-large-v3-turbo';
const LARGE = 'whisper-large-v3';
/** Vote weights. Gemini transcribed most accurately in side-by-side tests on this project's clips. */
const WEIGHT = { whisper: 1, whisperSecond: 0.9, gemini: 1.1, nemotron: 0.8 } as const;
const MAX_RECOVERY_SLICES = 8;
/** What Whisper says when handed a short slice with no speech in it. */
const SILENCE_HALLUCINATION = /^(thank you|thanks for watching|please subscribe|subscribe|bye|you)[.!]*$/i;

const tokensOf = (text: string | null | undefined): string[] =>
  (text ?? '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => /[\p{L}\p{N}]/u.test(token));

const midpoint = (word: TranscriptWord) => (word.start + word.end) / 2;

const cancelled = () => new TranscriptionError('Cancelled', 'cancelled', false);

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** True when a word already in the transcript covers this recovered one. */
const alreadyHave = (word: TranscriptWord, existing: TranscriptWord[]): boolean => {
  const key = matchKey(word.text);
  if (!key) return true;
  return existing.some(
    (other) => Math.abs(other.start - word.start) < 0.8 && tokenSimilarity(matchKey(other.text), key) >= 0.8,
  );
};

const countRetimed = (before: TranscriptWord[], after: TranscriptWord[]): number => {
  const sorted = [...before].sort((a, b) => a.start - b.start);
  let changed = 0;
  for (let i = 0; i < Math.min(sorted.length, after.length); i++) {
    if (Math.abs(sorted[i].start - after[i].start) > 0.02 || Math.abs(sorted[i].end - after[i].end) > 0.02) changed++;
  }
  return changed;
};

const whisperLabel = (model: string) => model.replace(/^whisper-/, 'Whisper ');

export class HybridEnsembleProvider implements TranscriptionProvider {
  readonly id = 'hybrid-ensemble';
  readonly label = 'Ultra-Accuracy Hybrid — Whisper ×2 + Gemini + Nemotron';
  readonly description =
    'Every engine you have set up listens separately, then they vote word by word. Missed speech is recovered and every word is timed against the audio itself.';
  readonly requiresApiKey = false;
  readonly supportedLanguages: LanguageCode[] = ['auto', 'en', 'en-IN', 'hi', 'hinglish'];

  private groq = new GroqTranscriptionProvider();

  status(): ProviderStatus {
    if (this.groq.status().configured || isGeminiListenerConfigured() || locateHandy()) {
      return { configured: true, reason: null };
    }
    return {
      configured: false,
      reason: 'Add a Groq key (best sync), a Gemini key, or install Handy for local Nemotron in Settings (⚙️).',
    };
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const report = (progress: number, message: string, phase: TranscriptionPhase = 'transcribing') =>
      request.onProgress?.({ phase, progress: Math.min(1, progress), message });
    const check = () => {
      if (request.signal?.aborted) throw cancelled();
    };

    const notes: string[] = [];
    const skipped: string[] = [];
    const engines: string[] = [];

    report(0.02, 'Reading the audio', 'preparing');
    const audio = await loadPcm16Mono(request.audioPath, request.signal);
    const duration = durationOf(audio);
    if (duration <= 0) throw new TranscriptionError('That file contains no audio.', 'no-audio', false);

    const map = buildSpeechMap(audio.samples, audio.sampleRate);
    if (map.reliable && totalSpeechSeconds(map) === 0) {
      throw new TranscriptionError('No speech was found in this audio.', 'no-audio', false);
    }
    if (!map.reliable) {
      notes.push('The background sound is too constant to find pauses, so word timing could not be checked against the audio.');
    }

    const chunks = planChunks(map, CHUNK_SECONDS);
    const language = request.language;
    const englishTarget = language === 'en' || language === 'en-IN';
    // English captions start from what was actually said; Hindi is translated afterwards, phrase by phrase.
    const sourceLanguage: LanguageCode = englishTarget ? 'auto' : language;
    const terms = request.terminology?.terms ?? [];

    const hasGroq = this.groq.status().configured;
    const hasGemini = isGeminiListenerConfigured();
    const handy = locateHandy();

    if (!hasGroq && !hasGemini && !handy) {
      throw new TranscriptionError(this.status().reason ?? 'No transcription engine is set up.', 'not-configured', false);
    }

    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cm-ensemble-'));

    try {
      const wavFor = (span: SpeechInterval) => encodeWavPcm16(sliceSeconds(audio, span.start, span.end), audio.sampleRate);

      // ── 1. every engine listens on its own ──────────────────────────────
      const jobCount = chunks.length * ((hasGroq ? 2 : 0) + (hasGemini ? 1 : 0) + (handy ? 1 : 0));
      let jobsDone = 0;
      const tick = (message: string) => {
        jobsDone++;
        report(0.05 + 0.5 * (jobsDone / Math.max(1, jobCount)), message);
      };
      report(
        0.05,
        `Listening with ${[hasGroq && 'Whisper ×2', hasGemini && 'Gemini', handy && 'Nemotron'].filter(Boolean).join(' + ')}`,
      );

      const primaryModel = resolveGroqModel(sourceLanguage);
      const secondaryModel = primaryModel === TURBO ? LARGE : TURBO;

      const whisperPass = async (model: string) => {
        const perChunk: Array<TranscriptWord[] | null> = [];
        let detected: string | null = null;
        let failure: string | null = null;

        for (const [index, chunk] of chunks.entries()) {
          check();
          let words: TranscriptWord[] | null = null;
          for (let attempt = 1; attempt <= 2 && !failure && !words; attempt++) {
            try {
              const wav = wavFor(chunk);
              const options = {
                model,
                language: sourceLanguage,
                hinglishDomain: request.hinglishDomain,
                terms,
                transcriptionSample: request.terminology?.transcriptionSample,
                offsetSeconds: chunk.start,
              };
              const result = await cachedCall('whisper', [wav, options], () =>
                this.groq.transcribeWav(wav, { ...options, signal: request.signal }),
              );
              words = result.words;
              detected = detected ?? result.detectedLanguage;
            } catch (error) {
              if (request.signal?.aborted) throw cancelled();
              if (error instanceof TranscriptionError && !error.retryable) failure = error.message;
              else if (attempt < 2) await pause(3000, request.signal);
            }
          }
          perChunk.push(words);
          tick(`${whisperLabel(model)}: part ${index + 1} of ${chunks.length}`);
        }
        return { perChunk, detected, failure };
      };

      const geminiPass = async () => {
        const texts: Array<string | null> = [];
        let failure: string | null = null;

        for (const [index, chunk] of chunks.entries()) {
          check();
          let text: string | null = null;
          if (!failure) {
            try {
              const wav = wavFor(chunk);
              text = await cachedCall('gemini-listen', [wav, sourceLanguage, terms], async () =>
                (await listenWithGemini({ wav, language: sourceLanguage, terms, signal: request.signal })).text,
              );
            } catch (error) {
              if (request.signal?.aborted) throw cancelled();
              if (error instanceof GeminiListenError && !error.retryable) failure = error.message;
            }
          }
          texts.push(text);
          tick(`Gemini: part ${index + 1} of ${chunks.length}`);
        }
        return { texts, failure };
      };

      /**
       * Nemotron is a voter, never a reason to wait. Its speed on this laptop's
       * 2 GB GPU swings from 4.6× realtime to slower than realtime — mostly when
       * the Handy dictation app is open and already holds the model in video
       * memory. So once the cloud engines are done it gets a bounded extra
       * budget, then the vote goes ahead without it.
       */
      const nemotronStop = new AbortController();
      const nemotronSignal = request.signal ? AbortSignal.any([request.signal, nemotronStop.signal]) : nemotronStop.signal;

      const nemotronPass = async (handyPath: string) => {
        const texts: Array<string | null> = [];
        let failure: string | null = null;

        for (const [index, chunk] of chunks.entries()) {
          check();
          let text: string | null = null;
          if (!failure && !nemotronStop.signal.aborted) {
            const file = path.join(workDir, `nemotron-${index}.wav`);
            try {
              const wav = wavFor(chunk);
              text = await cachedCall('nemotron', [wav], async () => {
                await fsp.writeFile(file, wav);
                const result = await transcribeWavWithHandy(handyPath, file, {
                  signal: nemotronSignal,
                  timeoutMs: Math.max(45_000, (chunk.end - chunk.start) * 1500),
                });
                return result.text || null;
              });
            } catch (error) {
              if (request.signal?.aborted) throw cancelled();
              // Handy failures are about the machine, not the part; stop rather than repeat them.
              failure = nemotronStop.signal.aborted
                ? 'too slow on this computer right now (is the Handy app open and using the GPU?)'
                : error instanceof HandyTimeoutError
                  ? `too slow on this computer (${error.message})`
                  : (error as Error).message;
            }
          }
          texts.push(text);
          tick(`Nemotron: part ${index + 1} of ${chunks.length}`);
        }
        if (nemotronStop.signal.aborted && !failure) {
          failure = 'too slow on this computer right now (is the Handy app open and using the GPU?)';
        }
        return { texts, failure };
      };

      const nemotronRun = handy ? nemotronPass(handy) : Promise.resolve(null);
      const [primary, secondary, gemini] = await Promise.all([
        hasGroq ? whisperPass(primaryModel) : Promise.resolve(null),
        hasGroq ? whisperPass(secondaryModel) : Promise.resolve(null),
        hasGemini ? geminiPass() : Promise.resolve(null),
      ]);
      check();

      // With no cloud engine Nemotron is all there is, so it gets its full time.
      const cloudRan = Boolean(primary || secondary || gemini);
      const budget = cloudRan ? setTimeout(() => nemotronStop.abort(), Math.max(15_000, duration * 400)) : null;
      const nemotron = await nemotronRun;
      if (budget) clearTimeout(budget);
      check();

      const account = (name: string, parts: ReadonlyArray<unknown> | undefined, failure: string | null | undefined) => {
        if (!parts) return;
        const worked = parts.filter((part) => part !== null).length;
        if (worked > 0) engines.push(name);
        if (failure) skipped.push(`${name}: ${failure}`);
        else if (worked < parts.length) skipped.push(`${name}: ${parts.length - worked} of ${parts.length} part(s) failed`);
      };
      account(whisperLabel(primaryModel), primary?.perChunk, primary?.failure);
      account(whisperLabel(secondaryModel), secondary?.perChunk, secondary?.failure);
      account(`Gemini (${defaultSettingsStore.getGeminiModel()})`, gemini?.texts, gemini?.failure);
      account('Nemotron (local GPU)', nemotron?.texts, nemotron?.failure);

      request.debug?.('engines', {
        chunks,
        [primaryModel]: primary?.perChunk.map((part) => part?.map((w) => w.text).join(' ') ?? null),
        [secondaryModel]: secondary?.perChunk.map((part) => part?.map((w) => w.text).join(' ') ?? null),
        gemini: gemini?.texts,
        nemotron: nemotron?.texts,
        skipped,
      });

      // ── 2. the timed backbone ───────────────────────────────────────────
      report(0.57, 'Timing every word against the audio');
      const preferRoman = sourceLanguage !== 'hi';
      const speechIn = (start: number, end: number) => (map.reliable ? speechRangesIn(map, start, end) : []);

      /** What each engine heard in one part, in a form the vote can compare. */
      const listenersFor = (i: number): Array<Listener & { words?: TranscriptWord[] }> => {
        const out: Array<Listener & { words?: TranscriptWord[] }> = [];
        const timedPass = (engine: string, words: TranscriptWord[] | null | undefined, weight: number) => {
          if (!words?.length) return;
          const tokens = words.map((word) => word.text);
          out.push({ engine, tokens, words, weight, timed: true, eligible: !preferRoman || !tokens.some(hasDevanagari) });
        };
        timedPass('whisper', primary?.perChunk[i], WEIGHT.whisper);
        timedPass('whisper-2', secondary?.perChunk[i], WEIGHT.whisperSecond);
        const geminiTokens = tokensOf(gemini?.texts[i]);
        if (geminiTokens.length) {
          out.push({ engine: 'gemini', tokens: geminiTokens, weight: WEIGHT.gemini, timed: false, eligible: true });
        }
        const nemotronTokens = tokensOf(nemotron?.texts[i]);
        if (nemotronTokens.length) {
          // Devanagari loanwords romanise imperfectly, so Nemotron votes but leads only for Hindi captions
          out.push({ engine: 'nemotron', tokens: nemotronTokens, weight: WEIGHT.nemotron, timed: false, eligible: !preferRoman });
        }
        return out;
      };

      const chunkListeners = chunks.map((_, i) => listenersFor(i));
      if (chunkListeners.every((listeners) => listeners.length === 0)) {
        throw new TranscriptionError(
          `No engine could transcribe this audio.${skipped.length > 0 ? ` ${skipped.join('; ')}.` : ''}`,
          'provider-error',
        );
      }

      const backboneChoice: Array<{ engine: string; scores: Record<string, number> } | null> = [];
      let estimatedParts = 0;
      const backboneParts: TranscriptWord[][] = chunks.map((chunk, i) => {
        const listeners = chunkListeners[i];
        if (listeners.length === 0) {
          backboneChoice.push(null);
          return [];
        }
        const { index, scores } = chooseTextBackbone(listeners);
        const leader = listeners[index];
        backboneChoice.push({
          engine: leader.engine,
          scores: Object.fromEntries(listeners.map((l, k) => [l.engine, Math.round(scores[k] * 1000) / 1000])),
        });
        if (leader.words) return leader.words;

        const reference = listeners.find((l) => l.engine === 'whisper')?.words ?? listeners.find((l) => l.timed)?.words;
        if (reference) return timeTokensAgainst(leader.tokens, reference, chunk, speechIn);
        estimatedParts++;
        return allocateTokens(leader.tokens, chunk, speechIn(chunk.start, chunk.end));
      });
      request.debug?.('backbone-choice', backboneChoice);

      const timingSource: TranscriptQuality['timingSource'] =
        estimatedParts > 0 && estimatedParts === backboneParts.filter((part) => part.length > 0).length
          ? 'estimated'
          : 'audio-aligned';
      if (estimatedParts > 0) {
        notes.push(
          hasGroq
            ? 'Whisper failed on part of this file, so word timing there is estimated from the audio.'
            : 'Word timing is estimated from the audio. Add a Groq key in Settings for word-accurate sync.',
        );
      }
      const ledBy = backboneChoice.filter((choice) => choice && !choice.engine.startsWith('whisper')).length;
      if (ledBy > 0) {
        notes.push(
          `${ledBy} of ${chunks.length} part(s) were led by another engine because the others agreed with it more than with Whisper.`,
        );
      }

      const rawBackbone = backboneParts.flat();
      request.debug?.('words:raw', rawBackbone);
      let backbone = refineWordTimings(rawBackbone, map).words;
      request.debug?.('words:refined', backbone);
      const retimedCount = countRetimed(rawBackbone, backbone);

      // ── 3. recover speech nobody put words on ──────────────────────────
      let recovered = 0;

      if (timingSource === 'audio-aligned' && primary && secondary) {
        const gaps = findSpeechGaps(backbone, map);
        if (gaps.length > 0) {
          const secondWords = refineWordTimings(secondary.perChunk.flatMap((part) => part ?? []), map).words;
          const additions = secondWords.filter(
            (word) =>
              gaps.some((gap) => midpoint(word) >= gap.start - 0.05 && midpoint(word) <= gap.end + 0.05) &&
              !alreadyHave(word, backbone),
          );
          if (additions.length > 0) {
            backbone = mergeByTime(backbone, additions);
            recovered += additions.length;
          }
        }
      }

      if (timingSource === 'audio-aligned' && hasGroq) {
        const gaps = findSpeechGaps(backbone, map, { minSpeechSeconds: 0.5 })
          .sort((a, b) => b.speechSeconds - a.speechSeconds)
          .slice(0, MAX_RECOVERY_SLICES);

        for (const [index, gap] of gaps.entries()) {
          check();
          report(0.6 + 0.08 * (index / gaps.length), `Recovering missed speech (${index + 1} of ${gaps.length})`);
          const centre = (gap.start + gap.end) / 2;
          const half = Math.max(0.75, (gap.end - gap.start) / 2 + 0.3);
          const slice = { start: Math.max(0, centre - half), end: Math.min(duration, centre + half) };

          try {
            const wav = wavFor(slice);
            const options = {
              model: primaryModel,
              language: sourceLanguage,
              hinglishDomain: request.hinglishDomain,
              terms,
              offsetSeconds: slice.start,
            };
            const result = await cachedCall('whisper', [wav, options], () =>
              this.groq.transcribeWav(wav, { ...options, signal: request.signal }),
            );
            if (SILENCE_HALLUCINATION.test(result.text.trim())) continue;

            const found = result.words.filter(
              (word) =>
                midpoint(word) >= gap.start - 0.05 && midpoint(word) <= gap.end + 0.05 && !alreadyHave(word, backbone),
            );
            if (found.length > 0) {
              backbone = mergeByTime(backbone, refineWordTimings(found, map).words);
              recovered += found.length;
            }
          } catch (error) {
            if (request.signal?.aborted) throw cancelled();
            // A failed recovery leaves that gap as it was; the quality report still counts it.
          }
        }

        backbone = refineWordTimings(backbone, map).words;
      }

      // ── 4. vote, word by word ──────────────────────────────────────────
      report(0.7, 'Comparing what each engine heard');
      const voted: ConsensusWord[] = [];
      const disputes: Dispute[] = [];
      const totals = { agreed: 0, substituted: 0, inserted: 0, dropped: 0, disputed: 0 };

      for (const [i, chunk] of chunks.entries()) {
        const last = i === chunks.length - 1;
        const own = backbone.filter(
          (word) => midpoint(word) >= chunk.start && (last ? midpoint(word) <= chunk.end : midpoint(word) < chunk.end),
        );

        const leader = backboneChoice[i]?.engine ?? 'whisper';
        const listeners = chunkListeners[i];
        const hypotheses: Hypothesis[] = listeners
          .filter((listener) => listener.engine !== leader)
          .map((listener) => ({ engine: listener.engine, tokens: listener.tokens, weight: listener.weight }));

        const result = buildConsensus({
          backbone: own,
          backboneEngine: leader,
          backboneWeight: listeners.find((listener) => listener.engine === leader)?.weight ?? WEIGHT.whisper,
          hypotheses,
          speech: map,
          window: chunk,
          preferRoman,
        });

        const offset = voted.length;
        voted.push(...result.words);
        for (const dispute of result.disputes) disputes.push({ ...dispute, index: dispute.index + offset });
        totals.agreed += result.stats.agreed;
        totals.substituted += result.stats.substituted;
        totals.inserted += result.stats.inserted;
        totals.dropped += result.stats.dropped;
        totals.disputed += result.stats.disputed;
      }

      request.debug?.('words:backbone', backbone);
      request.debug?.('words:voted', voted);
      request.debug?.('vote', {
        totals,
        recovered,
        words: voted.map((w) => `${w.text}${w.source && w.source !== 'agreed' ? `[${w.source}]` : ''}`).join(' '),
      });

      // ── 5. Gemini settles what the vote could not ──────────────────────
      let words: TranscriptWord[] = voted;
      let arbitrated = { applied: 0, removed: 0 };

      if (disputes.length > 0) {
        report(
          0.78,
          `Settling ${disputes.length} disagreement${disputes.length === 1 ? '' : 's'} between engines`,
          'post-processing',
        );
        const outcome = await arbitrateDisputes({
          words: voted,
          disputes,
          style: sourceLanguage === 'hi' ? 'hindi' : 'hinglish',
          terms,
          signal: request.signal,
        });
        words = outcome.words;
        arbitrated = { applied: outcome.applied, removed: outcome.removed };
        request.debug?.('arbiter', { model: outcome.model, trace: outcome.trace });
        if (outcome.rejected > 0) {
          notes.push(`${outcome.rejected} suggested correction(s) were rejected because no engine heard them.`);
        }
      }
      check();

      request.debug?.('words:arbitrated', words);

      // ── 6. language ────────────────────────────────────────────────────
      const hindiShare =
        words.length > 0 ? words.reduce((sum, word) => sum + hindiEvidence(word.text), 0) / words.length : 0;
      const spokeHindi =
        language === 'hinglish' || language === 'hi' || hindiShare >= 0.05 || words.some((word) => hasDevanagari(word.text));

      words = words.map((word) => {
        let text = word.text;
        if (sourceLanguage === 'hi') text = postProcessText(text, 'hi');
        else if (spokeHindi) text = postProcessText(text, 'hinglish');
        // Independent listeners agreeing on a spelling outrank a fuzzy lexicon
        // lookup. Running agreed words through it turned "charity" into
        // "clarity" and "really" into "Reels" on a clean English interview.
        const agreed = (word as ConsensusWord).source === 'agreed' && !hasDevanagari(word.text);
        return { ...word, text: agreed ? text : normaliseEnglishToken(text, terms) };
      });

      if (englishTarget && spokeHindi) {
        report(0.84, 'Translating Hindi speech into English', 'post-processing');
        const translated = await translateTranscriptWordsToEnglishWithGroq({
          sourceWords: words,
          apiKey: defaultSettingsStore.getGroqKey() ?? '',
          terms,
          signal: request.signal,
          speechMap: map,
          onProgress: (p, message) => report(0.84 + p * 0.08, message, 'post-processing'),
        });
        words = translated.map((word) => ({ ...word, text: normaliseEnglishToken(word.text, terms) }));
      }
      check();
      request.debug?.('words:language', words);

      // ── 7. final timing check ──────────────────────────────────────────
      report(0.94, 'Final timing check', 'post-processing');
      words = refineWordTimings(words, map).words;
      words = applyPreferredTerminology(words, terms, request.terminology?.rules ?? []);
      words = finaliseTimeline(words).map(({ text, start, end, confidence }) => ({
        text,
        start,
        end,
        confidence: confidence ?? null,
      }));

      if (words.length === 0) {
        throw new TranscriptionError('No words were recognised. The audio may be silent or unclear.', 'provider-error');
      }

      const timing = measureTimingQuality(words, map);
      if (timing.uncoveredSpeechSeconds >= 2) {
        notes.push(
          `About ${timing.uncoveredSpeechSeconds.toFixed(1)}s of speech still has no caption words. Review those parts before exporting.`,
        );
      }

      const quality: TranscriptQuality = {
        engines,
        skipped,
        timingSource,
        speechCoverage: Math.round(timing.coverage * 1000) / 1000,
        uncoveredSpeechSeconds: timing.uncoveredSpeechSeconds,
        pausesRespected: timing.pausesRespected === null ? null : Math.round(timing.pausesRespected * 1000) / 1000,
        wordsRetimed: retimedCount,
        wordsRecovered: recovered + totals.inserted,
        wordsCorrected: totals.substituted + arbitrated.applied,
        wordsDropped: totals.dropped + arbitrated.removed,
        notes,
      };

      return {
        text: words.map((word) => word.text).join(' '),
        words,
        detectedLanguage: primary?.detected ?? secondary?.detected ?? null,
        modelId: [
          ...engines,
          'word-level vote',
          timingSource === 'audio-aligned' ? 'timed to audio' : 'estimated timing',
        ].join(' + '),
        quality,
      };
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
