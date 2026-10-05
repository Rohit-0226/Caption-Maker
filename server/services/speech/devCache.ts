import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Replays engine answers from disk while tuning the pipeline.
 *
 * Only active when CM_ENGINE_CACHE_DIR is set, which the app never sets. With
 * it, each engine call is keyed by its exact input and answered from disk on
 * the next run, so a change to the vote or the timing can be measured on the
 * same engine output — without spending API quota, and without Gemini's or
 * Whisper's run-to-run variation hiding whether the change helped.
 */
export const cachedCall = async <T>(namespace: string, key: unknown, compute: () => Promise<T>): Promise<T> => {
  const dir = process.env.CM_ENGINE_CACHE_DIR?.trim();
  if (!dir) return compute();

  const hash = createHash('sha256');
  const feed = (value: unknown) => {
    if (value instanceof Uint8Array) hash.update(value);
    else hash.update(JSON.stringify(value) ?? 'undefined');
  };
  if (Array.isArray(key)) key.forEach(feed);
  else feed(key);

  const file = path.join(dir, `${namespace}-${hash.digest('hex').slice(0, 24)}.json`);
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T;
  } catch {
    // not cached yet
  }

  const value = await compute();
  // a failed call answers null; replaying it would hide that the next run might succeed
  if (value === null || value === undefined) return value;
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(file, JSON.stringify(value));
  return value;
};
