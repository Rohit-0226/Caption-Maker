import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, Video, useVideoConfig } from 'remotion';
import type { RenderScene } from '../core/types/project';
import { CaptionLayer } from './CaptionLayer';
import { captionFrameRange } from '../core/subtitles/timing';
import { FontLoader } from './FontLoader';
import { getSafeZone, type SafeZonePlatform } from '../core/rendering/safeZones';

export interface CaptionSceneProps {
  scene: RenderScene;
  /** the Player needs a plain <Video>; the renderer wants <OffthreadVideo> */
  preview?: boolean;
  /** draw a checkerboard where the frame is transparent (editor only) */
  showTransparencyGrid?: boolean;
  /** platform interface guides, editor only — never part of an export */
  safeZone?: SafeZonePlatform;
  /**
   * Editor-only audio track. When the background is not the source video there
   * is no <Video> to carry sound, so the preview plays the media separately.
   */
  audioSrc?: string | null;
  volume?: number;
  playbackRate?: number;
  /**
   * Editor-only. Without a handler Remotion throws from inside the media
   * element's error event, which only reaches the console; with one the editor
   * can tell the user why the picture is missing.
   */
  onMediaError?: (error: Error) => void;
}

const CHECKER =
  'repeating-conic-gradient(#242731 0% 25%, #1b1d25 0% 50%) 50% / 40px 40px';

/**
 * How far the preview's <video> may drift from the player clock before it is
 * re-seeked. Captions follow the clock exactly, so any drift here shows up as
 * captions running ahead of or behind the speaker. Remotion's default allows
 * nearly half a second; this keeps the picture within a few frames without
 * re-seeking so often that playback stutters.
 */
const PREVIEW_SYNC_TOLERANCE_SECONDS = 0.15;

const SafeArea: React.FC<{ platform: SafeZonePlatform }> = ({ platform }) => {
  const spec = getSafeZone(platform);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {spec.regions.map((region) => (
        <div
          key={region.label}
          style={{
            position: 'absolute',
            left: region.right === undefined ? 0 : undefined,
            right: 0,
            top: region.bottom === undefined ? 0 : undefined,
            bottom: region.top === undefined ? 0 : undefined,
            width: region.right !== undefined ? region.right + '%' : '100%',
            height:
              region.top !== undefined
                ? region.top + '%'
                : region.bottom !== undefined
                  ? region.bottom + '%'
                  : '100%',
            background:
              'repeating-linear-gradient(45deg, rgba(255,92,124,0.10) 0 8px, transparent 8px 16px)',
            borderColor: 'rgba(255,92,124,0.45)',
            borderStyle: 'dashed',
            borderWidth: 0,
            borderTopWidth: region.bottom !== undefined ? 1.5 : 0,
            borderBottomWidth: region.top !== undefined ? 1.5 : 0,
            borderLeftWidth: region.right !== undefined ? 1.5 : 0,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

export const CaptionScene: React.FC<CaptionSceneProps> = ({
  scene,
  preview = false,
  showTransparencyGrid = false,
  safeZone = 'none',
  audioSrc = null,
  volume = 1,
  onMediaError,
}) => {
  const { fps } = useVideoConfig();

  const background =
    scene.background.mode === 'solid'
      ? scene.background.color
      : scene.background.mode === 'transparent'
        ? showTransparencyGrid
          ? CHECKER
          : undefined
        : '#000000';

  const isAudioOnly = scene.mediaKind === 'audio';

  return (
    <AbsoluteFill style={{ background }}>
      <FontLoader fonts={scene.fonts ?? []} />

      {scene.background.mode === 'source' && scene.mediaSrc && !isAudioOnly ? (
        preview ? (
          <Video
            src={scene.mediaSrc}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            volume={volume}
            acceptableTimeShiftInSeconds={PREVIEW_SYNC_TOLERANCE_SECONDS}
            onError={onMediaError}
          />
        ) : (
          <OffthreadVideo
            src={scene.mediaSrc}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            muted
          />
        )
      ) : null}

      {/* When media is audio-only in source background mode, render an audio backdrop */}
      {isAudioOnly && scene.background.mode === 'source' ? (
        <AbsoluteFill
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #13151b 0%, #1a1e29 50%, #111319 100%)',
            color: '#8b949e',
            gap: 16,
          }}
        >
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: '50%',
              background: 'rgba(255, 212, 0, 0.12)',
              border: '2px solid rgba(255, 212, 0, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 40px rgba(255, 212, 0, 0.15)',
            }}
          >
            <svg
              width="44"
              height="44"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffd400"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '0.04em', color: '#e6edf3' }}>
            Audio Track Playing
          </span>
        </AbsoluteFill>
      ) : null}

      {/* Audio playback */}
      {preview && (
        isAudioOnly && scene.mediaSrc ? (
          <Audio
            src={scene.mediaSrc}
            volume={volume}
            acceptableTimeShiftInSeconds={PREVIEW_SYNC_TOLERANCE_SECONDS}
            onError={onMediaError}
          />
        ) : (
          audioSrc && scene.background.mode !== 'source' ? (
            <Audio
              src={audioSrc}
              volume={volume}
              acceptableTimeShiftInSeconds={PREVIEW_SYNC_TOLERANCE_SECONDS}
              onError={onMediaError}
            />
          ) : null
        )
      )}

      {scene.captions.map((caption) => {
        const { from, durationInFrames } = captionFrameRange(caption, fps);
        return (
          <Sequence
            key={caption.id}
            from={from}
            durationInFrames={durationInFrames}
            layout="none"
          >
            <CaptionLayer
              caption={caption}
              style={scene.style}
              position={scene.position}
              animation={scene.animation}
              maxLines={scene.maxLines}
              maxWordsPerLine={scene.maxWordsPerLine}
            />
          </Sequence>
        );
      })}

      {safeZone !== 'none' ? <SafeArea platform={safeZone} /> : null}
    </AbsoluteFill>
  );
};
