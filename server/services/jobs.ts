import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';
export type JobType = 'transcribe' | 'render' | 'waveform';

export interface JobState<T = unknown> {
  id: string;
  type: JobType;
  projectId: string;
  status: JobStatus;
  /** 0..1, or null when the work has no measurable progress */
  progress: number | null;
  message: string;
  result: T | null;
  error: { message: string; code: string; retryable: boolean } | null;
  startedAt: string;
  finishedAt: string | null;
}

interface JobRecord<T = unknown> {
  state: JobState<T>;
  controller: AbortController;
}

export interface JobContext {
  signal: AbortSignal;
  report(progress: number | null, message: string): void;
}

/**
 * A small in-process job registry. Work runs off the request cycle so the UI
 * stays responsive, and progress is pushed to clients over SSE.
 */
class JobManager extends EventEmitter {
  private jobs = new Map<string, JobRecord>();

  /** Finished jobs are kept briefly so a client that reconnects still sees them. */
  private static readonly RETENTION_MS = 5 * 60_000;

  start<T>(
    type: JobType,
    projectId: string,
    work: (context: JobContext) => Promise<T>,
  ): JobState<T> {
    const id = randomUUID();
    const controller = new AbortController();

    const state: JobState<T> = {
      id,
      type,
      projectId,
      status: 'running',
      progress: null,
      message: 'Starting',
      result: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };

    const record: JobRecord<T> = { state, controller };
    this.jobs.set(id, record as JobRecord);

    const context: JobContext = {
      signal: controller.signal,
      report: (progress, message) => {
        if (state.status !== 'running') return;
        state.progress = progress;
        state.message = message;
        this.emit('update', state);
      },
    };

    void work(context)
      .then((result) => {
        if (state.status === 'cancelled') return;
        state.status = 'done';
        state.progress = 1;
        state.message = 'Finished';
        state.result = result;
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || state.status === 'cancelled') {
          state.status = 'cancelled';
          state.message = 'Cancelled';
        } else {
          const err = error as { message?: string; code?: string; retryable?: boolean };
          state.status = 'error';
          state.message = 'Failed';
          state.error = {
            message: err.message ?? 'Something went wrong',
            code: err.code ?? 'unknown',
            retryable: err.retryable ?? true,
          };
        }
      })
      .finally(() => {
        state.finishedAt = new Date().toISOString();
        this.emit('update', state);
        setTimeout(() => this.jobs.delete(id), JobManager.RETENTION_MS).unref?.();
      });

    this.emit('update', state);
    return state;
  }

  get(id: string): JobState | undefined {
    return this.jobs.get(id)?.state;
  }

  listFor(projectId: string): JobState[] {
    return [...this.jobs.values()]
      .map((r) => r.state)
      .filter((s) => s.projectId === projectId);
  }

  cancel(id: string): boolean {
    const record = this.jobs.get(id);
    if (!record || record.state.status !== 'running') return false;
    record.state.status = 'cancelled';
    record.state.message = 'Cancelling';
    record.controller.abort();
    this.emit('update', record.state);
    return true;
  }
}

export const jobs = new JobManager();
