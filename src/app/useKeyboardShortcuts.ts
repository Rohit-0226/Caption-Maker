import { useEffect } from 'react';
import type { PlayerRef } from '@remotion/player';
import { useEditor } from './store';
import { playbackClock, previewFps } from './playbackClock';

/** True when the user is typing, so shortcuts must stay out of the way. */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'textbox'
  );
};

export interface ShortcutOptions {
  playerRef: React.RefObject<PlayerRef | null>;
  onExport?: () => void;
  onToggleLeft?: () => void;
  onToggleRight?: () => void;
}

export const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'Space', description: 'Play or pause' },
  { keys: '← / →', description: 'Step one frame (hold Shift for one second)' },
  { keys: 'S', description: 'Split the selected caption at the playhead' },
  { keys: 'M', description: 'Merge the selected caption with the previous one' },
  { keys: '↑ / ↓', description: 'Select the previous or next caption' },
  { keys: 'Ctrl+Z', description: 'Undo' },
  { keys: 'Ctrl+Shift+Z', description: 'Redo' },
  { keys: 'Ctrl+S', description: 'Save now' },
  { keys: 'Ctrl+E', description: 'Open export' },
  { keys: 'Ctrl+B', description: 'Toggle left drawer (Cinema view)' },
  { keys: 'Ctrl+I', description: 'Toggle right inspector' },
];

export const useKeyboardShortcuts = ({
  playerRef,
  onExport,
  onToggleLeft,
  onToggleRight,
}: ShortcutOptions) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape always works: it takes focus out of whatever is being typed in
      if (event.key === 'Escape' && isTyping(event.target)) {
        (event.target as HTMLElement).blur();
        return;
      }
      if (isTyping(event.target)) return;

      const store = useEditor.getState();
      const project = store.project;
      const player = playerRef.current;
      const modifier = event.ctrlKey || event.metaKey;

      if (modifier && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        onToggleLeft?.();
        return;
      }

      if (modifier && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        onToggleRight?.();
        return;
      }

      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }

      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        store.redo();
        return;
      }

      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void store.save();
        return;
      }

      if (modifier && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        onExport?.();
        return;
      }

      if (modifier) return;

      // the player's rate, not the source's — see previewFps
      const fps = previewFps(project);

      switch (event.key) {
        case ' ': {
          event.preventDefault();
          if (!player) return;
          if (player.isPlaying()) player.pause();
          else void player.play();
          return;
        }

        case 'ArrowLeft':
        case 'ArrowRight': {
          if (!player) return;
          event.preventDefault();
          const step = event.shiftKey ? fps : 1;
          const delta = event.key === 'ArrowRight' ? step : -step;
          player.seekTo(Math.max(0, player.getCurrentFrame() + delta));
          return;
        }

        case 'ArrowUp':
        case 'ArrowDown': {
          if (!project || project.captions.length === 0) return;
          event.preventDefault();
          const index = project.captions.findIndex((c) => c.id === store.selectedCaptionId);
          const next =
            event.key === 'ArrowDown'
              ? Math.min(project.captions.length - 1, index + 1)
              : Math.max(0, index - 1);
          const caption = project.captions[next];
          if (caption) {
            store.selectCaption(caption.id);
            player?.seekTo(Math.round(caption.start * fps));
          }
          return;
        }

        case 's':
        case 'S': {
          if (!store.selectedCaptionId) return;
          event.preventDefault();
          store.splitAtTime(store.selectedCaptionId, playbackClock.getTime());
          return;
        }

        case 'm':
        case 'M': {
          if (!store.selectedCaptionId) return;
          event.preventDefault();
          store.mergeWithPrevious(store.selectedCaptionId);
          return;
        }

        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playerRef, onExport]);
};
