import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, subscribeToJobs, type JobState } from '../../app/api';
import { useEditor } from '../../app/store';
import { defaultSegmentation } from '../../core/project/defaults';
import type { CaptionProject, SegmentationSettings } from '../../core/types/project';
import { Dialog } from '../../app/shell/Dialog';
import { navigate } from '../../app/shell/router';
import { toast } from '../../app/shell/toast';
import { formatBytes, plural } from '../../app/shell/format';
import { IconFilm, IconMusic } from '../../app/shell/icons';
import { describeError } from '../../app/shell/shellApi';
import { PipelineSteps } from './PipelineSteps';
import { PIPELINE_STEPS, stepForJobMessage, type PipelineStep } from './pipeline';
import { StarterTemplates, starterPatch } from './StarterTemplates';
import {
  AdvancedTranscription,
  LanguagePicker,
  blockingReason,
  defaultChoices,
  effectiveLanguage,
  parseTerms,
  resolveProvider,
  useProviders,
  type TranscribeChoices,
} from './TranscriptionOptions';

export type WordsPerCaption = 'auto' | 1 | 2 | 3 | 4 | 5;

/** "Auto" keeps the segmenter's own balance; a number means exactly that many words, one line. */
export const segmentationFor = (words: WordsPerCaption): Partial<SegmentationSettings> =>
  words === 'auto'
    ? { maxWordsPerLine: defaultSegmentation.maxWordsPerLine, maxLines: defaultSegmentation.maxLines }
    : { maxWordsPerLine: words, maxLines: 1 };

/** Asks the shell to open Settings, from anywhere, without threading a prop through. */
export const openSettings = () => window.dispatchEvent(new CustomEvent('cm:open-settings'));

type Phase =
  | { kind: 'options' }
  | {
      kind: 'working';
      step: PipelineStep;
      detail: string | null;
      progress: number | null;
      upload: { loaded: number; total: number } | null;
    }
  | { kind: 'failed'; step: PipelineStep; message: string; needsSettings: boolean };

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * From a dropped file to an open editor: a few choices, then upload, preview
 * copy, transcription and caption building, with real progress throughout.
 */
export const UploadModal: React.FC<{
  file: File;
  onClose: () => void;
  /** the grid should refresh: a project now exists even if the run stopped */
  onProjectsChanged: () => void;
}> = ({ file, onClose, onProjectsChanged }) => {
  const [choices, setChoices] = useState<TranscribeChoices>(() => defaultChoices());
  const [words, setWords] = useState<WordsPerCaption>('auto');
  const [template, setTemplate] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'options' });
  const { providers } = useProviders();
  const provider = resolveProvider(providers, choices);
  const blocked = blockingReason(provider, choices);

  const projectIdRef = useRef<string | null>(null);
  const uploadedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const finishedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
      unsubscribeRef.current?.();
    },
    [],
  );

  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|mkv|webm|avi|wmv|flv|ts|mts|m2ts|3gp|mpe?g)$/i.test(file.name);

  const fail = useCallback((step: PipelineStep, message: string, needsSettings = false) => {
    if (!mountedRef.current) return;
    setPhase({ kind: 'failed', step, message, needsSettings });
  }, []);

  /** Opens the finished project; the editor picks it straight up from the store. */
  const finish = useCallback(
    async (projectId: string) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      unsubscribeRef.current?.();
      try {
        const project = await api.loadProject(projectId);
        useEditor.getState().setProject(project);
        toast.success('Captions ready', `${plural(project.captions.length, 'caption')} in ${project.name}.`);
        onProjectsChanged();
        onClose();
        navigate({ page: 'editor', projectId });
      } catch (error) {
        finishedRef.current = false;
        fail('captions', describeError(error));
      }
    },
    [fail, onClose, onProjectsChanged],
  );

  const onJob = useCallback(
    (job: JobState) => {
      if (job.type !== 'transcribe' || job.id !== jobIdRef.current || !mountedRef.current) return;
      if (job.status === 'done') {
        void finish(job.projectId);
        return;
      }
      if (job.status === 'error') {
        unsubscribeRef.current?.();
        fail('transcribe', job.error?.message ?? 'Transcription stopped with an error.', job.error?.code === 'not-configured');
        return;
      }
      if (job.status === 'cancelled') {
        unsubscribeRef.current?.();
        return;
      }
      setPhase((current) => {
        const previous = current.kind === 'working' ? current.step : 'audio';
        return {
          kind: 'working',
          step: stepForJobMessage(job.message, previous),
          detail: job.message,
          progress: job.progress,
          upload: null,
        };
      });
    },
    [fail, finish],
  );

  /** Everything the choices change, written before transcription reads the project. */
  const applyChoices = (project: CaptionProject): CaptionProject => {
    const starter = template ? starterPatch(template) : null;
    const terms = parseTerms(choices.terms);
    const mergedTerms = parseTerms([...project.terminology.terms, ...terms].join('\n'));
    return {
      ...project,
      language: effectiveLanguage(choices),
      hinglishDomain: choices.domain,
      segmentation: { ...project.segmentation, ...segmentationFor(words) },
      style: starter ? starter.style : project.style,
      animation: starter?.animation ? { ...project.animation, ...starter.animation } : project.animation,
      terminology: terms.length ? { ...project.terminology, terms: mergedTerms } : project.terminology,
    };
  };

  const run = async () => {
    setPhase({ kind: 'working', step: 'upload', detail: null, progress: null, upload: { loaded: 0, total: file.size } });
    let step: PipelineStep = 'upload';
    try {
      let projectId = projectIdRef.current;
      if (!projectId) {
        // named after the file by the server once the media lands
        projectId = (await api.createProject('Untitled project')).id;
        projectIdRef.current = projectId;
        onProjectsChanged();
      }

      let project: CaptionProject;
      if (!uploadedRef.current) {
        abortRef.current = new AbortController();
        project = await api.uploadMedia(
          projectId,
          file,
          (loaded, total) => {
            if (!mountedRef.current) return;
            const done = total > 0 && loaded >= total;
            if (done) step = 'preview';
            setPhase({
              kind: 'working',
              step: done ? 'preview' : 'upload',
              detail: done ? (isVideo ? 'Checking the file and making a copy every browser can play' : 'Checking the file') : null,
              progress: null,
              upload: { loaded, total },
            });
          },
          abortRef.current.signal,
        );
        uploadedRef.current = true;
        abortRef.current = null;
      } else {
        project = await api.loadProject(projectId);
      }

      step = 'preview';
      if (!mountedRef.current) return;
      setPhase({ kind: 'working', step: 'preview', detail: 'Saving your choices', progress: null, upload: null });

      if (choices.pdf) {
        try {
          project = await api.uploadTerminologyPdf(projectId, choices.pdf);
        } catch (error) {
          // a glossary is a help, not a requirement: carry on without it
          toast.warning('Terminology PDF skipped', `${describeError(error)} Captions will still be generated.`);
        }
      }

      project = await api.saveProject(applyChoices(project));
      if (template) useEditor.getState().setLastAppliedPresetId(template);

      if (!project.media?.hasAudio) {
        fail(
          'audio',
          'This file has no audio track, so there is nothing to transcribe. Open the project to import a subtitle file or style captions by hand.',
        );
        return;
      }

      step = 'audio';
      const job = await api.transcribe(projectId, provider?.id ?? null, effectiveLanguage(choices), choices.domain);
      jobIdRef.current = job.id;
      unsubscribeRef.current?.();
      // the stream replays this job's latest state on connect, so nothing is missed
      unsubscribeRef.current = subscribeToJobs(projectId, onJob);
      onJob(job);
    } catch (error) {
      abortRef.current = null;
      if (isAbort(error)) return;
      const message = describeError(error);
      const needsSettings =
        error instanceof ApiError && error.status === 400 && /key|settings|not configured|set up/i.test(message);
      fail(step, message, needsSettings);
    }
  };

  /**
   * Stops whatever is running (or closes after a failure). A project whose
   * upload never finished is empty, so it is removed rather than left behind
   * as an "Untitled project" card.
   */
  const cancel = async (reason: 'stop' | 'close') => {
    const projectId = projectIdRef.current;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (reason === 'stop' && jobIdRef.current && !finishedRef.current) {
      await api.cancelJob(jobIdRef.current).catch(() => undefined);
    }
    unsubscribeRef.current?.();
    if (projectId && !uploadedRef.current) {
      await api.deleteProject(projectId).catch(() => undefined);
    } else if (projectId && reason === 'stop') {
      toast.info('Stopped', 'The project is saved with its media. Open it and press Regenerate to try again.');
    }
    onProjectsChanged();
    onClose();
  };

  const openProjectAnyway = () => {
    const projectId = projectIdRef.current;
    if (!projectId) return;
    unsubscribeRef.current?.();
    onProjectsChanged();
    onClose();
    navigate({ page: 'editor', projectId });
  };

  const working = phase.kind === 'working';

  const footer =
    phase.kind === 'options' ? (
      <>
        <button type="button" className="ui-btn ui-btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="ui-btn ui-btn--primary"
          disabled={Boolean(blocked) || providers === null}
          title={blocked ?? undefined}
          onClick={() => void run()}
        >
          Generate captions
        </button>
      </>
    ) : phase.kind === 'working' ? (
      <button type="button" className="ui-btn ui-btn--ghost" onClick={() => void cancel('stop')}>
        Cancel
      </button>
    ) : (
      <>
        <button type="button" className="ui-btn ui-btn--ghost" onClick={() => void cancel('close')}>
          Close
        </button>
        {uploadedRef.current ? (
          <button type="button" className="ui-btn" onClick={openProjectAnyway}>
            Open project anyway
          </button>
        ) : null}
        {phase.needsSettings ? (
          <button type="button" className="ui-btn" onClick={openSettings}>
            Open Settings
          </button>
        ) : null}
        <button type="button" className="ui-btn ui-btn--primary" onClick={() => void run()}>
          Try again
        </button>
      </>
    );

  return (
    <Dialog
      open
      title={phase.kind === 'options' ? 'New captions' : phase.kind === 'working' ? 'Generating captions' : 'That didn’t work'}
      width={560}
      onClose={working ? null : phase.kind === 'failed' ? () => void cancel('close') : onClose}
      footer={footer}
    >
      <div className="hm-file">
        <span className="hm-file__icon" aria-hidden>
          {isVideo ? <IconFilm size={18} /> : <IconMusic size={18} />}
        </span>
        <span className="hm-file__name" title={file.name}>
          {file.name}
        </span>
        <span className="hm-file__size">{formatBytes(file.size)}</span>
      </div>

      {phase.kind === 'options' ? (
        <div className="hm-form">
          <LanguagePicker choices={choices} onChange={setChoices} />

          <div className="ui-field">
            <div className="ui-field__head">
              <span className="ui-label">Words per caption</span>
            </div>
            <div className="ui-seg" role="radiogroup" aria-label="Words per caption">
              {(['auto', 1, 2, 3, 4, 5] as const).map((option) => (
                <button
                  key={String(option)}
                  type="button"
                  role="radio"
                  aria-checked={words === option}
                  className={words === option ? 'is-active' : ''}
                  onClick={() => setWords(option)}
                >
                  {option === 'auto' ? 'Auto' : option}
                </button>
              ))}
            </div>
            <p className="ui-hint">
              {words === 'auto'
                ? 'Captions break at natural pauses, up to two short lines.'
                : `Exactly up to ${plural(words, 'word')} on screen at a time, on one line.`}
            </p>
          </div>

          <StarterTemplates value={template} onChange={setTemplate} />

          <AdvancedTranscription choices={choices} onChange={setChoices} providers={providers} />

          {blocked ? (
            <div className="ui-note" role="note">
              <span>{blocked}</span>
              {provider && !provider.configured ? (
                <button type="button" className="ui-link" onClick={openSettings}>
                  Open Settings
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : phase.kind === 'working' ? (
        <div className="hm-progress">
          <PipelineSteps
            steps={PIPELINE_STEPS}
            current={phase.step}
            detail={phase.detail}
            progress={phase.progress}
            extra={
              phase.step === 'upload' && phase.upload ? (
                <span className="hm-upload">
                  <span className="hm-step__bar" role="progressbar" aria-valuenow={Math.round((phase.upload.loaded / Math.max(1, phase.upload.total)) * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${Math.max(2, (phase.upload.loaded / Math.max(1, phase.upload.total)) * 100)}%` }} />
                  </span>
                  <span className="hm-upload__numbers">
                    {Math.round((phase.upload.loaded / Math.max(1, phase.upload.total)) * 100)}% ·{' '}
                    {formatBytes(phase.upload.loaded)} of {formatBytes(phase.upload.total)}
                  </span>
                </span>
              ) : null
            }
          />
          <p className="ui-hint">The editor opens on its own when the captions are ready.</p>
        </div>
      ) : (
        <div className="hm-failed" role="alert">
          <PipelineSteps steps={PIPELINE_STEPS} current={phase.step} failed />
          <div className="ui-note ui-note--error">
            <span>{phase.message}</span>
          </div>
        </div>
      )}
    </Dialog>
  );
};
