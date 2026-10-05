import type {
  CaptionProject,
  HinglishDomain,
  LanguageCode,
  SegmentationSettings,
  SubtitleFormat,
  VideoExportFormat,
} from '../core/types/project';
import type { AIAction } from '../core/ai/actions';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  mediaFileName: string | null;
  captionCount: number;
}

export interface ProviderSummary {
  id: string;
  label: string;
  description: string;
  requiresApiKey: boolean;
  supportedLanguages: LanguageCode[];
  configured: boolean;
  reason: string | null;
}

export interface JobState<T = unknown> {
  id: string;
  type: 'transcribe' | 'render' | 'waveform';
  projectId: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  progress: number | null;
  message: string;
  result: T | null;
  error: { message: string; code: string; retryable: boolean } | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface RenderResult {
  fileName: string;
  size: number;
  url: string;
}

export interface AppSettings {
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
  ffmpeg: {
    installed: boolean;
    path?: string;
    version?: string;
  };
  nemotron?: {
    installed: boolean;
    path?: string | null;
    model?: string;
    accelerator?: string;
  };
}

export interface SaveSettingsPayload {
  groqApiKey?: string;
  openRouterApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  defaultProvider?: 'groq' | 'openrouter' | 'openai' | 'gemini';
  groqWhisperModel?: string;
}

export interface TestKeyResult {
  ok: boolean;
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = '/api';

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(BASE + path, init);
  } catch {
    throw new ApiError(
      'Cannot reach the Caption Maker server. Is it still running?',
      0,
    );
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    let detail: unknown;
    try {
      const body = (await response.json()) as { error?: string };
      detail = body;
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body; keep the status message
    }
    throw new ApiError(message, response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export interface CustomFont {
  id: string;
  family: string;
  fileName: string;
  size: number;
  uploadedAt: string;
  url: string;
}

export interface AIChange {
  label: string;
  before: string;
  after: string;
}

export interface QAIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  captionNumber: number | null;
  fixable: boolean;
}

export interface QAReport {
  status: 'good' | 'needsAttention';
  issues: QAIssue[];
  checked: number;
}

export interface AICommandResult {
  reply: string;
  changes: AIChange[];
  rejected: string[];
  actions: AIAction[];
  project: CaptionProject;
  qa: QAReport | null;
  model: string;
}

export interface AIStatus {
  configured: boolean;
  provider: string;
  model: string;
  reason: string | null;
}

export const api = {
  aiStatus: () => request<AIStatus>('/ai/status'),

  aiCommand: (
    id: string,
    prompt: string,
    selectedCaptionIds: string[],
    playheadSeconds: number,
    project?: CaptionProject,
  ) =>
    request<AICommandResult>(
      `/projects/${id}/ai/command`,
      json({ prompt, selectedCaptionIds, playheadSeconds, project }),
    ),

  captionQA: (id: string, safeZone?: string) =>
    request<QAReport>(`/projects/${id}/qa`, json({ safeZone })),

  listFonts: () => request<CustomFont[]>('/fonts'),

  uploadFont: (file: File) =>
    request<CustomFont>('/fonts', {
      method: 'POST',
      headers: {
        'x-file-name': encodeURIComponent(file.name),
        'Content-Type': 'application/octet-stream',
      },
      body: file,
      duplex: 'half',
    } as RequestInit),

  renameFont: (id: string, family: string) =>
    request<CustomFont>(`/fonts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ family }),
    }),

  deleteFont: (id: string) => request<{ ok: boolean }>(`/fonts/${id}`, { method: 'DELETE' }),

  health: () => request<{ ok: boolean; acceptedExtensions: string[] }>('/health'),

  providers: () => request<ProviderSummary[]>('/providers'),

  listProjects: () => request<ProjectSummary[]>('/projects'),

  createProject: (name: string) => request<CaptionProject>('/projects', json({ name })),

  loadProject: (id: string) => request<CaptionProject>(`/projects/${id}`),

  saveProject: (project: CaptionProject) =>
    request<CaptionProject>(`/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    }),

  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),

  /** Streams the file straight to disk; returns the project with media attached. */
  uploadMedia: (
    id: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<CaptionProject> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/projects/${id}/media`);
      xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
      xhr.setRequestHeader('x-file-size', String(file.size));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      if (signal) {
        if (signal.aborted) {
          reject(new DOMException('Upload aborted', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', () => {
          xhr.abort();
          reject(new DOMException('Upload aborted', 'AbortError'));
        });
      }

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            onProgress(e.loaded, e.total);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as CaptionProject);
          } catch {
            reject(new Error('Invalid response from server'));
          }
        } else {
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            reject(new ApiError(body.error || `Upload failed (${xhr.status})`, xhr.status));
          } catch {
            reject(new ApiError(`Upload failed (${xhr.status})`, xhr.status));
          }
        }
      };

      xhr.onerror = () => {
        reject(new ApiError('Network connection lost during upload. Check your Wi-Fi or LAN connection.', 0));
      };

      xhr.onabort = () => {
        reject(new DOMException('Upload aborted', 'AbortError'));
      };

      xhr.send(file);
    }),

  /** Stores and analyses an optional client vocabulary PDF inside the project. */
  uploadTerminologyPdf: (id: string, file: File, signal?: AbortSignal) =>
    request<CaptionProject>(`/projects/${id}/terminology`, {
      method: 'POST',
      headers: {
        'x-file-name': encodeURIComponent(file.name),
        'x-file-size': String(file.size),
        'Content-Type': 'application/pdf',
      },
      body: file,
      signal,
      duplex: 'half',
    } as RequestInit),

  removeTerminologyPdf: (id: string) =>
    request<CaptionProject>(`/projects/${id}/terminology`, { method: 'DELETE' }),

  mediaUrl: (id: string, version?: string | number) =>
    `${BASE}/projects/${id}/media/file${version ? `?v=${encodeURIComponent(version)}` : ''}`,

  waveform: (id: string, buckets = 1200) =>
    request<{ peaks: number[]; duration: number; cached?: boolean }>(
      `/projects/${id}/waveform?buckets=${buckets}`,
    ),

  transcribe: (
    id: string,
    providerId: string | null,
    language: LanguageCode,
    hinglishDomain?: HinglishDomain,
  ) =>
    request<JobState>(
      `/projects/${id}/transcribe`,
      json({ providerId, language, hinglishDomain }),
    ),

  translateProject: (id: string, targetLanguage: LanguageCode) =>
    request<JobState>(`/projects/${id}/translate`, json({ targetLanguage })),

  regenerate: (id: string, segmentation: Partial<SegmentationSettings>) =>
    request<CaptionProject>(`/projects/${id}/regenerate`, json({ segmentation })),

  job: (id: string) => request<JobState>(`/jobs/${id}`),

  cancelJob: (id: string) => request<{ cancelled: boolean }>(`/jobs/${id}/cancel`, { method: 'POST' }),

  exportVideo: (id: string, format: VideoExportFormat) =>
    request<JobState<RenderResult>>(`/projects/${id}/export/video`, json({ format })),

  /** Subtitles come back as a file download rather than JSON. */
  exportSubtitles: async (id: string, format: SubtitleFormat, fileName: string) => {
    const response = await fetch(`${BASE}/projects/${id}/export/subtitles`, json({ format }));

    if (!response.ok) {
      let message = 'Export failed';
      try {
        const body = (await response.json()) as { error?: string; issues?: unknown[] };
        if (body.error) message = body.error;
        throw new ApiError(message, response.status, body);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(message, response.status);
      }
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  },

  // --- Hinglish Studio: Lexicon & Corrections
  recordCorrection: (data: {
    segment_id: string;
    before: string;
    after: string;
    left_context?: string | null;
    right_context?: string | null;
    category?: string;
    editor?: string;
  }) => request<{ ok: boolean; id: string }>('/corrections', json(data)),

  getCorrections: (limit = 100) => request<any[]>(`/corrections?limit=${limit}`),

  getLexiconCandidates: () =>
    request<{ all: any[]; promotable: any[] }>('/lexicon/candidates'),

  approveLexicon: (surface_form: string, approved_by = 'Owner') =>
    request<{ ok: boolean }>('/lexicon/approve', json({ surface_form, approved_by })),

  rejectLexicon: (surface_form: string) =>
    request<{ ok: boolean }>('/lexicon/reject', json({ surface_form })),

  backupDb: (destPath?: string) =>
    request<{ ok: boolean; backupFile: string }>('/backup', json({ path: destPath })),

  getVocabulary: () =>
    request<{ version: number; description: string; entries: any[] }>('/vocabulary'),

  saveVocabularyEntry: (entry: any) =>
    request<{ ok: boolean; entry: any }>('/vocabulary/entry', json(entry)),

  deleteVocabularyEntry: (word: string) =>
    request<{ ok: boolean }>('/vocabulary/entry', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word }),
    }),

  extractVocabularyCandidates: (captions: string[]) =>
    request<{ candidates: Array<{ word: string; count: number; examples: string[]; suggested_form: string }> }>(
      '/vocabulary/extract-candidates',
      json({ captions }),
    ),

  evaluateVocabulary: () =>
    request<any>('/vocabulary/evaluate', { method: 'POST' }),

  getAIProviderStatuses: () =>
    request<Array<{ id: string; name: string; role: string; configured: boolean; model: string; endpoint: string; reason: string | null }>>(
      '/ai/providers/status',
    ),

  getAIModelLogs: () =>
    request<Array<{
      id: string;
      timestamp: string;
      provider: string;
      primaryModel: string;
      secondaryModel?: string;
      responseTimeMs: number;
      confidence: number;
      fallbackUsed: boolean;
      secondOpinionUsed: boolean;
      correctionsCount: number;
      uncertainWordsCount: number;
      tokensCount: number;
    }>>('/ai/logs'),

  compareAIProviders: (text: string, properNouns?: string[]) =>
    request<{
      original: string;
      groq: { caption: string; tokens: string[]; confidence: number; responseTimeMs: number; error?: string };
      openrouter: { caption: string; tokens: string[]; confidence: number; responseTimeMs: number; error?: string };
      finalSelected: { caption: string; tokens: string[]; confidence: number; reason: string; secondOpinionUsed: boolean; agreementCount: number };
    }>('/ai/compare', json({ text, properNouns })),

  benchmarkAIProviders: (cases?: Array<{ input: string; expected: string }>) =>
    request<{
      casesCount: number;
      groqAccuracy: number;
      openRouterAccuracy: number;
      hybridAccuracy: number;
      averageLatencyGroqMs: number;
      averageLatencyOpenRouterMs: number;
      recommendation: string;
    }>('/ai/benchmark', json({ cases })),

  getSettings: () => request<AppSettings>('/settings'),

  saveSettings: (payload: SaveSettingsPayload) =>
    request<{ ok: boolean; settings: AppSettings }>('/settings', json(payload)),

  testKey: (provider: 'groq' | 'openrouter' | 'gemini', apiKey: string) =>
    request<TestKeyResult>('/settings/test', json({ provider, apiKey })),
};

/** Follows job progress over SSE, falling back to polling if the stream dies. */
export const subscribeToJobs = (
  projectId: string,
  onUpdate: (job: JobState) => void,
): (() => void) => {
  const source = new EventSource(`${BASE}/jobs-stream?projectId=${encodeURIComponent(projectId)}`);

  source.onmessage = (event) => {
    try {
      onUpdate(JSON.parse(event.data) as JobState);
    } catch {
      // ignore malformed frames rather than tearing down the stream
    }
  };

  return () => source.close();
};
