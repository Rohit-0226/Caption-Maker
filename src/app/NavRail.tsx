import React from 'react';

export type RailSection =
  | 'captions'
  | 'system'
  | 'templates'
  | 'style'
  | 'motion'
  | 'ai'
  | 'transcribe'
  | 'presets';

interface RailItem {
  id: RailSection;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

const ITEMS: RailItem[] = [
  {
    id: 'captions',
    label: 'Captions',
    hint: 'Subtitle editor & audio transcript',
    icon: (
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 6h16M4 12h10M4 18h14" />
      </svg>
    ),
  },
  {
    id: 'templates',
    label: 'Templates',
    hint: 'Viral creator presets & custom styles',
    icon: (
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
      </svg>
    ),
  },
  {
    id: 'ai',
    label: 'AI Studio',
    hint: 'Smart assistant, highlights & Hinglish fixes',
    icon: (
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    ),
  },
  {
    id: 'system',
    label: 'Projects',
    hint: 'Project library & management',
    icon: (
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

export const NavRail: React.FC<{
  active: RailSection;
  onChange: (section: RailSection) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}> = ({ active, onChange, isCollapsed, onToggleCollapse }) => {
  return (
    <nav className="cm-rail" aria-label="Studio Tools">
      <div className="cm-rail__tools">
        {ITEMS.map((item) => {
          const isActive = !isCollapsed && active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`cm-rail__item ${isActive ? 'is-active' : ''}`}
              aria-current={isActive}
              title={`${item.label} — ${item.hint}`}
              onClick={() => onChange(item.id)}
            >
              <span className="cm-rail__icon">{item.icon}</span>
              <span className="cm-rail__label">{item.label}</span>
            </button>
          );
        })}
      </div>

      {onToggleCollapse ? (
        <div className="cm-rail__bottom">
          <button
            type="button"
            className={`cm-rail__collapse-btn ${isCollapsed ? 'is-collapsed' : ''}`}
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand Drawer (Ctrl+B)' : 'Collapse Drawer (Ctrl+B)'}
            aria-label={isCollapsed ? 'Expand Drawer' : 'Collapse Drawer'}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {isCollapsed ? (
                <polyline points="9 18 15 12 9 6" />
              ) : (
                <polyline points="15 18 9 12 15 6" />
              )}
            </svg>
          </button>
        </div>
      ) : null}
    </nav>
  );
};
