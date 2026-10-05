import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useEditor } from '../../app/store';
import { useFavourites, useRecents } from '../../app/preferences';
import {
  ENTER_ANIMATIONS,
  MOTION_CATEGORIES,
  getEnterAnimation,
  type EnterAnimationPreset,
} from '../../core/rendering/animations';
import type { AnimationSettings, EnterAnimationId } from '../../core/types/project';
import { buildSampleCaption, CaptionSample, SAMPLE_DURATION } from './CaptionSample';
import { useSampleClock } from './sampleClock';
import { FavouriteStar, GalleryFilter } from './GalleryChrome';

const SAMPLE = buildSampleCaption('YOUR CAPTION');

export const MotionGallery: React.FC = () => {
  const animation = useEditor((s) => s.project?.animation);
  const style = useEditor((s) => s.project?.style);
  const update = useEditor((s) => s.updateAnimation);
  const [favourites, toggleFavourite] = useFavourites('motions');
  const [recents, pushRecent] = useRecents('motions');
  const [filter, setFilter] = useState<string>('all');
  const [replayToken, setReplayToken] = useState(1);

  const active = getEnterAnimation(animation?.enter ?? 'none');
  const previewTime = useSampleClock(replayToken, SAMPLE_DURATION);
  const previewAnimation: AnimationSettings = useMemo(
    () => ({
      ...(animation ?? {
        enter: 'none',
        exit: 'cut',
        enterDuration: 0.24,
        exitDuration: 0.16,
        bounciness: 45,
        travel: 48,
      }),
      exit: 'cut',
    }),
    [animation],
  );

  useEffect(() => {
    setReplayToken((token) => token + 1);
  }, [animation?.enter]);

  const pick = useCallback(
    (id: EnterAnimationId) => {
      update({ enter: id });
      pushRecent(id);
    },
    [update, pushRecent],
  );

  const visible = useMemo(() => {
    if (filter === 'favourites') {
      return ENTER_ANIMATIONS.filter((preset) => favourites.includes(preset.id));
    }
    if (filter === 'recent') {
      return recents
        .map((id) => ENTER_ANIMATIONS.find((preset) => preset.id === id))
        .filter((preset): preset is EnterAnimationPreset => Boolean(preset));
    }
    if (filter === 'all') return ENTER_ANIMATIONS;
    return ENTER_ANIMATIONS.filter((preset) => preset.category === filter);
  }, [filter, favourites, recents]);

  if (!animation || !style) return null;

  return (
    <section className="cm-gallery cm-motion-gallery">
      <div className="cm-motion-preview">
        <button
          type="button"
          className="cm-motion-preview__canvas"
          aria-label={`Replay ${active.label} motion preview`}
          title="Click to replay"
          onClick={() => setReplayToken((token) => token + 1)}
        >
          <CaptionSample
            caption={SAMPLE}
            style={style}
            animation={previewAnimation}
            time={previewTime}
            sizeScale={0.72}
            maxWordsPerLine={2}
            maxLines={2}
          />
          <span className="cm-motion-preview__replay">↻ Replay</span>
        </button>
        <div className="cm-motion-preview__copy">
          <strong>{active.label}</strong>
          <span>{active.description}</span>
        </div>
      </div>

      <GalleryFilter
        value={filter}
        onChange={setFilter}
        favouriteCount={favourites.length}
        recentCount={recents.length}
        options={MOTION_CATEGORIES.map((category) => ({
          value: category.id,
          label: category.label,
        }))}
      />

      {visible.length === 0 ? (
        <p className="cm-gallery__empty">Nothing here yet.</p>
      ) : (
        <div className="cm-motion-options">
          {visible.map((preset) => (
            <div
              key={preset.id}
              className={`cm-motion-option ${animation.enter === preset.id ? 'is-active' : ''}`}
            >
              <button
                type="button"
                className="cm-motion-option__pick"
                aria-pressed={animation.enter === preset.id}
                title={preset.description}
                onClick={() => pick(preset.id)}
              >
                {preset.label}
              </button>
              <FavouriteStar
                active={favourites.includes(preset.id)}
                label={`${preset.label} favourite`}
                onClick={() => toggleFavourite(preset.id)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
