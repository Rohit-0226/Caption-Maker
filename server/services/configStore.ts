import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');

export interface UserSettings {
  groqApiKey?: string;
  openRouterApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  defaultProvider?: 'groq' | 'openrouter' | 'openai' | 'gemini';
  groqWhisperModel?: string;
}

export interface SettingsSummary {
  hasGroqKey: boolean;
  groqKeyPreview: string | null;
  hasOpenRouterKey: boolean;
  openRouterKeyPreview: string | null;
  hasOpenAiKey: boolean;
  openAiKeyPreview: string | null;
  hasGeminiKey: boolean;
  geminiKeyPreview: string | null;
  geminiModel: string;
  defaultProvider: 'groq' | 'openrouter' | 'openai' | 'gemini';
  groqWhisperModel: string;
}

/**
 * Settings live beside the projects the server is using, so the Web & Share
 * stack and the desktop app read the same keys. An explicit data folder wins
 * (the packaged app far from the source uses its own); otherwise the project
 * root's `data` folder. CAPTION_MAKER_ROOT is honoured because inside the
 * bundled server this file no longer sits two folders below the root, so the
 * path derived from it would point outside the project.
 */
const resolveDataDir = (): string => {
  if (process.env.CAPTION_MAKER_DATA_DIR && process.env.CAPTION_MAKER_DATA_DIR.trim()) {
    return path.resolve(process.env.CAPTION_MAKER_DATA_DIR.trim());
  }
  if (process.env.CAPTION_MAKER_ROOT && process.env.CAPTION_MAKER_ROOT.trim()) {
    return path.join(path.resolve(process.env.CAPTION_MAKER_ROOT.trim()), 'data');
  }
  return path.join(ROOT, 'data');
};

const maskKey = (key?: string): string | null => {
  if (!key || typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••••••';
  const prefix = trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
};

export class ConfigStore {
  private dataDir: string;
  private filePath: string;
  private memoryCache: UserSettings | null = null;

  constructor(customDataDir?: string) {
    this.dataDir = customDataDir ? path.resolve(customDataDir) : resolveDataDir();
    this.filePath = path.join(this.dataDir, 'user_settings.json');
  }

  public getDataDir(): string {
    return this.dataDir;
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  public getSettings(): UserSettings {
    if (this.memoryCache) {
      return { ...this.memoryCache };
    }

    let diskSettings: UserSettings = {};
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        diskSettings = JSON.parse(raw) as UserSettings;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[configStore] Failed to read user_settings.json, falling back to env:', err);
    }

    // Merge with process.env fallbacks if disk doesn't specify
    const merged: UserSettings = {
      groqApiKey: diskSettings.groqApiKey?.trim() || process.env.GROQ_API_KEY?.trim() || process.env.AI_API_KEY?.trim() || undefined,
      openRouterApiKey: diskSettings.openRouterApiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim() || undefined,
      openaiApiKey: diskSettings.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || undefined,
      geminiApiKey: diskSettings.geminiApiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || undefined,
      geminiModel: diskSettings.geminiModel?.trim() || process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
      defaultProvider: diskSettings.defaultProvider || (process.env.AI_PROVIDER as any) || 'groq',
      groqWhisperModel: diskSettings.groqWhisperModel || process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
    };

    this.memoryCache = merged;
    return { ...merged };
  }

  public async saveSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    this.ensureDir();
    const current = this.getSettings();
    const updated: UserSettings = {
      ...current,
      ...patch,
    };

    // Clean up empty strings
    if (updated.groqApiKey !== undefined) updated.groqApiKey = updated.groqApiKey.trim() || undefined;
    if (updated.openRouterApiKey !== undefined) updated.openRouterApiKey = updated.openRouterApiKey.trim() || undefined;
    if (updated.openaiApiKey !== undefined) updated.openaiApiKey = updated.openaiApiKey.trim() || undefined;
    if (updated.geminiApiKey !== undefined) updated.geminiApiKey = updated.geminiApiKey.trim() || undefined;
    if (updated.geminiModel !== undefined) updated.geminiModel = updated.geminiModel.trim() || undefined;

    this.memoryCache = updated;

    // Update in-memory process.env so existing consumers receive the update immediately
    if (updated.groqApiKey) process.env.GROQ_API_KEY = updated.groqApiKey;
    if (updated.openRouterApiKey) process.env.OPENROUTER_API_KEY = updated.openRouterApiKey;
    if (updated.openaiApiKey) process.env.OPENAI_API_KEY = updated.openaiApiKey;
    if (updated.geminiApiKey) process.env.GEMINI_API_KEY = updated.geminiApiKey;
    if (updated.geminiModel) process.env.GEMINI_MODEL = updated.geminiModel;
    if (updated.defaultProvider) process.env.AI_PROVIDER = updated.defaultProvider;
    if (updated.groqWhisperModel) process.env.GROQ_WHISPER_MODEL = updated.groqWhisperModel;

    await fsp.writeFile(this.filePath, JSON.stringify(updated, null, 2), 'utf8');
    return { ...updated };
  }

  public getGroqKey(): string | undefined {
    return this.getSettings().groqApiKey;
  }

  public getOpenRouterKey(): string | undefined {
    return this.getSettings().openRouterApiKey;
  }

  public getOpenAiKey(): string | undefined {
    return this.getSettings().openaiApiKey;
  }

  public getGeminiKey(): string | undefined {
    return this.getSettings().geminiApiKey;
  }

  public getGeminiModel(): string {
    return this.getSettings().geminiModel || 'gemini-3.5-flash-lite';
  }

  public getGroqWhisperModel(): string {
    return this.getSettings().groqWhisperModel || 'whisper-large-v3-turbo';
  }

  public getSummary(): SettingsSummary {
    const s = this.getSettings();
    return {
      hasGroqKey: Boolean(s.groqApiKey),
      groqKeyPreview: maskKey(s.groqApiKey),
      hasOpenRouterKey: Boolean(s.openRouterApiKey),
      openRouterKeyPreview: maskKey(s.openRouterApiKey),
      hasOpenAiKey: Boolean(s.openaiApiKey),
      openAiKeyPreview: maskKey(s.openaiApiKey),
      hasGeminiKey: Boolean(s.geminiApiKey),
      geminiKeyPreview: maskKey(s.geminiApiKey),
      geminiModel: s.geminiModel || 'gemini-3.5-flash-lite',
      defaultProvider: s.defaultProvider ?? 'groq',
      groqWhisperModel: s.groqWhisperModel ?? 'whisper-large-v3-turbo',
    };
  }

  public async testGroqKey(key: string): Promise<{ ok: boolean; message: string }> {
    const trimmed = key.trim();
    if (!trimmed) {
      return { ok: false, message: 'Please provide a Groq API key.' };
    }
    if (!trimmed.startsWith('gsk_')) {
      return { ok: false, message: 'Invalid format. Groq API keys must begin with "gsk_".' };
    }

    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          Authorization: `Bearer ${trimmed}`,
          'User-Agent': 'Caption-Maker-Desktop',
        },
      });

      if (res.ok) {
        return { ok: true, message: 'Connected successfully to Groq! Whisper & Llama models ready.' };
      }

      if (res.status === 401) {
        return { ok: false, message: 'Groq rejected the API key (401 Unauthorized). Please check that you copied the entire key.' };
      }

      const body = await res.text();
      return { ok: false, message: `Groq error (${res.status}): ${body.slice(0, 150)}` };
    } catch (err) {
      return { ok: false, message: `Network error connecting to Groq: ${(err as Error).message}` };
    }
  }

  public async testOpenRouterKey(key: string): Promise<{ ok: boolean; message: string }> {
    const trimmed = key.trim();
    if (!trimmed) {
      return { ok: false, message: 'Please provide an OpenRouter API key.' };
    }
    if (!trimmed.startsWith('sk-or-')) {
      return { ok: false, message: 'Invalid format. OpenRouter API keys must begin with "sk-or-".' };
    }

    try {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: {
          Authorization: `Bearer ${trimmed}`,
          'User-Agent': 'Caption-Maker-Desktop',
        },
      });

      if (res.ok) {
        return { ok: true, message: 'Connected successfully to OpenRouter!' };
      }

      if (res.status === 401) {
        return { ok: false, message: 'OpenRouter rejected the key (401 Unauthorized).' };
      }

      const body = await res.text();
      return { ok: false, message: `OpenRouter error (${res.status}): ${body.slice(0, 150)}` };
    } catch (err) {
      return { ok: false, message: `Network error connecting to OpenRouter: ${(err as Error).message}` };
    }
  }

  public async testGeminiKey(key: string): Promise<{ ok: boolean; message: string }> {
    const trimmed = key.trim();
    if (!trimmed) {
      return { ok: false, message: 'Please provide a Google Gemini API key.' };
    }
    if (!trimmed.startsWith('AQ.') && !trimmed.startsWith('AIza')) {
      return { ok: false, message: 'Invalid format. Gemini API keys typically start with "AQ." or "AIza".' };
    }

    try {
      // the key travels in a header, never the URL, where proxies and logs would keep it
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'User-Agent': 'Caption-Maker-Desktop', 'x-goog-api-key': trimmed },
      });

      if (res.ok) {
        return { ok: true, message: 'Connected successfully to Google Gemini! Gemini 3.5 Flash Lite ready.' };
      }

      if (res.status === 400 || res.status === 403) {
        return { ok: false, message: `Gemini rejected key (${res.status} Forbidden). Check that the API key is active.` };
      }

      const body = await res.text();
      return { ok: false, message: `Gemini error (${res.status}): ${body.slice(0, 150)}` };
    } catch (err) {
      return { ok: false, message: `Network error connecting to Gemini: ${(err as Error).message}` };
    }
  }
}

export const defaultSettingsStore = new ConfigStore();
