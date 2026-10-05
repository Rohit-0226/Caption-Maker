export type SafeZonePlatform = 'none' | 'tiktok' | 'reels' | 'shorts';

export interface SafeZoneRegion {
  /** percentages of the frame */
  top?: number;
  bottom?: number;
  right?: number;
  label: string;
}

export interface SafeZoneSpec {
  id: SafeZonePlatform;
  label: string;
  regions: SafeZoneRegion[];
}

/**
 * Where each platform draws its own interface over your video.
 *
 * These are approximations of the vertical 9:16 layouts and are shown in the
 * editor only — nothing here is ever baked into an export.
 */
export const SAFE_ZONES: SafeZoneSpec[] = [
  { id: 'none', label: 'Off', regions: [] },
  {
    id: 'tiktok',
    label: 'TikTok',
    regions: [
      { top: 10, label: 'Top bar' },
      { bottom: 22, label: 'Caption and handle' },
      { right: 20, label: 'Action buttons' },
    ],
  },
  {
    id: 'reels',
    label: 'Reels',
    regions: [
      { top: 9, label: 'Top bar' },
      { bottom: 25, label: 'Caption and audio' },
      { right: 18, label: 'Action buttons' },
    ],
  },
  {
    id: 'shorts',
    label: 'Shorts',
    regions: [
      { top: 8, label: 'Top bar' },
      { bottom: 20, label: 'Title and controls' },
      { right: 17, label: 'Action buttons' },
    ],
  },
];

export const getSafeZone = (id: SafeZonePlatform): SafeZoneSpec =>
  SAFE_ZONES.find((z) => z.id === id) ?? SAFE_ZONES[0];
