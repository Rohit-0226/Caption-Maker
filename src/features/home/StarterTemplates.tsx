import React, { useEffect, useMemo, useState } from 'react';
import { defaultAnimation, defaultStyle } from '../../core/project/defaults';
import { getStylePreset, type StylePreset } from '../../core/rendering/presets';
import { loadFontFamily } from '../../core/rendering/fonts';
import type { AnimationSettings, CaptionStyle } from '../../core/types/project';
import { buildSampleCaption, CaptionSample, SAMPLE_DURATION } from '../gallery/CaptionSample';

/**
 * Four looks to start from, one per family the template library is organised
 * around: clean, bold, word-by-word and highlight box. Optional: with none
 * picked, the project starts with the default look and any template can be
 * applied later from the editor.
 */
export const STARTER_TEMPLATE_IDS = ['clean-white', 'bold-outline', 'big-word', 'highlight-box'] as const;

const STARTER_LABELS: Record<(typeof STARTER_TEMPLATE_IDS)[number], string> = {
  'clean-white': 'Clean',
  'bold-outline': 'Bold',
  'big-word': 'Word by word',
  'highlight-box': 'Highlight box',
};

const SAMPLE = buildSampleCaption('Kya baat hai, bhai');

/** Motion held at its end state: a still card reads faster than a looping one. */
const STILL: AnimationSettings = {
  ...defaultAnimation,
  enter: 'none',
  exit: 'cut',
  enterDuration: 0.01,
  exitDuration: 0.01,
};

/** What applying a starter does to a fresh project: appearance, plus motion when the look has one. */
export const starterPatch = (id: string): { style: CaptionStyle; animation?: Partial<AnimationSettings> } | null => {
  const preset = getStylePreset(id);
  if (!preset) return null;
  return {
    style: { ...defaultStyle, ...preset.style },
    animation: preset.motion ? { enter: preset.motion } : undefined,
  };
};

const StarterTile: React.FC<{
  preset: StylePreset;
  label: string;
  selected: boolean;
  onToggle: () => void;
}> = ({ preset, label, selected, onToggle }) => {
  const style = useMemo(() => ({ ...defaultStyle, ...preset.style }), [preset]);
  const [, setFontReady] = useState(false);

  // re-render once the template's font has arrived, so the tile shows the real face
  useEffect(() => {
    let cancelled = false;
    void loadFontFamily(style.fontFamily).then(() => !cancelled && setFontReady(true));
    return () => {
      cancelled = true;
    };
  }, [style.fontFamily]);

  return (
    <button
      type="button"
      className={`hm-starter ${selected ? 'is-selected' : ''}`}
      aria-pressed={selected}
      title={selected ? `${preset.name} selected. Click again to start with the default look.` : `Start with the ${preset.name} look`}
      onClick={onToggle}
    >
      <span className="hm-starter__canvas">
        <CaptionSample
          caption={SAMPLE}
          style={style}
          animation={STILL}
          time={SAMPLE_DURATION}
          sizeScale={0.2}
          maxWordsPerLine={3}
          maxLines={2}
        />
      </span>
      <span className="hm-starter__name">{label}</span>
    </button>
  );
};

export const StarterTemplates: React.FC<{
  value: string | null;
  onChange: (id: string | null) => void;
}> = ({ value, onChange }) => {
  const presets = useMemo(
    () =>
      STARTER_TEMPLATE_IDS.map((id) => ({ id, preset: getStylePreset(id) })).filter(
        (entry): entry is { id: (typeof STARTER_TEMPLATE_IDS)[number]; preset: StylePreset } => Boolean(entry.preset),
      ),
    [],
  );
  if (presets.length === 0) return null;
  return (
    <div className="ui-field">
      <div className="ui-field__head">
        <span className="ui-label">Starting template</span>
        <span className="ui-field__optional">Optional</span>
      </div>
      <div className="hm-starters">
        {presets.map(({ id, preset }) => (
          <StarterTile
            key={id}
            preset={preset}
            label={STARTER_LABELS[id]}
            selected={value === id}
            onToggle={() => onChange(value === id ? null : id)}
          />
        ))}
      </div>
    </div>
  );
};
