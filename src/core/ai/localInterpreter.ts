import type { CaptionProject } from '../types/project';
import { resolveColor, type AIAction, type Target } from './actions';
import { STYLE_PRESETS } from '../rendering/presets';
import { ENTER_ANIMATIONS } from '../rendering/animations';
import { FONT_CATALOGUE } from '../rendering/fonts';

const targetAll: Target = {
  scope: 'project',
  fromCaption: null,
  toCaption: null,
};

/**
 * Deterministic local interpreter for common natural language commands.
 * Acts as an instant zero-latency interpreter and offline fallback when
 * cloud AI is unavailable or rate-limited.
 */
export const interpretCommandLocally = (
  project: CaptionProject,
  prompt: string,
  selection?: { selectedCaptionIds: string[] },
): AIAction[] | null => {
  const p = prompt.trim().toLowerCase();
  if (!p) return null;

  const target: Target =
    selection && selection.selectedCaptionIds.length > 0
      ? { scope: 'selectedCaptions', fromCaption: null, toCaption: null }
      : targetAll;

  const actions: AIAction[] = [];

  // 1. Text Casing
  const isSentenceCase =
    /\b(first\s+(word|letter)|capitalize\s+first|sentence\s+case|initial\s+caps?)\b/.test(p);
  const isTitleCase =
    /\b(title\s+case|capitalize\s+every\s+word|capitalize\s+all\s+words|each\s+word\s+capital)\b/.test(p);
  const isLowerCase =
    /\b(all\s+lower(case)?|small\s+letters?|make\s+(it\s+)?lowercase)\b/.test(p);
  const isUpperCase =
    /\b(all\s+caps?|uppercase|all\s+upper|capital\s+letters?)\b/.test(p) && !isSentenceCase && !isTitleCase;

  if (isSentenceCase) {
    actions.push({ type: 'TRANSFORM_TEXT_CASE', casing: 'sentence', target });
    actions.push({ type: 'SET_UPPERCASE', value: false, target });
    return actions;
  }
  if (isTitleCase) {
    actions.push({ type: 'TRANSFORM_TEXT_CASE', casing: 'title', target });
    actions.push({ type: 'SET_UPPERCASE', value: false, target });
    return actions;
  }
  if (isLowerCase) {
    actions.push({ type: 'TRANSFORM_TEXT_CASE', casing: 'lower', target });
    actions.push({ type: 'SET_UPPERCASE', value: false, target });
    return actions;
  }
  if (isUpperCase) {
    actions.push({ type: 'SET_UPPERCASE', value: true, target });
    return actions;
  }

  // 2. Alignment
  if (/\b(center\s+align|align\s+center|centered\s+text|text\s+center)\b/.test(p)) {
    actions.push({ type: 'SET_TEXT_ALIGN', value: 'center', target });
  } else if (/\b(left\s+align|align\s+left)\b/.test(p)) {
    actions.push({ type: 'SET_TEXT_ALIGN', value: 'left', target });
  } else if (/\b(right\s+align|align\s+right)\b/.test(p)) {
    actions.push({ type: 'SET_TEXT_ALIGN', value: 'right', target });
  }

  // 3. Colors
  const COLOR_NAMES = [
    'yellow', 'red', 'green', 'white', 'black', 'blue', 'cyan', 'orange',
    'purple', 'pink', 'magenta', 'gold', 'amber', 'lime', 'crimson',
  ];
  const colorMatch = COLOR_NAMES.find((c) => new RegExp(`\\b${c}\\b`).test(p)) ||
    p.match(/#[0-9a-f]{6}\b/i)?.[0];

  if (colorMatch) {
    const hex = resolveColor(colorMatch);
    if (hex) {
      if (/\b(active|spoken|current|highlight)\b/.test(p)) {
        actions.push({ type: 'SET_ACTIVE_WORD_COLOR', value: hex, target });
      } else if (/\b(emphasis|keyword)\b/.test(p)) {
        actions.push({ type: 'SET_EMPHASIS_COLOR', value: hex, target });
      } else {
        actions.push({ type: 'SET_TEXT_COLOR', value: hex, target });
      }
    }
  }

  // 4. Font Size
  if (/\b(bigger|larger|increase\s+size|increase\s+font)\b/.test(p)) {
    actions.push({ type: 'SET_FONT_SIZE', amount: { value: 8, mode: 'relative' }, target });
  } else if (/\b(smaller|decrease\s+size|smaller\s+font|reduce\s+size)\b/.test(p)) {
    actions.push({ type: 'SET_FONT_SIZE', amount: { value: -8, mode: 'relative' }, target });
  } else {
    const sizeNum = p.match(/\b(?:font\s+size|size)\s*[:=]?\s*(\d{2,3})\b/)?.[1];
    if (sizeNum) {
      const num = parseInt(sizeNum, 10);
      if (num >= 16 && num <= 200) {
        actions.push({ type: 'SET_FONT_SIZE', amount: { value: num, mode: 'absolute' }, target });
      }
    }
  }

  // 5. Position
  if (/\b(move\s+up|higher|move\s+higher)\b/.test(p)) {
    actions.push({ type: 'SET_POSITION', x: null, y: { value: -10, mode: 'relative' }, target });
  } else if (/\b(move\s+down|lower|move\s+lower)\b/.test(p)) {
    actions.push({ type: 'SET_POSITION', x: null, y: { value: 10, mode: 'relative' }, target });
  } else if (/\b(center\s+of\s+screen|middle\s+center|center\s+screen)\b/.test(p)) {
    actions.push({
      type: 'SET_POSITION',
      x: { value: 50, mode: 'absolute' },
      y: { value: 50, mode: 'absolute' },
      target,
    });
  } else if (/\b(top\s+of\s+screen|move\s+to\s+top)\b/.test(p)) {
    actions.push({
      type: 'SET_POSITION',
      x: { value: 50, mode: 'absolute' },
      y: { value: 15, mode: 'absolute' },
      target,
    });
  } else if (/\b(bottom\s+of\s+screen|move\s+to\s+bottom)\b/.test(p)) {
    actions.push({
      type: 'SET_POSITION',
      x: { value: 50, mode: 'absolute' },
      y: { value: 80, mode: 'absolute' },
      target,
    });
  }

  // 6. Fonts
  for (const font of FONT_CATALOGUE) {
    if (p.includes(font.family.toLowerCase())) {
      actions.push({ type: 'SET_FONT', family: font.family, target });
      break;
    }
  }

  // 7. Templates
  if (/\b(dynamic\s+word\s+follower|word\s+follower)\b/.test(p)) {
    actions.push({ type: 'APPLY_TEMPLATE', templateId: 'dynamic-word-follower', target });
    actions.push({ type: 'APPLY_MOTION', motionId: 'wordFollower', target });
  } else {
    for (const preset of STYLE_PRESETS) {
      if (
        p.includes(preset.id.toLowerCase()) ||
        p.includes(preset.name.toLowerCase())
      ) {
        actions.push({ type: 'APPLY_TEMPLATE', templateId: preset.id, target });
        break;
      }
    }
  }

  // 8. Motions
  for (const motion of ENTER_ANIMATIONS) {
    if (p.includes(motion.id.toLowerCase()) || p.includes(motion.label.toLowerCase())) {
      actions.push({ type: 'APPLY_MOTION', motionId: motion.id, target });
      break;
    }
  }

  // 9. Words per line
  const wordsPerLineMatch = p.match(/\b(\d)\s+words?\s+per\s+line\b/);
  if (wordsPerLineMatch) {
    const val = parseInt(wordsPerLineMatch[1], 10);
    if (val >= 1 && val <= 10) {
      actions.push({ type: 'SET_MAX_WORDS_PER_LINE', value: val });
    }
  }

  // 10. QA
  if (/\b(check\s+project|review\s+captions?|qa|run\s+qa)\b/.test(p)) {
    actions.push({ type: 'RUN_CAPTION_QA' });
  }

  return actions.length > 0 ? actions : null;
};
