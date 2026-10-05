/**
 * What the transcription pipeline did, kept with the transcript so it can be
 * shown in the editor and audited later.
 */
export interface TranscriptQuality {
  /** engines that contributed at least one part */
  engines: string[];
  /** engines that were available but failed or were too slow, and why */
  skipped: string[];
  /** 'audio-aligned': word times measured against the speech; 'estimated': spread across it */
  timingSource: 'audio-aligned' | 'estimated';
  /** share of the detected speech that has a caption word on it, 0..1 */
  speechCoverage: number;
  uncoveredSpeechSeconds: number;
  /** share of real pauses that fall between two words; null when the audio has none */
  pausesRespected: number | null;
  wordsRetimed: number;
  wordsRecovered: number;
  wordsCorrected: number;
  wordsDropped: number;
  notes: string[];
}
