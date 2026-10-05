import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../app/store';
import { useFavourites, useRecents } from '../../app/preferences';
import { defaultStyle } from '../../core/project/defaults';
import { STYLE_CATEGORIES, STYLE_PRESETS, type StylePreset } from '../../core/rendering/presets';
import { loadFontFamily } from '../../core/rendering/fonts';
import type { AnimationSettings, CaptionStyle } from '../../core/types/project';
import { buildSampleCaption, CaptionSample, SAMPLE_DURATION } from './CaptionSample';
import { useInView } from './sampleClock';
import { FavouriteStar, GalleryFilter } from './GalleryChrome';

const SAMPLE = buildSampleCaption('YOUR CAPTION HERE');

/** Styles are appearance only, so the card holds motion still at its end state. */
const STATIC_MOTION: AnimationSettings = {
  enter: 'none',
  exit: 'cut',
  enterDuration: 0.01,
  exitDuration: 0.01,
  bounciness: 0,
  travel: 0,
};

const CARD_WIDTH = 124;

interface CardProps {
  preset: StylePreset;
  active: boolean;
  favourite: boolean;
  onPick: (preset: StylePreset) => void;
  onToggleFavourite: (id: string) => void;
}

const StyleCard = React.memo<CardProps>(
  ({ preset, active, favourite, onPick, onToggleFavourite }) => {
    const ref = useRef<HTMLDivElement>(null);
    const inView = useInView(ref);
    const [fontReady, setFontReady] = useState(false);

    const style: CaptionStyle = useMemo(
      () => ({ ...defaultStyle, ...preset.style }),
      [preset],
    );

    // only fetch the font once the card is actually on screen
    React.useEffect(() => {
      if (!inView || fontReady) return;
      let cancelled = false;
      void loadFontFamily(style.fontFamily).then(() => {
        if (!cancelled) setFontReady(true);
      });
      return () => {
        cancelled = true;
      };
    }, [inView, fontReady, style.fontFamily]);

    // shrink the real 1080-wide look down to the card
    const sizeScale = CARD_WIDTH / 1080 * 2.6;

    return (
      <div
        ref={ref}
        className={`cm-card ${active ? 'is-active' : ''}`}
      >
        <button
          type="button"
          className="cm-card__canvas"
          aria-pressed={active}
          aria-label={`Use the ${preset.name} caption style`}
          onClick={() => onPick(preset)}
        >
          {inView ? (
            <CaptionSample
              caption={SAMPLE}
              style={style}
              animation={STATIC_MOTION}
              time={SAMPLE_DURATION}
              sizeScale={sizeScale}
              maxWordsPerLine={2}
              maxLines={2}
            />
          ) : null}
        </button>
        <div className="cm-card__footer">
          <span className="cm-card__name truncate">{preset.name}</span>
          <FavouriteStar
            active={favourite}
            label={`${preset.name} favourite`}
            onClick={() => onToggleFavourite(preset.id)}
          />
        </div>
      </div>
    );
  },
);

StyleCard.displayName = 'StyleCard';

export const StyleGallery: React.FC = () => {
  const currentFont = useEditor((s) => s.project?.style.fontFamily);
  const update = useEditor((s) => s.updateStyle);

  const [favourites, toggleFavourite] = useFavourites('styles');
  const [recents, pushRecent] = useRecents('styles');
  const [filter, setFilter] = useState<string>('all');

  const pick = useCallback(
    (preset: StylePreset) => {
      // appearance only — whatever motion is selected stays selected
      update(preset.style);
      pushRecent(preset.id);
      void loadFontFamily({ ...defaultStyle, ...preset.style }.fontFamily);
    },
    [update, pushRecent],
  );

  const visible = useMemo(() => {
    if (filter === 'favourites') return STYLE_PRESETS.filter((p) => favourites.includes(p.id));
    if (filter === 'recent') {
      return recents
        .map((id) => STYLE_PRESETS.find((p) => p.id === id))
        .filter((p): p is StylePreset => Boolean(p));
    }
    if (filter === 'all') return STYLE_PRESETS;
    return STYLE_PRESETS.filter((p) => p.category === filter);
  }, [filter, favourites, recents]);

  // a style is "active" when its font matches — presets do not persist an id
  const activeId = useMemo(
    () => STYLE_PRESETS.find((p) => p.style.fontFamily === currentFont)?.id,
    [currentFont],
  );

  return (
    <section className="cm-gallery cm-style-gallery">
      <GalleryFilter
        value={filter}
        onChange={setFilter}
        favouriteCount={favourites.length}
        recentCount={recents.length}
        options={STYLE_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
      />

      {visible.length === 0 ? (
        <p className="cm-gallery__empty">Nothing here yet.</p>
      ) : (
        <div className="cm-style-grid">
          {visible.map((preset) => (
            <StyleCard
              key={preset.id}
              preset={preset}
              active={preset.id === activeId}
              favourite={favourites.includes(preset.id)}
              onPick={pick}
              onToggleFavourite={toggleFavourite}
            />
          ))}
        </div>
      )}
    </section>
  );
};
