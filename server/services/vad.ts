import { spawn } from 'node:child_process';
import { ffmpegPath } from './ffmpeg';
import type { TranscriptWord } from '../../src/core/types/project';

export interface SpeechInterval {
  start: number;
  end: number;
  duration: number;
}

export interface SpeechGap {
  start: number;
  end: number;
  duration: number;
}

export interface CoverageReport {
  totalDuration: number;
  speechDuration: number;
  coveredDuration: number;
  coverageRatio: number;
  missingGaps: SpeechGap[];
}

/**
 * Parses FFmpeg silencedetect stderr output and computes speech intervals.
 */
export const parseSilencedetectOutput = (
  stderr: string,
  totalDuration: number,
): SpeechInterval[] => {
  const silences: Array<{ start: number; end: number }> = [];
  let currentStart: number | null = null;

  const lines = stderr.split('\n');
  for (const line of lines) {
    if (line.includes('silence_start:')) {
      const match = /silence_start:\s*([\d.]+)/.exec(line);
      if (match) {
        currentStart = parseFloat(match[1]);
      }
    }
    if (line.includes('silence_end:')) {
      const match = /silence_end:\s*([\d.]+)/.exec(line);
      if (match && currentStart !== null) {
        const end = parseFloat(match[1]);
        if (end > currentStart) {
          silences.push({ start: currentStart, end });
        }
        currentStart = null;
      }
    }
  }

  if (currentStart !== null && currentStart < totalDuration) {
    silences.push({ start: currentStart, end: totalDuration });
  }

  // Sort silences chronologically
  silences.sort((a, b) => a.start - b.start);

  // Invert silences to compute speech intervals
  const speechIntervals: SpeechInterval[] = [];
  let pointer = 0;

  for (const s of silences) {
    if (s.start > pointer + 0.15) {
      const start = Math.max(0, Math.round(pointer * 1000) / 1000);
      const end = Math.min(totalDuration, Math.round(s.start * 1000) / 1000);
      if (end - start >= 0.2) {
        speechIntervals.push({
          start,
          end,
          duration: Math.round((end - start) * 1000) / 1000,
        });
      }
    }
    pointer = Math.max(pointer, s.end);
  }

  if (pointer + 0.15 < totalDuration) {
    const start = Math.max(0, Math.round(pointer * 1000) / 1000);
    const end = Math.round(totalDuration * 1000) / 1000;
    if (end - start >= 0.2) {
      speechIntervals.push({
        start,
        end,
        duration: Math.round((end - start) * 1000) / 1000,
      });
    }
  }

  return speechIntervals;
};

/**
 * Runs FFmpeg silencedetect to identify exact speech intervals in an audio file.
 */
export const detectSpeechIntervals = async (
  audioPath: string,
  totalDuration: number,
  signal?: AbortSignal,
  noiseThresholdDb = -32,
  minSilenceDurationSec = 0.3,
): Promise<SpeechInterval[]> => {
  return new Promise((resolve) => {
    const child = spawn(
      ffmpegPath(),
      [
        '-y',
        '-i', audioPath,
        '-af', `silencedetect=noise=${noiseThresholdDb}dB:d=${minSilenceDurationSec}`,
        '-f', 'null',
        '-',
      ],
      { signal },
    );

    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });

    child.on('error', () => {
      // Fallback: entire file considered single speech interval if VAD fails
      resolve([{ start: 0, end: totalDuration, duration: totalDuration }]);
    });

    child.on('close', (code) => {
      if (code !== 0 && !stderr.includes('silence_')) {
        resolve([{ start: 0, end: totalDuration, duration: totalDuration }]);
        return;
      }
      const intervals = parseSilencedetectOutput(stderr, totalDuration);
      if (intervals.length === 0 && totalDuration > 0) {
        // If no silence was detected at all, the entire audio has acoustic energy
        resolve([{ start: 0, end: totalDuration, duration: totalDuration }]);
        return;
      }
      resolve(intervals);
    });
  });
};

/**
 * Compares transcribed words against VAD speech intervals to find missing speech gaps.
 */
export const analyzeSpeechCoverage = (
  words: TranscriptWord[],
  speechIntervals: SpeechInterval[],
  totalDuration: number,
  gapToleranceSec = 1.0,
): CoverageReport => {
  const sortedWords = [...words]
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end))
    .sort((a, b) => a.start - b.start);

  const missingGaps: SpeechGap[] = [];
  let speechDuration = 0;
  let coveredDuration = 0;

  for (const interval of speechIntervals) {
    speechDuration += interval.duration;

    // Words falling inside or overlapping this speech interval
    const intervalWords = sortedWords.filter(
      (w) => w.end >= interval.start - 0.25 && w.start <= interval.end + 0.25,
    );

    if (intervalWords.length === 0) {
      if (interval.duration >= gapToleranceSec) {
        missingGaps.push({
          start: interval.start,
          end: interval.end,
          duration: interval.duration,
        });
      }
      continue;
    }

    // Check opening gap inside interval
    const firstWord = intervalWords[0];
    if (firstWord.start - interval.start >= gapToleranceSec) {
      missingGaps.push({
        start: interval.start,
        end: firstWord.start,
        duration: Math.round((firstWord.start - interval.start) * 1000) / 1000,
      });
    }

    // Check internal gaps between words inside interval
    for (let i = 0; i < intervalWords.length - 1; i++) {
      const cur = intervalWords[i];
      const next = intervalWords[i + 1];
      const gap = next.start - cur.end;
      if (gap >= gapToleranceSec) {
        missingGaps.push({
          start: Math.round(cur.end * 1000) / 1000,
          end: Math.round(next.start * 1000) / 1000,
          duration: Math.round(gap * 1000) / 1000,
        });
      }
    }

    // Check closing gap inside interval
    const lastWord = intervalWords[intervalWords.length - 1];
    if (interval.end - lastWord.end >= gapToleranceSec) {
      missingGaps.push({
        start: Math.round(lastWord.end * 1000) / 1000,
        end: interval.end,
        duration: Math.round((interval.end - lastWord.end) * 1000) / 1000,
      });
    }

    // Calculate covered portion
    const span = Math.min(interval.end, lastWord.end) - Math.max(interval.start, firstWord.start);
    if (span > 0) {
      coveredDuration += span;
    }
  }

  const coverageRatio = speechDuration > 0 ? Math.min(1, coveredDuration / speechDuration) : 1;

  return {
    totalDuration,
    speechDuration: Math.round(speechDuration * 1000) / 1000,
    coveredDuration: Math.round(coveredDuration * 1000) / 1000,
    coverageRatio: Math.round(coverageRatio * 1000) / 1000,
    missingGaps,
  };
};

/**
 * Sanitizes word timestamps:
 * - Enforces monotonic progression
 * - Clamps abnormally long tokens (> 2.5s) to avoid frozen captions
 * - Ensures start >= 0 and end > start
 */
export const sanitizeWordTimestamps = (
  words: TranscriptWord[],
  maxSingleWordDuration = 2.5,
): TranscriptWord[] => {
  if (words.length === 0) return [];

  const sanitized: TranscriptWord[] = [];
  let prevEnd = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let start = Math.max(0, Number.isFinite(w.start) ? w.start : prevEnd);
    let end = Number.isFinite(w.end) ? w.end : start + 0.3;

    // Monotonic constraint
    if (start < prevEnd) {
      start = prevEnd;
    }
    if (end <= start) {
      end = start + 0.05;
    }

    // Outlier clamp for stuck tokens
    if (end - start > maxSingleWordDuration) {
      end = start + maxSingleWordDuration;
    }

    sanitized.push({
      ...w,
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
    });

    prevEnd = end;
  }

  return sanitized;
};
