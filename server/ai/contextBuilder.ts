import type { CaptionProject } from '../../src/core/types/project';
import { captionText } from '../../src/core/segmentation/segmenter';
import { STYLE_PRESETS } from '../../src/core/rendering/presets';
import { ENTER_ANIMATIONS } from '../../src/core/rendering/animations';
import { FONT_CATALOGUE } from '../../src/core/rendering/fonts';
import { ACTION_TYPES } from './schemas';

export interface CommandContext {
  selectedCaptionIds: string[];
  playheadSeconds: number;
}

/** How many captions to show in full before summarising. */
const CAPTION_SAMPLE = 40;

/**
 * Builds the system prompt.
 *
 * The model can only choose from ids that actually exist, so they are listed
 * explicitly — that turns "use a bold creator template" into a real template id
 * rather than an invented one the executor would have to reject.
 */
export const buildSystemPrompt = (): string => {
  const templates = STYLE_PRESETS.map((p) => `${p.id} (${p.name}, ${p.category})`).join(', ');
  const motions = ENTER_ANIMATIONS.map((m) => `${m.id} (${m.label})`).join(', ');
  const fonts = FONT_CATALOGUE.map((f) => f.family).join(', ');

  return [
    'You are the assistant inside Caption Maker, a video captioning editor.',
    'Turn the user request into structured actions. Never answer with prose instructions — emit actions.',
    'Emit one action for every distinct change the user asked for. If they asked for three things, return three actions.',
    'If the request is a question or nothing needs changing, return an empty actions array and answer in `reply`.',
    '',
    `Allowed action types: ${ACTION_TYPES.join(', ')}.`,
    '',
    'Rules:',
    '- Every unused field must be null. Never invent a field.',
    '- Caption numbers are 1-based, exactly as shown to the user.',
    '- Vertical position is a percentage where a SMALLER number is HIGHER up the frame.',
    '- For middle-center alignment: emit SET_POSITION with x: 50, y: 50, and emit SET_TEXT_ALIGN with align: "center".',
    '- For font size given as a fraction/percentage (e.g. 0.07 or 7% of screen height): multiply by 1080 to get pixel size (e.g. 0.07 * 1080 = 76). Use SET_FONT_SIZE with number: 76.',
    '- When typography specifies a font and weight like "Quicksand Bold", emit SET_FONT with family: "Quicksand" and SET_FONT_WEIGHT with number: 700.',
    '- For "dynamic word follower", "word follower", or similar subtitle motion styles, emit APPLY_TEMPLATE with templateId: "dynamic-word-follower" and APPLY_MOTION with motionId: "wordFollower".',
    '- For text casing requests: ',
    '  * "first word/letter uppercase", "capitalize first letter", "sentence case": emit TRANSFORM_TEXT_CASE with casing: "sentence" AND emit SET_UPPERCASE with enabled: false (so uppercase CSS does not override word casing).',
    '  * "capitalize every word", "title case": emit TRANSFORM_TEXT_CASE with casing: "title" AND emit SET_UPPERCASE with enabled: false.',
    '  * "lowercase", "all lower": emit TRANSFORM_TEXT_CASE with casing: "lower" AND emit SET_UPPERCASE with enabled: false.',
    '  * "uppercase", "all caps", "all capital": emit SET_UPPERCASE with enabled: true.',
    '- For a nudge ("a bit bigger", "slightly higher") set the mode to "relative" and give a small delta.',
    '- For an exact value ("set size to 80") use mode "absolute".',
    '- Only use ids from the lists below. If nothing fits, say so in `reply` and emit no action for it.',
    '- Do not change the wording of captions unless the user explicitly asked you to.',
    '',
    `Template ids: ${templates}`,
    '',
    `Motion ids: ${motions}`,
    '',
    `Font families: ${fonts}`,
  ].join('\n');
};

/**
 * A compact picture of the project.
 *
 * Long transcripts are sampled rather than sent whole: the model needs to know
 * the shape and the current settings, not every word, and a 500-caption project
 * would otherwise blow the context window.
 */
export const buildUserPrompt = (
  project: CaptionProject,
  context: CommandContext,
  prompt: string,
): string => {
  const { style, animation, segmentation, position, background, captions } = project;

  const selected = captions
    .map((c, i) => ({ c, number: i + 1 }))
    .filter(({ c }) => context.selectedCaptionIds.includes(c.id));

  const sample = captions.slice(0, CAPTION_SAMPLE).map((c, i) => `${i + 1}: ${captionText(c)}`);
  if (captions.length > CAPTION_SAMPLE) {
    sample.push(`… and ${captions.length - CAPTION_SAMPLE} more, up to caption ${captions.length}`);
  }

  return [
    'CURRENT PROJECT',
    `Captions: ${captions.length}`,
    `Font: ${style.fontFamily} ${style.fontSize}px weight ${style.fontWeight}${style.uppercase ? ', uppercase' : ''}`,
    `Text colour: ${style.color}; spoken word: ${style.activeWordColor}; emphasis: ${style.emphasisColor}`,
    `Motion: ${animation.enter}, exit ${animation.exit}`,
    `Position: x ${position.x}%, y ${position.y}%`,
    `Background: ${background.mode}${background.mode === 'solid' ? ` ${background.color}` : ''}`,
    `Words per line: ${segmentation.maxWordsPerLine}; max lines: ${segmentation.maxLines}; reading speed: ${segmentation.maxReadingSpeed} w/s`,
    '',
    `Playhead: ${context.playheadSeconds.toFixed(2)}s`,
    selected.length > 0
      ? `Selected caption${selected.length > 1 ? 's' : ''}: ${selected.map((s) => s.number).join(', ')}`
      : 'Nothing is selected — treat scope as the whole project unless the user names captions.',
    '',
    'CAPTIONS',
    ...sample,
    '',
    'REQUEST',
    prompt,
  ].join('\n');
};
