import { useCallback, useEffect, useState } from 'react';
import type {
  AnimationSettings,
  CaptionPosition,
  CaptionProject,
  CaptionStyle,
  SegmentationSettings,
} from '../core/types/project';

const KEY = 'caption-maker:my-presets';

export interface MyPreset {
  id: string;
  name: string;
  createdAt: string;
  style: CaptionStyle;
  animation: AnimationSettings;
  position: CaptionPosition;
  segmentation: SegmentationSettings;
}

/**
 * Presets the user saved themselves.
 *
 * Local to this machine and deliberately not part of any project file — a
 * preset follows the person across projects, and losing one costs nothing.
 */
const read = (): MyPreset[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MyPreset[]) : [];
  } catch {
    return [];
  }
};

const write = (presets: MyPreset[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets));
  } catch {
    // storage blocked or full; presets are a convenience, not a requirement
  }
};

const listeners = new Set<(presets: MyPreset[]) => void>();

const broadcast = (presets: MyPreset[]) => {
  write(presets);
  listeners.forEach((fn) => fn(presets));
};

export const capturePreset = (name: string, project: CaptionProject): MyPreset => ({
  id: `preset_${Date.now().toString(36)}`,
  name: name.trim() || 'Untitled preset',
  createdAt: new Date().toISOString(),
  style: { ...project.style },
  animation: { ...project.animation },
  position: { ...project.position },
  segmentation: { ...project.segmentation },
});

export const useMyPresets = () => {
  const [presets, setPresets] = useState<MyPreset[]>(read);

  useEffect(() => {
    listeners.add(setPresets);
    setPresets(read());
    return () => {
      listeners.delete(setPresets);
    };
  }, []);

  const save = useCallback((preset: MyPreset) => {
    broadcast([preset, ...read().filter((p) => p.id !== preset.id)].slice(0, 40));
  }, []);

  const remove = useCallback((id: string) => {
    broadcast(read().filter((p) => p.id !== id));
  }, []);

  const rename = useCallback((id: string, name: string) => {
    broadcast(read().map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)));
  }, []);

  return { presets, save, remove, rename };
};
