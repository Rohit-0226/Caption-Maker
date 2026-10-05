import type {
  HinglishDomain,
  LanguageCode,
  TerminologyContext,
  TranscriptWord,
} from '../types/project';
import type { TranscriptQuality } from '../speech/quality';

export type TranscriptionPhase =
  | 'preparing'
  | 'extracting-audio'
  | 'loading-model'
  | 'uploading'
  | 'transcribing'
  | 'post-processing'
  | 'done';

export interface TranscriptionProgress {
  phase: TranscriptionPhase;
  /** 0..1, or null when the phase has no measurable progress */
  progress: number | null;
  message: string;
}

export interface TranscriptionRequest {
  /** absolute path to an audio file the provider can read */
  audioPath: string;
  language: LanguageCode;
  hinglishDomain?: HinglishDomain;
  /** Optional client-specific spellings and representative prose from its PDF. */
  terminology?: Pick<TerminologyContext, 'terms' | 'rules' | 'transcriptionSample'>;
  onProgress?: (progress: TranscriptionProgress) => void;
  signal?: AbortSignal;
  /** receives each pipeline stage's intermediate output; for diagnostics, never shown to users */
  debug?: (stage: string, data: unknown) => void;
}

export interface TranscriptionResult {
  text: string;
  words: TranscriptWord[];
  detectedLanguage: string | null;
  modelId: string;
  /** what the pipeline did and how well the words cover the speech, when the provider measures it */
  quality?: TranscriptQuality;
}

export interface ProviderStatus {
  configured: boolean;
  /** why it is unusable, shown directly to the user */
  reason: string | null;
}

/**
 * A transcription backend. Implementations live server-side; the client only
 * ever sees provider ids and status.
 */
export interface TranscriptionProvider {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly requiresApiKey: boolean;
  readonly supportedLanguages: LanguageCode[];
  status(): ProviderStatus;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

/** Raised when a provider fails in a way the user can act on. */
export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not-configured'
      | 'no-audio'
      | 'provider-error'
      | 'network'
      | 'cancelled'
      | 'unsupported',
    readonly retryable: boolean = true,
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}
