import { CURRENT_SCHEMA_VERSION, type CaptionProject } from '../types/project';
import {
  defaultAnimation,
  defaultBackground,
  defaultExportSettings,
  defaultPosition,
  defaultSegmentation,
  defaultStyle,
  defaultTerminology,
} from './defaults';

export class ProjectMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectMigrationError';
  }
}

type Migration = (project: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations are keyed by the version they upgrade *from*. To add one, write the
 * transform, register it here, and bump CURRENT_SCHEMA_VERSION.
 *
 * Example for a future v1 to v2:
 *   1: (p) => ({ ...p, schemaVersion: 2, newField: 'default' }),
 */
const migrations: Record<number, Migration> = {
  /**
   * v1 → v2: caption length stopped being measured in characters.
   *
   * v1 had `maxCharacters` (the user-facing control) and `maxWords` (a
   * per-caption cap). v2 makes `maxWordsPerLine` the control and adds
   * `maxReadingSpeed`, demoting characters to an overflow backstop. An old
   * project's per-caption word cap is divided across its lines to land on a
   * comparable layout.
   */
  1: (project) => {
    const segmentation = isObject(project.segmentation) ? project.segmentation : {};
    const lines = typeof segmentation.maxLines === 'number' ? segmentation.maxLines : 2;
    const legacyWords =
      typeof segmentation.maxWords === 'number' ? segmentation.maxWords : 8;

    const { maxWords: _dropped, ...rest } = segmentation as Record<string, unknown>;

    // A hand-written file may already carry the new field; never clobber it.
    const derived =
      typeof segmentation.maxWordsPerLine === 'number'
        ? segmentation.maxWordsPerLine
        : Math.max(1, Math.round(legacyWords / Math.max(1, lines)));

    return {
      ...project,
      schemaVersion: 2,
      segmentation: {
        ...rest,
        maxWordsPerLine: derived,
        maxReadingSpeed:
          typeof segmentation.maxReadingSpeed === 'number' ? segmentation.maxReadingSpeed : 3.0,
        // the old value was a tight user-facing limit; as a backstop it needs headroom
        maxCharacters: 90,
      },
    };
  },
  /** v2 -> v3: add optional, project-scoped client terminology context. */
  2: (project) => ({
    ...project,
    schemaVersion: 3,
    terminology: { ...defaultTerminology },
  }),
  /**
   * v3 -> v4: null now means "keep the source frame rate".
   *
   * Older projects were created with 30fps even when the user had never
   * selected a platform preset. Only clear that legacy default when no output
   * size was selected; an explicit 1080x1920/30fps preset stays untouched.
   */
  3: (project) => {
    const exportSettings = isObject(project.exportSettings) ? project.exportSettings : {};
    const usesSourceSize = exportSettings.width == null && exportSettings.height == null;

    return {
      ...project,
      schemaVersion: 4,
      exportSettings: {
        ...exportSettings,
        fps: usesSourceSize && exportSettings.fps === 30 ? null : exportSettings.fps,
      },
    };
  },

  /**
   * v4 → v5: read-along motions need a colour for words not yet spoken.
   *
   * Older projects have no such field, and a missing colour would render those
   * words invisible, so give them the default grey.
   */
  4: (project) => {
    const style = isObject(project.style) ? project.style : {};
    return {
      ...project,
      schemaVersion: 5,
      style: {
        ...style,
        futureWordColor:
          typeof style.futureWordColor === 'string' ? style.futureWordColor : '#B4B4B4',
      },
    };
  },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Brings a project file up to the current schema, filling in any section that a
 * partial or hand-edited file is missing. Throws only when the file is not a
 * project at all, or comes from a newer version of the app.
 */
export const migrateProject = (raw: unknown): CaptionProject => {
  if (!isObject(raw)) {
    throw new ProjectMigrationError('That file does not contain a Caption Maker project.');
  }

  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new ProjectMigrationError(
      `This project was made with a newer version of Caption Maker (schema ${version}). Update the app to open it.`,
    );
  }

  let current: Record<string, unknown> = { ...raw };

  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    const migration = migrations[v];
    if (!migration) {
      // No explicit step registered: treat it as a fill-in-the-blanks upgrade.
      current = { ...current, schemaVersion: v + 1 };
      continue;
    }
    current = migration(current);
  }

  return withDefaults(current);
};

/** Fills missing sections so an older or partial file still opens cleanly. */
const withDefaults = (raw: Record<string, unknown>): CaptionProject => {
  const now = new Date().toISOString();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: typeof raw.id === 'string' ? raw.id : `prj_${Date.now().toString(36)}`,
    name: typeof raw.name === 'string' ? raw.name : 'Untitled project',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,

    media: (raw.media as CaptionProject['media']) ?? null,
    language: (raw.language as CaptionProject['language']) ?? 'auto',
    terminology: {
      ...defaultTerminology,
      ...(isObject(raw.terminology) ? raw.terminology : {}),
      terms:
        isObject(raw.terminology) && Array.isArray(raw.terminology.terms)
          ? raw.terminology.terms.filter((term): term is string => typeof term === 'string')
          : [],
      rules:
        isObject(raw.terminology) && Array.isArray(raw.terminology.rules)
          ? (raw.terminology.rules as CaptionProject['terminology']['rules'])
          : [],
    },
    transcript: (raw.transcript as CaptionProject['transcript']) ?? null,
    captions: Array.isArray(raw.captions) ? (raw.captions as CaptionProject['captions']) : [],

    segmentation: { ...defaultSegmentation, ...(isObject(raw.segmentation) ? raw.segmentation : {}) },
    style: { ...defaultStyle, ...(isObject(raw.style) ? raw.style : {}) },
    position: { ...defaultPosition, ...(isObject(raw.position) ? raw.position : {}) },
    animation: { ...defaultAnimation, ...(isObject(raw.animation) ? raw.animation : {}) },
    background: { ...defaultBackground, ...(isObject(raw.background) ? raw.background : {}) },
    exportSettings: {
      ...defaultExportSettings,
      ...(isObject(raw.exportSettings) ? raw.exportSettings : {}),
    },
  };
};
