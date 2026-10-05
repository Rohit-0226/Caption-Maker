import type { TranscriptWord } from '../../../src/core/types/project';
import type { VocabularyEntry } from '../../../src/core/vocabulary/vocabularyStore';

export interface CaptionProcessingRequest {
  tokens: string[];
  sourceWords: TranscriptWord[];
  fallbackWords: TranscriptWord[];
  relevantVocabRules: VocabularyEntry[];
  properNouns: string[];
  signal?: AbortSignal;
}

export interface CaptionProcessingResponse {
  provider: 'groq' | 'openrouter';
  model: string;
  tokens: string[];
  caption: string;
  changes: Array<{ original: string; corrected: string; confidence: number; reason: string }>;
  needs_review: boolean;
  responseTimeMs: number;
}

export interface ProviderStatus {
  id: 'groq' | 'openrouter';
  name: string;
  role: 'primary' | 'secondary';
  configured: boolean;
  model: string;
  endpoint: string;
  reason: string | null;
}

export interface ModelLogEntry {
  id: string;
  timestamp: string;
  provider: 'groq' | 'openrouter' | 'hybrid';
  primaryModel: string;
  secondaryModel?: string;
  responseTimeMs: number;
  confidence: number;
  fallbackUsed: boolean;
  secondOpinionUsed: boolean;
  correctionsCount: number;
  uncertainWordsCount: number;
  tokensCount: number;
}

export interface DebugTraceStep {
  stage: string;
  description: string;
  data: unknown;
}

export interface OrchestratedCaptionResult {
  tokens: string[];
  caption: string;
  words: TranscriptWord[];
  confidence: number;
  providerUsed: 'groq' | 'openrouter' | 'hybrid';
  primaryModel: string;
  secondaryModel?: string;
  fallbackUsed: boolean;
  secondOpinionUsed: boolean;
  modelAgreementCount: number;
  modelDisagreementCount: number;
  changes: Array<{ original: string; corrected: string; confidence: number; reason: string; needsReview?: boolean }>;
  needs_review: boolean;
  debugTrace?: DebugTraceStep[];
}

export interface ComparisonResult {
  original: string;
  groq: {
    caption: string;
    tokens: string[];
    confidence: number;
    responseTimeMs: number;
    error?: string;
  };
  openrouter: {
    caption: string;
    tokens: string[];
    confidence: number;
    responseTimeMs: number;
    error?: string;
  };
  finalSelected: {
    caption: string;
    tokens: string[];
    confidence: number;
    reason: string;
    secondOpinionUsed: boolean;
    agreementCount: number;
  };
}

export interface AIProvider {
  readonly id: 'groq' | 'openrouter';
  readonly name: string;
  status(): ProviderStatus;
  processCaption(req: CaptionProcessingRequest): Promise<CaptionProcessingResponse>;
}
