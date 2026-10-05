import type { CaptionProject, RenderFont, RenderScene } from '../types/project';
import { FONT_CATALOGUE } from './fonts';
import { resolveExportSpec } from './exportPresets';

export interface BuildSceneOptions {
  /** what the <Video> tag should load; null renders captions only */
  mediaSrc: string | null;
  /** override the frame size, e.g. for an audio-only project */
  width?: number;
  height?: number;
  fps?: number;
  /** uploaded fonts, so a custom family resolves to its file */
  customFonts?: { family: string; url: string }[];
}

/**
 * Works out which font the scene needs and where to get it.
 *
 * Custom fonts win over the built-in catalogue, so renaming an upload to match
 * a bundled family uses the user's file.
 */
const resolveFonts = (
  family: string,
  usedWeight: number,
  customFonts: { family: string; url: string }[] = [],
): RenderFont[] => {
  const custom = customFonts.find((f) => f.family === family);
  if (custom) return [{ family, source: 'custom', url: custom.url, usedWeight }];

  const known = FONT_CATALOGUE.find((f) => f.family === family);
  if (!known || known.source === 'system') {
    return known ? [{ family, source: 'system', usedWeight }] : [];
  }

  // make sure the weight in use is actually requested, even if it is off-catalogue
  const weights = known.weights.includes(usedWeight)
    ? known.weights
    : [...known.weights, usedWeight].sort((a, b) => a - b);

  return [{ family, source: 'google', weights, usedWeight }];
};

/** Frame size used when the source has no video track of its own. */
export const AUDIO_ONLY_FRAME = { width: 1080, height: 1920 };

export const projectDuration = (project: CaptionProject): number => {
  const mediaDuration = project.media?.duration ?? 0;
  const last = project.captions[project.captions.length - 1];
  const captionsDuration = last ? last.end + 0.5 : 0;
  return Math.max(mediaDuration, captionsDuration, 5);
};

/**
 * Collapses a project into exactly what the renderer needs.
 *
 * Both the editor preview and the export path call this, which is what keeps
 * the two identical.
 */
export const buildScene = (
  project: CaptionProject,
  options: BuildSceneOptions,
): RenderScene => {
  const media = project.media;

  /**
   * The frame comes from the same resolver the export uses, so the editor
   * preview and the render agree on it to the pixel. They used to differ for an
   * odd-sized source, because only the export rounded up to an even dimension —
   * and any disagreement about the frame is a disagreement about how big a
   * caption looks inside it.
   */
  const spec = resolveExportSpec(project);
  const width = options.width ?? (media || project.exportSettings.width != null ? spec.width : AUDIO_ONLY_FRAME.width);
  const height = options.height ?? (media || project.exportSettings.height != null ? spec.height : AUDIO_ONLY_FRAME.height);
  const fps = options.fps ?? spec.fps;
  const duration = projectDuration(project);

  return {
    width,
    height,
    fps,
    durationInFrames: Math.max(1, Math.round(duration * fps)),
    captions: project.captions,
    style: project.style,
    position: project.position,
    animation: project.animation,
    background: project.background,
    maxLines: project.segmentation.maxLines,
    maxWordsPerLine: project.segmentation.maxWordsPerLine,
    fonts: resolveFonts(project.style.fontFamily, project.style.fontWeight, options.customFonts),
    mediaSrc: options.mediaSrc,
    mediaKind: project.media?.kind ?? null,
  };
};
