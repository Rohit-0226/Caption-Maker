import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ffmpegPath } from './ffmpeg';
import type { MediaInfo } from '../../src/core/types/project';

/**
 * One still frame per project for the Projects page cards.
 *
 * The frame is cut once with FFmpeg and cached beside the project as
 * `thumbnail.jpg`. A small key file records which media it came from, so
 * replacing the video makes a fresh one instead of showing the old picture.
 */

const THUMB_FILE = 'thumbnail.jpg';
const KEY_FILE = 'thumbnail.json';
/** Wide enough for a 2x card on a laptop screen, small enough to load instantly. */
const THUMB_WIDTH = 480;
const MAX_PARALLEL = 2;
const TIMEOUT_MS = 20_000;

/** The same project asked for twice while its frame is being cut shares one job. */
const inFlight = new Map<string, Promise<string>>();

/**
 * Opening the Projects page asks for every card at once. Cutting thirty frames
 * in parallel would make the machine stutter for everyone on the LAN, so frames
 * are cut a couple at a time.
 */
let running = 0;
const waiting: Array<() => void> = [];

const withSlot = async <T>(work: () => Promise<T>): Promise<T> => {
  if (running >= MAX_PARALLEL) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
};

const keyFor = (media: MediaInfo) => `${media.path}|${media.size}|${media.importedAt}`;

const cutFrame = (source: string, seconds: number, destination: string): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(
      ffmpegPath(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        // seeking before the input is fast: it jumps to the nearest keyframe
        '-ss',
        seconds.toFixed(2),
        '-i',
        source,
        '-frames:v',
        '1',
        '-vf',
        `scale=${THUMB_WIDTH}:-2`,
        '-q:v',
        '4',
        '-y',
        destination,
      ],
      { timeout: TIMEOUT_MS, windowsHide: true },
      (error, _stdout, stderr) => {
        if (error) reject(new Error(`Could not cut a thumbnail: ${String(stderr || error.message).slice(-400)}`));
        else resolve();
      },
    );
  });

/**
 * Returns the path of a JPEG still for the project's video, cutting it first if
 * the cached one is missing or belongs to older media. Throws for audio-only
 * projects; the caller answers those with a 404 and the card shows a placeholder.
 */
export const ensureThumbnail = async (projectDir: string, media: MediaInfo): Promise<string> => {
  if (media.kind !== 'video') throw new Error('Audio-only projects have no picture.');

  const thumbPath = path.join(projectDir, THUMB_FILE);
  const keyPath = path.join(projectDir, KEY_FILE);
  const key = keyFor(media);

  if (fs.existsSync(thumbPath)) {
    try {
      const cached = JSON.parse(await fsp.readFile(keyPath, 'utf8')) as { key?: string };
      if (cached.key === key) return thumbPath;
    } catch {
      // no or unreadable key file: cut a fresh frame below
    }
  }

  const pending = inFlight.get(thumbPath);
  if (pending) return pending;

  const job = withSlot(async () => {
    // a little way in, past black fades and slates, but never past the end
    const seconds = Math.max(0, Math.min(media.duration * 0.2, 2, Math.max(0, media.duration - 0.1)));
    const temp = `${thumbPath}.tmp.jpg`;
    try {
      await cutFrame(media.path, seconds, temp);
      if (!fs.existsSync(temp)) {
        // a seek past the last keyframe can yield nothing; the first frame always exists
        await cutFrame(media.path, 0, temp);
      }
      await fsp.rename(temp, thumbPath);
      await fsp.writeFile(keyPath, JSON.stringify({ key }), 'utf8');
      return thumbPath;
    } finally {
      await fsp.rm(temp, { force: true }).catch(() => undefined);
    }
  }).finally(() => inFlight.delete(thumbPath));

  inFlight.set(thumbPath, job);
  return job;
};
