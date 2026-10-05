import { useSyncExternalStore } from 'react';
import { readString, writeString } from './prefs';

export type Theme = 'dark' | 'light';

const KEY = 'caption-maker:theme';
const listeners = new Set<() => void>();

const stored = readString(KEY);
let current: Theme = stored === 'light' ? 'light' : 'dark';

/**
 * Puts the theme on <html> so every token in shell.css (and the older panel
 * styles that read the same tokens) switches in one go.
 */
const apply = (theme: Theme) => {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? '#0c0a09' : '#f5f5f4');
};

// applied as soon as the shell is imported, so the first paint is already right
apply(current);

export const getTheme = (): Theme => current;

export const setTheme = (theme: Theme): void => {
  if (theme === current) return;
  current = theme;
  apply(theme);
  writeString(KEY, theme);
  listeners.forEach((fn) => fn());
};

export const toggleTheme = (): void => setTheme(current === 'dark' ? 'light' : 'dark');

export const useTheme = (): Theme =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getTheme,
    getTheme,
  );
