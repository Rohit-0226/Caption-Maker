import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../app/store';
import { useFavourites, useRecents } from '../../app/preferences';
import {
  FONT_CATALOGUE,
  FONT_CATEGORIES,
  loadFont,
  type FontDefinition,
} from '../../core/rendering/fonts';
import { api, type CustomFont } from '../../app/api';
import { Button } from '../../components/controls';
import { ErrorState, Spinner } from '../../components/feedback';
import { IconSearch, IconTrash, IconUpload } from '../../components/icons';
import { FavouriteStar } from './GalleryChrome';
import { useInView } from './sampleClock';

const PREVIEW_TEXT = 'Your caption';

const FontRow = React.memo<{
  font: FontDefinition;
  active: boolean;
  favourite: boolean;
  onPick: (font: FontDefinition) => void;
  onToggleFavourite: (family: string) => void;
  onDelete?: (font: FontDefinition) => void;
}>(({ font, active, favourite, onPick, onToggleFavourite, onDelete }) => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, '200px');
  const [ready, setReady] = useState(font.source === 'system');

  // the font file is only fetched when its row scrolls into view
  useEffect(() => {
    if (!inView || ready) return;
    let cancelled = false;
    void loadFont(font)
      .then(() => !cancelled && setReady(true))
      .catch(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [inView, ready, font]);

  return (
    <div ref={ref} className={`cm-font-row ${active ? 'is-active' : ''}`}>
      <button
        type="button"
        className="cm-font-row__main"
        aria-pressed={active}
        onClick={() => onPick(font)}
      >
        <span
          className="cm-font-row__preview truncate"
          style={{
            fontFamily: `"${font.family}", "Segoe UI", sans-serif`,
            fontWeight: font.weights.includes(700) ? 700 : font.weights[0] ?? 400,
            opacity: ready ? 1 : 0.35,
          }}
        >
          {font.family}
        </span>
        <span className="cm-font-row__name truncate">
          {font.source === 'system' ? 'System' : 'Google'} · {font.categories.filter((c) => c !== 'recommended').join(', ') || font.categories[0]}
        </span>
      </button>

      {onDelete ? (
        <button
          type="button"
          className="cm-icon-button"
          aria-label={`Delete ${font.family}`}
          title="Delete this font"
          onClick={() => onDelete(font)}
        >
          <IconTrash size={13} />
        </button>
      ) : null}

      <FavouriteStar
        active={favourite}
        label={`${font.family} favourite`}
        onClick={() => onToggleFavourite(font.family)}
      />
    </div>
  );
});

FontRow.displayName = 'FontRow';

export const FontBrowser: React.FC = () => {
  const current = useEditor((s) => s.project?.style.fontFamily);
  const updateStyle = useEditor((s) => s.updateStyle);

  const [favourites, toggleFavourite] = useFavourites('fonts');
  const [recents, pushRecent] = useRecents('fonts');

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [custom, setCustom] = useState<CustomFont[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const refreshCustom = useCallback(() => {
    api.listFonts().then(setCustom).catch(() => setCustom([]));
  }, []);

  useEffect(refreshCustom, [refreshCustom]);

  const customDefinitions: FontDefinition[] = useMemo(
    () =>
      custom.map((f) => ({
        family: f.family,
        categories: ['custom'],
        weights: [400, 700],
        source: 'custom',
        url: f.url,
      })),
    [custom],
  );

  const all = useMemo(
    () => [...customDefinitions, ...FONT_CATALOGUE],
    [customDefinitions],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = all.filter((f) => !q || f.family.toLowerCase().includes(q));

    if (category === 'all') return matching;
    if (category === 'favourites') return matching.filter((f) => favourites.includes(f.family));
    if (category === 'recent') {
      return recents
        .map((family) => matching.find((f) => f.family === family))
        .filter((f): f is FontDefinition => Boolean(f));
    }
    return matching.filter((f) => f.categories.includes(category as FontDefinition['categories'][number]));
  }, [all, query, category, favourites, recents]);

  const pick = useCallback(
    (font: FontDefinition) => {
      void loadFont(font);
      updateStyle({ fontFamily: font.family });
      pushRecent(font.family);
    },
    [updateStyle, pushRecent],
  );

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const added = await api.uploadFont(file);
        refreshCustom();
        setCategory('custom');
        // make it usable straight away
        await loadFont({
          family: added.family,
          categories: ['custom'],
          weights: [400, 700],
          source: 'custom',
          url: added.url,
        });
        updateStyle({ fontFamily: added.family });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [refreshCustom, updateStyle],
  );

  const remove = useCallback(
    async (font: FontDefinition) => {
      const record = custom.find((f) => f.family === font.family);
      if (!record) return;
      await api.deleteFont(record.id).catch(() => undefined);
      refreshCustom();
    },
    [custom, refreshCustom],
  );

  const filters = [
    { value: 'all', label: `All (${all.length})` },
    { value: 'favourites', label: `★ Favorites (${favourites.length})` },
    ...(recents.length > 0 ? [{ value: 'recent', label: 'Recent' }] : []),
    ...FONT_CATEGORIES.map((c) => ({ value: c.id, label: c.label })),
  ];

  return (
    <section className="cm-fonts">
      <div className="cm-fonts__search">
        <IconSearch size={13} />
        <input
          value={query}
          placeholder={`Search ${all.length} fonts`}
          aria-label="Search fonts"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {(
        <div className="cm-gallery__filters">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`cm-chip ${category === f.value ? 'is-active' : ''}`}
              onClick={() => setCategory(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className="cm-fonts__list">
        {visible.length === 0 ? (
          <p className="cm-gallery__empty">
            {query ? `No font matches “${query}”.` : 'Nothing in this category yet.'}
          </p>
        ) : (
          visible.map((font) => (
            <FontRow
              key={font.family}
              font={font}
              active={font.family === current}
              favourite={favourites.includes(font.family)}
              onPick={pick}
              onToggleFavourite={toggleFavourite}
              onDelete={font.source === 'custom' ? remove : undefined}
            />
          ))
        )}
      </div>

      <div className="cm-fonts__upload">
        <Button
          block
          size="sm"
          loading={uploading}
          icon={<IconUpload size={13} />}
          onClick={() => fileRef.current?.click()}
        >
          Upload font
        </Button>
        <p className="cm-field__hint">TTF, OTF, WOFF or WOFF2. Used in preview and export.</p>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </div>

      {uploading ? <Spinner size={13} label="Uploading font" /> : null}

      {error ? (
        <ErrorState title="Font upload failed" message={error} onDismiss={() => setError(null)} />
      ) : null}
    </section>
  );
};
