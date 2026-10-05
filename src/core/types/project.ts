/**
 * The Caption Maker project schema.
 *
 * This is the single source of truth persisted to disk. Every field the editor
 * can change lives here, so a saved project reopens exactly as it was left.
 *
 * The schema is versioned: bump CURRENT_SCHEMA_VERSION and add a migration in
 * core/project/migrate.ts whenever the shape changes incompatibly.
 */

export const CURRENT_SCHEMA_VERSION = 5;

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type MediaKind = 'video' | 'audio';

export interface MediaInfo {
  /** absolute path on disk to the imported source */
  path: string;
  fileName: string;
  kind: MediaKind;
  /** bytes */
  size: number;
  /** seconds */
  duration: number;
  hasAudio: boolean;
  /** video only; null for audio-only sources */
  width: number | null;
  height: number | null;
  fps: number | null;
  /** e.g. "9:16" — derived, stored for convenience */
  aspectRatio: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  pixelFormat?: string | null;
  isWebCompatible?: boolean;
  importedAt: string;
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

export type LanguageCode =
  | 'auto'
  | 'en'
  | 'en-IN'
  | 'hinglish'
  | 'hi'
  | 'ur'
  | 'pa'
  | 'bn'
  | 'mr'
  | 'gu'
  | 'ta'
  | 'te'
  | 'kn'
  | 'ml';
export type HinglishDomain = 'general' | 'tech' | 'business' | 'vlog' | 'education';

export type WordScript = 'en' | 'hi' | 'num' | 'punct';

export interface TranscriptWord {
  text: string;
  /** seconds from the start of the media */
  start: number;
  end: number;
  /** integer milliseconds for exact frame timing */
  start_ms?: number;
  end_ms?: number;
  /** detected script classification */
  script?: WordScript;
  /** true if term is from the approved lexicon */
  locked?: boolean;
  /** 0..1 where the provider reports it, otherwise null */
  confidence: number | null;
}

/**
 * The raw provider output. Kept separate from captions so caption grouping can
 * be regenerated at any time without paying for transcription again.
 */
export interface Transcript {
  text: string;
  words: TranscriptWord[];
  language: LanguageCode;
  /** what the provider actually detected, when it reports it */
  detectedLanguage: string | null;
  providerId: string;
  modelId: string;
  createdAt: string;
  /** seconds of wall-clock time the transcription took */
  durationMs: number;
  /** immutable raw model output */
  asr_raw?: string;
  /** which engines ran, how well the words cover the speech, and what was corrected */
  quality?: import('../speech/quality').TranscriptQuality;
}

// ---------------------------------------------------------------------------
// Client terminology
// ---------------------------------------------------------------------------

export interface TerminologyDocument {
  /** absolute path to the project-scoped source PDF */
  path: string;
  fileName: string;
  /** bytes */
  size: number;
  pageCount: number;
  extractedCharacterCount: number;
  uploadedAt: string;
}

export interface TerminologyRule {
  preferred: string;
  alternatives: string[];
}

/**
 * Optional client vocabulary learned from a reference PDF.
 *
 * Only the compact transcription sample and preferred spellings are persisted
 * in project.json. The original PDF stays beside the project so it can be
 * replaced, removed or analysed again later without bloating every save.
 */
export interface TerminologyContext {
  document: TerminologyDocument | null;
  /** canonical words and short phrases, ordered by likely usefulness */
  terms: string[];
  /** explicit Preferred -> Avoid/Alternative mappings found in glossary tables */
  rules: TerminologyRule[];
  /** representative PDF prose used as preceding context by capable providers */
  transcriptionSample: string | null;
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
  start_ms?: number;
  end_ms?: number;
  script?: WordScript;
  locked?: boolean;
  confidence?: number | null;
  /** styled with the emphasis colour and scale */
  emphasis: boolean;
}

export interface Caption {
  /** Original end before Remove Gaps; retained for Restore and shifted with delay. */
  gapRestoreEnd?: number;
  id: string;
  start: number;
  end: number;
  words: CaptionWord[];
  /**
   * True once the user has touched this caption by hand. Regeneration warns
   * before discarding edited captions.
   */
  edited: boolean;
  /** immutable raw model output */
  asr_raw?: string;
  /** deterministic transliterated / lexicon-repaired output */
  pipeline_output?: string;
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

export interface SegmentationSettings {
  /**
   * The primary readability control: how many words may sit on one visual line.
   * A caption's total word budget is this multiplied by maxLines.
   */
  maxWordsPerLine: number;
  maxLines: 1 | 2 | 3;
  /**
   * Words per second a viewer is expected to keep up with. A caption that would
   * run faster than this is split at a natural boundary, or given more time
   * where the gap to the next caption allows it.
   */
  maxReadingSpeed: number;
  /**
   * Safety fallback only, to stop a line of very long words overflowing the
   * frame. Not shown in the default UI — words per line is the real control.
   */
  maxCharacters: number;
  /** seconds */
  minDuration: number;
  maxDuration: number;
  /** seconds of silence that force a caption break */
  minGap: number;
  preferPunctuation: boolean;
  preferPauses: boolean;
}

/** The friendly form of maxReadingSpeed. */
export type ReadingPace = 'relaxed' | 'normal' | 'fast';

export const READING_PACE_WPS: Record<ReadingPace, number> = {
  relaxed: 2.2,
  normal: 3.0,
  fast: 4.0,
};

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

export type TextAlign = 'left' | 'center' | 'right';

export type PositionPreset =
  | 'top'
  | 'upperMiddle'
  | 'center'
  | 'lowerMiddle'
  | 'bottom'
  | 'custom';

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  uppercase: boolean;
  align: TextAlign;
  letterSpacing: number;
  lineHeight: number;
  wordSpacing: number;

  color: string;
  activeWordColor: string;
  /**
   * Words the speaker has not reached yet, for read-along motions. The whole
   * phrase is on screen from the start; this is the colour it waits in.
   */
  futureWordColor: string;
  emphasisEnabled: boolean;
  emphasisColor: string;
  emphasisScale: number;
  opacity: number;

  strokeEnabled: boolean;
  strokeWidth: number;
  strokeColor: string;

  shadowEnabled: boolean;
  shadowBlur: number;
  shadowOffsetY: number;
  shadowColor: string;

  boxEnabled: boolean;
  boxColor: string;
  boxPaddingX: number;
  boxPaddingY: number;
  boxRadius: number;

  activeBoxEnabled: boolean;
  activeBoxColor: string;
  activeBoxRadius: number;
  activeWordScale: number;
}

export interface CaptionPosition {
  preset: PositionPreset;
  /** percentage of frame width/height for the caption block's centre */
  x: number;
  y: number;
  /** percentage of frame width the text block may occupy */
  maxWidth: number;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export type EnterAnimationId =
  // basic
  | 'none' | 'fade' | 'scale' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight'
  // pop
  | 'softPop' | 'hardPop' | 'springPop' | 'bounce' | 'elastic' | 'punch'
  // word
  | 'wordPop' | 'wordScale' | 'wordBounce' | 'wordRise' | 'wordFade'
  | 'wordHighlight' | 'activeWordPunch'
  // reveal
  | 'typewriter' | 'wipe' | 'maskReveal' | 'blurReveal' | 'riseReveal'
  // dynamic
  | 'stagger' | 'wave' | 'pulse' | 'drop' | 'zoom' | 'wordFollower' | 'spotlight' | 'flashPunch'
  // read-along: the whole phrase is visible and words darken as they are spoken
  | 'progressive-word-reveal' | 'progressive-word-accent';

export type ExitAnimationId = 'cut' | 'fade' | 'scaleDown' | 'slideDown' | 'blurOut';

export interface AnimationSettings {
  enter: EnterAnimationId;
  exit: ExitAnimationId;
  /** seconds */
  enterDuration: number;
  exitDuration: number;
  /** 0..100 */
  bounciness: number;
  /** pixels of travel for slide-style motion */
  travel: number;
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

export type BackgroundMode = 'source' | 'solid' | 'transparent';

export interface BackgroundSettings {
  mode: BackgroundMode;
  color: string;
  recentColors: string[];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'json';
export type VideoExportFormat = 'mp4' | 'mov-alpha' | 'webm-alpha';
export type VideoExportQuality = 'high' | 'medium' | 'low';

export interface ExportSettings {
  subtitleFormat: SubtitleFormat;
  videoFormat: VideoExportFormat;
  /** null keeps the source resolution */
  width: number | null;
  height: number | null;
  /** null keeps the source frame rate */
  fps: number | null;
  /** Aspect ratio preset or custom ratio */
  aspectRatio?: string | null;
  /** Target file weight and encoding quality */
  quality?: VideoExportQuality;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface CaptionProject {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;

  media: MediaInfo | null;
  language: LanguageCode;
  hinglishDomain?: HinglishDomain;
  terminology: TerminologyContext;
  transcript: Transcript | null;
  captions: Caption[];

  segmentation: SegmentationSettings;
  style: CaptionStyle;
  position: CaptionPosition;
  animation: AnimationSettings;
  background: BackgroundSettings;
  exportSettings: ExportSettings;
}

/** A font the renderer must have available before drawing. */
export interface RenderFont {
  family: string;
  source: 'google' | 'custom' | 'system';
  /** custom fonts only; absolute at export time so headless Chrome can fetch it */
  url?: string;
  weights?: number[];
  /**
   * The weight the caption style actually asks for.
   *
   * The renderer has to block on this exact face. Waiting on some other weight
   * lets the first frames draw in a fallback whose metrics are a different size,
   * which shows up as captions that change size partway through an export.
   */
  usedWeight?: number;
}

/** The subset the renderer needs — preview and export both take exactly this. */
export interface RenderScene {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  captions: Caption[];
  style: CaptionStyle;
  position: CaptionPosition;
  animation: AnimationSettings;
  background: BackgroundSettings;
  /** line wrapping must match the editor, so it travels with the scene */
  maxLines: number;
  maxWordsPerLine: number;
  /** fonts to load before the first frame */
  fonts: RenderFont[];
  /** URL or absolute path for the source video, when background is 'source' */
  mediaSrc: string | null;
  /** Media kind (video or audio) */
  mediaKind?: MediaKind | null;
}
