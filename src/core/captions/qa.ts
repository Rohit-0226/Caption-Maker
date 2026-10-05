import type { CaptionProject } from '../types/project';
import { captionText, wrapIntoLines } from '../segmentation/segmenter';
import { FONT_CATALOGUE } from '../rendering/fonts';
import { getSafeZone, type SafeZonePlatform } from '../rendering/safeZones';

export type QASeverity = 'error' | 'warning';

export interface QAIssue {
  severity: QASeverity;
  code: string;
  message: string;
  /** 1-based caption number, when the issue belongs to one */
  captionNumber: number | null;
  /** true when Quick Fix can resolve it without rewriting the user's words */
  fixable: boolean;
}

export interface QAReport {
  status: 'good' | 'needsAttention';
  issues: QAIssue[];
  checked: number;
}

export interface QAOptions {
  /** check captions sit clear of a platform's interface */
  safeZone?: SafeZonePlatform;
  /** font families the user has uploaded, so a custom font is not flagged */
  customFonts?: string[];
}

const SHORT_CAPTION_SECONDS = 0.3;

/**
 * Looks for the things that make captions unreadable or unexportable.
 *
 * Deliberately conservative: it reports what is wrong and whether a safe fix
 * exists, and never rewrites wording. Deciding what the video should say is the
 * user's job.
 */
export const runCaptionQA = (
  project: CaptionProject,
  options: QAOptions = {},
): QAReport => {
  const issues: QAIssue[] = [];
  const { captions, segmentation, style } = project;

  const add = (
    severity: QASeverity,
    code: string,
    message: string,
    captionNumber: number | null = null,
    fixable = false,
  ) => issues.push({ severity, code, message, captionNumber, fixable });

  if (!project.media) {
    add('error', 'no-media', 'This project has no media, so it cannot be exported.');
  }

  if (captions.length === 0) {
    add('error', 'no-captions', 'There are no captions yet.');
    return { status: 'needsAttention', issues, checked: 0 };
  }

  const knownFont =
    FONT_CATALOGUE.some((f) => f.family === style.fontFamily) ||
    (options.customFonts ?? []).includes(style.fontFamily);

  if (!knownFont) {
    add(
      'warning',
      'missing-font',
      `The caption font "${style.fontFamily}" is not in the library, so the export may fall back to another face.`,
      null,
      true,
    );
  }

  const zone = options.safeZone ? getSafeZone(options.safeZone) : null;
  if (zone && zone.regions.length > 0) {
    const topLimit = zone.regions.find((r) => r.top !== undefined)?.top ?? 0;
    const bottomRegion = zone.regions.find((r) => r.bottom !== undefined)?.bottom ?? 0;
    const bottomLimit = 100 - bottomRegion;

    if (project.position.y < topLimit || project.position.y > bottomLimit) {
      add(
        'warning',
        'outside-safe-zone',
        `Captions sit at ${Math.round(project.position.y)}%, inside the ${zone.label} interface area (safe range is ${Math.round(topLimit)}–${Math.round(bottomLimit)}%).`,
        null,
        true,
      );
    }
  }

  const wordBudget = segmentation.maxWordsPerLine * segmentation.maxLines;

  captions.forEach((caption, index) => {
    const number = index + 1;
    const duration = caption.end - caption.start;
    const text = captionText(caption);

    if (text.trim().length === 0) {
      add('error', 'empty', `Caption ${number} has no text.`, number);
    }

    if (!Number.isFinite(caption.start) || !Number.isFinite(caption.end)) {
      add('error', 'bad-timestamp', `Caption ${number} has an invalid timestamp.`, number);
      return;
    }

    if (duration <= 0) {
      add('error', 'zero-duration', `Caption ${number} ends before it starts.`, number, true);
    } else if (duration < SHORT_CAPTION_SECONDS) {
      add(
        'warning',
        'very-short',
        `Caption ${number} is only ${duration.toFixed(2)}s — too quick to read.`,
        number,
        true,
      );
    }

    const previous = captions[index - 1];
    if (previous && caption.start < previous.end - 1e-6) {
      add(
        'error',
        'overlap',
        `Caption ${number} starts before caption ${number - 1} has finished.`,
        number,
        true,
      );
    }

    if (caption.words.length > wordBudget) {
      add(
        'warning',
        'too-many-words',
        `Caption ${number} holds ${caption.words.length} words; the layout allows ${wordBudget}.`,
        number,
        true,
      );
    }

    const lines = wrapIntoLines(caption.words, segmentation.maxLines, segmentation.maxWordsPerLine);
    if (lines.length > segmentation.maxLines) {
      add(
        'warning',
        'too-many-lines',
        `Caption ${number} needs ${lines.length} lines; the limit is ${segmentation.maxLines}.`,
        number,
        true,
      );
    }

    if (duration > 0) {
      const speed = caption.words.length / duration;
      // a little headroom, so a caption a hair over the limit is not nagged about
      if (speed > segmentation.maxReadingSpeed * 1.25) {
        add(
          'warning',
          'too-fast',
          `Caption ${number} runs at ${speed.toFixed(1)} words a second; the pace is set to ${segmentation.maxReadingSpeed.toFixed(1)}.`,
          number,
          true,
        );
      }
    }
  });

  return {
    status: issues.some((i) => i.severity === 'error') || issues.length > 0
      ? 'needsAttention'
      : 'good',
    issues,
    checked: captions.length,
  };
};
