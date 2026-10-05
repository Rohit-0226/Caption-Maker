import { useCallback, useEffect, useState } from 'react';

/**
 * Small, local-only preferences: favourites, recently used items, remembered
 * colours. Never part of a project file — these follow the person, not the
 * video, and losing them costs nothing.
 */

type Bucket = 'styles' | 'motions' | 'fonts' | 'colors' | 'exportPreset';

const KEY = (bucket: Bucket, kind: 'fav' | 'recent') => `caption-maker:${kind}:${bucket}`;

const read = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    // private mode, cleared storage, or a corrupt value — start empty
    return [];
  }
};

const write = (key: string, values: string[]) => {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // storage full or blocked; preferences are a nicety, not a requirement
  }
};

/** Cross-component sync so two galleries never disagree about a star. */
const listeners = new Map<string, Set<(values: string[]) => void>>();

const broadcast = (key: string, values: string[]) => {
  write(key, values);
  listeners.get(key)?.forEach((fn) => fn(values));
};

const useStoredList = (key: string): [string[], (values: string[]) => void] => {
  const [values, setValues] = useState<string[]>(() => read(key));

  useEffect(() => {
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(setValues);
    setValues(read(key));
    return () => {
      set?.delete(setValues);
    };
  }, [key]);

  const update = useCallback((next: string[]) => broadcast(key, next), [key]);

  return [values, update];
};

export const useFavourites = (bucket: Bucket): [string[], (id: string) => void] => {
  const [values, set] = useStoredList(KEY(bucket, 'fav'));

  const toggle = useCallback(
    (id: string) => {
      set(values.includes(id) ? values.filter((v) => v !== id) : [id, ...values]);
    },
    [values, set],
  );

  return [values, toggle];
};

export const useRecents = (
  bucket: Bucket,
  limit = 12,
): [string[], (id: string) => void] => {
  const [values, set] = useStoredList(KEY(bucket, 'recent'));

  const push = useCallback(
    (id: string) => {
      set([id, ...values.filter((v) => v !== id)].slice(0, limit));
    },
    [values, set, limit],
  );

  return [values, push];
};
