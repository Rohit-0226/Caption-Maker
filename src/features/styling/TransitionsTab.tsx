import React, { useCallback, useMemo, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { useEditor } from '../../app/store';
import { previewFps } from '../../app/playbackClock';
import type { EnterAnimationId, ExitAnimationId } from '../../core/types/project';
import { Select, SliderField } from '../../components/controls';
import {
  ANIMATION_SPEED_PRESETS,
  EXIT_ANIMATION_OPTIONS,
  getEnterAnimation,
} from '../../core/rendering/animations';

interface TransitionItem {
  id: EnterAnimationId;
  label: string;
  category: 'basic' | 'pop' | 'word' | 'reveal' | 'dynamic';
  scope: 'line' | 'word' | 'both';
  description: string;
  icon: React.ReactNode;
}

export const ALL_TRANSITIONS: TransitionItem[] = [
  // --- Basic (7) ---
  {
    id: 'none',
    label: 'None',
    category: 'basic',
    scope: 'both',
    description: 'Captions cut straight in with no animation.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--none" viewBox="0 0 48 48" fill="none" stroke="currentColor">
        <circle cx="24" cy="24" r="16" strokeWidth="2.5" />
        <line x1="12" y1="12" x2="36" y2="36" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'fade',
    label: 'Fade',
    category: 'basic',
    scope: 'line',
    description: 'Gentle opacity fade up. Quiet and unobtrusive.',
    icon: (
      <div className="cm-trans-fade-box">
        <div className="cm-trans-fade-inner" />
      </div>
    ),
  },
  {
    id: 'scale',
    label: 'Scale',
    category: 'basic',
    scope: 'line',
    description: 'Grows smoothly into place with no bounce.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--scale" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <circle cx="12" cy="24" r="2.5" fill="#10b981" />
        <circle cx="20" cy="24" r="2.5" fill="#10b981" />
        <circle cx="28" cy="24" r="2.5" fill="#10b981" />
        <path d="M34 24h7m-3-4l4 4-4 4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'slideUp',
    label: 'Slide Up',
    category: 'basic',
    scope: 'line',
    description: 'Rises into place vertically from below.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--slideup" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <path d="M14 26l10-10 10 10" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 34l10-10 10 10" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'slideDown',
    label: 'Slide Down',
    category: 'basic',
    scope: 'line',
    description: 'Drops in from above.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--slidedown" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <path d="M14 14l10 10 10-10" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 22l10 10 10-10" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'slideLeft',
    label: 'Slide Left',
    category: 'basic',
    scope: 'line',
    description: 'Enters horizontally from the right edge.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--slideleft" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <path d="M26 14l-10 10 10 10" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M34 14l-10 10 10 10" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'slideRight',
    label: 'Slide Right',
    category: 'basic',
    scope: 'line',
    description: 'Enters horizontally from the left edge.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--slideright" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <path d="M22 14l10 10-10 10" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 14l10 10-10 10" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },

  // --- Pop (6) ---
  {
    id: 'softPop',
    label: 'Soft Pop',
    category: 'pop',
    scope: 'line',
    description: 'A gentle spring up from small. The safe default.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--softpop" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="16" stroke="#10b981" strokeWidth="2" opacity="0.3" strokeDasharray="3 3" />
        <circle cx="24" cy="24" r="9" fill="#10b981" fillOpacity="0.8" />
      </svg>
    ),
  },
  {
    id: 'hardPop',
    label: 'Hard Pop',
    category: 'pop',
    scope: 'line',
    description: 'Snaps in aggressively from much smaller.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--hardpop" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="6" fill="#10b981" />
        <path d="M24 10v4M24 34v4M10 24h4M34 24h4M14 14l3 3M31 31l3 3M34 14l-3 3M17 31l-3 3" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'springPop',
    label: 'Spring Pop',
    category: 'pop',
    scope: 'line',
    description: 'Overshoots and settles with bounciness.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--springpop" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="15" stroke="#10b981" strokeWidth="2" opacity="0.35" />
        <circle cx="24" cy="24" r="10" stroke="#10b981" strokeWidth="2.5" />
        <circle cx="24" cy="24" r="4" fill="#10b981" />
      </svg>
    ),
  },
  {
    id: 'bounce',
    label: 'Bounce',
    category: 'pop',
    scope: 'line',
    description: 'Drops in from top and bounces on landing.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--bounce" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <path d="M8 26c4-14 8-14 12 0s8 14 12 0s6-7 8 0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="20" cy="24" r="3.5" fill="#10b981" />
      </svg>
    ),
  },
  {
    id: 'elastic',
    label: 'Elastic',
    category: 'pop',
    scope: 'line',
    description: 'Overshooting scale with a rotation kick.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--elastic" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <circle cx="24" cy="24" r="14" strokeWidth="2" strokeDasharray="3 3" />
        <path d="M16 24c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'punch',
    label: 'Punch',
    category: 'pop',
    scope: 'line',
    description: 'Starts oversized and slams down to size.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--punch" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <circle cx="24" cy="24" r="11" strokeWidth="2.5" />
        <path d="M24 6v5M24 37v5M6 24h5M37 24h5" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="24" cy="24" r="4" fill="#10b981" />
      </svg>
    ),
  },

  // --- Word (7) ---
  {
    id: 'wordPop',
    label: 'Word Pop',
    category: 'word',
    scope: 'word',
    description: 'Each word pops in dynamically as it is spoken.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--wordpop" viewBox="0 0 48 48" fill="none">
        <rect x="8" y="24" width="8" height="6" rx="3" fill="#10b981" opacity="0.4" />
        <rect x="20" y="16" width="10" height="8" rx="4" fill="#10b981" />
        <rect x="34" y="24" width="8" height="6" rx="3" fill="#10b981" opacity="0.4" />
      </svg>
    ),
  },
  {
    id: 'wordScale',
    label: 'Word Scale',
    category: 'word',
    scope: 'word',
    description: 'The line is visible; the spoken word swells.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--wordscale" viewBox="0 0 48 48" fill="none">
        <rect x="8" y="22" width="7" height="6" rx="3" fill="#10b981" opacity="0.4" />
        <rect x="18" y="17" width="14" height="14" rx="4" fill="#10b981" />
        <rect x="35" y="22" width="7" height="6" rx="3" fill="#10b981" opacity="0.4" />
      </svg>
    ),
  },
  {
    id: 'wordBounce',
    label: 'Word Bounce',
    category: 'word',
    scope: 'word',
    description: 'Each word bounces up and lands as spoken.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--wordbounce" viewBox="0 0 48 48" fill="none">
        <path d="M10 32c7 0 10-6 14-6s7 6 14 6" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="19" y="14" width="10" height="8" rx="4" fill="#10b981" />
      </svg>
    ),
  },
  {
    id: 'wordRise',
    label: 'Word Rise',
    category: 'word',
    scope: 'word',
    description: 'Words lift gracefully into place one by one.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--wordrise" viewBox="0 0 48 48" fill="none">
        <rect x="10" y="28" width="7" height="8" rx="2" fill="#10b981" opacity="0.4" />
        <rect x="21" y="20" width="7" height="16" rx="2" fill="#10b981" opacity="0.75" />
        <rect x="32" y="12" width="7" height="24" rx="2" fill="#10b981" />
      </svg>
    ),
  },
  {
    id: 'wordFade',
    label: 'Word Fade',
    category: 'word',
    scope: 'word',
    description: 'Words fade on in perfect sync with the speech.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--wordfade" viewBox="0 0 48 48" fill="none">
        <rect x="8" y="21" width="8" height="8" rx="3" fill="#10b981" opacity="0.25" />
        <rect x="20" y="21" width="8" height="8" rx="3" fill="#10b981" opacity="0.6" />
        <rect x="32" y="21" width="8" height="8" rx="3" fill="#10b981" opacity="1.0" />
      </svg>
    ),
  },
  {
    id: 'wordHighlight',
    label: 'Karaoke',
    category: 'word',
    scope: 'word',
    description: 'Active word lights up with high contrast karaoke color.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--karaoke" viewBox="0 0 48 48" fill="none">
        <rect x="8" y="16" width="32" height="16" rx="6" fill="#10b981" fillOpacity="0.25" stroke="#10b981" strokeWidth="2" />
        <rect x="13" y="22" width="12" height="4" rx="2" fill="#10b981" />
      </svg>
    ),
  },
  {
    id: 'activeWordPunch',
    label: 'Word Box',
    category: 'word',
    scope: 'word',
    description: 'A vibrant colored block snaps behind the spoken word.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--wordbox" viewBox="0 0 48 48" fill="none">
        <rect x="10" y="14" width="28" height="20" rx="5" fill="#10b981" fillOpacity="0.3" stroke="#10b981" strokeWidth="2.5" />
        <circle cx="24" cy="24" r="3.5" fill="#10b981" />
      </svg>
    ),
  },

  // --- Reveal (5) ---
  {
    id: 'typewriter',
    label: 'Typewriter',
    category: 'reveal',
    scope: 'word',
    description: 'Characters type out progressively across the caption.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--typewriter" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <path d="M11 16l8 8-8 8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="22" y1="32" x2="37" y2="32" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'wipe',
    label: 'Wipe',
    category: 'reveal',
    scope: 'word',
    description: 'A wipe sweeps across each word to reveal it.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--wipe" viewBox="0 0 48 48" fill="none">
        <path d="M12 36L26 12h10L22 36H12z" fill="#10b981" fillOpacity="0.25" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />
        <line x1="8" y1="24" x2="40" y2="24" stroke="#10b981" strokeWidth="2" strokeDasharray="3 3" />
      </svg>
    ),
  },
  {
    id: 'maskReveal',
    label: 'Mask Reveal',
    category: 'reveal',
    scope: 'both',
    description: 'The entire line uncovers smoothly left to right.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--maskreveal" viewBox="0 0 48 48" fill="none">
        <rect x="10" y="16" width="28" height="16" rx="3" stroke="#10b981" strokeWidth="2" fill="none" />
        <line x1="24" y1="16" x2="24" y2="32" stroke="#10b981" strokeWidth="2.5" strokeDasharray="2 2" />
      </svg>
    ),
  },
  {
    id: 'blurReveal',
    label: 'Blur Reveal',
    category: 'reveal',
    scope: 'word',
    description: 'Words resolve out of a soft blur as spoken.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--blur" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="15" fill="#10b981" fillOpacity="0.18" />
        <circle cx="24" cy="24" r="10" stroke="#10b981" strokeWidth="2" strokeDasharray="3 2" />
        <circle cx="24" cy="24" r="4.5" fill="#10b981" />
      </svg>
    ),
  },
  {
    id: 'riseReveal',
    label: 'Rise Reveal',
    category: 'reveal',
    scope: 'line',
    description: 'The line rises out of a subtle blur together.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--risereveal" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <path d="M16 28l8-8 8 8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 20l8-8 8 8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      </svg>
    ),
  },

  // --- Dynamic (8) ---
  {
    id: 'stagger',
    label: 'Stagger',
    category: 'dynamic',
    scope: 'word',
    description: 'Words arrive in quick sequential cascade.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--stagger" viewBox="0 0 48 48" fill="none">
        <rect x="10" y="14" width="28" height="5" rx="2.5" fill="#10b981" fillOpacity="0.4" />
        <rect x="10" y="22" width="20" height="5" rx="2.5" fill="#10b981" fillOpacity="0.75" />
        <rect x="10" y="30" width="13" height="5" rx="2.5" fill="#10b981" />
      </svg>
    ),
  },
  {
    id: 'wave',
    label: 'Wave',
    category: 'dynamic',
    scope: 'word',
    description: 'A fluid harmonic wave travels across words.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--wave" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <path d="M8 24c4-10 6-10 10 0s6 10 10 0s6-10 12 0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'pulse',
    label: 'Pulse',
    category: 'dynamic',
    scope: 'line',
    description: 'The line breathes with a rhythmic heartbeat pulse.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--pulse" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <path d="M8 24h7l4-10 6 20 4-10h11" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'drop',
    label: 'Drop',
    category: 'dynamic',
    scope: 'line',
    description: 'Falls in hard from above and settles on baseline.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--drop" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <path d="M24 10v22m-8-8l8 8 8-8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="12" y1="38" x2="36" y2="38" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'zoom',
    label: 'Zoom',
    category: 'dynamic',
    scope: 'line',
    description: 'Rushes in dynamically from deep in frame.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--zoom" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <circle cx="21" cy="21" r="11" strokeWidth="2.5" />
        <line x1="29" y1="29" x2="39" y2="39" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="21" y1="16" x2="21" y2="26" strokeWidth="2" strokeLinecap="round" />
        <line x1="16" y1="21" x2="26" y2="21" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'wordFollower',
    label: 'Follower',
    category: 'dynamic',
    scope: 'word',
    description: 'Upward slide transition with active word tracking.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--follower" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <path d="M10 24h26M26 16l8 8-8 8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="14" cy="24" r="3" fill="#10b981" />
      </svg>
    ),
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    category: 'dynamic',
    scope: 'word',
    description: 'Dims inactive words while spotlighting spoken word.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--spotlight" viewBox="0 0 48 48" fill="none">
        <path d="M18 10h12l10 26H8l10-26z" fill="#10b981" fillOpacity="0.25" stroke="#10b981" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="24" cy="30" r="4" fill="#10b981" />
      </svg>
    ),
  },
  {
    id: 'flashPunch',
    label: 'Flash Punch',
    category: 'dynamic',
    scope: 'word',
    description: 'High-energy burst and scale snap for viral shorts.',
    icon: (
      <svg className="cm-trans-icon cm-trans-icon--flash" viewBox="0 0 48 48" fill="none" stroke="#10b981">
        <polygon points="26 6 12 24 24 24 22 42 36 24 24 24" strokeWidth="2.5" strokeLinejoin="round" fill="#10b981" fillOpacity="0.25" />
      </svg>
    ),
  },
];

export const TransitionsTab: React.FC<{
  playerRef?: React.RefObject<PlayerRef | null>;
}> = ({ playerRef }) => {
  const animation = useEditor((s) => s.project?.animation);
  const updateAnimation = useEditor((s) => s.updateAnimation);

  const [scope, setScope] = useState<'line' | 'word' | 'all'>('line');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleReplay = useCallback(() => {
    const player = playerRef?.current;
    if (!player) return;
    const project = useEditor.getState().project;
    const selectedId = useEditor.getState().selectedCaptionId;
    const targetCaption =
      project?.captions.find((c) => c.id === selectedId) ?? project?.captions[0];
    if (targetCaption) {
      // the player's rate, not a fixed 30 — see previewFps
      player.seekTo(Math.max(0, Math.round((targetCaption.start - 0.05) * previewFps(project))));
      player.play();
    }
  }, [playerRef]);

  // above the early return: React needs the same hooks on every render
  const visibleTransitions = useMemo(() => {
    if (scope === 'all') return ALL_TRANSITIONS;
    if (scope === 'line') return ALL_TRANSITIONS.filter((t) => t.scope === 'line' || t.scope === 'both');
    return ALL_TRANSITIONS.filter((t) => t.scope === 'word' || t.scope === 'both');
  }, [scope]);

  if (!animation) return null;

  const currentEnter = animation.enter;
  const activePreset = getEnterAnimation(currentEnter);

  const handleSelect = (id: EnterAnimationId) => {
    updateAnimation({ enter: id });
    handleReplay();
  };

  const handleSpeedPreset = (duration: number) => {
    updateAnimation({ enterDuration: duration });
    handleReplay();
  };

  return (
    <div className="cm-transitions-tab">
      {/* 1. Motion Speed & Dynamics Hub */}
      <div className="cm-motion-hub-card">
        <div className="cm-motion-hub__header">
          <div className="cm-motion-hub__active-badge">
            <div className="cm-motion-hub__icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="cm-motion-hub__details">
              <div className="cm-motion-hub__title-row">
                <span className="cm-motion-hub__name">{activePreset.label}</span>
                <span className="cm-pill-badge cm-pill-badge--new">{animation.enterDuration}s</span>
              </div>
              <span className="cm-motion-hub__desc">
                {animation.bounciness > 60 ? 'Elastic Bounce' : animation.bounciness > 20 ? 'Natural Spring' : 'Smooth Decel'} • {animation.travel}px travel
              </span>
            </div>
          </div>
          {playerRef ? (
            <button
              type="button"
              className="cm-motion-hub__replay-btn"
              title="Replay animation in video preview"
              onClick={handleReplay}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              <span>Replay</span>
            </button>
          ) : null}
        </div>

        {/* Speed Presets Row */}
        <div className="cm-motion-speed-section">
          <div className="cm-motion-speed__header">
            <span className="cm-control-label">Animation Speed Preset</span>
            <span className="cm-motion-speed__active-val">{animation.enterDuration}s</span>
          </div>
          <div className="cm-speed-presets-row" role="group" aria-label="Animation speed presets">
            {ANIMATION_SPEED_PRESETS.map((p) => {
              const isSelected = Math.abs(animation.enterDuration - p.duration) < 0.03;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`cm-speed-preset-btn ${isSelected ? 'is-active' : ''}`}
                  title={`${p.label} (${p.duration}s): ${p.hint}`}
                  onClick={() => handleSpeedPreset(p.duration)}
                >
                  <span className="cm-speed-preset-btn__icon">{p.icon}</span>
                  <span className="cm-speed-preset-btn__name">{p.label}</span>
                  <span className="cm-speed-preset-btn__sec">{p.duration}s</span>
                </button>
              );
            })}
          </div>

          <div className="cm-motion-slider-row">
            <SliderField
              label="Enter Duration"
              hint="Continuous fine speed adjustment"
              value={animation.enterDuration}
              min={0.05}
              max={1.0}
              step={0.01}
              precision={2}
              suffix="s"
              onChange={(enterDuration) => updateAnimation({ enterDuration })}
            />
          </div>
        </div>

        {/* Expandable Advanced Controls */}
        <div className="cm-motion-advanced-toggle">
          <button
            type="button"
            className="cm-motion-advanced-btn"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              style={{
                transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span>{showAdvanced ? 'Hide Physics & Exit Settings' : 'Fine-Tune Bounciness, Travel & Exit'}</span>
          </button>
        </div>

        {showAdvanced && (
          <div className="cm-motion-advanced-drawer">
            <SliderField
              label="Spring Bounciness"
              hint="0% = Flat/Smooth, 45% = Natural Pop, 80%+ = Viral Elastic"
              value={animation.bounciness}
              min={0}
              max={100}
              step={1}
              precision={0}
              suffix="%"
              onChange={(bounciness) => updateAnimation({ bounciness })}
            />
            <SliderField
              label="Travel Distance"
              hint="Movement distance for slides, rises, and drops"
              value={animation.travel}
              min={0}
              max={200}
              step={2}
              precision={0}
              suffix="px"
              onChange={(travel) => updateAnimation({ travel })}
            />
            <div className="cm-motion-exit-group">
              <label className="cm-control-label" style={{ display: 'block', marginBottom: 6 }}>
                Exit Transition
              </label>
              <Select<ExitAnimationId>
                value={animation.exit}
                ariaLabel="Exit animation"
                options={EXIT_ANIMATION_OPTIONS.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
                onChange={(exit) => updateAnimation({ exit })}
              />
              {animation.exit !== 'cut' && (
                <SliderField
                  label="Exit Duration"
                  hint="How long the caption takes to leave"
                  value={animation.exitDuration}
                  min={0.05}
                  max={0.6}
                  step={0.01}
                  precision={2}
                  suffix="s"
                  onChange={(exitDuration) => updateAnimation({ exitDuration })}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. Scope Filter: Line | Word | All */}
      <div className="cm-transitions-scope">
        <button
          type="button"
          className={`cm-scope-btn ${scope === 'line' ? 'is-active' : ''}`}
          onClick={() => setScope('line')}
        >
          Line
        </button>
        <button
          type="button"
          className={`cm-scope-btn ${scope === 'word' ? 'is-active' : ''}`}
          onClick={() => setScope('word')}
        >
          Word
        </button>
        <button
          type="button"
          className={`cm-scope-btn ${scope === 'all' ? 'is-active' : ''}`}
          onClick={() => setScope('all')}
        >
          All (33)
        </button>
      </div>

      <p className="cm-transitions-subheading">
        {scope === 'all' ? (
          <>Showing all <span className="cm-highlight-green">33 transitions</span></>
        ) : (
          <>
            Transitions will be <span className="cm-highlight-green">Applied</span> on{' '}
            {scope === 'line' ? 'Line' : 'Word'}
          </>
        )}
      </p>

      {/* 3. Responsive Grid of 33 Transitions */}
      <div className="cm-transitions-grid">
        {visibleTransitions.map((t) => {
          const isActive = currentEnter === t.id;

          return (
            <button
              key={t.id}
              type="button"
              className={`cm-transition-card ${isActive ? 'is-active' : ''}`}
              onClick={() => handleSelect(t.id)}
              title={`${t.label} — ${t.description}`}
            >
              <div className="cm-transition-card__icon-box">
                {t.icon}
              </div>
              <span className="cm-transition-card__label">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
