import { api, ApiError, type ProjectSummary } from '../api';
import type { CaptionProject } from '../../core/types/project';

/**
 * Calls the new shell needs on top of `api`. Kept in their own module so the
 * shared api.ts (whose upload internals another change is reworking) is left
 * alone.
 */

/** What the Projects page shows on a card; the extra fields come from the server's list. */
export interface ProjectCardSummary extends ProjectSummary {
  createdAt?: string;
  duration?: number | null;
  mediaKind?: 'video' | 'audio' | null;
  width?: number | null;
  height?: number | null;
  language?: string;
  firstCaption?: string | null;
  mediaVersion?: string | null;
}

const send = async <T>(path: string, init: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError('Cannot reach the Caption Maker server. Is it still running?', 0);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status message
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
};

export const shellApi = {
  listProjects: () => api.listProjects() as Promise<ProjectCardSummary[]>,

  /** The version makes a re-imported video fetch a fresh picture instead of the cached one. */
  thumbnailUrl: (id: string, version?: string | null) =>
    `/api/projects/${encodeURIComponent(id)}/thumbnail${version ? `?v=${encodeURIComponent(version)}` : ''}`,

  duplicateProject: (id: string, name?: string) =>
    send<CaptionProject>(`/projects/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(name ? { name } : {}),
    }),

  /** Renames a project that is not open in the editor (the open one renames through the store). */
  renameProject: async (id: string, name: string) => {
    const project = await api.loadProject(id);
    return api.saveProject({ ...project, name });
  },
};

/** "Cannot reach the server" deserves different words from "the server said no". */
export const describeError = (error: unknown): string => {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
};
