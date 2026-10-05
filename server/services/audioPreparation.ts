import { spawn } from 'node:child_process';
import path from 'node:path';
import { ffmpegPath } from './ffmpeg';

export interface AudioPrepOptions {
  signal?: AbortSignal;
  loudnorm?: boolean;
}

/**
 * Prepares an optimized audio file for ASR engines:
 * - 16kHz sample rate (Whisper & Nemotron native)
 * - 1 channel (mono)
 * - 16-bit signed PCM WAV
 * - Speech-band bandpass filter (80Hz - 7500Hz)
 * - EBU R128 loudness normalization (-16 LUFS) to bring quiet words above silence gate
 */
export const prepareOptimizedAudio = async (
  inputPath: string,
  outPath: string,
  options: AudioPrepOptions = {},
): Promise<string> => {
  const { signal, loudnorm = true } = options;

  const audioFilter = loudnorm
    ? 'highpass=f=80,lowpass=f=7500,loudnorm=I=-16:TP=-1.5:LRA=11'
    : 'highpass=f=80,lowpass=f=7500';

  const filterArgs = [
    '-y',
    '-i', inputPath,
    '-vn',
    '-af', audioFilter,
    '-ac', '1',
    '-ar', '16000',
    '-acodec', 'pcm_s16le',
    outPath,
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), filterArgs, { signal });
    let stderr = '';

    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(outPath);
      } else {
        // Fallback without complex audio filter
        const fallback = spawn(
          ffmpegPath(),
          [
            '-y',
            '-i', inputPath,
            '-vn',
            '-ac', '1',
            '-ar', '16000',
            '-acodec', 'pcm_s16le',
            outPath,
          ],
          { signal },
        );

        fallback.on('close', (fallbackCode) => {
          if (fallbackCode === 0) {
            resolve(outPath);
          } else {
            reject(new Error(`Audio preparation failed (code ${code}): ${stderr.slice(-600)}`));
          }
        });
        fallback.on('error', reject);
      }
    });
  });
};
