import React, { useCallback, useMemo, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { useEditor } from '../../app/store';
import { previewFps } from '../../app/playbackClock';
import { defaultStyle } from '../../core/project/defaults';
import { STYLE_PRESETS } from '../../core/rendering/presets';
import { FONT_CATALOGUE, loadFontFamily } from '../../core/rendering/fonts';
import { isReadAlong } from '../../core/rendering/animations';
import type { CaptionStyle, TextAlign } from '../../core/types/project';
import {
  Button,
  ColorField,
  Field,
  Segmented,
  Select,
  SliderField,
  Toggle,
} from '../../components/controls';
import { Collapsible, Section, Tabs } from '../../components/layout';
import {
  IconBox,
  IconBurst,
  IconHighlight,
  IconHourglass,
  IconPen,
  IconPunctuation,
  IconShadow,
  IconStar,
  IconText,
} from '../../components/icons';
import { TransitionsTab } from './TransitionsTab';
import { CanvasTab } from './CanvasTab';

export const CREATOR_SWATCHES = [
  '#FFFFFF', // Crisp White
  '#FFD400', // Hormozi Yellow
  '#22C55E', // Viral Green
  '#00F0FF', // Cyber Cyan
  '#FF3B5C', // Punch Crimson
  '#FF6AD5', // Neon Pink
  '#FF9F1C', // Warm Amber
  '#000000', // Pitch Black
];

/** Muted greys for the words a read-along caption has not reached yet. */
export const READ_ALONG_SWATCHES = [
  '#B4B4B4',
  '#8A8A8A',
  '#6B7280',
  'rgba(255,255,255,0.45)',
  'rgba(0,0,0,0.35)',
  '#C7C7C7',
];

// ---------------------------------------------------------------------------
// 1. Design & Typography Tab
// ---------------------------------------------------------------------------

const FONT_OPTIONS = FONT_CATALOGUE.map((f) => ({
  value: f.family,
  label: f.family,
}));

const WEIGHT_OPTIONS = [
  { value: '300', label: 'Light (300)' },
  { value: '400', label: 'Regular (400)' },
  { value: '500', label: 'Medium (500)' },
  { value: '600', label: 'Semi Bold (600)' },
  { value: '700', label: 'Bold (700)' },
  { value: '800', label: 'Extra Bold (800)' },
  { value: '900', label: 'Black (900)' },
];

const DesignTab: React.FC<{
  playerRef?: React.RefObject<PlayerRef | null>;
}> = ({ playerRef }) => {
  const style = useEditor((s) => s.project?.style);
  const animation = useEditor((s) => s.project?.animation);
  const update = useEditor((s) => s.updateStyle);
  const updateAnimation = useEditor((s) => s.updateAnimation);
  const transformCaptionCasing = useEditor((s) => s.transformCaptionCasing);
  const clearAllEmphasis = useEditor((s) => s.clearAllEmphasis);
  const lastAppliedPresetId = useEditor((s) => s.lastAppliedPresetId);
  const captions = useEditor((s) => s.project?.captions);
  const addPunctuation = useEditor((s) => s.addPunctuation);
  const removePunctuation = useEditor((s) => s.removePunctuation);
  const enterMotion = animation?.enter;

  const hasPunctuation = useMemo(() => {
    return (captions ?? []).some((c) => c.words.some((w) => /[.?!,;:]+/.test(w.text)));
  }, [captions]);

  const resetToTemplate = useCallback(() => {
    if (!lastAppliedPresetId) return;
    const preset = STYLE_PRESETS.find((p) => p.id === lastAppliedPresetId);
    if (!preset) return;
    update(preset.style);
    if (preset.motion) {
      updateAnimation({
        enter: preset.motion,
        ...(preset.id === 'founders-of-uae' ? { exit: 'cut' as const, exitDuration: 0 } : {}),
      });
    }
    void loadFontFamily({ ...defaultStyle, ...preset.style }.fontFamily);
  }, [lastAppliedPresetId, update, updateAnimation]);

  if (!style) return null;
  const readAlong = enterMotion ? isReadAlong(enterMotion) : false;
  const set = (patch: Partial<CaptionStyle>) => update(patch);

  const templateName = lastAppliedPresetId
    ? STYLE_PRESETS.find((p) => p.id === lastAppliedPresetId)?.name
    : null;

  return (
    <>
      {/* Active Template Banner with Reset */}
      {lastAppliedPresetId ? (
        <div className="cm-inspector-preset-banner">
          <div className="cm-inspector-preset-banner__info">
            <span className="cm-inspector-preset-banner__tag">TEMPLATE</span>
            <span className="cm-inspector-preset-banner__name">{templateName}</span>
          </div>
          <button
            type="button"
            className="cm-inspector-preset-banner__reset-btn"
            onClick={resetToTemplate}
            title="Reset all style customizations back to template defaults"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            <span>Reset</span>
          </button>
        </div>
      ) : null}

      {/* 1. Typography & Font */}
      <Section title="Font & size">
        <Field label="Font family">
          <Select<string>
            value={style.fontFamily}
            ariaLabel="Font family"
            options={FONT_OPTIONS}
            onChange={(fontFamily) => {
              set({ fontFamily });
              void loadFontFamily(fontFamily);
            }}
          />
        </Field>
        <Field label="Weight / Style">
          <Select<string>
            value={String(style.fontWeight)}
            ariaLabel="Font weight"
            options={WEIGHT_OPTIONS}
            onChange={(fontWeight) => set({ fontWeight: Number(fontWeight) })}
          />
        </Field>
        <SliderField
          label="Size"
          suffix="px"
          value={style.fontSize}
          min={16}
          max={200}
          onChange={(fontSize) => set({ fontSize })}
        />
        <div className="cm-size-presets" role="group" aria-label="Font size quick presets">
          {[
            { label: 'S 36', size: 36, title: 'Small (36px)' },
            { label: 'M 48', size: 48, title: 'Medium (48px)' },
            { label: 'L 64', size: 64, title: 'Large / Viral (64px)' },
            { label: 'XL 82', size: 82, title: 'Extra Large (82px)' },
          ].map((preset) => (
            <button
              key={preset.size}
              type="button"
              className={`cm-size-preset-btn ${style.fontSize === preset.size ? 'is-active' : ''}`}
              title={preset.title}
              onClick={() => set({ fontSize: preset.size })}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Section>

      {/* 2. Format & Alignment */}
      <Section title="Format & casing">
        <Field label="Alignment">
          <Segmented<TextAlign>
            ariaLabel="Text alignment"
            value={style.align}
            options={[
              {
                value: 'left',
                label: 'Left',
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="15" y2="12" />
                    <line x1="3" y1="18" x2="18" y2="18" />
                  </svg>
                ),
              },
              {
                value: 'center',
                label: 'Center',
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="6" y1="12" x2="18" y2="12" />
                    <line x1="4" y1="18" x2="20" y2="18" />
                  </svg>
                ),
              },
              {
                value: 'right',
                label: 'Right',
                icon: (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="9" y1="12" x2="21" y2="12" />
                    <line x1="6" y1="18" x2="21" y2="18" />
                  </svg>
                ),
              },
            ]}
            onChange={(align) => set({ align })}
          />
        </Field>
        <Field label="Text Casing">
          <div className="cm-casing-group" role="group" aria-label="Text casing options">
            <button
              type="button"
              className="cm-casing-btn"
              title="Capitalize first letter of every caption (Sentence case)"
              onClick={() => transformCaptionCasing('sentence')}
            >
              <span className="cm-casing-btn__badge">Aa</span>
              <span>Sentence</span>
            </button>
            <button
              type="button"
              className="cm-casing-btn"
              title="Capitalize every word (Title case)"
              onClick={() => transformCaptionCasing('title')}
            >
              <span className="cm-casing-btn__badge">Ab</span>
              <span>Words</span>
            </button>
            <button
              type="button"
              className="cm-casing-btn"
              title="Convert all words to lowercase"
              onClick={() => transformCaptionCasing('lower')}
            >
              <span className="cm-casing-btn__badge">aa</span>
              <span>lower</span>
            </button>
            <button
              type="button"
              className={`cm-casing-btn ${style.uppercase ? 'is-active' : ''}`}
              title="ALL CAPS (force uppercase CSS)"
              onClick={() => set({ uppercase: !style.uppercase })}
            >
              <span className="cm-casing-btn__badge">AA</span>
              <span>ALL CAPS</span>
            </button>
          </div>
        </Field>
        <Field label="Punctuation" hint="Add sentence punctuation (. ? ! ,) or remove all punctuation">
          <div className="cm-casing-group" role="group" aria-label="Punctuation options">
            <button
              type="button"
              className={`cm-casing-btn ${hasPunctuation ? 'is-active' : ''}`}
              title="Add sentence and clause punctuation (. ? ! ,)"
              onClick={addPunctuation}
            >
              <span className="cm-casing-btn__badge">
                <IconPunctuation size={13} />
              </span>
              <span>Add Punctuation</span>
            </button>
            <button
              type="button"
              className={`cm-casing-btn ${!hasPunctuation ? 'is-active' : ''}`}
              title="Remove all punctuation from all captions"
              onClick={removePunctuation}
            >
              <span className="cm-casing-btn__badge">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </span>
              <span>Remove Punctuation</span>
            </button>
          </div>
        </Field>
        <SliderField
          label="Opacity"
          precision={2}
          value={style.opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(opacity) => set({ opacity })}
        />
      </Section>

      {/* 3. Spacing */}
      <Section title="Spacing">
        <SliderField
          label="Letter spacing"
          suffix="px"
          value={style.letterSpacing}
          min={-5}
          max={20}
          onChange={(letterSpacing) => set({ letterSpacing })}
        />
        <SliderField
          label="Line height"
          precision={2}
          value={style.lineHeight}
          min={0.8}
          max={2.4}
          step={0.01}
          onChange={(lineHeight) => set({ lineHeight })}
        />
        <SliderField
          label="Word gap"
          suffix="em"
          precision={2}
          value={style.wordSpacing}
          min={0}
          max={1.2}
          step={0.01}
          onChange={(wordSpacing) => set({ wordSpacing })}
        />
      </Section>

      {/* 4. Colors & Swatches */}
      <Section title="Colours">
        <div className="cm-color-role-card">
          <div className="cm-color-role-card__header">
            <span className="cm-color-role-card__icon"><IconText size={15} /></span>
            <div className="cm-color-role-card__info">
              <span className="cm-color-role-card__title">Base Text Colour</span>
              <span className="cm-color-role-card__desc">Primary font color for all subtitle text</span>
            </div>
          </div>
          <ColorField
            label=""
            value={style.color}
            onChange={(color) => set({ color })}
            recent={CREATOR_SWATCHES}
          />
        </div>

        <div className="cm-color-role-card" style={{ marginTop: 12 }}>
          <div className="cm-color-role-card__header">
            <span className="cm-color-role-card__icon"><IconHighlight size={15} /></span>
            <div className="cm-color-role-card__info">
              <span className="cm-color-role-card__title">{readAlong ? 'Already Spoken Word' : 'Active Spoken Word'}</span>
              <span className="cm-color-role-card__desc">Karaoke highlight color synced to voice</span>
            </div>
          </div>
          <ColorField
            label=""
            value={style.activeWordColor}
            onChange={(activeWordColor) => set({ activeWordColor })}
            recent={CREATOR_SWATCHES}
          />
        </div>

        {readAlong ? (
          <div className="cm-color-role-card" style={{ marginTop: 12 }}>
            <div className="cm-color-role-card__header">
              <span className="cm-color-role-card__icon"><IconHourglass size={15} /></span>
              <div className="cm-color-role-card__info">
                <span className="cm-color-role-card__title">Upcoming Word Colour</span>
                <span className="cm-color-role-card__desc">Muted shade for words not yet reached</span>
              </div>
            </div>
            <ColorField
              label=""
              value={style.futureWordColor}
              onChange={(futureWordColor) => set({ futureWordColor })}
              recent={READ_ALONG_SWATCHES}
            />
          </div>
        ) : null}
      </Section>

      {/* 5. Boxes & Highlighting */}
      <Collapsible title="Boxes & highlight" defaultOpen={true}>
        <div className="cm-feature-card">
          <div className="cm-feature-card__head">
            <span className="cm-feature-card__icon"><IconHighlight size={16} /></span>
            <div className="cm-feature-card__info">
              <span className="cm-feature-card__title">Spoken Word Highlight Box</span>
              <span className="cm-feature-card__desc">Colored background pillow on spoken word</span>
            </div>
            <Toggle
              label=""
              checked={style.activeBoxEnabled}
              onChange={(activeBoxEnabled) => set({ activeBoxEnabled })}
            />
          </div>
          {style.activeBoxEnabled ? (
            <div className="cm-feature-card__body">
              <ColorField
                label="Highlight colour"
                value={style.activeBoxColor}
                onChange={(activeBoxColor) => set({ activeBoxColor })}
                recent={CREATOR_SWATCHES}
              />
              <SliderField
                label="Corner radius"
                suffix="px"
                value={style.activeBoxRadius}
                min={0}
                max={40}
                onChange={(activeBoxRadius) => set({ activeBoxRadius })}
              />
            </div>
          ) : null}
        </div>

        <div className="cm-feature-card" style={{ marginTop: 12 }}>
          <div className="cm-feature-card__head">
            <span className="cm-feature-card__icon"><IconBox size={16} /></span>
            <div className="cm-feature-card__info">
              <span className="cm-feature-card__title">Caption Background Box</span>
              <span className="cm-feature-card__desc">Solid backplate behind the entire subtitle line</span>
            </div>
            <Toggle
              label=""
              checked={style.boxEnabled}
              onChange={(boxEnabled) => set({ boxEnabled })}
            />
          </div>
          {style.boxEnabled ? (
            <div className="cm-feature-card__body">
              <ColorField
                label="Box colour"
                value={style.boxColor}
                onChange={(boxColor) => set({ boxColor })}
                recent={CREATOR_SWATCHES}
              />
              <SliderField
                label="Padding X"
                suffix="px"
                value={style.boxPaddingX}
                min={0}
                max={90}
                onChange={(boxPaddingX) => set({ boxPaddingX })}
              />
              <SliderField
                label="Padding Y"
                suffix="px"
                value={style.boxPaddingY}
                min={0}
                max={60}
                onChange={(boxPaddingY) => set({ boxPaddingY })}
              />
              <SliderField
                label="Corner radius"
                suffix="px"
                value={style.boxRadius}
                min={0}
                max={60}
                onChange={(boxRadius) => set({ boxRadius })}
              />
            </div>
          ) : null}
        </div>
      </Collapsible>

      {/* 6. Outline and shadow */}
      <Collapsible title="Outline and shadow" defaultOpen={false}>
        <div className="cm-feature-card">
          <div className="cm-feature-card__head">
            <span className="cm-feature-card__icon"><IconPen size={16} /></span>
            <div className="cm-feature-card__info">
              <span className="cm-feature-card__title">Text Stroke / Outline</span>
              <span className="cm-feature-card__desc">Contour border for readability on light backgrounds</span>
            </div>
            <Toggle
              label=""
              checked={style.strokeEnabled}
              onChange={(strokeEnabled) => set({ strokeEnabled })}
            />
          </div>
          {style.strokeEnabled ? (
            <div className="cm-feature-card__body">
              <SliderField
                label="Outline width"
                suffix="px"
                value={style.strokeWidth}
                min={0}
                max={40}
                onChange={(strokeWidth) => set({ strokeWidth })}
              />
              <ColorField
                label="Outline colour"
                value={style.strokeColor}
                onChange={(strokeColor) => set({ strokeColor })}
                recent={CREATOR_SWATCHES}
              />
            </div>
          ) : null}
        </div>

        <div className="cm-feature-card" style={{ marginTop: 12 }}>
          <div className="cm-feature-card__head">
            <span className="cm-feature-card__icon"><IconShadow size={16} /></span>
            <div className="cm-feature-card__info">
              <span className="cm-feature-card__title">Drop Shadow & Glow</span>
              <span className="cm-feature-card__desc">Depth shadow and glow to make subtitles stand out</span>
            </div>
            <Toggle
              label=""
              checked={style.shadowEnabled}
              onChange={(shadowEnabled) => set({ shadowEnabled })}
            />
          </div>
          {style.shadowEnabled ? (
            <div className="cm-feature-card__body">
              <SliderField
                label="Shadow blur"
                suffix="px"
                value={style.shadowBlur}
                min={0}
                max={80}
                onChange={(shadowBlur) => set({ shadowBlur })}
              />
              <SliderField
                label="Shadow drop"
                suffix="px"
                value={style.shadowOffsetY}
                min={0}
                max={50}
                onChange={(shadowOffsetY) => set({ shadowOffsetY })}
              />
              <ColorField
                label="Shadow colour"
                value={style.shadowColor}
                onChange={(shadowColor) => set({ shadowColor })}
                recent={CREATOR_SWATCHES}
              />
            </div>
          ) : null}
        </div>
      </Collapsible>

      {/* 7. Word scale & emphasis */}
      <Collapsible title="Word scale & emphasis" defaultOpen={false}>
        <div className="cm-feature-card">
          <div className="cm-feature-card__head">
            <span className="cm-feature-card__icon"><IconBurst size={16} /></span>
            <div className="cm-feature-card__info">
              <span className="cm-feature-card__title">Spoken Word Pop Scale</span>
              <span className="cm-feature-card__desc">Magnifies the currently active spoken word</span>
            </div>
          </div>
          <div className="cm-feature-card__body">
            <SliderField
              label="Active scale"
              suffix="×"
              precision={2}
              value={style.activeWordScale}
              min={1}
              max={1.8}
              step={0.01}
              onChange={(activeWordScale) => set({ activeWordScale })}
            />
          </div>
        </div>

        <div className="cm-feature-card" style={{ marginTop: 12 }}>
          <div className="cm-feature-card__head">
            <span className="cm-feature-card__icon"><IconStar size={16} /></span>
            <div className="cm-feature-card__info">
              <span className="cm-feature-card__title">Keyword Emphasis</span>
              <span className="cm-feature-card__desc">Highlight key words with color & scale</span>
            </div>
            <Toggle
              label=""
              checked={Boolean(style.emphasisEnabled)}
              onChange={(emphasisEnabled) => set({ emphasisEnabled })}
            />
          </div>
          {style.emphasisEnabled ? (
            <div className="cm-feature-card__body">
              <SliderField
                label="Emphasis scale"
                suffix="×"
                precision={2}
                value={style.emphasisScale}
                min={1}
                max={2}
                step={0.01}
                onChange={(emphasisScale) => set({ emphasisScale })}
              />
              <ColorField
                label="Emphasis color"
                value={style.emphasisColor}
                onChange={(emphasisColor) => set({ emphasisColor })}
                recent={CREATOR_SWATCHES}
              />
            </div>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <Button
              size="sm"
              variant="ghost"
              block
              onClick={clearAllEmphasis}
              title="Clear all emphasis flags from words across the project"
            >
              Clear all word emphasis
            </Button>
          </div>
        </div>
      </Collapsible>
    </>
  );
};

// ---------------------------------------------------------------------------
// 2. Inspector Shell (Focused 3 Tabs: Style | Canvas | Motion)
// ---------------------------------------------------------------------------

const TABS = [
  {
    id: 'style',
    label: 'Style',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
  },
  {
    id: 'canvas',
    label: 'Canvas',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
    ),
  },
  {
    id: 'motion',
    label: 'Motion',
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
  },
];

export const Inspector: React.FC<{
  onExport?: () => void;
  playerRef?: React.RefObject<PlayerRef | null>;
}> = ({ onExport, playerRef }) => {
  const [tab, setTab] = useState(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('tab');
      if (param && ['style', 'canvas', 'motion'].includes(param)) {
        return param;
      }
    }
    return 'style';
  });
  const hasProject = useEditor((s) => Boolean(s.project));

  const body = useMemo(() => {
    switch (tab) {
      case 'canvas':
        return <CanvasTab />;
      case 'motion':
        return <TransitionsTab playerRef={playerRef} />;
      default:
        return <DesignTab playerRef={playerRef} />;
    }
  }, [tab, playerRef]);

  if (!hasProject) return null;

  return (
    <aside className="cm-inspector">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="cm-inspector__body">{body}</div>
      {onExport ? (
        <div className="cm-inspector__footer">
          <button
            type="button"
            className="cm-kalakar-export-btn"
            onClick={onExport}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span>Export Video</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
};
