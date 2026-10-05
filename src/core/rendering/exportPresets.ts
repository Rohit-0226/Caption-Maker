import type { CaptionProject, VideoExportFormat, VideoExportQuality } from '../types/project';

export interface ExportPreset {
  id: string;
  name: string;
  description: string;
  format: VideoExportFormat;
  /** null keeps whatever the source is */
  width: number | null;
  height: number | null;
  fps: number | null;
}

export interface AspectRatioOption {
  id: string;
  label: string;
  ratio: string;
  width: number | null;
  height: number | null;
  description: string;
}

export const ASPECT_RATIOS: AspectRatioOption[] = [
  { id: 'source', label: 'Source (Original)', ratio: 'source', width: null, height: null, description: 'Matches source video resolution' },
  { id: '9:16', label: '9:16 Vertical', ratio: '9:16', width: 1080, height: 1920, description: 'Instagram Reels, YouTube Shorts, TikTok' },
  { id: '16:9', label: '16:9 Landscape', ratio: '16:9', width: 1920, height: 1080, description: 'YouTube, Desktop, TV' },
  { id: '1:1', label: '1:1 Square', ratio: '1:1', width: 1080, height: 1080, description: 'Instagram Feed, LinkedIn posts' },
  { id: '4:5', label: '4:5 Portrait', ratio: '4:5', width: 1080, height: 1350, description: 'Instagram Feed portrait' },
  { id: 'custom', label: 'Custom Dimensions', ratio: 'custom', width: null, height: null, description: 'Enter specific width & height' },
];

export interface QualityOption {
  id: VideoExportQuality;
  label: string;
  description: string;
  crf: number;
}

export const QUALITY_OPTIONS: QualityOption[] = [
  { id: 'high', label: 'High Quality', description: 'CRF 14 · Best clarity (~18–25 Mbps)', crf: 14 },
  { id: 'medium', label: 'Balanced Weight', description: 'CRF 22 · ~50% lighter file size (~8–12 Mbps)', crf: 22 },
  { id: 'low', label: 'Lightweight', description: 'CRF 28 · Smallest file size (~3–5 Mbps)', crf: 28 },
];

/**
 * One-click export targets.
 *
 * The vertical platforms all want 1080x1920 at 30fps. "Original" deliberately
 * changes nothing, which is the right default whenever the source is already
 * the shape the user wants.
 */
export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'original',
    name: 'Original',
    description: 'Keeps the source resolution and frame rate.',
    format: 'mp4',
    width: null,
    height: null,
    fps: null,
  },
  {
    id: 'reel',
    name: 'Instagram Reel',
    description: '1080 x 1920, 30fps.',
    format: 'mp4',
    width: 1080,
    height: 1920,
    fps: 30,
  },
  {
    id: 'short',
    name: 'YouTube Short',
    description: '1080 x 1920, 30fps.',
    format: 'mp4',
    width: 1080,
    height: 1920,
    fps: 30,
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: '1080 x 1920, 30fps.',
    format: 'mp4',
    width: 1080,
    height: 1920,
    fps: 30,
  },
  {
    id: 'overlay',
    name: 'Transparent Overlay',
    description: 'Captions only, with alpha, for another editor.',
    format: 'mov-alpha',
    width: null,
    height: null,
    fps: null,
  },
];

export interface ResolvedExportSpec {
  width: number;
  height: number;
  fps: number;
  keepsSourceResolution: boolean;
  keepsSourceFps: boolean;
  quality: VideoExportQuality;
  aspectRatio: string;
}

const evenDimension = (value: number, fallback: number): number => {
  const safe = Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
  return safe % 2 === 0 ? safe : safe + 1;
};

/**
 * Resolves nullable "Original" settings into concrete renderer dimensions.
 * H.264 requires even dimensions, so unusual odd-sized sources are rounded up
 * by a single pixel instead of failing near the end of a render.
 */
export const resolveExportSpec = (project: CaptionProject): ResolvedExportSpec => {
  const media = project.media;
  const keepsSourceResolution =
    project.exportSettings.width == null && project.exportSettings.height == null;
  const keepsSourceFps = project.exportSettings.fps == null;
  const quality = project.exportSettings.quality ?? 'high';

  const width = evenDimension(project.exportSettings.width ?? media?.width ?? 1080, 1080);
  const height = evenDimension(project.exportSettings.height ?? media?.height ?? 1920, 1920);

  let aspectRatio = project.exportSettings.aspectRatio ?? 'source';
  if (aspectRatio === 'source' && media?.aspectRatio) {
    aspectRatio = media.aspectRatio;
  }

  return {
    width,
    height,
    fps: Math.min(
      120,
      Math.max(1, Math.round(project.exportSettings.fps ?? media?.fps ?? 30)),
    ),
    keepsSourceResolution,
    keepsSourceFps,
    quality,
    aspectRatio,
  };
};
