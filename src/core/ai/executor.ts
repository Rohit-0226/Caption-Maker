import type { CaptionProject } from '../types/project';
import { defaultStyle } from '../project/defaults';
import { getStylePreset, QUICK_PRESETS } from '../rendering/presets';
import { ENTER_ANIMATIONS } from '../rendering/animations';
import { FONT_CATALOGUE } from '../rendering/fonts';
import { defaultSegmenter, captionText } from '../segmentation/segmenter';
import { transformCaptionWords } from '../text/casing';
import { applyAmount, type AIAction } from './actions';

/** One human-readable thing an action did, for the confirm-before-apply panel. */
export interface AIChange {
  label: string;
  before: string;
  after: string;
}

export interface ApplyResult {
  project: CaptionProject;
  changes: AIChange[];
  /** actions that validated but could not be carried out, with the reason */
  rejected: string[];
}

export interface AISelection {
  selectedCaptionIds: string[];
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const pct = (n: number) => `${Math.round(n)}%`;

/**
 * Resolves which captions an action touches.
 *
 * Caption numbers are 1-based because that is what the user sees in the list
 * and therefore what they say to the assistant.
 */
const resolveCaptions = (
  project: CaptionProject,
  selection: AISelection,
  target: { scope: string; fromCaption: number | null; toCaption: number | null },
): string[] => {
  switch (target.scope) {
    case 'selectedCaption':
    case 'selectedCaptions':
    case 'selectedWords':
      return selection.selectedCaptionIds;
    case 'range': {
      const from = Math.max(1, target.fromCaption ?? 1);
      const to = Math.min(project.captions.length, target.toCaption ?? project.captions.length);
      return project.captions.slice(from - 1, to).map((c) => c.id);
    }
    default:
      return project.captions.map((c) => c.id);
  }
};

/**
 * Applies validated actions to a project.
 *
 * Pure: takes a project, returns a new one. Nothing here talks to a network or
 * a store, which is what makes every AI behaviour testable offline and what
 * lets the same result be previewed before it is committed.
 */
export const applyActions = (
  input: CaptionProject,
  actions: AIAction[],
  selection: AISelection = { selectedCaptionIds: [] },
): ApplyResult => {
  let project = input;
  const changes: AIChange[] = [];
  const rejected: string[] = [];

  const note = (label: string, before: unknown, after: unknown) => {
    if (String(before) === String(after)) return;
    changes.push({ label, before: String(before), after: String(after) });
  };

  /**
   * Style, motion and position are project-wide in this schema version. When a
   * caption-scoped change is asked for we widen it rather than silently doing
   * nothing, and say so — a quiet no-op would be worse than an honest note.
   */
  const noteWidened = (label: string, scope: string) => {
    if (scope !== 'project') {
      rejected.push(
        `${label} was applied to the whole project — per-caption styling is not supported yet.`,
      );
    }
  };

  const regenerate = (next: CaptionProject): CaptionProject => {
    if (!next.transcript) return next;
    return {
      ...next,
      captions: defaultSegmenter.segment(next.transcript.words, next.segmentation),
    };
  };

  for (const action of actions) {
    switch (action.type) {
      case 'SET_FONT': {
        const known = FONT_CATALOGUE.find(
          (f) => f.family.toLowerCase() === action.family.toLowerCase(),
        );
        if (!known) {
          rejected.push(`There is no font called "${action.family}".`);
          break;
        }
        noteWidened('Font', action.target.scope);
        note('Font', project.style.fontFamily, known.family);
        project = { ...project, style: { ...project.style, fontFamily: known.family } };
        break;
      }

      case 'SET_FONT_SIZE': {
        let amount = action.amount;
        if (amount.mode === 'absolute' && amount.value > 0 && amount.value <= 1) {
          amount = { ...amount, value: Math.round(amount.value * 1080) };
        }
        const next = clamp(Math.round(applyAmount(project.style.fontSize, amount)), 8, 300);
        noteWidened('Font size', action.target.scope);
        note('Font size', `${project.style.fontSize}px`, `${next}px`);
        project = { ...project, style: { ...project.style, fontSize: next } };
        break;
      }

      case 'SET_FONT_WEIGHT': {
        noteWidened('Font weight', action.target.scope);
        note('Font weight', project.style.fontWeight, action.value);
        project = { ...project, style: { ...project.style, fontWeight: action.value } };
        break;
      }

      case 'SET_UPPERCASE': {
        note('Uppercase', project.style.uppercase, action.value);
        project = { ...project, style: { ...project.style, uppercase: action.value } };
        break;
      }

      case 'TRANSFORM_TEXT_CASE': {
        const targetIds = resolveCaptions(project, selection, action.target);
        if (targetIds.length === 0) {
          rejected.push('No captions found to transform casing.');
          break;
        }

        const casing = action.casing;
        let modifiedCount = 0;
        const targetSet = new Set(targetIds);
        const updatedCaptions = project.captions.map((cap) => {
          if (!targetSet.has(cap.id)) return cap;
          modifiedCount++;
          return {
            ...cap,
            words: transformCaptionWords(cap.words, casing),
            edited: true,
          };
        });

        // If casing is sentence, title, or lower, turn off style.uppercase so Remotion CSS doesn't force uppercase!
        let updatedStyle = project.style;
        if (casing !== 'upper' && project.style.uppercase) {
          updatedStyle = { ...project.style, uppercase: false };
          note('Uppercase', true, false);
        }

        let updatedTranscript = project.transcript;
        if (updatedTranscript?.words) {
          const wordMap = new Map<string, string>();
          for (const cap of updatedCaptions) {
            if (!targetSet.has(cap.id)) continue;
            for (const w of cap.words) {
              wordMap.set(`${w.start.toFixed(3)}_${w.end.toFixed(3)}`, w.text);
            }
          }
          const words = updatedTranscript.words.map((tw) => {
            const key = `${tw.start.toFixed(3)}_${tw.end.toFixed(3)}`;
            const match = wordMap.get(key);
            return match ? { ...tw, text: match } : tw;
          });
          updatedTranscript = { ...updatedTranscript, words };
        }

        note(
          `Text casing (${casing})`,
          `${project.captions.length} captions`,
          `${modifiedCount} caption${modifiedCount === 1 ? '' : 's'} updated`,
        );
        project = {
          ...project,
          style: updatedStyle,
          transcript: updatedTranscript,
          captions: updatedCaptions,
        };
        break;
      }

      case 'SET_TEXT_COLOR': {
        noteWidened('Text colour', action.target.scope);
        note('Text colour', project.style.color, action.value);
        project = { ...project, style: { ...project.style, color: action.value } };
        break;
      }

      case 'SET_ACTIVE_WORD_COLOR': {
        noteWidened('Spoken word colour', action.target.scope);
        note('Spoken word colour', project.style.activeWordColor, action.value);
        project = { ...project, style: { ...project.style, activeWordColor: action.value } };
        break;
      }

      case 'SET_EMPHASIS_COLOR': {
        note('Emphasis colour', project.style.emphasisColor, action.value);
        project = { ...project, style: { ...project.style, emphasisColor: action.value } };
        break;
      }

      case 'SET_POSITION': {
        noteWidened('Position', action.target.scope);
        let { x, y } = project.position;
        if (action.x) x = clamp(applyAmount(x, action.x), 2, 98);
        if (action.y) y = clamp(applyAmount(y, action.y), 2, 98);
        note('Horizontal position', pct(project.position.x), pct(x));
        note('Vertical position', pct(project.position.y), pct(y));
        project = { ...project, position: { ...project.position, x, y, preset: 'custom' } };
        break;
      }

      case 'SET_TEXT_ALIGN': {
        noteWidened('Text align', action.target.scope);
        note('Text align', project.style.align, action.value);
        project = { ...project, style: { ...project.style, align: action.value } };
        break;
      }

      case 'APPLY_TEMPLATE': {
        const quick = QUICK_PRESETS.find((q) => q.id === action.templateId || q.styleId === action.templateId);
        const preset = getStylePreset(action.templateId) ?? (quick ? getStylePreset(quick.styleId) : undefined);
        if (!preset) {
          rejected.push(`There is no template called "${action.templateId}".`);
          break;
        }
        noteWidened('Template', action.target.scope);
        note('Template', project.style.fontFamily, preset.name);
        project = {
          ...project,
          style: { ...defaultStyle, ...project.style, ...preset.style },
        };
        if (quick) {
          project = {
            ...project,
            animation: {
              ...project.animation,
              enter: quick.motion,
              ...(quick.animation || {}),
            },
          };
          note('Motion', project.animation.enter, quick.motion);
        }
        break;
      }

      case 'APPLY_MOTION': {
        const motion = ENTER_ANIMATIONS.find((m) => m.id === action.motionId);
        if (!motion) {
          rejected.push(`There is no motion called "${action.motionId}".`);
          break;
        }
        noteWidened('Motion', action.target.scope);
        note('Motion', project.animation.enter, motion.id);
        project = { ...project, animation: { ...project.animation, enter: motion.id } };
        break;
      }

      case 'SET_BACKGROUND': {
        note('Background', project.background.mode, action.mode);
        if (action.color) note('Background colour', project.background.color, action.color);
        project = {
          ...project,
          background: {
            ...project.background,
            mode: action.mode,
            color: action.color ?? project.background.color,
          },
        };
        break;
      }

      case 'SET_MAX_WORDS_PER_LINE': {
        note('Words per line', project.segmentation.maxWordsPerLine, action.value);
        const before = project.captions.length;
        project = regenerate({
          ...project,
          segmentation: { ...project.segmentation, maxWordsPerLine: action.value },
        });
        note('Captions', before, project.captions.length);
        break;
      }

      case 'SET_MAX_LINES': {
        note('Max lines', project.segmentation.maxLines, action.value);
        const before = project.captions.length;
        project = regenerate({
          ...project,
          segmentation: { ...project.segmentation, maxLines: action.value },
        });
        note('Captions', before, project.captions.length);
        break;
      }

      case 'SET_READING_SPEED': {
        note(
          'Reading speed',
          `${project.segmentation.maxReadingSpeed.toFixed(1)} w/s`,
          `${action.value.toFixed(1)} w/s`,
        );
        project = regenerate({
          ...project,
          segmentation: { ...project.segmentation, maxReadingSpeed: action.value },
        });
        break;
      }

      case 'UPDATE_CAPTION_TEXT': {
        const caption = project.captions[action.captionNumber - 1];
        if (!caption) {
          rejected.push(`There is no caption ${action.captionNumber}.`);
          break;
        }
        const tokens = action.text.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) {
          rejected.push(`Caption ${action.captionNumber} cannot be left empty.`);
          break;
        }
        // keep the caption's own span; redistribute the words evenly inside it
        const span = Math.max(caption.end - caption.start, 0.05) / tokens.length;
        note(`Caption ${action.captionNumber}`, captionText(caption), action.text);
        const words = tokens.map((text, i) => ({
          text,
          start: caption.start + i * span,
          end: caption.start + (i + 1) * span,
          emphasis: false,
        }));
        project = {
          ...project,
          captions: project.captions.map((c) =>
            c.id === caption.id ? { ...c, words, edited: true } : c,
          ),
        };
        break;
      }

      case 'SET_WORD_EMPHASIS': {
        const caption = project.captions[action.captionNumber - 1];
        if (!caption) {
          rejected.push(`There is no caption ${action.captionNumber}.`);
          break;
        }
        const valid = action.wordIndexes.filter((i) => i < caption.words.length);
        if (valid.length === 0) {
          rejected.push(`Caption ${action.captionNumber} has no such words.`);
          break;
        }
        note(
          `Emphasis in caption ${action.captionNumber}`,
          caption.words.filter((w) => w.emphasis).length,
          action.enabled ? valid.length : 0,
        );
        project = {
          ...project,
          captions: project.captions.map((c) =>
            c.id === caption.id
              ? {
                  ...c,
                  edited: true,
                  words: c.words.map((w, i) =>
                    valid.includes(i) ? { ...w, emphasis: action.enabled } : w,
                  ),
                }
              : c,
          ),
        };
        break;
      }

      case 'SPLIT_CAPTION': {
        const caption = project.captions[action.captionNumber - 1];
        if (!caption) {
          rejected.push(`There is no caption ${action.captionNumber}.`);
          break;
        }
        if (action.wordIndex <= 0 || action.wordIndex >= caption.words.length) {
          rejected.push(
            `Caption ${action.captionNumber} cannot be split at word ${action.wordIndex}.`,
          );
          break;
        }
        const left = caption.words.slice(0, action.wordIndex);
        const right = caption.words.slice(action.wordIndex);
        const index = action.captionNumber - 1;
        const captions = [...project.captions];
        captions.splice(
          index,
          1,
          { ...caption, words: left, end: left[left.length - 1].end, edited: true },
          {
            ...caption,
            id: `${caption.id}_b`,
            words: right,
            start: right[0].start,
            edited: true,
          },
        );
        note('Captions', project.captions.length, captions.length);
        project = { ...project, captions };
        break;
      }

      case 'MERGE_CAPTIONS': {
        const numbers = [...action.captionNumbers].sort((a, b) => a - b);
        const contiguous = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
        if (!contiguous) {
          rejected.push('Only captions next to each other can be merged.');
          break;
        }
        const targets = numbers.map((n) => project.captions[n - 1]);
        if (targets.some((c) => !c)) {
          rejected.push('Those caption numbers do not all exist.');
          break;
        }
        const merged = {
          ...targets[0],
          words: targets.flatMap((c) => c.words),
          end: targets[targets.length - 1].end,
          edited: true,
        };
        const captions = [...project.captions];
        captions.splice(numbers[0] - 1, numbers.length, merged);
        note('Captions', project.captions.length, captions.length);
        project = { ...project, captions };
        break;
      }

      case 'RUN_CAPTION_QA':
        // handled by the caller, which surfaces the report rather than editing
        break;

      default: {
        // exhaustiveness: a new action type must be handled here
        const never: never = action;
        rejected.push(`Unsupported action: ${JSON.stringify(never)}`);
      }
    }
  }

  return { project, changes, rejected };
};

/** Used by resolveCaptions consumers that need ids rather than numbers. */
export { resolveCaptions };
