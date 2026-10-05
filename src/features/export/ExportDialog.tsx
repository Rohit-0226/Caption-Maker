import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  subscribeToJobs,
  type JobState,
  type RenderResult,
} from '../../app/api';
import { useEditor } from '../../app/store';
import { validateCaptions } from '../../core/subtitles/formats';
import {
  ASPECT_RATIOS,
  EXPORT_PRESETS,
  QUALITY_OPTIONS,
  resolveExportSpec,
} from '../../core/rendering/exportPresets';
import type {
  SubtitleFormat,
  VideoExportFormat,
  VideoExportQuality,
} from '../../core/types/project';
import { Button, Field, Select } from '../../components/controls';
import { Banner, ErrorState, Modal, ProgressBar } from '../../components/feedback';
import { IconDownload } from '../../components/icons';

const SUBTITLE_FORMATS: { value: SubtitleFormat; label: string; hint: string }[] = [
  { value: 'srt', label: 'SubRip (.srt)', hint: 'The universal subtitle format.' },
  { value: 'vtt', label: 'WebVTT (.vtt)', hint: 'For the web and HTML5 video players.' },
  {
    value: 'ass',
    label: 'Advanced SubStation (.ass)',
    hint: 'Carries font, colour and position. Styling is approximate.',
  },
  {
    value: 'json',
    label: 'Caption Maker project (.json)',
    hint: 'Everything, including the transcript and every setting.',
  },
];

const VIDEO_FORMATS: { value: VideoExportFormat; label: string; hint: string }[] = [
  {
    value: 'mp4',
    label: 'Captioned MP4',
    hint: 'Your video with captions burned in, audio kept. The usual choice.',
  },
  {
    value: 'mov-alpha',
    label: 'Transparent overlay (.mov)',
    hint: 'Captions only, on transparency. ProRes 4444 — large but widely supported.',
  },
  {
    value: 'webm-alpha',
    label: 'Transparent overlay (.webm)',
    hint: 'Captions only, on transparency. Far smaller, but not every editor reads it.',
  },
];

export const ExportDialog: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const project = useEditor((s) => s.project);
  const save = useEditor((s) => s.save);

  const [subtitleFormat, setSubtitleFormat] = useState<SubtitleFormat>('srt');
  const [videoFormat, setVideoFormat] = useState<VideoExportFormat>('mp4');
  const [job, setJob] = useState<JobState<RenderResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const projectId = project?.id;

  useEffect(() => {
    if (open && project) setVideoFormat(project.exportSettings.videoFormat);
  }, [open, project?.id, project?.exportSettings.videoFormat]);

  useEffect(() => {
    if (!projectId || !open) return;
    return subscribeToJobs(projectId, (update) => {
      if (update.type === 'render') setJob(update as JobState<RenderResult>);
    });
  }, [projectId, open]);

  const activePreset = useMemo(() => {
    const s = project?.exportSettings;
    if (!s) return null;
    return (
      EXPORT_PRESETS.find(
        (p) => p.format === s.videoFormat && p.width === s.width && p.height === s.height,
      )?.id ?? null
    );
  }, [project?.exportSettings]);

  const currentRatio = useMemo(() => {
    const s = project?.exportSettings;
    if (!s) return 'source';
    if (s.aspectRatio) return s.aspectRatio;
    if (s.width === 1080 && s.height === 1920) return '9:16';
    if (s.width === 1920 && s.height === 1080) return '16:9';
    if (s.width === 1080 && s.height === 1080) return '1:1';
    if (s.width === 1080 && s.height === 1350) return '4:5';
    if (s.width != null || s.height != null) return 'custom';
    return 'source';
  }, [project?.exportSettings]);

  const currentQuality: VideoExportQuality = project?.exportSettings.quality ?? 'high';

  const handleRatioChange = useCallback(
    (ratioId: string) => {
      if (!project) return;
      const option = ASPECT_RATIOS.find((r) => r.id === ratioId);
      if (!option) return;

      if (option.id === 'custom') {
        useEditor.getState().update({
          exportSettings: {
            ...project.exportSettings,
            aspectRatio: 'custom',
            width: project.exportSettings.width ?? project.media?.width ?? 1080,
            height: project.exportSettings.height ?? project.media?.height ?? 1920,
          },
        });
      } else {
        useEditor.getState().update({
          exportSettings: {
            ...project.exportSettings,
            aspectRatio: option.id,
            width: option.width,
            height: option.height,
          },
        });
      }
    },
    [project],
  );

  const handleCustomWidthChange = useCallback(
    (w: number) => {
      if (!project) return;
      const safe = Math.max(100, Math.min(7680, Math.round(w) || 1080));
      useEditor.getState().update({
        exportSettings: {
          ...project.exportSettings,
          aspectRatio: 'custom',
          width: safe % 2 === 0 ? safe : safe + 1,
        },
      });
    },
    [project],
  );

  const handleCustomHeightChange = useCallback(
    (h: number) => {
      if (!project) return;
      const safe = Math.max(100, Math.min(7680, Math.round(h) || 1920));
      useEditor.getState().update({
        exportSettings: {
          ...project.exportSettings,
          aspectRatio: 'custom',
          height: safe % 2 === 0 ? safe : safe + 1,
        },
      });
    },
    [project],
  );

  const handleQualityChange = useCallback(
    (quality: VideoExportQuality) => {
      if (!project) return;
      useEditor.getState().update({
        exportSettings: {
          ...project.exportSettings,
          quality,
        },
      });
    },
    [project],
  );

  const issues = useMemo(
    () => (project ? validateCaptions(project.captions) : []),
    [project],
  );

  const exportSpec = useMemo(
    () => (project ? resolveExportSpec(project) : null),
    [project],
  );

  const exportSubtitles = useCallback(async () => {
    if (!project) return;
    setError(null);
    setBusy(true);
    try {
      // make sure the server is exporting exactly what is on screen
      await save();
      const extension = subtitleFormat === 'json' ? 'json' : subtitleFormat;
      await api.exportSubtitles(project.id, subtitleFormat, `${project.name}.${extension}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [project, subtitleFormat, save]);

  const exportVideo = useCallback(async () => {
    if (!project) return;
    setError(null);
    setBusy(true);
    try {
      await save();
      const started = await api.exportVideo(project.id, videoFormat);
      setJob(started as JobState<RenderResult>);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [project, videoFormat, save]);

  if (!project) return null;

  const rendering = job?.status === 'running';
  const finished = job?.status === 'done' && job.result;
  const noCaptions = project.captions.length === 0;

  return (
    <Modal
      open={open}
      title="Export"
      description={`${project.captions.length} captions · ${project.name}`}
      onClose={onClose}
      width={560}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {noCaptions ? (
        <Banner tone="warning">
          There are no captions to export yet. Transcribe your media first.
        </Banner>
      ) : null}

      {issues.length > 0 ? (
        <Banner tone="danger">
          {issues.length} caption{issues.length === 1 ? ' has' : 's have'} a timing problem —
          the first is “{issues[0].message}” on caption {issues[0].index + 1}. Fix it before
          exporting.
        </Banner>
      ) : null}

      <section className="cm-export__section">
        <h3 className="section-title">Subtitles</h3>
        <Field label="Format" hint={SUBTITLE_FORMATS.find((f) => f.value === subtitleFormat)?.hint}>
          <Select<SubtitleFormat>
            value={subtitleFormat}
            ariaLabel="Subtitle format"
            options={SUBTITLE_FORMATS.map((f) => ({ value: f.value, label: f.label }))}
            onChange={setSubtitleFormat}
          />
        </Field>
        <Button
          variant="secondary"
          block
          icon={<IconDownload size={15} />}
          loading={busy && !rendering}
          disabled={noCaptions || issues.length > 0}
          onClick={() => void exportSubtitles()}
        >
          Download subtitles
        </Button>
      </section>

      <section className="cm-export__section">
        <h3 className="section-title">Video</h3>

        <div className="cm-quick" style={{ marginBottom: 'var(--space-4)' }}>
          {EXPORT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`cm-quick__item ${
                activePreset === preset.id ? 'is-active' : ''
              }`}
              title={preset.description}
              onClick={() => {
                setVideoFormat(preset.format);
                useEditor.getState().update({
                  exportSettings: {
                    ...project.exportSettings,
                    videoFormat: preset.format,
                    width: preset.width,
                    height: preset.height,
                    fps: preset.fps,
                  },
                });
              }}
            >
              {preset.name}
            </button>
          ))}
        </div>

        <Field label="Format" hint={VIDEO_FORMATS.find((f) => f.value === videoFormat)?.hint}>
          <Select<VideoExportFormat>
            value={videoFormat}
            ariaLabel="Video format"
            options={VIDEO_FORMATS.map((f) => ({
              value: f.value,
              label: f.label,
              disabled: f.value === 'mp4' && !project.media,
            }))}
            onChange={(format) => {
              setVideoFormat(format);
              useEditor.getState().update({
                exportSettings: { ...project.exportSettings, videoFormat: format },
              });
            }}
          />
        </Field>

        <Field
          label="Aspect Ratio / Framing"
          hint={ASPECT_RATIOS.find((r) => r.id === currentRatio)?.description}
        >
          <Select
            value={currentRatio}
            ariaLabel="Aspect ratio"
            options={ASPECT_RATIOS.map((r) => ({ value: r.id, label: r.label }))}
            onChange={handleRatioChange}
          />
        </Field>

        {currentRatio === 'custom' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-3)',
            }}
          >
            <Field label="Custom Width (px)">
              <input
                type="number"
                min={100}
                max={7680}
                step={2}
                value={project.exportSettings.width ?? 1080}
                style={{
                  height: 32,
                  padding: '0 var(--space-3)',
                  background: 'var(--surface-sunken)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  font: 'inherit',
                  fontSize: 'var(--text-sm)',
                  width: '100%',
                }}
                onChange={(e) => handleCustomWidthChange(Number(e.target.value))}
              />
            </Field>
            <Field label="Custom Height (px)">
              <input
                type="number"
                min={100}
                max={7680}
                step={2}
                value={project.exportSettings.height ?? 1920}
                style={{
                  height: 32,
                  padding: '0 var(--space-3)',
                  background: 'var(--surface-sunken)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  font: 'inherit',
                  fontSize: 'var(--text-sm)',
                  width: '100%',
                }}
                onChange={(e) => handleCustomHeightChange(Number(e.target.value))}
              />
            </Field>
          </div>
        ) : null}

        <Field
          label="Target Weight / File Size"
          hint={QUALITY_OPTIONS.find((q) => q.id === currentQuality)?.description}
        >
          <Select<VideoExportQuality>
            value={currentQuality}
            ariaLabel="Target video weight and quality"
            options={QUALITY_OPTIONS.map((q) => ({ value: q.id, label: q.label }))}
            onChange={handleQualityChange}
          />
        </Field>

        {exportSpec ? (
          <div className="cm-export__quality" aria-label="Export quality">
            <div>
              <strong>
                {exportSpec.quality === 'high'
                  ? 'High Quality'
                  : exportSpec.quality === 'medium'
                    ? 'Balanced Weight'
                    : 'Lightweight'}
              </strong>
              <span>
                {exportSpec.width}×{exportSpec.height} · {exportSpec.fps} fps
              </span>
            </div>
            <span className="cm-export__quality-badge">
              {exportSpec.keepsSourceResolution && exportSpec.keepsSourceFps
                ? 'Source Ratio'
                : `${exportSpec.width}×${exportSpec.height}`}
            </span>
          </div>
        ) : null}

        {rendering ? (
          <div className="cm-export__progress">
            <ProgressBar value={job?.progress ?? null} label={job?.message ?? 'Rendering'} />
            <Button
              size="sm"
              variant="ghost"
              block
              onClick={() => job && void api.cancelJob(job.id)}
            >
              Cancel render
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            block
            icon={<IconDownload size={15} />}
            disabled={noCaptions || issues.length > 0}
            onClick={() => void exportVideo()}
          >
            Render video
          </Button>
        )}

        {finished && job?.result ? (
          <div className="cm-export__done">
            <Banner
              tone="success"
              action={
                <a
                  className="cm-button cm-button--secondary cm-button--sm"
                  href={job.result.url}
                  download
                >
                  Download
                </a>
              }
            >
              {job.result.fileName} · {(job.result.size / 1e6).toFixed(1)} MB
            </Banner>
          </div>
        ) : null}

        {job?.status === 'error' && job.error ? (
          <div className="cm-export__done">
            <ErrorState
              title="Render failed"
              message={job.error.message}
              onRetry={job.error.retryable ? () => void exportVideo() : undefined}
              onDismiss={() => setJob(null)}
            />
          </div>
        ) : null}
      </section>

      {error ? (
        <ErrorState title="Export failed" message={error} onDismiss={() => setError(null)} />
      ) : null}
    </Modal>
  );
};
