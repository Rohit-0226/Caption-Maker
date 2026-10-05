import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, type CallbackListener, type PlayerRef } from '@remotion/player';
import { CaptionScene, type CaptionSceneProps } from '../../remotion/CaptionScene';
import { buildScene } from '../../core/rendering/scene';
import { api } from '../../app/api';
import { useEditor } from '../../app/store';
import { playbackClock, useCurrentTime, useIsPlaying } from '../../app/playbackClock';
import { IconButton, Select } from '../../components/controls';
import { IconPause, IconPlay, IconVolume } from '../../components/icons';
import { SAFE_ZONES, type SafeZonePlatform } from '../../core/rendering/safeZones';
import { CaptionBoundingBox } from './CaptionBoundingBox';

const formatTime = (seconds: number) => {
  // Whole hundredths first: frame times such as 183 / 30 land a hair under
  // 6.1 in floating point, and flooring the fraction showed 06.09.
  const total = Math.round(Math.max(0, seconds) * 100);
  const m = Math.floor(total / 6000);
  const sec = Math.floor(total / 100) % 60;
  const cs = total % 100;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

const SPEEDS = ['0.5', '0.75', '1', '1.25', '1.5', '2'] as const;
const ZOOMS = ['fit', '0.5', '0.75', '1'] as const;

/**
 * These two read the playhead, so they re-render on every frame. Keeping them
 * as leaves means the frame cost is a text node and a slider thumb — the Player
 * and the rest of the transport never re-render during playback.
 */
const TransportTime: React.FC<{ duration: number }> = ({ duration }) => {
  const currentTime = useCurrentTime();
  return (
    <div className="cm-transport__time mono">
      <span className="cm-transport__current">{formatTime(currentTime)}</span>
      <span className="cm-transport__sep">/</span>
      <span className="cm-transport__total">{formatTime(duration)}</span>
    </div>
  );
};

const TransportScrub: React.FC<{
  fps: number;
  durationInFrames: number;
  onSeek: (frame: number) => void;
}> = ({ fps, durationInFrames, onSeek }) => {
  const currentTime = useCurrentTime();
  return (
    <input
      className="cm-transport__scrub"
      type="range"
      min={0}
      max={Math.max(0, durationInFrames - 1)}
      step={1}
      value={Math.round(currentTime * fps)}
      aria-label="Seek"
      onChange={(e) => onSeek(Number(e.target.value))}
    />
  );
};

export const Preview: React.FC<{ playerRef: React.RefObject<PlayerRef | null> }> = ({
  playerRef,
}) => {
  /*
   * Every hook in this component runs before the early `return null` further
   * down. React matches hooks by call order, so a hook placed after a
   * conditional return makes the hook count change between renders — React
   * then throws "Rendered more hooks than during the previous render" and the
   * whole preview dies. Hooks that need the scene therefore tolerate null.
   */
  const project = useEditor((s) => s.project);
  const setProject = useEditor((s) => s.setProject);
  const selectedId = useEditor((s) => s.selectedCaptionId);
  const isPlaying = useIsPlaying();

  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>('1');
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>('fit');
  const safeZone = useEditor((s) => s.safeZone);
  const syncCaptionToPlayhead = useEditor((s) => s.syncCaptionToPlayhead);
  const [syncedFeedback, setSyncedFeedback] = useState(false);
  const [loopSelected, setLoopSelected] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [stageDimensions, setStageDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedCaption = useMemo(
    () => project?.captions.find((c) => c.id === selectedId) || null,
    [project?.captions, selectedId],
  );

  const mediaVersion = project?.media?.importedAt ?? '';
  const mediaUrl = useMemo(
    () => (project?.media ? api.mediaUrl(project.id, mediaVersion) : null),
    [project?.id, project?.media, mediaVersion],
  );

  const scene = useMemo(() => {
    if (!project) return null;
    return buildScene(project, {
      mediaSrc: mediaUrl,
    });
  }, [project, mediaUrl]);

  const fps = scene?.fps ?? 30;
  const durationInFrames = scene?.durationInFrames ?? 1;
  const hasScene = scene !== null;

  /**
   * A file the browser cannot decode used to surface only as an uncaught
   * exception in the console, leaving a black frame with no explanation.
   * Catching it here lets the captions keep working and tells the user why
   * the picture is missing.
   */
  const onMediaError = useCallback((error: Error) => {
    // eslint-disable-next-line no-console
    console.warn('[preview] media failed to load:', error.message);
    setMediaError(
      'This media could not be played in the preview. Captions still work, and the export is unaffected. Try re-importing the file.',
    );
  }, []);

  // a new file (or a re-import of the same one) gets a fresh chance to load
  useEffect(() => {
    setMediaError(null);
  }, [mediaUrl]);

  const inputProps = useMemo((): CaptionSceneProps | null => {
    if (!scene || !project) return null;
    return {
      scene,
      preview: true,
      showTransparencyGrid: true,
      safeZone,
      audioSrc: project.media?.hasAudio ? mediaUrl : null,
      volume: muted ? 0 : volume,
      onMediaError,
    };
  }, [scene, project, safeZone, muted, volume, mediaUrl, onMediaError]);

  /**
   * Opening another project (or replacing the media) starts from the top,
   * paused. The Player stays mounted across projects, so without this it kept
   * the old playhead — and kept playing — over a different video.
   */
  const projectId = project?.id;
  useEffect(() => {
    playbackClock.reset();
    const player = playerRef.current;
    if (!player) return;
    player.pause();
    player.seekTo(0);
  }, [projectId, mediaUrl, playerRef]);

  // Cue selected caption with 300ms lead-in ONLY if loopSelected is enabled by user.
  // Keyed on the frame rate rather than the scene: the scene is rebuilt on
  // every edit and autosave, which used to yank the playhead back mid-loop.
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !hasScene || !selectedCaption || !loopSelected) return;
    const leadIn = Math.max(0, selectedCaption.start - 0.3);
    player.seekTo(Math.round(leadIn * fps));
  }, [selectedCaption?.id, loopSelected, playerRef, hasScene, fps]);

  // keep the store's playhead in step with the player & handle segment loop
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !hasScene) return;

    const onFrame: CallbackListener<'frameupdate'> = (e) => {
      const currentSec = e.detail.frame / fps;
      playbackClock.setTime(currentSec);

      // Only loop if user explicitly toggled loopSelected on
      if (loopSelected && selectedCaption && player.isPlaying()) {
        if (currentSec >= selectedCaption.end) {
          const leadIn = Math.max(0, selectedCaption.start - 0.3);
          player.seekTo(Math.round(leadIn * fps));
        }
      }
    };
    const onPlay = () => playbackClock.setPlaying(true);
    const onPause = () => playbackClock.setPlaying(false);

    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);

    // the player may have moved while nothing was listening
    playbackClock.setTime(player.getCurrentFrame() / fps);
    playbackClock.setPlaying(player.isPlaying());

    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
    };
  }, [playerRef, hasScene, fps, loopSelected, selectedCaption]);

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isPlaying()) player.pause();
    else void player.play();
  }, [playerRef]);

  const skipSeconds = useCallback(
    (deltaSeconds: number) => {
      const player = playerRef.current;
      if (!player || !hasScene) return;
      const current = player.getCurrentFrame();
      const target = Math.max(
        0,
        Math.min(durationInFrames - 1, current + Math.round(deltaSeconds * fps)),
      );
      player.seekTo(target);
    },
    [playerRef, hasScene, durationInFrames, fps],
  );

  const stepFrames = useCallback(
    (delta: number) => {
      const player = playerRef.current;
      if (!player || !hasScene) return;
      const current = player.getCurrentFrame();
      const target = Math.max(0, Math.min(durationInFrames - 1, current + delta));
      player.seekTo(target);
    },
    [playerRef, hasScene, durationInFrames],
  );

  // Re-attaches once the stage exists, in case the first render had no scene.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageDimensions({ width: rect.width, height: rect.height });
      }
    };

    measure();

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setStageDimensions({ width, height });
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasScene]);

  const fitDimensions = useMemo((): React.CSSProperties => {
    if (!scene) return { width: '100%', height: '100%' };

    const aspect = scene.width / scene.height;
    const stageW = stageDimensions.width;
    const stageH = stageDimensions.height;

    if (stageW <= 0 || stageH <= 0) {
      return {
        width: aspect >= 1 ? '100%' : `${Math.round(100 * aspect)}%`,
        height: aspect < 1 ? '100%' : `${Math.round(100 / aspect)}%`,
        maxWidth: '100%',
        maxHeight: '100%',
        aspectRatio: `${scene.width} / ${scene.height}`,
      };
    }

    // Leave a clean margin (32px horizontal, 32px vertical) for floating overlay buttons & padding
    const availW = Math.max(80, stageW - 32);
    const availH = Math.max(80, stageH - 32);

    const videoAspect = scene.width / scene.height;
    const stageAspect = availW / availH;

    let width: number;
    let height: number;

    if (videoAspect > stageAspect) {
      // Video is wider than stage: fit to width
      width = availW;
      height = Math.round(availW / videoAspect);
    } else {
      // Video is taller than stage: fit to height
      height = availH;
      width = Math.round(availH * videoAspect);
    }

    return {
      width: `${width}px`,
      height: `${height}px`,
      maxWidth: '100%',
      maxHeight: '100%',
      aspectRatio: `${scene.width} / ${scene.height}`,
    };
  }, [scene, stageDimensions]);

  const sceneWidth = scene?.width ?? 0;
  const sceneHeight = scene?.height ?? 0;
  const playerStyle: React.CSSProperties = useMemo(() => {
    if (zoom === 'fit' || sceneWidth <= 0 || sceneHeight <= 0) {
      return fitDimensions;
    }
    const scale = Number(zoom);
    return {
      width: `${sceneWidth * scale}px`,
      height: `${sceneHeight * scale}px`,
      aspectRatio: `${sceneWidth} / ${sceneHeight}`,
    };
  }, [zoom, fitDimensions, sceneWidth, sceneHeight]);

  if (!project || !scene || !inputProps) return null;

  const duration = scene.durationInFrames / scene.fps;

  const handleReplaceClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    setUploadingMedia(true);
    try {
      const updated = await api.uploadMedia(project.id, file);
      setProject(updated);
    } catch (err) {
      console.error('Failed to replace media:', err);
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleFullscreen = () => {
    if (!stageRef.current) return;
    if (!document.fullscreenElement) {
      void stageRef.current.requestFullscreen().catch(() => {});
    } else {
      void document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="cm-preview">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,.mp4,.mov,.webm,.mkv,.m4v,.avi,.wmv,.flv,.ts,.mts,.m2ts,.3gp,.vob,.ogv,.divx,.mpeg,.mpg,.m2v,.asf,.f4v,.mp3,.wav,.m4a,.aac,.ogg,.flac,.wma,.opus,.m4b,.aiff,.aif,.amr"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className="cm-preview__stage" ref={stageRef}>

        <div
          ref={frameRef}
          className="cm-preview__frame"
          style={playerStyle}
        >
          <Player
            ref={playerRef}
            component={CaptionScene as unknown as React.FC<Record<string, unknown>>}
            inputProps={inputProps as unknown as Record<string, unknown>}
            durationInFrames={scene.durationInFrames}
            fps={scene.fps}
            compositionWidth={scene.width}
            compositionHeight={scene.height}
            playbackRate={Number(speed)}
            style={{ width: '100%', height: '100%' }}
            acknowledgeRemotionLicense
          />

          {mediaError ? (
            <div className="cm-preview__media-error" role="alert">
              {mediaError}
            </div>
          ) : null}

          {/* editor-only overlay; a sibling of the composition so it can never be exported */}
          <CaptionBoundingBox frameRef={frameRef} />
        </div>
      </div>

      <div className="cm-transport cm-transport--kalakar">
        <div className="cm-transport__playback-group">
          <IconButton
            label="Skip back 5s (Shift+←)"
            onClick={() => skipSeconds(-5)}
            className="cm-transport__step-btn"
          >
            <span className="cm-transport__skip-text">-5s</span>
          </IconButton>
          <IconButton
            label="Step back 1 frame (←)"
            onClick={() => stepFrames(-1)}
            className="cm-transport__step-btn"
          >
            <span className="cm-transport__skip-text">-1f</span>
          </IconButton>
          <IconButton
            label={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            onClick={togglePlay}
            className="cm-transport__play"
          >
            {isPlaying ? <IconPause size={17} /> : <IconPlay size={17} />}
          </IconButton>
          <IconButton
            label="Step forward 1 frame (→)"
            onClick={() => stepFrames(1)}
            className="cm-transport__step-btn"
          >
            <span className="cm-transport__skip-text">+1f</span>
          </IconButton>
          <IconButton
            label="Skip forward 5s (Shift+→)"
            onClick={() => skipSeconds(5)}
            className="cm-transport__step-btn"
          >
            <span className="cm-transport__skip-text">+5s</span>
          </IconButton>
        </div>

        <div className="cm-transport__vol-wrap">
          <IconButton
            label={muted ? 'Unmute' : 'Mute'}
            onClick={() => setMuted((m) => !m)}
            className="cm-transport__vol-btn"
          >
            <IconVolume size={16} muted={muted} />
          </IconButton>
          <input
            className="cm-transport__volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            aria-label="Volume"
            onChange={(e) => {
              setVolume(Number(e.target.value));
              setMuted(false);
            }}
          />
        </div>

        <TransportTime duration={duration} />

        <TransportScrub
          fps={scene.fps}
          durationInFrames={scene.durationInFrames}
          onSeek={(frame) => playerRef.current?.seekTo(frame)}
        />

        <div className="cm-transport__tools-group">
          <select
            className="cm-transport__select-pill"
            value={speed}
            onChange={(e) => setSpeed(e.target.value as (typeof SPEEDS)[number])}
            title="Playback Speed"
            aria-label="Playback Speed"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>

          <select
            className="cm-transport__select-pill"
            value={zoom}
            onChange={(e) => setZoom(e.target.value as (typeof ZOOMS)[number])}
            title="Preview Zoom"
            aria-label="Preview Zoom"
          >
            <option value="fit">Fit</option>
            <option value="0.5">50%</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
          </select>

          <IconButton
            label={syncedFeedback ? 'Synced to playhead!' : 'Sync selected caption start to playhead'}
            onClick={() => {
              const targetId = selectedCaption?.id ?? project?.captions?.[0]?.id;
              if (targetId) {
                syncCaptionToPlayhead(targetId, playbackClock.getTime());
                setSyncedFeedback(true);
                setTimeout(() => setSyncedFeedback(false), 1200);
              }
            }}
            className={`cm-transport__sync-btn ${syncedFeedback ? 'is-active' : ''}`}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </IconButton>

          <IconButton
            label={loopSelected ? 'Loop selected caption (Enabled)' : 'Loop selected caption (Disabled)'}
            onClick={() => setLoopSelected((l) => !l)}
            className={`cm-transport__loop-btn ${loopSelected ? 'is-active' : ''}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </IconButton>

          <IconButton
            label="Fullscreen"
            onClick={toggleFullscreen}
            className="cm-transport__fullscreen"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </IconButton>
        </div>
      </div>
    </div>
  );
};
