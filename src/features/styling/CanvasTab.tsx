import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../app/store';
import { api } from '../../app/api';
import { ASPECT_RATIOS } from '../../core/rendering/exportPresets';
import { SAFE_ZONES, type SafeZonePlatform } from '../../core/rendering/safeZones';
import { CAPTION_LAYOUTS, POSITION_PRESETS } from '../../core/project/defaults';
import {
  READING_PACE_WPS,
  type BackgroundMode,
  type PositionPreset,
  type ReadingPace,
} from '../../core/types/project';
import {
  Button,
  ColorField,
  Field,
  Segmented,
  Select,
  SliderField,
  Toggle,
} from '../../components/controls';
import { Banner } from '../../components/feedback';
import { Collapsible, Section } from '../../components/layout';
import {
  IconGaps,
  IconPalette,
  IconTransparency,
  IconUpload,
  IconVideo,
  IconZap,
} from '../../components/icons';

const paceFor = (wps: number): ReadingPace => {
  let closest: ReadingPace = 'normal';
  let smallest = Infinity;
  for (const [pace, value] of Object.entries(READING_PACE_WPS) as [ReadingPace, number][]) {
    const distance = Math.abs(value - wps);
    if (distance < smallest) {
      smallest = distance;
      closest = pace;
    }
  }
  return closest;
};

const POSITION_OPTIONS: { value: PositionPreset; label: string }[] = [
  { value: 'top', label: 'Top (12%)' },
  { value: 'upperMiddle', label: 'Upper Middle (30%)' },
  { value: 'center', label: 'Center (50%)' },
  { value: 'lowerMiddle', label: 'Lower Middle (72%)' },
  { value: 'bottom', label: 'Bottom (88%)' },
  { value: 'custom', label: 'Custom Placement' },
];

export const CanvasTab: React.FC = () => {
  const project = useEditor((s) => s.project);
  const setProject = useEditor((s) => s.setProject);
  const update = useEditor((s) => s.update);
  const segmentation = useEditor((s) => s.project?.segmentation);
  const position = useEditor((s) => s.project?.position);
  const background = useEditor((s) => s.project?.background);
  const safeZone = useEditor((s) => s.safeZone);
  const setSafeZone = useEditor((s) => s.setSafeZone);
  const hasVideo = useEditor((s) => s.project?.media?.kind === 'video');
  const hasTranscript = useEditor((s) => Boolean(s.project?.transcript));
  const editedCount = useEditor((s) => s.project?.captions.filter((c) => c.edited).length ?? 0);
  const captionCount = useEditor((s) => s.project?.captions.length ?? 0);

  const updateSegmentation = useEditor((s) => s.updateSegmentation);
  const updatePosition = useEditor((s) => s.updatePosition);
  const updateBackground = useEditor((s) => s.updateBackground);
  const regenerate = useEditor((s) => s.regenerateCaptions);
  const toggleCaptionGaps = useEditor((s) => s.toggleCaptionGaps);

  const [uploading, setUploading] = useState(false);
  const [pendingRegen, setPendingRegen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const changeGrouping = useCallback(
    (patch: Parameters<typeof updateSegmentation>[0]) => {
      updateSegmentation(patch);
      if (!hasTranscript) return;
      if (editedCount > 0) {
        setPendingRegen(true);
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => regenerate(), 200);
    },
    [updateSegmentation, hasTranscript, editedCount, regenerate],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!project || !segmentation || !position || !background) return null;

  const gapsRemoved = Boolean(project.captions?.some((c) => c.gapRestoreEnd !== undefined));
  const currentAspectRatio = project.exportSettings?.aspectRatio || 'source';

  const handleAspectRatioChange = (ratioId: string) => {
    const opt = ASPECT_RATIOS.find((r) => r.id === ratioId);
    if (!opt) return;
    update({
      exportSettings: {
        ...project.exportSettings,
        aspectRatio: opt.ratio,
        width: opt.width,
        height: opt.height,
      },
    });
  };

  const handlePositionPresetChange = (preset: PositionPreset) => {
    if (preset === 'custom') {
      updatePosition({ preset });
      return;
    }
    updatePosition({ preset, ...POSITION_PRESETS[preset] });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    setUploading(true);
    try {
      const updated = await api.uploadMedia(project.id, file);
      setProject(updated);
    } catch (err) {
      console.error('Failed to replace media:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="cm-canvas-tab">
      {/* 1. Canvas & Aspect Ratio */}
      <Section title="Canvas & Ratio">
        <Field label="Aspect ratio" hint="Select video canvas aspect ratio and resolution">
          <div className="cm-aspect-ratio-selector" role="group" aria-label="Aspect Ratio">
            <button
              type="button"
              className={`cm-aspect-ratio-btn ${currentAspectRatio === '9:16' ? 'is-active' : ''}`}
              onClick={() => handleAspectRatioChange('9:16')}
              title="9:16 Vertical — Reels, TikTok, Shorts (1080×1920)"
            >
              <span className="cm-aspect-ratio-btn__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="7" y="2" width="10" height="20" rx="2" />
                  <line x1="11" y1="18" x2="13" y2="18" />
                </svg>
              </span>
              <span className="cm-aspect-ratio-btn__name">9:16</span>
              <span className="cm-aspect-ratio-btn__desc">Vertical (1080×1920)</span>
            </button>
            <button
              type="button"
              className={`cm-aspect-ratio-btn ${currentAspectRatio === '16:9' ? 'is-active' : ''}`}
              onClick={() => handleAspectRatioChange('16:9')}
              title="16:9 Landscape — YouTube, Desktop (1920×1080)"
            >
              <span className="cm-aspect-ratio-btn__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="2" y="4" width="20" height="13" rx="2" />
                  <line x1="8" y1="20" x2="16" y2="20" />
                  <line x1="12" y1="17" x2="12" y2="20" />
                </svg>
              </span>
              <span className="cm-aspect-ratio-btn__name">16:9</span>
              <span className="cm-aspect-ratio-btn__desc">Landscape (1920×1080)</span>
            </button>
            <button
              type="button"
              className={`cm-aspect-ratio-btn ${currentAspectRatio === '1:1' ? 'is-active' : ''}`}
              onClick={() => handleAspectRatioChange('1:1')}
              title="1:1 Square — Instagram Feed (1080×1080)"
            >
              <span className="cm-aspect-ratio-btn__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              </span>
              <span className="cm-aspect-ratio-btn__name">1:1</span>
              <span className="cm-aspect-ratio-btn__desc">Square (1080×1080)</span>
            </button>
            <button
              type="button"
              className={`cm-aspect-ratio-btn ${currentAspectRatio === 'source' ? 'is-active' : ''}`}
              onClick={() => handleAspectRatioChange('source')}
              title="Source video original aspect ratio"
            >
              <span className="cm-aspect-ratio-btn__icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="2" y="3" width="20" height="18" rx="2" />
                  <path d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5" />
                </svg>
              </span>
              <span className="cm-aspect-ratio-btn__name">Source</span>
              <span className="cm-aspect-ratio-btn__desc">Original Video</span>
            </button>
          </div>
        </Field>

        <Field label="Social Safe Zone Overlay" hint="Keep captions out of TikTok/Reels UI buttons and sound tags">
          <div className="cm-safezone-grid">
            {[
              {
                id: 'off',
                label: 'Off',
                title: 'No safe zone overlay',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                ),
              },
              {
                id: 'tiktok',
                label: 'TikTok',
                title: 'TikTok safe area',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
                  </svg>
                ),
              },
              {
                id: 'reels',
                label: 'Reels',
                title: 'Instagram Reels safe area',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="2" y="2" width="20" height="20" rx="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                ),
              },
              {
                id: 'shorts',
                label: 'Shorts',
                title: 'YouTube Shorts safe area',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="4" y="3" width="16" height="18" rx="4" />
                    <path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" />
                  </svg>
                ),
              },
            ].map((zone) => (
              <button
                key={zone.id}
                type="button"
                className={`cm-safezone-btn ${safeZone === zone.id ? 'is-active' : ''}`}
                title={zone.title}
                onClick={() => setSafeZone(zone.id as any)}
              >
                <span className="cm-safezone-btn__icon">{zone.icon}</span>
                <span className="cm-safezone-btn__label">{zone.label}</span>
              </button>
            ))}
          </div>
        </Field>
      </Section>

      {/* 2. Position & Placement */}
      <Section title="Position & Alignment">
        <Field label="Placement Zone" hint="Click a zone to position captions instantly">
          <div className="cm-placement-zones" role="group" aria-label="Placement zones">
            {[
              {
                id: 'top',
                label: 'Top',
                pct: '12%',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="4" y1="3" x2="20" y2="3" strokeWidth="2.5" />
                    <rect x="5" y="7" width="14" height="6" rx="1.5" fill="currentColor" fillOpacity="0.25" />
                  </svg>
                ),
              },
              {
                id: 'upperMiddle',
                label: 'Upper Mid',
                pct: '30%',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="5" y="6" width="14" height="6" rx="1.5" fill="currentColor" fillOpacity="0.25" />
                    <line x1="4" y1="21" x2="20" y2="21" strokeOpacity="0.3" />
                  </svg>
                ),
              },
              {
                id: 'center',
                label: 'Center',
                pct: '50%',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="3" y1="12" x2="21" y2="12" strokeDasharray="2 2" strokeOpacity="0.5" />
                    <rect x="5" y="9" width="14" height="6" rx="1.5" fill="currentColor" fillOpacity="0.25" />
                  </svg>
                ),
              },
              {
                id: 'lowerMiddle',
                label: 'Lower Mid',
                pct: '72%',
                badge: 'Viral',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="5" y="12" width="14" height="6" rx="1.5" fill="currentColor" fillOpacity="0.25" />
                    <line x1="4" y1="3" x2="20" y2="3" strokeOpacity="0.3" />
                  </svg>
                ),
              },
              {
                id: 'bottom',
                label: 'Bottom',
                pct: '88%',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="5" y="11" width="14" height="6" rx="1.5" fill="currentColor" fillOpacity="0.25" />
                    <line x1="4" y1="21" x2="20" y2="21" strokeWidth="2.5" />
                  </svg>
                ),
              },
            ].map((pos) => {
              const active = position.preset === pos.id;
              return (
                <button
                  key={pos.id}
                  type="button"
                  className={`cm-placement-btn ${active ? 'is-active' : ''}`}
                  title={`${pos.label} (${pos.pct})`}
                  onClick={() => handlePositionPresetChange(pos.id as PositionPreset)}
                >
                  <span className="cm-placement-btn__icon">{pos.icon}</span>
                  <span className="cm-placement-btn__name">{pos.label}</span>
                  <span className="cm-placement-btn__pct">{pos.pct}</span>
                  {pos.badge ? <span className="cm-placement-btn__badge">{pos.badge}</span> : null}
                </button>
              );
            })}
          </div>
        </Field>

        <SliderField
          label="Vertical (Y)"
          suffix="%"
          value={Math.round(position.y)}
          min={5}
          max={95}
          onChange={(y) => updatePosition({ y, preset: 'custom' })}
        />
        <SliderField
          label="Horizontal (X)"
          suffix="%"
          value={Math.round(position.x)}
          min={5}
          max={95}
          onChange={(x) => updatePosition({ x, preset: 'custom' })}
        />
        <SliderField
          label="Max text width"
          suffix="%"
          value={Math.round(position.maxWidth)}
          min={20}
          max={100}
          onChange={(maxWidth) => updatePosition({ maxWidth })}
        />
      </Section>

      {/* 3. Grouping & Lines */}
      <Section title="Grouping & Lines">
        <Field label="Layout presets" hint="Auto-segment words per caption for maximum retention">
          <div className="cm-layouts-grid">
            {CAPTION_LAYOUTS.map((layout) => {
              const active =
                segmentation.maxWordsPerLine === layout.settings.maxWordsPerLine &&
                segmentation.maxLines === layout.settings.maxLines &&
                segmentation.maxReadingSpeed === layout.settings.maxReadingSpeed;
              const icon =
                layout.id === 'one-word' ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="4" y="9" width="16" height="6" rx="2" fill="currentColor" fillOpacity="0.25" />
                  </svg>
                ) : layout.id === 'short' ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="4" y="6" width="16" height="4.5" rx="1.5" fill="currentColor" fillOpacity="0.25" />
                    <rect x="4" y="13.5" width="11" height="4.5" rx="1.5" fill="currentColor" fillOpacity="0.25" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="4" y="5" width="16" height="3.5" rx="1" fill="currentColor" fillOpacity="0.25" />
                    <rect x="4" y="10.5" width="16" height="3.5" rx="1" fill="currentColor" fillOpacity="0.25" />
                    <rect x="4" y="16" width="10" height="3.5" rx="1" fill="currentColor" fillOpacity="0.25" />
                  </svg>
                );
              return (
                <button
                  key={layout.id}
                  type="button"
                  className={`cm-layout-card ${active ? 'is-active' : ''}`}
                  title={layout.description}
                  onClick={() => changeGrouping(layout.settings)}
                >
                  <span className="cm-layout-card__icon">{icon}</span>
                  <span className="cm-layout-card__name">{layout.name}</span>
                  <span className="cm-layout-card__desc">
                    {layout.settings.maxWordsPerLine}w/line · {layout.settings.maxLines}L
                  </span>
                </button>
              );
            })}
          </div>
        </Field>

        <SliderField
          label="Words per line"
          hint="Maximum words per line budget"
          value={segmentation.maxWordsPerLine}
          min={1}
          max={10}
          onChange={(maxWordsPerLine) => changeGrouping({ maxWordsPerLine })}
        />

        <Field label="Max lines">
          <Segmented<'1' | '2' | '3'>
            ariaLabel="Maximum lines per caption"
            value={String(segmentation.maxLines) as '1' | '2' | '3'}
            options={[
              { value: '1', label: '1 Line' },
              { value: '2', label: '2 Lines' },
              { value: '3', label: '3 Lines' },
            ]}
            onChange={(value) => changeGrouping({ maxLines: Number(value) as 1 | 2 | 3 })}
          />
        </Field>

        <Field label="Reading pace">
          <Segmented<ReadingPace>
            ariaLabel="Reading pace"
            value={paceFor(segmentation.maxReadingSpeed)}
            options={[
              { value: 'relaxed', label: 'Relaxed' },
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Fast' },
            ]}
            onChange={(pace) => changeGrouping({ maxReadingSpeed: READING_PACE_WPS[pace] })}
          />
        </Field>

        <Field label="Silence gaps" hint="Extend captions to cover speech pauses, or restore original gaps">
          <div className="cm-casing-group" role="group" aria-label="Silence gaps options">
            <button
              type="button"
              className={`cm-casing-btn ${!gapsRemoved ? 'is-active' : ''}`}
              title="Keep natural speech pauses between captions"
              onClick={() => toggleCaptionGaps(false)}
            >
              <span className="cm-casing-btn__badge">
                <IconGaps size={13} />
              </span>
              <span>Keep Gaps</span>
            </button>
            <button
              type="button"
              className={`cm-casing-btn ${gapsRemoved ? 'is-active' : ''}`}
              title="Close silence gaps so captions stay persistently visible"
              onClick={() => toggleCaptionGaps(true)}
            >
              <span className="cm-casing-btn__badge">
                <IconZap size={13} />
              </span>
              <span>Close Gaps</span>
            </button>
          </div>
        </Field>

        {editedCount > 0 ? (
          <Banner tone="warning">
            {editedCount} caption{editedCount === 1 ? ' has' : 's have'} manual edits.
            Regenerating will recalculate line splits.
          </Banner>
        ) : null}

        {hasTranscript ? (
          <div style={{ marginTop: 10 }}>
            <Button
              block
              variant={pendingRegen ? 'primary' : 'secondary'}
              onClick={() => {
                regenerate();
                setPendingRegen(false);
              }}
            >
              {pendingRegen ? 'Apply and Regroup' : 'Regroup from Transcript'}
            </Button>
          </div>
        ) : null}
      </Section>

      {/* 4. Canvas Background */}
      <Section title="Background">
        <div className="cm-bg-mode-grid">
          {[
            { id: 'source', label: 'Source Video', icon: <IconVideo size={18} />, desc: 'Video layer' },
            { id: 'solid', label: 'Solid Colour', icon: <IconPalette size={18} />, desc: 'Flat background' },
            { id: 'transparent', label: 'Transparent', icon: <IconTransparency size={18} />, desc: 'Alpha overlay' },
          ].map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`cm-bg-mode-btn ${background.mode === mode.id ? 'is-active' : ''}`}
              onClick={() => updateBackground({ mode: mode.id as BackgroundMode })}
            >
              <span className="cm-bg-mode-btn__icon">{mode.icon}</span>
              <span className="cm-bg-mode-btn__label">{mode.label}</span>
              <span className="cm-bg-mode-btn__desc">{mode.desc}</span>
            </button>
          ))}
        </div>

        {background.mode === 'source' && !hasVideo ? (
          <div style={{ marginTop: 8 }}>
            <Banner tone="info">
              This project has no video, so the preview stays black. Pick a solid colour or
              transparent instead.
            </Banner>
          </div>
        ) : null}

        {background.mode === 'solid' ? (
          <div style={{ marginTop: 8 }}>
            <ColorField
              label="Colour"
              value={background.color}
              recent={background.recentColors}
              onChange={(color) => updateBackground({ color })}
              onReset={() => updateBackground({ color: '#000000' })}
            />
          </div>
        ) : null}

        {background.mode === 'transparent' ? (
          <div style={{ marginTop: 8 }}>
            <Banner tone="info">
              Captions render on transparency. Export as MOV or WebM with alpha.
            </Banner>
          </div>
        ) : null}
      </Section>

      {/* 5. Replace Media */}
      <Section title="Media Source">
        <div className="cm-replace-media-box">
          <div className="cm-replace-media-info">
            <span className="cm-replace-media-name truncate">
              {project.media?.fileName ?? 'No media loaded'}
            </span>
            <span className="cm-replace-media-meta">
              {project.media?.width && project.media?.height
                ? `${project.media.width}×${project.media.height} · `
                : ''}
              {project.media?.duration ? `${project.media.duration.toFixed(1)}s` : ''}
            </span>
          </div>

          <Button
            variant="secondary"
            size="sm"
            loading={uploading}
            onClick={() => fileInputRef.current?.click()}
            icon={<IconUpload size={13} />}
          >
            Replace Video
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*,.mp4,.mov,.webm,.mkv,.m4v,.avi,.wmv,.flv,.ts,.mts,.m2ts,.3gp,.vob,.ogv,.divx,.mpeg,.mpg,.m2v,.asf,.f4v,.mp3,.wav,.m4a,.aac,.ogg,.flac,.wma,.opus,.m4b,.aiff,.aif,.amr"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </Section>

      {/* 6. Advanced Timing Collapsible */}
      <Collapsible title="Advanced Timing & Boundaries" defaultOpen={false}>
        <SliderField
          label="Reading speed"
          suffix=" w/s"
          precision={1}
          value={segmentation.maxReadingSpeed}
          min={1.5}
          max={5}
          step={0.1}
          onChange={(maxReadingSpeed) => changeGrouping({ maxReadingSpeed })}
        />
        <SliderField
          label="Min duration"
          suffix="s"
          precision={2}
          value={segmentation.minDuration}
          min={0.1}
          max={2}
          step={0.05}
          onChange={(minDuration) => changeGrouping({ minDuration })}
        />
        <SliderField
          label="Max duration"
          suffix="s"
          precision={1}
          value={segmentation.maxDuration}
          min={1}
          max={12}
          step={0.1}
          onChange={(maxDuration) => changeGrouping({ maxDuration })}
        />
        <SliderField
          label="Min gap"
          hint="Silence duration forcing a new caption"
          suffix="s"
          precision={2}
          value={segmentation.minGap}
          min={0}
          max={2}
          step={0.05}
          onChange={(minGap) => changeGrouping({ minGap })}
        />
        <Toggle
          label="Prefer punctuation boundaries"
          checked={segmentation.preferPunctuation}
          onChange={(preferPunctuation) => changeGrouping({ preferPunctuation })}
        />
        <Toggle
          label="Prefer pause boundaries"
          checked={segmentation.preferPauses}
          onChange={(preferPauses) => changeGrouping({ preferPauses })}
        />
      </Collapsible>
    </div>
  );
};
