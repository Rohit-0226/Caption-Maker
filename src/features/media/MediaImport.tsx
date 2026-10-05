import React, { useCallback, useRef, useState } from 'react';
import { api, ApiError } from '../../app/api';
import { useEditor } from '../../app/store';
import { Button } from '../../components/controls';
import { ErrorState, ProgressBar } from '../../components/feedback';
import { IconUpload } from '../../components/icons';

const VIDEO = ['MP4', 'MOV', 'WebM', 'MKV', 'AVI', 'WMV', 'TS', 'All Formats'];
const AUDIO = ['MP3', 'WAV', 'M4A', 'AAC', 'OGG', 'FLAC', 'WMA', 'Opus'];
const ACCEPT =
  'video/*,audio/*,.mp4,.mov,.webm,.mkv,.m4v,.avi,.wmv,.flv,.ts,.mts,.m2ts,.3gp,.vob,.ogv,.divx,.mpeg,.mpg,.m2v,.asf,.f4v,.mp3,.wav,.m4a,.aac,.ogg,.flac,.wma,.opus,.m4b,.aiff,.aif,.amr';

export const MediaImport: React.FC<{ projectId: string }> = ({ projectId }) => {
  const setProject = useEditor((s) => s.setProject);
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      setUploadProgress({ loaded: 0, total: file.size });
      setFileName(file.name);
      try {
        const project = await api.uploadMedia(projectId, file, (loaded, total) => {
          setUploadProgress({ loaded, total });
        });
        setProject(project);
      } catch (e) {
        setError(
          e instanceof ApiError
            ? e.message
            : `Could not import that file: ${(e as Error).message}`,
        );
      } finally {
        setUploading(false);
        setUploadProgress(null);
      }
    },
    [projectId, setProject],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void upload(file);
    },
    [upload],
  );

  if (uploading) {
    const percent =
      uploadProgress && uploadProgress.total > 0
        ? Math.round((uploadProgress.loaded / uploadProgress.total) * 100)
        : null;
    const mbLoaded = uploadProgress ? (uploadProgress.loaded / (1024 * 1024)).toFixed(1) : '0';
    const mbTotal = uploadProgress ? (uploadProgress.total / (1024 * 1024)).toFixed(1) : '0';

    return (
      <div className="cm-import">
        <div className="cm-import__zone is-busy">
          <ProgressBar
            value={percent}
            label={
              percent !== null
                ? `Uploading ${fileName ?? 'file'}… ${percent}% (${mbLoaded} / ${mbTotal} MB)`
                : `Importing ${fileName ?? 'your file'}…`
            }
          />
          <p className="cm-import__note">
            Large videos stream directly to the project folder without clipping.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cm-import">
      <div
        className={`cm-import__zone ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="cm-import__icon">
          <IconUpload size={30} />
        </div>

        <h2 className="cm-import__title">Add video or audio</h2>
        <p className="cm-import__subtitle">
          Drop a file here, or choose one from your computer.
        </p>

        <Button
          variant="primary"
          size="lg"
          onClick={() => inputRef.current?.click()}
          icon={<IconUpload size={15} />}
        >
          Choose file
        </Button>

        <div className="cm-import__formats">
          <div>
            <span className="cm-import__formats-label">Video</span>
            {VIDEO.join(' · ')}
          </div>
          <div>
            <span className="cm-import__formats-label">Audio</span>
            {AUDIO.join(' · ')}
          </div>
        </div>
        <p className="cm-import__note">
          No file-size limit. Video and audio are streamed directly to the project folder.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </div>

      {error ? (
        <div className="cm-import__error">
          <ErrorState
            title="Import failed"
            message={error}
            onRetry={() => inputRef.current?.click()}
            retryLabel="Choose another file"
            onDismiss={() => setError(null)}
          />
        </div>
      ) : null}
    </div>
  );
};
