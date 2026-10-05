import React from 'react';

export const FavouriteStar: React.FC<{
  active: boolean;
  label: string;
  onClick: () => void;
}> = ({ active, label, onClick }) => (
  <button
    type="button"
    className={`cm-star ${active ? 'is-active' : ''}`}
    aria-pressed={active}
    aria-label={active ? `Remove ${label}` : `Add ${label}`}
    title={active ? 'Remove from favourites' : 'Add to favourites'}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
  >
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
      <path
        d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  </button>
);

export interface FilterOption {
  value: string;
  label: string;
}

/** Favourites first, then Recent, then the categories — as the spec asks. */
export const GalleryFilter: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  favouriteCount: number;
  recentCount: number;
}> = ({ value, onChange, options, favouriteCount, recentCount }) => {
  const all: FilterOption[] = [
    { value: 'favourites', label: `★ Favorites (${favouriteCount})` },
    ...(recentCount > 0 ? [{ value: 'recent', label: 'Recent' }] : []),
    { value: 'all', label: 'All' },
    ...options,
  ];

  return (
    <div className="cm-gallery__filters" role="tablist" aria-label="Filter">
      {all.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={`cm-chip ${value === option.value ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};
