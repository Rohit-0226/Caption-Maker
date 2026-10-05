import { describe, expect, it } from 'vitest';
import { locateHandy, NemotronASRProvider } from '../server/services/providers/nemotron';
import { getProvider, listProviders } from '../server/services/providers/registry';

describe('Nemotron ASR Provider', () => {
  it('detects handy executable on the system', () => {
    const handyPath = locateHandy();
    // On this machine, E:\Handy\handy.exe exists
    expect(handyPath).toBeTruthy();
    expect(handyPath).toContain('handy.exe');
  });

  it('reports configured true when handy is present', () => {
    const provider = new NemotronASRProvider();
    expect(provider.id).toBe('nemotron');
    expect(provider.label).toBe('Local Nemotron (GPU)');
    expect(provider.requiresApiKey).toBe(false);

    const status = provider.status();
    expect(status.configured).toBe(true);
    expect(status.reason).toBeNull();
  });

  it('supports required speech languages including hinglish and hindi', () => {
    const provider = new NemotronASRProvider();
    expect(provider.supportedLanguages).toContain('auto');
    expect(provider.supportedLanguages).toContain('en');
    expect(provider.supportedLanguages).toContain('hi');
    expect(provider.supportedLanguages).toContain('hinglish');
  });

  it('is registered in the provider registry alongside Groq and Local Whisper', () => {
    const allProviders = listProviders();
    const ids = allProviders.map((p) => p.id);
    expect(ids).toContain('groq');
    expect(ids).toContain('nemotron');
    expect(ids).toContain('local');

    const nemotron = getProvider('nemotron');
    expect(nemotron).toBeDefined();
    expect(nemotron?.id).toBe('nemotron');
  });
});
