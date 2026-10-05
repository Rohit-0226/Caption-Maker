import React, { useRef, useState } from 'react';
import { api } from '../../app/api';
import { useEditor } from '../../app/store';
import { parseSubtitles } from '../../core/subtitles/formats';
import { Dialog } from '../../app/shell/Dialog';
import { navigate } from '../../app/shell/router';
import { toast } from '../../app/shell/toast';
import { formatBytes, plural } from '../../app/shell/format';
import { describeError } from '../../app/shell/shellApi';
const MEDIA_ACCEPT =
  'video/*,audio/*,.mp4,.mov,.webm,.mkv,.m4v,.avi,.wmv,.flv,.ts,.mts,.m2ts,.3gp,.vob,.ogv,.divx,.mpeg,.mpg,.m2v,.asf,.f4v,.mp3,.wav,.m4a,.aac,.ogg,.flac,.wma,.opus,.m4b,.aiff,.aif,.amr';

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * "Have subtitles already?" — builds a project from a video plus an SRT or VTT
 * file, skipping transcription. Each cue becomes one caption; its words share
 * the cue's time evenly, as the existing importer does.
 */
export const ImportSubtitlesModal: React.FC<{
  initialMedia?: File | null;
  onClose: () => void;
  onProjectsChanged: () => void;
}> = ({ initialMedia = null, onClose, onProjectsChanged }) => {
  const [media, setMedia] = useState<File | null>(initialMedia);
  const [subtitle, setSubtitle] = useState<{ file: File; text: string; cues: number } | null>(null);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const subtitleRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const projectIdRef = useRef<string | null>(null);

  /** Checked straight away, so a bad file is caught before a long video upload. */
  const pickSubtitle = async (file: File) => {
    setSubtitleError(null);
    try {
      const text = await file.text();
      const cues = parseSubtitles(text).length;
      if (cues === 0) {
        setSubtitle(null);
        setSubtitleError('No timed lines found. Check it is an .srt or .vtt file with lines like 00:00:01,000 --> 00:00:04,000.');
        return;
      }
      setSubtitle({ file, text, cues });
    } catch (e) {
      setSubtitleError(describeError(e));
    }
  };

  const create = async () => {
    if (!media || !subtitle) return;
    setError(null);
    setBusy({ loaded: 0, total: media.size });
    try {
      const projectId = projectIdRef.current ?? (await api.createProject('Untitled project')).id;
      projectIdRef.current = projectId;
      abortRef.current = new AbortController();
      const project = await api.uploadMedia(
        projectId,
        media,
        (loaded, total) => setBusy({ loaded, total }),
        abortRef.current.signal,
      );
      abortRef.current = null;
      const store = useEditor.getState();
      store.setProject(project);
      const result = store.importSubtitles(subtitle.text);
      await useEditor.getState().save();
      if (useEditor.getState().saveStatus === 'error') {
        throw new Error(useEditor.getState().saveError ?? 'The captions could not be saved.');
      }
      toast.success('Subtitles imported', `${plural(result.count, 'caption')} from ${subtitle.file.name}.`);
      onProjectsChanged();
      onClose();
      navigate({ page: 'editor', projectId });
    } catch (e) {
      abortRef.current = null;
      setBusy(null);
      if (isAbort(e)) return;
      setError(describeError(e));
    }
  };

  const cancel = async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    // an upload that never finished leaves an empty project; tidy it away
    const projectId = projectIdRef.current;
    if (projectId && useEditor.getState().project?.id !== projectId) {
      await api.deleteProject(projectId).catch(() => undefined);
      onProjectsChanged();
    }
    onClose();
  };

  const percent = busy ? Math.round((busy.loaded / Math.max(1, busy.total)) * 100) : 0;

  return (
    <Dialog
      open
      title="Import subtitles"
      description="Use captions you already have. Pick the video (or audio) and its .srt or .vtt file."
      width={520}
      onClose={busy ? null : () => void cancel()}
      footer={
        <>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={() => void cancel()}>
            Cancel
          </button>
          <button
            type="button"
            className="ui-btn ui-btn--primary"
            disabled={!media || !subtitle || Boolean(busy)}
            onClick={() => void create()}
          >
            {busy ? <span className="ui-spin" aria-hidden /> : null}
            Create project
          </button>
        </>
      }
    >
      <div className="hm-form">
        <div className="ui-field">
          <div className="ui-field__head">
            <span className="ui-label">Video or audio</span>
          </div>
          <div className="ui-file-row">
            <span className="ui-file-row__name" title={media?.name}>
              {media ? `${media.name} · ${formatBytes(media.size)}` : 'No file chosen'}
            </span>
            <button type="button" className="ui-btn ui-btn--sm" disabled={Boolean(busy)} onClick={() => mediaRef.current?.click()}>
              {media ? 'Change' : 'Choose file'}
            </button>
            <input
              ref={mediaRef}
              type="file"
              accept={MEDIA_ACCEPT}
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) setMedia(file);
              }}
            />
          </div>
        </div>

        <div className="ui-field">
          <div className="ui-field__head">
            <span className="ui-label">Subtitle file</span>
            {subtitle ? <span className="ui-label__value">{plural(subtitle.cues, 'line')}</span> : null}
          </div>
          <div className="ui-file-row">
            <span className="ui-file-row__name" title={subtitle?.file.name}>
              {subtitle ? subtitle.file.name : '.srt or .vtt'}
            </span>
            <button type="button" className="ui-btn ui-btn--sm" disabled={Boolean(busy)} onClick={() => subtitleRef.current?.click()}>
              {subtitle ? 'Change' : 'Choose file'}
            </button>
            <input
              ref={subtitleRef}
              type="file"
              accept=".srt,.vtt,text/plain,text/vtt"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void pickSubtitle(file);
              }}
            />
          </div>
          {subtitleError ? <p className="ui-hint ui-hint--error">{subtitleError}</p> : null}
        </div>

        {busy ? (
          <div className="hm-upload">
            <span className="hm-step__bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${Math.max(2, percent)}%` }} />
            </span>
            <span className="hm-upload__numbers">
              {percent < 100
                ? `Uploading ${percent}% · ${formatBytes(busy.loaded)} of ${formatBytes(busy.total)}`
                : 'Making a preview copy and reading the subtitles…'}
            </span>
          </div>
        ) : null}

        {error ? (
          <div className="ui-note ui-note--error" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
};
