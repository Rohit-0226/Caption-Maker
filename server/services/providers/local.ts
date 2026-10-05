import { spawn } from 'node:child_process';
import { ffmpegPath } from '../ffmpeg';
import {
  TranscriptionError,
  type ProviderStatus,
  type TranscriptionProvider,
  type TranscriptionRequest,
  type TranscriptionResult,
} from '../../../src/core/transcription/types';
import { LANGUAGES, postProcessText } from '../../../src/core/transcription/languages';
import type { LanguageCode, TranscriptWord } from '../../../src/core/types/project';
import { applyPreferredTerminology } from '../terminology';

/**
 * Offline Whisper through Transformers.js.
 *
 * Runs on the CPU with no API key, which makes it the dependable fallback, but
 * it is roughly 3-4x slower than realtime on a typical laptop and the small
 * model it can afford to load is noticeably weaker on code-switched speech.
 * Hinglish is therefore marked unsupported here rather than quietly returning
 * a bad transcript.
 */
export class LocalWhisperProvider implements TranscriptionProvider {
  readonly id = 'local';
  readonly label = 'Local Whisper (offline)';
  readonly description =
    'Runs on this machine, no API key and no cost. Good for English. Slower than realtime, and not recommended for Hinglish.';
  readonly requiresApiKey = false;
  readonly supportedLanguages: LanguageCode[] = ['auto', 'en', 'en-IN', 'hi'];

  private pipelinePromise: Promise<unknown> | null = null;

  status(): ProviderStatus {
    return { configured: true, reason: null };
  }

  private decode(file: string, signal?: AbortSignal): Promise<Float32Array> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const child = spawn(
        ffmpegPath(),
        ['-i', file, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', '16000', '-'],
        { signal },
      );
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.stderr.on('data', () => {});
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error('ffmpeg could not decode the audio'));
        const buf = Buffer.concat(chunks);
        const usable = buf.length - (buf.length % 4);
        resolve(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable)));
      });
    });
  }

  private async getPipeline(onProgress?: TranscriptionRequest['onProgress']) {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        const { pipeline } = await import('@huggingface/transformers');
        return pipeline(
          'automatic-speech-recognition',
          'onnx-community/whisper-base_timestamped',
          {
            dtype: 'q8',
            progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
              if (p.status === 'progress' && typeof p.progress === 'number') {
                onProgress?.({
                  phase: 'loading-model',
                  progress: p.progress / 100,
                  message: `Downloading the speech model (${Math.round(p.progress)}%)`,
                });
              }
            },
          },
        );
      })();
    }
    return this.pipelinePromise;
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const config = LANGUAGES[request.language];

    if (!this.supportedLanguages.includes(request.language)) {
      throw new TranscriptionError(
        `The offline model does not handle ${config.label} well enough to be useful. Switch to Groq for this language.`,
        'unsupported',
        false,
      );
    }

    request.onProgress?.({
      phase: 'loading-model',
      progress: null,
      message: 'Loading the offline speech model',
    });

    const asr = (await this.getPipeline(request.onProgress)) as (
      audio: Float32Array,
      options: Record<string, unknown>,
    ) => Promise<{
      text: string;
      chunks?: { text: string; timestamp: [number, number | null] }[];
    }>;

    request.onProgress?.({
      phase: 'transcribing',
      progress: null,
      message: 'Transcribing on this machine — this takes a few minutes',
    });

    const audio = await this.decode(request.audioPath, request.signal);
    if (audio.length === 0) {
      throw new TranscriptionError('That file contains no audio.', 'no-audio', false);
    }

    const output = await asr(audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      language: config.whisperLanguage ?? undefined,
      task: request.language === 'en' ? 'translate' : 'transcribe',
    });

    const words: TranscriptWord[] = [];
    for (const chunk of output.chunks ?? []) {
      const text = chunk.text?.trim();
      if (!text) continue;
      const [start, end] = chunk.timestamp;
      if (typeof start !== 'number') continue;
      words.push({
        text: postProcessText(text, request.language),
        start,
        end: typeof end === 'number' && end > start ? end : start + 0.2,
        confidence: null,
      });
    }

    if (words.length === 0) {
      throw new TranscriptionError(
        'The offline model produced no words. The audio may be silent.',
        'provider-error',
      );
    }

    const processedWords = applyPreferredTerminology(
      words,
      request.terminology?.terms ?? [],
      request.terminology?.rules ?? [],
    );

    return {
      text:
        request.terminology?.terms.length
          ? processedWords.map((word) => word.text).join(' ')
          : postProcessText(output.text.trim(), request.language),
      words: processedWords,
      detectedLanguage: config.whisperLanguage,
      modelId: 'whisper-base_timestamped',
    };
  }
}
