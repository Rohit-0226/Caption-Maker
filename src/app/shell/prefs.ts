/**
 * Tiny localStorage helpers for per-browser preferences (theme, panel sizes).
 *
 * Storage can be blocked (private windows, locked-down browsers on a LAN
 * machine), so every read falls back to a default and every write is allowed
 * to fail quietly: a forgotten preference costs nothing, a crash costs the edit.
 */

export const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const writeJson = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked
  }
};

export const readString = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const writeString = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage full or blocked
  }
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
