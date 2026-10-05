import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  TranscriptionError,
  type ProviderStatus,
  type TranscriptionProvider,
  type TranscriptionRequest,
  type TranscriptionResult,
} from '../../../src/core/transcription/types';
import { hasDevanagari, LANGUAGES, postProcessText } from '../../../src/core/transcription/languages';
import { normaliseEnglishToken } from '../../../src/core/transcription/englishLexicon';
import type { LanguageCode, TranscriptWord } from '../../../src/core/types/project';
import { durationOf, encodeWavPcm16, sliceSeconds } from '../../../src/core/speech/pcm';
import { buildSpeechMap, speechRangesIn } from '../../../src/core/speech/speechMap';
import { allocateTokens, finaliseTimeline, measureTimingQuality } from '../../../src/core/speech/timing';
import { planChunks } from '../../../src/core/speech/chunks';
import { applyPreferredTerminology } from '../terminology';
import { loadPcm16Mono } from '../speech/audio';
import { defaultSettingsStore } from '../configStore';
import { translateTranscriptWordsToEnglishWithGroq } from './englishTranslation';

export const locateHandy = (): string | null => {
  const explicit = process.env.HANDY_PATH?.trim();
  const candidates = [
    ...(explicit ? [explicit] : []),
    'E:\\Handy\\handy.exe',
    'C:\\Program Files\\Handy\\handy.exe',
    path.join(os.homedir(), 'AppData/Local/Programs/Handy/handy.exe'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // an unreadable location is simply not the one
    }
  }
  return null;
};

export interface HandyTranscript {
  text: string;
  model: string | null;
  elapsedMs: number;
}

export class HandyTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HandyTimeoutError';
  }
}

/**
 * Runs Handy's headless transcription on one 16 kHz mono WAV.
 *
 * Handy returns text only — no word timestamps — which is why Nemotron is a
 * voter in the hybrid pipeline rather than a source of timing. Measured on the
 * MX250 here: 4.3–4.7× realtime on Hindi, 1.3× on English.
 */
export const transcribeWavWithHandy = (
  handyPath: string,
  wavPath: string,
  { signal, timeoutMs = 120_000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<HandyTranscript> =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(handyPath, ['-f', wavPath, '--json'], { signal, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new HandyTimeoutError(`Nemotron took longer than ${Math.round(timeoutMs / 1000)}s`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Handy exited with code ${code}: ${(stderr || stdout).slice(-300)}`));
        return;
      }

      // Handy logs to stdout before its result; the result is the last line holding a JSON object.
      const line = stdout
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .reverse()
        .find((entry) => entry.startsWith('{') && entry.endsWith('}'));

      if (!line) {
        reject(new Error('Handy finished without a transcript.'));
        return;
      }

      try {
        const parsed = JSON.parse(line) as { text?: string; model?: string; error?: string };
        if (parsed.error) {
          reject(new Error(`Handy: ${parsed.error}`));
          return;
        }
        resolve({ text: (parsed.text ?? '').trim(), model: parsed.model ?? null, elapsedMs: Date.now() - started });
      } catch (error) {
        reject(new Error(`Could not read Handy's result: ${(error as Error).message}`));
      }
    });
  });

/** Parts this short keep estimated word times close to where they were said. */
const STANDALONE_CHUNK_SECONDS = 20;

/**
 * Local Nemotron on its own.
 *
 * Because Handy gives no word timestamps, words are laid across the speech in
 * each short part of the audio. That keeps them out of pauses, but it is an
 * estimate; the hybrid engine is the one to use when sync matters.
 */
export class NemotronASRProvider implements TranscriptionProvider {
  readonly id = 'nemotron';
  readonly label = 'Local Nemotron (GPU)';
  readonly description =
    'On-device Nemotron through Handy: offline, no tokens. It gives text only, so word timing is estimated from the audio — use the Hybrid engine for exact sync.';
  readonly requiresApiKey = false;
  readonly supportedLanguages: LanguageCode[] = ['auto', 'en', 'en-IN', 'hi', 'hinglish'];

  status(): ProviderStatus {
    if (!locateHandy()) {
      return {
        configured: false,
        reason: 'Handy (the local Nemotron engine) was not found at E:\\Handy\\handy.exe. Install Handy, or set HANDY_PATH.',
      };
    }
    return { configured: true, reason: null };
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const handy = locateHandy();
    if (!handy) {
      throw new TranscriptionError(this.status().reason ?? 'Handy was not found.', 'not-configured', false);
    }
    if (!this.supportedLanguages.includes(request.language)) {
      throw new TranscriptionError(
        `Nemotron does not support ${LANGUAGES[request.language].label}.`,
        'unsupported',
        false,
      );
    }

    const audio = await loadPcm16Mono(request.audioPath, request.signal);
    if (durationOf(audio) <= 0) {
      throw new TranscriptionError('That file contains no audio.', 'no-audio', false);
    }

    const map = buildSpeechMap(audio.samples, audio.sampleRate);
    const chunks = planChunks(map, STANDALONE_CHUNK_SECONDS, 8);
    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cm-nemotron-'));
    const words: TranscriptWord[] = [];

    try {
      for (const [index, chunk] of chunks.entries()) {
        if (request.signal?.aborted) throw new TranscriptionError('Cancelled', 'cancelled', false);

        request.onProgress?.({
          phase: 'transcribing',
          progress: index / chunks.length,
          message: `Transcribing part ${index + 1} of ${chunks.length} with local Nemotron`,
        });

        const speech = speechRangesIn(map, chunk.start, chunk.end);
        if (map.reliable && speech.length === 0) continue;

        const file = path.join(workDir, `part-${index}.wav`);
        await fsp.writeFile(file, encodeWavPcm16(sliceSeconds(audio, chunk.start, chunk.end), audio.sampleRate));
        const result = await transcribeWavWithHandy(handy, file, {
          signal: request.signal,
          timeoutMs: Math.max(60_000, (chunk.end - chunk.start) * 4000),
        });

        const tokens = result.text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token));
        words.push(...allocateTokens(tokens, chunk, speech));
      }
    } catch (error) {
      if (request.signal?.aborted) throw new TranscriptionError('Cancelled', 'cancelled', false);
      if (error instanceof TranscriptionError) throw error;
      throw new TranscriptionError(`Local Nemotron failed: ${(error as Error).message}`, 'provider-error');
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }

    if (words.length === 0) {
      throw new TranscriptionError('Nemotron heard no words. The audio may be silent or unclear.', 'provider-error');
    }

    const terms = request.terminology?.terms ?? [];
    let processed: TranscriptWord[] = words.map((word) => {
      let text = word.text;
      if (request.language === 'hi') text = postProcessText(text, 'hi');
      else if (request.language === 'hinglish' || hasDevanagari(text)) text = postProcessText(text, 'hinglish');
      return { ...word, text: normaliseEnglishToken(text, terms) };
    });

    if (request.language === 'en' || request.language === 'en-IN') {
      processed = await translateTranscriptWordsToEnglishWithGroq({
        sourceWords: processed,
        apiKey: defaultSettingsStore.getGroqKey() ?? '',
        terms,
        signal: request.signal,
        speechMap: map,
      });
    }

    processed = finaliseTimeline(applyPreferredTerminology(processed, terms, request.terminology?.rules ?? []));
    const timing = measureTimingQuality(processed, map);

    return {
      text: processed.map((word) => word.text).join(' '),
      words: processed,
      detectedLanguage: LANGUAGES[request.language].whisperLanguage,
      modelId: 'nemotron-3.5-asr (local) + estimated timing',
      quality: {
        engines: ['Nemotron (local GPU)'],
        skipped: [],
        timingSource: 'estimated',
        speechCoverage: Math.round(timing.coverage * 1000) / 1000,
        uncoveredSpeechSeconds: timing.uncoveredSpeechSeconds,
        pausesRespected: timing.pausesRespected,
        wordsRetimed: 0,
        wordsRecovered: 0,
        wordsCorrected: 0,
        wordsDropped: 0,
        notes: ['Nemotron gives text only, so word timing is estimated from the audio.'],
      },
    };
  }
}
