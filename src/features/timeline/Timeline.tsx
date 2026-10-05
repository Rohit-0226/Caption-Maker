import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { api } from '../../app/api';
import { useEditor } from '../../app/store';
import {
  playbackClock,
  previewFps,
  useActiveCaptionId,
  useCurrentTime,
} from '../../app/playbackClock';
import { projectDuration } from '../../core/rendering/scene';
import { captionText } from '../../core/segmentation/segmenter';
import type { Caption } from '../../core/types/project';
import { IconButton } from '../../components/controls';
import { IconWaveform } from '../../components/icons';
import { Spinner } from '../../components/feedback';

type DragMode = 'start' | 'end' | null;

const EMPTY_CAPTIONS: Caption[] = [];

const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

const formatTick = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * The only part of the timeline that follows the playhead.
 *
 * Isolating it means playback repaints one marker and one overlay, instead of
 * re-running the waveform canvas and every caption block sixty times a second.
 */
const TimelinePlayhead: React.FC<{
  duration: number;
  onPointerDown?: (e: React.PointerEvent) => void;
}> = ({ duration, onPointerDown }) => {
  const currentTime = useCurrentTime();
  const percent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <>
      <div className="cm-timeline__played" style={{ width: `${percent}%` }} />
      <div
        className="cm-timeline__playhead"
        style={{ left: `${percent}%` }}
        onPointerDown={onPointerDown}
      >
        <span className="cm-timeline__playhead-grip" />
      </div>
    </>
  );
};

export const Timeline: React.FC<{ playerRef: React.RefObject<PlayerRef | null> }> = ({
  playerRef,
}) => {
  const projectId = useEditor((s) => s.project?.id);
  const media = useEditor((s) => s.project?.media);
  const captions = useEditor((s) => s.project?.captions);
  const selectedId = useEditor((s) => s.selectedCaptionId);
  const selectCaption = useEditor((s) => s.selectCaption);
  const setCaptionTiming = useEditor((s) => s.setCaptionTiming);
  /*
   * Both come from the same place as the player's scene. The timeline used to
   * take the source fps and a rounded-up store duration, so its seeks landed
   * on the wrong frame whenever the export frame rate differed, and its scale
   * ran up to a second past the end of the player.
   */
  const fps = useEditor((s) => previewFps(s.project));
  const duration = useEditor((s) => (s.project ? projectDuration(s.project) : 5));

  // marks the caption under the playhead without re-rendering every frame
  const playingId = useActiveCaptionId(captions ?? EMPTY_CAPTIONS);

  const [zoom, setZoom] = useState(1);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [loadingWave, setLoadingWave] = useState(false);
  const [waveError, setWaveError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ id: string; mode: DragMode; start: number; end: number } | null>(null);

  // --- waveform ----------------------------------------------------------

  const loadWaveform = useCallback(async () => {
    if (!projectId || !media?.hasAudio) return;
    setLoadingWave(true);
    setWaveError(null);
    try {
      const result = await api.waveform(projectId, 1600);
      setPeaks(result.peaks);
    } catch (error) {
      setWaveError((error as Error).message);
    } finally {
      setLoadingWave(false);
    }
  }, [projectId, media?.hasAudio]);

  useEffect(() => {
    setPeaks(null);
    void loadWaveform();
  }, [loadWaveform]);

  // --- drawing -----------------------------------------------------------

  const contentWidth = Math.max(600, (scrollRef.current?.clientWidth ?? 900) * zoom);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || peaks.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const mid = height / 2;
    const barWidth = width / peaks.length;

    // Dual-tone studio gradient for high dynamic range clarity
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#34d399');
    gradient.addColorStop(0.5, '#10b981');
    gradient.addColorStop(1, '#059669');
    ctx.fillStyle = gradient;

    for (let i = 0; i < peaks.length; i++) {
      const amplitude = Math.max(1.5, peaks[i] * (height / 2 - 2));
      const barW = Math.max(1, barWidth - 0.4);
      ctx.fillRect(i * barWidth, mid - amplitude, barW, amplitude * 2);
    }
  }, [peaks]);

  useEffect(() => {
    draw();
  }, [draw, contentWidth, zoom]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  // --- interactions ------------------------------------------------------

  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const track = scrollRef.current?.querySelector('.cm-timeline__content');
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(duration, ratio * duration));
    },
    [duration],
  );

  const isScrubbingRef = useRef(false);

  const seek = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(duration, time));
      playbackClock.setTime(clamped);
      playerRef.current?.seekTo(Math.round(clamped * fps));
    },
    [playerRef, duration, fps],
  );

  const startScrub = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.cm-block')) return;
      e.stopPropagation();
      isScrubbingRef.current = true;
      document.body.classList.add('is-dragging-timeline');
      seek(timeFromEvent(e.clientX));
    },
    [timeFromEvent, seek],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (isScrubbingRef.current) {
        seek(timeFromEvent(event.clientX));
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const time = timeFromEvent(event.clientX);
      if (drag.mode === 'start') {
        setCaptionTiming(drag.id, Math.min(time, drag.end - 0.1), drag.end);
      } else if (drag.mode === 'end') {
        setCaptionTiming(drag.id, drag.start, Math.max(time, drag.start + 0.1));
      }
    };
    const onUp = () => {
      if (isScrubbingRef.current) {
        isScrubbingRef.current = false;
        document.body.classList.remove('is-dragging-timeline');
      }
      if (dragRef.current) {
        dragRef.current = null;
        document.body.classList.remove('is-dragging-timeline');
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [timeFromEvent, setCaptionTiming, seek, duration]);

  // --- ticks -------------------------------------------------------------

  const ticks = useMemo(() => {
    if (duration <= 0) return [];
    const targetCount = Math.max(4, Math.round((contentWidth / 90) * 1));
    const rough = duration / targetCount;
    const step = TICK_STEPS.find((s) => s >= rough) ?? TICK_STEPS[TICK_STEPS.length - 1];
    const out: number[] = [];
    for (let t = 0; t <= duration; t += step) out.push(t);
    return out;
  }, [duration, contentWidth]);

  if (!media) {
    return (
      <div className="cm-timeline cm-timeline--empty">
        <IconWaveform size={16} />
        <span>The timeline appears once you add media.</span>
      </div>
    );
  }

  return (
    <div className="cm-timeline cm-timeline--kalakar">
      <div className="cm-timeline__toolbar">
        <div className="cm-timeline__meta" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
            TIMELINE
          </span>
          {loadingWave ? <Spinner size={12} label="Audio" /> : null}
        </div>

        <span style={{ flex: 1 }} />

        <div className="cm-timeline__zoom-bar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
          <input
            className="cm-timeline__zoom-slider"
            type="range"
            min={1}
            max={12}
            step={0.2}
            value={zoom}
            aria-label="Timeline zoom"
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </div>

        <button
          type="button"
          className="cm-timeline__expand-btn"
          title="Toggle timeline expansion"
          onClick={() => setZoom(zoom > 1 ? 1 : 3)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </div>

      {/* Kalakar Multi-Track Gutter: Captions, Video 1, Audio 1 */}
      <div className="cm-timeline__gutter" aria-hidden>
        <span className="cm-timeline__lane cm-timeline__lane--ruler" />
        <span className="cm-timeline__lane cm-timeline__lane--captions">
          <span className="cm-lane-dot cm-lane-dot--captions">!</span>
          <span>Captions</span>
        </span>
        <span className="cm-timeline__lane cm-timeline__lane--video">
          <span className="cm-lane-dot cm-lane-dot--video">■</span>
          <span>Video 1</span>
        </span>
        <span className="cm-timeline__lane cm-timeline__lane--audio">
          <span className="cm-lane-dot cm-lane-dot--audio">▲</span>
          <span>Audio 1</span>
        </span>
      </div>

      <div className="cm-timeline__scroll" ref={scrollRef}>
        <div
          className="cm-timeline__content"
          style={{ width: `${zoom * 100}%` }}
          onPointerDown={startScrub}
        >
          <div className="cm-timeline__ruler">
            {ticks.map((t) => (
              <span
                key={t}
                className="cm-timeline__tick mono"
                style={{ left: `${(t / duration) * 100}%` }}
              >
                {formatTick(t)}
              </span>
            ))}
          </div>

          {/* Track 1: Captions */}
          <div className="cm-timeline__track cm-timeline__track--captions">
            {(captions ?? []).map((caption) => {
              const left = (caption.start / duration) * 100;
              const width = ((caption.end - caption.start) / duration) * 100;
              return (
                <div
                  key={caption.id}
                  className={[
                    'cm-block',
                    selectedId === caption.id ? 'is-selected' : '',
                    playingId === caption.id ? 'is-playing' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.25)}%` }}
                  title={captionText(caption)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    selectCaption(caption.id);
                  }}
                  onDoubleClick={() => seek(caption.start)}
                >
                  <span
                    className="cm-block__handle cm-block__handle--start"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      dragRef.current = {
                        id: caption.id,
                        mode: 'start',
                        start: caption.start,
                        end: caption.end,
                      };
                      document.body.classList.add('is-dragging-timeline');
                    }}
                  />
                  <span className="cm-block__text truncate">{captionText(caption)}</span>
                  <span
                    className="cm-block__handle cm-block__handle--end"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      dragRef.current = {
                        id: caption.id,
                        mode: 'end',
                        start: caption.start,
                        end: caption.end,
                      };
                      document.body.classList.add('is-dragging-timeline');
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Track 2: Video 1 — Studio Filmstrip */}
          <div className="cm-timeline__track cm-timeline__track--video">
            <div className="cm-video-clip-bar" title={media?.fileName ?? 'Video Track'}>
              <div className="cm-video-clip-bar__info">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                <span className="cm-video-clip-bar__label truncate">
                  {media?.fileName ? media.fileName : 'Video 1'}
                </span>
                {media?.width && media?.height ? (
                  <span className="cm-video-clip-bar__meta mono">
                    {media.width}×{media.height}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Track 3: Audio 1 (Green Waveform) */}
          <div className="cm-timeline__track cm-timeline__track--audio">
            {media.hasAudio ? (
              <canvas ref={canvasRef} className="cm-timeline__canvas" />
            ) : (
              <div className="cm-timeline__no-audio">No audio track</div>
            )}
          </div>

          <TimelinePlayhead duration={duration} onPointerDown={startScrub} />
        </div>
      </div>
    </div>
  );
};
