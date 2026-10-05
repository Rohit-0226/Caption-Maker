/**
 * The steps shown while a new video turns into captions, and how the server's
 * own progress messages map onto them.
 *
 * Nothing here is invented: each step lights up only when the server says that
 * work has started. Upload progress comes from the browser; "Making preview
 * copy" is the server probing the file and, for formats Chrome cannot play
 * (iPhone HEVC, ProRes, MKV…), writing its H.264 preview copy before the upload
 * request returns; the rest are the transcription job's messages.
 */

export type PipelineStep = 'upload' | 'preview' | 'audio' | 'transcribe' | 'vocabulary' | 'captions';

export const PIPELINE_STEPS: { id: PipelineStep; label: string }[] = [
  { id: 'upload', label: 'Uploading' },
  { id: 'preview', label: 'Making preview copy' },
  { id: 'audio', label: 'Extracting audio' },
  { id: 'transcribe', label: 'Transcribing' },
  { id: 'vocabulary', label: 'Applying vocabulary' },
  { id: 'captions', label: 'Building captions' },
];

/** The steps a re-transcription in the editor goes through (no upload, no preview copy). */
export const RETRANSCRIBE_STEPS = PIPELINE_STEPS.filter(
  (step) => step.id !== 'upload' && step.id !== 'preview',
);

export const stepIndex = (step: PipelineStep): number =>
  PIPELINE_STEPS.findIndex((candidate) => candidate.id === step);

/**
 * Post-processing messages: spelling clean-up, Roman Hinglish conversion,
 * settling disagreements between engines, translation, and the final pass that
 * applies the preferred terminology. Together that is the vocabulary step.
 */
const VOCABULARY_MESSAGE =
  /settling|tidying|roman|translat|final timing|clean ?up|spelling|vocabular|terminolog|lexicon/i;

/**
 * Which step a transcription job message belongs to. Steps never go backwards,
 * so an engine that reports progress in an unusual order cannot make the list
 * flicker between steps.
 */
export const stepForJobMessage = (message: string, previous: PipelineStep): PipelineStep => {
  const text = message.trim();
  let next: PipelineStep;
  if (/^extracting audio/i.test(text)) next = 'audio';
  else if (/building captions|rebuilding captions/i.test(text)) next = 'captions';
  else if (VOCABULARY_MESSAGE.test(text)) next = 'vocabulary';
  else next = 'transcribe';
  return stepIndex(next) >= stepIndex(previous) ? next : previous;
};
