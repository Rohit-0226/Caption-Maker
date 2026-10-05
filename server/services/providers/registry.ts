import type { TranscriptionProvider } from '../../../src/core/transcription/types';
import { HybridEnsembleProvider } from './hybridEnsemble';
import { GroqTranscriptionProvider } from './groq';
import { NemotronASRProvider } from './nemotron';
import { LocalWhisperProvider } from './local';

const providers: TranscriptionProvider[] = [
  new HybridEnsembleProvider(),
  new GroqTranscriptionProvider(),
  new NemotronASRProvider(),
  new LocalWhisperProvider(),
];

export const listProviders = () => providers;

export const getProvider = (id: string): TranscriptionProvider | undefined =>
  providers.find((p) => p.id === id);

/** The provider used when the request does not name one: first configured wins. */
export const defaultProvider = (): TranscriptionProvider => {
  const configured = providers.find((p) => p.status().configured);
  return configured ?? providers[providers.length - 1];
};

export interface ProviderSummary {
  id: string;
  label: string;
  description: string;
  requiresApiKey: boolean;
  supportedLanguages: string[];
  configured: boolean;
  reason: string | null;
}

export const summarise = (): ProviderSummary[] =>
  providers.map((p) => {
    const status = p.status();
    return {
      id: p.id,
      label: p.label,
      description: p.description,
      requiresApiKey: p.requiresApiKey,
      supportedLanguages: [...p.supportedLanguages],
      configured: status.configured,
      reason: status.reason,
    };
  });
