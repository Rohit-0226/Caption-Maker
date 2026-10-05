import {
  CURRENT_SCHEMA_VERSION,
  type AnimationSettings,
  type BackgroundSettings,
  type CaptionPosition,
  type CaptionProject,
  type CaptionStyle,
  type ExportSettings,
  type SegmentationSettings,
  type TerminologyContext,
} from '../types/project';

export const defaultSegmentation: SegmentationSettings = {
  maxWordsPerLine: 4,
  maxLines: 2,
  maxReadingSpeed: 3.0,
  // generous: this only exists to stop a run of very long words overflowing
  maxCharacters: 90,
  minDuration: 0.4,
  maxDuration: 6,
  minGap: 0.35,
  preferPunctuation: true,
  preferPauses: true,
};

/** One-click caption layouts, per the product spec. */
export const CAPTION_LAYOUTS: {
  id: string;
  name: string;
  description: string;
  settings: Pick<SegmentationSettings, 'maxWordsPerLine' | 'maxLines' | 'maxReadingSpeed'>;
}[] = [
  {
    id: 'compact',
    name: 'Compact',
    description: 'Three words a line. Punchy, fills less of the frame.',
    settings: { maxWordsPerLine: 3, maxLines: 2, maxReadingSpeed: 3.0 },
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Four words a line. The safe default for most videos.',
    settings: { maxWordsPerLine: 4, maxLines: 2, maxReadingSpeed: 3.0 },
  },
  {
    id: 'spacious',
    name: 'Spacious',
    description: 'Six words a line at a relaxed pace. Easier to read.',
    settings: { maxWordsPerLine: 6, maxLines: 2, maxReadingSpeed: 2.2 },
  },
  {
    id: 'single',
    name: 'Single line',
    description: 'One line only. Keeps the frame clear.',
    settings: { maxWordsPerLine: 5, maxLines: 1, maxReadingSpeed: 3.0 },
  },
];

export const defaultStyle: CaptionStyle = {
  fontFamily: 'Inter',
  fontSize: 64,
  fontWeight: 800,
  uppercase: false,
  align: 'center',
  letterSpacing: 0,
  lineHeight: 1.2,
  wordSpacing: 0.28,

  color: '#FFFFFF',
  activeWordColor: '#FFD400',
  // muted grey for read-along motions; unused by every other motion
  futureWordColor: '#B4B4B4',
  emphasisEnabled: false,
  emphasisColor: '#4ADE80',
  emphasisScale: 1.1,
  opacity: 1,

  strokeEnabled: true,
  strokeWidth: 8,
  strokeColor: '#000000',

  shadowEnabled: true,
  shadowBlur: 18,
  shadowOffsetY: 4,
  shadowColor: 'rgba(0,0,0,0.5)',

  boxEnabled: false,
  boxColor: 'rgba(0,0,0,0.6)',
  boxPaddingX: 28,
  boxPaddingY: 16,
  boxRadius: 16,

  activeBoxEnabled: false,
  activeBoxColor: '#FF2D55',
  activeBoxRadius: 12,
  activeWordScale: 1.12,
};

export const defaultPosition: CaptionPosition = {
  preset: 'lowerMiddle',
  x: 50,
  y: 72,
  maxWidth: 84,
};

export const defaultAnimation: AnimationSettings = {
  enter: 'softPop',
  exit: 'fade',
  enterDuration: 0.24,
  exitDuration: 0.16,
  bounciness: 45,
  travel: 48,
};

export const defaultBackground: BackgroundSettings = {
  mode: 'source',
  color: '#000000',
  recentColors: [],
};

export const defaultExportSettings: ExportSettings = {
  subtitleFormat: 'srt',
  videoFormat: 'mp4',
  width: null,
  height: null,
  fps: null,
  aspectRatio: 'source',
  quality: 'high',
};

export const defaultTerminology: TerminologyContext = {
  document: null,
  terms: [],
  rules: [],
  transcriptionSample: null,
};

export const POSITION_PRESETS: Record<
  Exclude<CaptionPosition['preset'], 'custom'>,
  { x: number; y: number }
> = {
  top: { x: 50, y: 12 },
  upperMiddle: { x: 50, y: 30 },
  center: { x: 50, y: 50 },
  lowerMiddle: { x: 50, y: 72 },
  bottom: { x: 50, y: 88 },
};

export const createProject = (id: string, name: string): CaptionProject => {
  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    media: null,
    language: 'hinglish',
    terminology: { ...defaultTerminology },
    transcript: null,
    captions: [],
    segmentation: { ...defaultSegmentation },
    style: { ...defaultStyle },
    position: { ...defaultPosition },
    animation: { ...defaultAnimation },
    background: { ...defaultBackground },
    exportSettings: { ...defaultExportSettings },
  };
};
