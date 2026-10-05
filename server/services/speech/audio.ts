import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import { ffmpegPath } from '../ffmpeg';
import { parseWavPcm16, type PcmAudio } from '../../../src/core/speech/pcm';

const TARGET_RATE = 16000;

/**
 * Loads audio as 16 kHz mono samples.
 *
 * The WAV the server extracts is already in that format and is read directly;
 * anything else goes through ffmpeg once.
 */
export const loadPcm16Mono = async (filePath: string, signal?: AbortSignal): Promise<PcmAudio> => {
  const bytes = await fsp.readFile(filePath);
  const parsed = parseWavPcm16(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (parsed && parsed.sampleRate === TARGET_RATE) return parsed;
  return decodeWithFfmpeg(filePath, signal);
};

const decodeWithFfmpeg = (filePath: string, signal?: AbortSignal): Promise<PcmAudio> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath(),
      ['-v', 'error', '-i', filePath, '-vn', '-ac', '1', '-ar', String(TARGET_RATE), '-f', 's16le', '-acodec', 'pcm_s16le', '-'],
      { signal, windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg could not decode the audio: ${stderr.slice(-300)}`));
        return;
      }
      const buffer = Buffer.concat(chunks);
      const samples = new Int16Array(Math.floor(buffer.length / 2));
      for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2);
      resolve({ samples, sampleRate: TARGET_RATE });
    });
  });
