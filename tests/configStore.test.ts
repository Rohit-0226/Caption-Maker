import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigStore } from '../server/services/configStore';
import { getFFmpegStatus } from '../server/services/ffmpeg';

describe('ConfigStore settings management', () => {
  let tempDir: string;
  let store: ConfigStore;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `cm-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    store = new ConfigStore(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('provides sensible defaults and reads unconfigured keys gracefully', () => {
    const summary = store.getSummary();
    expect(summary.defaultProvider).toBe('groq');
    expect(summary.groqWhisperModel).toBe('whisper-large-v3-turbo');
  });

  it('persists and retrieves updated API keys', async () => {
    await store.saveSettings({
      groqApiKey: 'gsk_test1234567890abcd',
      openRouterApiKey: 'sk-or-test9876543210zyxw',
      geminiApiKey: 'AQ.test1234567890wxyz',
      geminiModel: 'gemini-3.5-flash-lite',
    });

    expect(store.getGroqKey()).toBe('gsk_test1234567890abcd');
    expect(store.getOpenRouterKey()).toBe('sk-or-test9876543210zyxw');
    expect(store.getGeminiKey()).toBe('AQ.test1234567890wxyz');
    expect(store.getGeminiModel()).toBe('gemini-3.5-flash-lite');

    const summary = store.getSummary();
    expect(summary.hasGroqKey).toBe(true);
    expect(summary.groqKeyPreview).toBe('gsk_••••abcd');
    expect(summary.hasOpenRouterKey).toBe(true);
    expect(summary.openRouterKeyPreview).toBe('sk-o••••zyxw');
    expect(summary.hasGeminiKey).toBe(true);
    expect(summary.geminiKeyPreview).toBe('AQ.t••••wxyz');
    expect(summary.geminiModel).toBe('gemini-3.5-flash-lite');

    // Verify it was written to disk
    const onDisk = JSON.parse(fs.readFileSync(path.join(tempDir, 'user_settings.json'), 'utf8'));
    expect(onDisk.groqApiKey).toBe('gsk_test1234567890abcd');
    expect(onDisk.geminiApiKey).toBe('AQ.test1234567890wxyz');
  });

  it('validates Groq API key format before sending network request', async () => {
    const emptyResult = await store.testGroqKey('');
    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.message).toContain('Please provide a Groq API key');

    const invalidPrefix = await store.testGroqKey('sk-12345678');
    expect(invalidPrefix.ok).toBe(false);
    expect(invalidPrefix.message).toContain('must begin with "gsk_"');
  });

  it('validates OpenRouter API key format before sending network request', async () => {
    const emptyResult = await store.testOpenRouterKey('');
    expect(emptyResult.ok).toBe(false);

    const invalidPrefix = await store.testOpenRouterKey('gsk_testkey');
    expect(invalidPrefix.ok).toBe(false);
    expect(invalidPrefix.message).toContain('must begin with "sk-or-"');
  });

  it('validates Google Gemini API key format before sending network request', async () => {
    const emptyResult = await store.testGeminiKey('');
    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.message).toContain('Please provide a Google Gemini API key');

    const invalidPrefix = await store.testGeminiKey('invalid_key_format');
    expect(invalidPrefix.ok).toBe(false);
    expect(invalidPrefix.message).toContain('typically start with "AQ." or "AIza"');
  });
});

describe('FFmpeg status detection', () => {
  it('detects FFmpeg status accurately', () => {
    const status = getFFmpegStatus();
    expect(typeof status.installed).toBe('boolean');
    if (status.installed) {
      expect(status.path).toBeDefined();
      expect(status.version).toBe('Ready');
    }
  });
});
