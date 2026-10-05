import React, { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../../app/store';
import { capturePreset, useMyPresets, type MyPreset } from '../../app/myPresets';
import { defaultStyle } from '../../core/project/defaults';
import { STYLE_CATEGORIES, STYLE_PRESETS, type StylePreset } from '../../core/rendering/presets';
import { loadFontFamily } from '../../core/rendering/fonts';
import { useFavourites } from '../../app/preferences';
import { Button, IconButton } from '../../components/controls';
import { EmptyState } from '../../components/feedback';
import { IconCrown, IconPalette, IconSearch, IconTrash } from '../../components/icons';
import { SegmentTabs } from '../../components/layout';
import { FavouriteStar } from '../gallery/GalleryChrome';
import { buildSampleCaption, CaptionSample, SAMPLE_DURATION } from '../gallery/CaptionSample';
import { useInView, useSampleClock } from '../gallery/sampleClock';
import type { AnimationSettings, CaptionStyle } from '../../core/types/project';

const VIRAL_SAMPLES: Record<string, { text: string; maxWords: number; maxLines: number }> = {
  // Premium suite
  'apple-cupertino': { text: 'Designed for precision', maxWords: 2, maxLines: 2 },
  'cinematic-studio': { text: 'Every detail tells a story', maxWords: 3, maxLines: 2 },
  'editorial-luxe': { text: 'Crafted with clarity', maxWords: 2, maxLines: 2 },
  'executive-brief': { text: 'Strategic leadership insights', maxWords: 2, maxLines: 2 },
  'swiss-typography': { text: 'Form follows function', maxWords: 2, maxLines: 2 },
  'nordic-elegance': { text: 'Simplicity and light', maxWords: 2, maxLines: 2 },
  'luxury-couture': { text: 'TIMELESS ELEGANCE', maxWords: 2, maxLines: 1 },
  'tech-minimal': { text: 'The next generation', maxWords: 2, maxLines: 2 },
  'monocle-doc': { text: 'Voices from the world', maxWords: 2, maxLines: 2 },

  // Creator & viral suite
  'hormozi-prime': { text: 'MAKE THEM AN OFFER', maxWords: 2, maxLines: 2 },
  'mrbeast-hyper': { text: 'I GAVE AWAY 1 MILLION', maxWords: 3, maxLines: 2 },
  'submagic-emerald': { text: 'HOW TO GO VIRAL', maxWords: 2, maxLines: 2 },
  'capcut-crimson': { text: 'STOP SCROLLING NOW', maxWords: 2, maxLines: 2 },
  'ali-abdaal': { text: 'The 3 daily habits', maxWords: 2, maxLines: 2 },
  'devin-spotlight': { text: 'THIS CHANGES EVERYTHING', maxWords: 3, maxLines: 1 },
  'iman-prestige': { text: 'Build your luxury empire', maxWords: 2, maxLines: 2 },
  'dan-minimalist': { text: 'Focus on what matters', maxWords: 2, maxLines: 2 },
  'vox-tape': { text: 'THE TRUTH BEHIND THIS', maxWords: 2, maxLines: 2 },
  'cyber-neon-pro': { text: 'WELCOME TO THE FUTURE', maxWords: 2, maxLines: 2 },
  'toxic-lime-punch': { text: 'CRUSH YOUR DAILY GOALS', maxWords: 2, maxLines: 2 },
  'bubbly-pastel-pro': { text: 'Good vibes only today', maxWords: 2, maxLines: 2 },
  'kinetic-wave-pro': { text: 'RIDE THE VIRAL WAVE', maxWords: 2, maxLines: 2 },
  'tiktok-clean-pro': { text: '100k followers in 30 days', maxWords: 3, maxLines: 2 },
  'netflix-cinema-pro': { text: 'Wait for the final moment', maxWords: 3, maxLines: 2 },
  'staggered-impact-pro': { text: 'STEP INTO THE ARENA', maxWords: 2, maxLines: 2 },
  'yellow-karaoke-pro': { text: 'SING EVERY SINGLE WORD', maxWords: 2, maxLines: 2 },
  'emerald-stream-pro': { text: 'LISTEN VERY CLOSELY NOW', maxWords: 2, maxLines: 2 },
};

const SAMPLE_CACHE = new Map<string, ReturnType<typeof buildSampleCaption>>();

const getSampleForPreset = (id?: string) => {
  const conf = (id && VIRAL_SAMPLES[id]) || { text: 'The quick brown fox', maxWords: 3, maxLines: 2 };
  let caption = SAMPLE_CACHE.get(conf.text);
  if (!caption) {
    caption = buildSampleCaption(conf.text);
    SAMPLE_CACHE.set(conf.text, caption);
  }
  return { caption, maxWords: conf.maxWords, maxLines: conf.maxLines };
};

/** Short descriptors inside a card, derived dynamically from style & motion rather than hardcoded IDs. */
const traitsOf = (style: CaptionStyle, animation: AnimationSettings): string[] => {
  const traits: string[] = [];
  const enter = animation.enter;
  if (enter === 'activeWordPunch') traits.push('Punch');
  else if (enter === 'wordBounce') traits.push('Bounce');
  else if (enter === 'flashPunch') traits.push('Flash');
  else if (enter === 'spotlight') traits.push('Spotlight');
  else if (enter === 'wordRise') traits.push('Rise');
  else if (enter === 'typewriter') traits.push('Typewriter');
  else if (enter === 'wave') traits.push('Wave');
  else if (enter === 'stagger') traits.push('Stagger');
  else if (enter === 'wordFollower') traits.push('Follower');
  else if (enter === 'springPop') traits.push('Spring');
  else if (enter === 'wordScale') traits.push('Scale');
  else if (enter === 'wipe') traits.push('Wipe');
  else if (enter === 'wordFade') traits.push('Fade');

  if (style.activeBoxEnabled) traits.push('Highlight');
  else if (style.boxEnabled && traits.length < 2) traits.push('Box');
  if (style.strokeEnabled && traits.length < 2) traits.push('Outline');
  if (style.shadowEnabled && traits.length < 2) traits.push('Glow');
  if (style.fontWeight >= 800 && traits.length < 2) traits.push('Bold');
  if (style.uppercase && traits.length < 2) traits.push('Caps');

  return traits.length > 0 ? traits.slice(0, 2) : ['Clean'];
};

const TemplateCard = React.memo<{
  id?: string;
  name: string;
  style: CaptionStyle;
  animation: AnimationSettings;
  active: boolean;
  badge?: 'new' | 'vip' | 'palette';
  favourite?: boolean;
  onApply: () => void;
  onToggleFavourite?: () => void;
  onDelete?: () => void;
}>(({ id, name, style, animation, active, badge, favourite, onApply, onToggleFavourite, onDelete }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState(0);
  const [hovered, setHovered] = useState(false);

  const sampleConfig = useMemo(() => getSampleForPreset(id), [id]);

  React.useEffect(() => {
    if (!inView || ready) return;
    let cancelled = false;
    void loadFontFamily(style.fontFamily).then(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [inView, ready, style.fontFamily]);

  // play once on arrival, again when selected, and continuously on hover
  React.useEffect(() => {
    if (inView) setToken((t) => t + 1);
  }, [inView]);
  React.useEffect(() => {
    if (active) setToken((t) => t + 1);
  }, [active]);

  const time = useSampleClock(inView ? token : 0, SAMPLE_DURATION, hovered);

  return (
    <div
      id={id ? `cm-template-${id}` : undefined}
      ref={ref}
      className={`cm-template ${active ? 'is-active' : ''}`}
      onMouseEnter={() => {
        setHovered(true);
        setToken((t) => t + 1);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <header className="cm-template__head">
        <div className="cm-template__title-wrap">
          <span className="cm-template__name truncate">{name}</span>
          {active && (
            <span className="cm-pill-badge cm-pill-badge--active">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Selected
            </span>
          )}
        </div>
        <div className="cm-template__badges">
          {badge === 'new' && !active ? (
            <span className="cm-pill-badge cm-pill-badge--new">New</span>
          ) : null}
          {badge === 'vip' && !active ? (
            <span className="cm-pill-badge cm-pill-badge--vip" title="VIP Template">
              <IconCrown size={11} />
            </span>
          ) : null}
          {badge === 'palette' && !active ? (
            <span className="cm-pill-badge cm-pill-badge--palette" title="Style Palette">
              <IconPalette size={11} />
            </span>
          ) : null}
          {onToggleFavourite ? (
            <FavouriteStar
              active={Boolean(favourite)}
              label={`${name} favourite`}
              onClick={onToggleFavourite}
            />
          ) : null}
          {onDelete ? (
            <IconButton label={`Delete ${name}`} onClick={onDelete}>
              <IconTrash size={13} />
            </IconButton>
          ) : null}
        </div>
      </header>

      <button
        type="button"
        className={`cm-template__canvas cm-template__canvas--${id ?? 'default'}`}
        aria-pressed={active}
        aria-label={`Apply the ${name} template`}
        onClick={onApply}
      >
        {inView ? (
          <div className="cm-template__preview-wrapper">
            <CaptionSample
              caption={sampleConfig.caption}
              style={style}
              animation={animation}
              time={time}
              sizeScale={0.34}
              maxWordsPerLine={sampleConfig.maxWords}
              maxLines={sampleConfig.maxLines}
            />
            {/* Trait chips at bottom-left inside the canvas */}
            <div className="cm-template__traits-overlay">
              {traitsOf(style, animation).map((trait) => (
                <span key={trait} className="cm-template__trait">
                  {trait}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </button>
    </div>
  );
});

TemplateCard.displayName = 'TemplateCard';

export const TemplatesPanel: React.FC = () => {
  const project = useEditor((s) => s.project);
  const update = useEditor((s) => s.update);
  const updateStyle = useEditor((s) => s.updateStyle);
  const updateAnimation = useEditor((s) => s.updateAnimation);

  const { presets: mine, save, remove } = useMyPresets();
  const [favourites, toggleFavourite] = useFavourites('styles');

  const [source, setSource] = useState<'builtin' | 'mine'>('builtin');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState(false);
  const [draftName, setDraftName] = useState('');

  const setLastAppliedPresetId = useEditor((s) => s.setLastAppliedPresetId);

  const applyBuiltin = useCallback(
    (preset: StylePreset) => {
      updateStyle(preset.style);
      if (preset.motion) {
        updateAnimation({ enter: preset.motion, ...(preset.id === 'founders-of-uae' ? { exit: 'cut' as const, exitDuration: 0 } : {}) });
      }
      void loadFontFamily({ ...defaultStyle, ...preset.style }.fontFamily);
      setLastAppliedPresetId(preset.id);
    },
    [updateStyle, updateAnimation, setLastAppliedPresetId],
  );

  const applyMine = useCallback(
    (preset: MyPreset) => {
      update(
        {
          style: preset.style,
          animation: preset.animation,
          position: preset.position,
          segmentation: preset.segmentation,
        },
        { history: true },
      );
      void loadFontFamily(preset.style.fontFamily);
      setLastAppliedPresetId(preset.id);
    },
    [update, setLastAppliedPresetId],
  );

  const lastAppliedPresetId = useEditor((s) => s.lastAppliedPresetId);
  const activePreset = lastAppliedPresetId
    ? STYLE_PRESETS.find((p) => p.id === lastAppliedPresetId) ??
      mine.find((p) => p.id === lastAppliedPresetId)
    : null;

  const visibleBuiltin = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = STYLE_PRESETS;
    if (favoritesOnly) list = list.filter((p) => favourites.includes(p.id));
    if (selectedCategory !== 'all') {
      list = list.filter((p) => p.category === selectedCategory);
    }
    if (q) {
      return list.filter(
        (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
      );
    }
    // When in "All" view and a preset is selected, place it at the top so it is immediately accessible
    if (selectedCategory === 'all' && lastAppliedPresetId) {
      const activeIdx = list.findIndex((p) => p.id === lastAppliedPresetId);
      if (activeIdx > 0) {
        const activeItem = list[activeIdx];
        return [activeItem, ...list.slice(0, activeIdx), ...list.slice(activeIdx + 1)];
      }
    }
    return list;
  }, [query, selectedCategory, lastAppliedPresetId, favoritesOnly, favourites]);

  const visibleMine = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mine.filter((p) =>
      (!favoritesOnly || favourites.includes(p.id)) && (!q || p.name.toLowerCase().includes(q)),
    );
  }, [mine, query, favoritesOnly, favourites]);

  if (!project) return null;

  const cardMotion: AnimationSettings = {
    ...project.animation,
    exit: 'cut',
  };

  return (
    <div className="cm-templates">
      <SegmentTabs
        tabs={[
          { id: 'builtin', label: 'Built-in Templates' },
          { id: 'mine', label: 'My Presets' },
        ]}
        active={source}
        onChange={(id) => setSource(id as 'builtin' | 'mine')}
      />

      <div className="cm-templates__toolbar">
        <div className="cm-fonts__search">
          <IconSearch size={13} />
          <input
            value={query}
            placeholder="Find a template"
            aria-label="Find a template"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="cm-save-preset-btn"
          icon={
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
          }
          onClick={() => setNaming(true)}
        >
          Save preset
        </Button>
      </div>

      <div className="cm-template-category-chips" role="group" aria-label="Template favorites filter">
        <button type="button" className={`cm-category-chip ${!favoritesOnly ? 'is-active' : ''}`}
          aria-pressed={!favoritesOnly} onClick={() => setFavoritesOnly(false)}>All</button>
        <button type="button" className={`cm-category-chip ${favoritesOnly ? 'is-active' : ''}`}
          aria-pressed={favoritesOnly} onClick={() => { setFavoritesOnly(true); setSelectedCategory('all'); }}>
          ★ Favorites ({(source === 'builtin' ? STYLE_PRESETS : mine).filter((p) => favourites.includes(p.id)).length})
        </button>
      </div>

      {source === 'builtin' ? (
        <div className="cm-template-category-chips">
          <button
            type="button"
            className={`cm-category-chip ${selectedCategory === 'all' ? 'is-active' : ''}`}
            onClick={() => setSelectedCategory('all')}
          >
            All
          </button>
          {STYLE_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`cm-category-chip ${selectedCategory === cat.id ? 'is-active' : ''}`}
              onClick={() => setSelectedCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      ) : null}

      {naming ? (
        <div className="cm-templates__save">
          <input
            autoFocus
            value={draftName}
            placeholder="Name this preset"
            aria-label="Preset name"
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNaming(false);
              if (e.key === 'Enter') {
                save(capturePreset(draftName, project));
                setDraftName('');
                setNaming(false);
                setSource('mine');
              }
            }}
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              save(capturePreset(draftName, project));
              setDraftName('');
              setNaming(false);
              setSource('mine');
            }}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </div>
      ) : null}

      {source === 'builtin' ? (
        <>
          {activePreset && (
            <div className="cm-applied-preset-banner">
              <div className="cm-applied-preset-banner__content">
                <span className="cm-applied-preset-banner__tag">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Selected
                </span>
                <strong className="cm-applied-preset-banner__name">{activePreset.name}</strong>
                <span className="cm-applied-preset-banner__category">
                  ({ 'category' in activePreset ? activePreset.category : 'Custom' })
                </span>
              </div>
              <button
                type="button"
                className="cm-applied-preset-banner__btn"
                onClick={() => {
                  const el = document.getElementById(`cm-template-${activePreset.id}`);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              >
                Locate in list ↓
              </button>
            </div>
          )}

          {query ? null : (
            <p className="cm-field__hint">
              {STYLE_PRESETS.length} templates across {STYLE_CATEGORIES.length} categories.
            </p>
          )}
          <div className="cm-templates__list">
            {visibleBuiltin.length === 0 ? (
              <EmptyState compact title={favoritesOnly ? 'No matching favorites' : 'No match'}
                description={favoritesOnly ? 'Click the star on a template in All to save it here.' : `Nothing called “${query}”.`} />
            ) : (
              visibleBuiltin.map((preset) => (
                <TemplateCard
                  key={preset.id}
                  id={preset.id}
                  name={preset.name}
                  style={{ ...defaultStyle, ...preset.style }}
                  animation={{
                    ...cardMotion,
                    enter:
                      preset.motion ??
                      (preset.style.activeBoxEnabled ? 'activeWordPunch' : 'wordHighlight'),
                  }}
                  active={preset.id === lastAppliedPresetId}
                  badge={preset.badge}
                  favourite={favourites.includes(preset.id)}
                  onApply={() => applyBuiltin(preset)}
                  onToggleFavourite={() => toggleFavourite(preset.id)}
                />
              ))
            )}
          </div>
        </>
      ) : (
        <div className="cm-templates__list">
          {visibleMine.length === 0 ? (
            <EmptyState
              compact
              title={favoritesOnly ? 'No matching favorites' : 'No saved presets'}
              description={favoritesOnly ? 'Click the star on a saved preset in All to save it here.' : 'Style a caption the way you like it, then press Save preset.'}
            />
          ) : (
            visibleMine.map((preset) => (
              <TemplateCard
                key={preset.id}
                id={preset.id}
                name={preset.name}
                style={preset.style}
                animation={preset.animation}
                active={preset.id === lastAppliedPresetId}
                favourite={favourites.includes(preset.id)}
                onToggleFavourite={() => toggleFavourite(preset.id)}
                onApply={() => applyMine(preset)}
                onDelete={() => remove(preset.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};
