import React from 'react';

const Svg: React.FC<{ children: React.ReactNode; size?: number }> = ({
  children,
  size = 16,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

export const IconPlay: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconPause: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconUpload: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
    <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
  </Svg>
);

export const IconWaveform: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
  </Svg>
);

export const IconSparkle: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </Svg>
);

export const IconScissors: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="6" cy="18" r="2.4" />
    <path d="M8 7.5L19 18M19 6L8 16.5" />
  </Svg>
);

export const IconMerge: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M5 5h6a4 4 0 0 1 4 4v6a4 4 0 0 0 4 4" />
    <path d="M16 16l3 3-3 3" />
  </Svg>
);

export const IconTrash: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    <path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
  </Svg>
);

export const IconUndo: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M4 9h10a5 5 0 0 1 0 10h-3" />
    <path d="M7.5 5.5L4 9l3.5 3.5" />
  </Svg>
);

export const IconRedo: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M20 9H10a5 5 0 0 0 0 10h3" />
    <path d="M16.5 5.5L20 9l-3.5 3.5" />
  </Svg>
);

export const IconSearch: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6" />
    <path d="M15.5 15.5L20 20" />
  </Svg>
);

export const IconDownload: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M12 4v12m0 0l-4.5-4.5M12 16l4.5-4.5" />
    <path d="M4 18v1.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V18" />
  </Svg>
);

export const IconChevron: React.FC<{ size?: number; open?: boolean }> = ({
  size = 16,
  open = false,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      transform: open ? 'rotate(90deg)' : 'none',
      transition: 'transform var(--duration-fast) var(--ease-out)',
    }}
    aria-hidden
  >
    <path d="M9 5l7 7-7 7" />
  </svg>
);

export const IconVolume: React.FC<{ size?: number; muted?: boolean }> = ({
  size = 16,
  muted = false,
}) => (
  <Svg size={size}>
    <path d="M4 9.5v5h3l4 3.5V6l-4 3.5z" fill="currentColor" stroke="none" />
    {muted ? (
      <path d="M15 9.5l4.5 5M19.5 9.5l-4.5 5" />
    ) : (
      <>
        <path d="M14.5 9a4 4 0 0 1 0 6" />
        <path d="M17 6.5a7.5 7.5 0 0 1 0 11" />
      </>
    )}
  </Svg>
);

export const IconZoomIn: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6" />
    <path d="M11 8.5v5M8.5 11h5M15.5 15.5L20 20" />
  </Svg>
);

export const IconZoomOut: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6" />
    <path d="M8.5 11h5M15.5 15.5L20 20" />
  </Svg>
);

export const IconLogo: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="4" fill="var(--accent)" opacity="0.18" />
    <rect
      x="2.75"
      y="4.75"
      width="18.5"
      height="14.5"
      rx="3.4"
      stroke="var(--accent)"
      strokeWidth="1.4"
    />
    <path d="M6.5 14.5h6M6.5 11h11" stroke="var(--accent)" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

export const IconReplace: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M14 4l4 4-4 4" />
    <path d="M4 8h14" />
    <path d="M10 20l-4-4 4-4" />
    <path d="M20 16H6" />
  </Svg>
);

export const IconStar: React.FC<{ size?: number; filled?: boolean }> = ({ size = 16, filled = false }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export const IconText: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" y1="20" x2="15" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </Svg>
);

export const IconLayers: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </Svg>
);

export const IconSliders: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </Svg>
);

export const IconWand: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M15 4l5 5-11 11-5-5z" />
    <line x1="18" y1="2" x2="18" y2="5" />
    <line x1="22" y1="6" x2="19" y2="6" />
    <line x1="14" y1="1" x2="14" y2="3" />
  </Svg>
);

export const IconFolder: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </Svg>
);

export const IconSettings: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
);

export const IconCheck: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

export const IconEye: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const IconEyeOff: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </Svg>
);

export const IconPunctuation: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 8a2.5 2.5 0 0 0-2.5 2.5c0 1.5 1 2.5 2.5 2.5s2.5-1 2.5-2.5V8H7z" />
    <path d="M17 8a2.5 2.5 0 0 0-2.5 2.5c0 1.5 1 2.5 2.5 2.5s2.5-1 2.5-2.5V8h-2z" />
    <circle cx="7" cy="18" r="1.25" fill="currentColor" stroke="none" />
    <circle cx="17" cy="18" r="1.25" fill="currentColor" stroke="none" />
  </svg>
);

export const IconGaps: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 6v12M8 9v6M16 9v6M20 6v12" />
    <line x1="10.5" y1="12" x2="13.5" y2="12" strokeWidth="1.8" strokeDasharray="1.5 1.5" />
  </svg>
);

export const IconSync: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21.5 2v6h-6M2.5 22v-6h6" />
    <path d="M2.5 11.5a9 9 0 0 1 15.36-5.36L21.5 8M21.5 12.5a9 9 0 0 1-15.36 5.36L2.5 16" />
  </svg>
);

export const IconZap: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

export const IconCasing: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 18l4.5-12h1L13 18M5 14h6" />
    <path d="M16 12a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm3 0v6" />
  </svg>
);

export const IconVideo: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="3" />
    <path d="M7 4v16M17 4v16M2 12h20M2 8h5M2 16h5M17 8h5M17 16h5" />
  </svg>
);

export const IconPalette: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="12.5" r="1.5" fill="currentColor" stroke="none" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.7 1.7-1.6 0-.4-.2-.8-.4-1.1-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8h2.1c4 0 7.3-3.3 7.3-7.3 0-5-4.4-8.9-10-8.9z" />
  </svg>
);

export const IconTransparency: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h6v6H3zM9 3h6v6H9zM15 9h6v6h-6zM9 15h6v6H9z" fill="currentColor" fillOpacity="0.3" stroke="none" />
  </svg>
);

export const IconAlignTop: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="4" y1="4" x2="20" y2="4" strokeWidth="2.5" />
    <rect x="6" y="8" width="12" height="6" rx="1.5" />
  </svg>
);

export const IconAlignCenter: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="4" y1="12" x2="20" y2="12" strokeDasharray="2 2" strokeOpacity="0.6" />
    <rect x="6" y="9" width="12" height="6" rx="1.5" />
  </svg>
);

export const IconAlignBottom: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="4" y1="20" x2="20" y2="20" strokeWidth="2.5" />
    <rect x="6" y="10" width="12" height="6" rx="1.5" />
  </svg>
);

export const IconSubtitles: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="3" />
    <path d="M7 15h3M14 15h3M7 10h10" />
  </svg>
);

export const IconX: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Svg>
);

export const IconAlert: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </Svg>
);

/** A word with a highlighted backing — the "active spoken word" role. */
export const IconHighlight: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="10" rx="2.5" fill="currentColor" fillOpacity="0.22" />
    <path d="M7.5 14.5l2.5-6 2.5 6M8.4 12.5h3.2M15 9v5.5" />
  </Svg>
);

export const IconHourglass: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" />
  </Svg>
);

export const IconBox: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <rect x="3" y="6" width="18" height="12" rx="3" fill="currentColor" fillOpacity="0.22" />
    <path d="M7 12h10" />
  </Svg>
);

export const IconPen: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <path d="M2 2l7.6 7.6" />
    <circle cx="11" cy="11" r="2" />
  </Svg>
);

export const IconShadow: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <rect x="7" y="7" width="13" height="13" rx="2.5" fill="currentColor" fillOpacity="0.22" stroke="none" />
    <rect x="4" y="4" width="13" height="13" rx="2.5" />
  </Svg>
);

export const IconBurst: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </Svg>
);

export const IconCrown: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
  </Svg>
);

export const IconDatabase: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </Svg>
);

export const IconChart: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);

export const IconTrophy: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
    <path d="M17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3" />
  </Svg>
);

export const IconShare: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </Svg>
);

export const IconCopy: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);

export const IconExternalLink: React.FC<{ size?: number }> = (p) => (
  <Svg {...p}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </Svg>
);



