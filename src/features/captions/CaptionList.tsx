import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { useEditor } from '../../app/store';
import { previewFps, useActiveCaptionId, useActiveWordKey } from '../../app/playbackClock';
import type { Caption, CaptionWord, WordScript } from '../../core/types/project';
import { captionText } from '../../core/segmentation/segmenter';
import { toSrt } from '../../core/subtitles/formats';
import { Button, IconButton } from '../../components/controls';
import { EmptyState } from '../../components/feedback';
import { api } from '../../app/api';
import {
  IconGaps,
  IconMerge,
  IconPunctuation,
  IconReplace,
  IconScissors,
  IconSearch,
  IconStar,
  IconSync,
  IconText,
  IconTrash,
  IconUpload,
  IconAlert,
  IconSparkle,
  IconX,
  IconZap,
  IconCasing,
  IconSubtitles,
} from '../../components/icons';


const EMPTY: Caption[] = [];

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

export interface ContextMenuState {
  x: number;
  y: number;
  captionId: string;
  wordIndex: number;
  word: CaptionWord;
}

const WordContextMenu: React.FC<{
  menu: ContextMenuState;
  onClose: () => void;
  onMarkScript: (captionId: string, wordIndex: number, script: WordScript) => void;
  onAddToLexicon: (word: CaptionWord, captionId: string, wordIndex: number) => void;
  onSplit: (captionId: string, wordIndex: number) => void;
}> = ({ menu, onClose, onMarkScript, onAddToLexicon, onSplit }) => {
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.cm-context-menu')) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', handleDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      className="cm-context-menu"
      style={{
        left: Math.min(window.innerWidth - 190, menu.x),
        top: Math.min(window.innerHeight - 170, menu.y),
      }}
    >
      <div style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
        Word: <strong style={{ color: 'var(--text)' }}>{menu.word.text}</strong>
      </div>
      <button
        type="button"
        className="cm-context-menu__item"
        onClick={() => {
          onMarkScript(menu.captionId, menu.wordIndex, 'en');
          onClose();
        }}
      >
        <span className="cm-legend-dot cm-legend-dot--en" />
        <span>Mark as English</span>
      </button>
      <button
        type="button"
        className="cm-context-menu__item"
        onClick={() => {
          onMarkScript(menu.captionId, menu.wordIndex, 'hi');
          onClose();
        }}
      >
        <span className="cm-legend-dot cm-legend-dot--hi" />
        <span>Mark as Hindi</span>
      </button>
      <button
        type="button"
        className="cm-context-menu__item"
        onClick={() => {
          onAddToLexicon(menu.word, menu.captionId, menu.wordIndex);
          onClose();
        }}
      >
        <span className="cm-legend-dot cm-legend-dot--locked" />
        <span>Add to project lexicon</span>
      </button>
      {menu.wordIndex > 0 ? (
        <>
          <div className="cm-context-menu__divider" />
          <button
            type="button"
            className="cm-context-menu__item"
            onClick={() => {
              onSplit(menu.captionId, menu.wordIndex);
              onClose();
            }}
          >
            <IconScissors size={12} />
            <span>Split segment here</span>
          </button>
        </>
      ) : null}
    </div>
  );
};

/**
 * A start or end time that is applied when the user finishes typing.
 *
 * Applying every keystroke went wrong in two ways: the field re-formatted
 * itself to two decimals mid-word (so "7." became "7.00." and the browser
 * reported an empty value), and an empty value was read as 0 — the caption
 * jumped to the start of the video. Half-typed values also pushed the other
 * end around, since end is kept after start.
 */
const TimeField: React.FC<{
  label: string;
  value: number;
  onCommit: (seconds: number) => void;
}> = ({ label, value, onCommit }) => {
  const [draft, setDraft] = useState<string | null>(null);
  // Escape blurs the field (the global shortcut handler does it too), and
  // that blur must not apply the draft being thrown away
  const cancelled = useRef(false);

  const commit = (raw: string) => {
    setDraft(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const seconds = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(seconds) || seconds < 0) return;
    if (Math.abs(seconds - value) < 0.0005) return;
    onCommit(seconds);
  };

  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        step="0.05"
        min={0}
        className="mono"
        value={draft ?? value.toFixed(2)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
};

// ---------------------------------------------------------------------------
// One caption
// ---------------------------------------------------------------------------

interface RowProps {
  caption: Caption;
  index: number;
  selected: boolean;
  playing: boolean;
  /** index of the word under the playhead, or -1 */
  activeWord: number;
  isFirst: boolean;
  isLast: boolean;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onWordContextMenu: (
    e: React.MouseEvent,
    captionId: string,
    wordIndex: number,
    word: CaptionWord,
  ) => void;
}

const CaptionRow = React.memo<RowProps>(
  ({
    caption,
    index,
    selected,
    playing,
    activeWord,
    isFirst,
    isLast,
    onSelect,
    onSeek,
    onWordContextMenu,
  }) => {
    const setCaptionText = useEditor((s) => s.setCaptionText);
    const setCaptionTiming = useEditor((s) => s.setCaptionTiming);
    const toggleEmphasis = useEditor((s) => s.toggleEmphasis);
    const splitCaption = useEditor((s) => s.splitCaption);
    const mergeWithPrevious = useEditor((s) => s.mergeWithPrevious);
    const mergeWithNext = useEditor((s) => s.mergeWithNext);
    const deleteCaption = useEditor((s) => s.deleteCaption);
    const emphasisEnabled = useEditor((s) => s.project?.style.emphasisEnabled);

    const text = captionText(caption);
    const [draft, setDraft] = useState(text);
    const editing = useRef(false);

    useEffect(() => {
      if (!editing.current) setDraft(text);
    }, [text]);

    const commit = () => {
      editing.current = false;
      const nextText = draft.trim();
      if (nextText !== text) {
        setCaptionText(caption.id, nextText);
        void api.recordCorrection({
          segment_id: caption.id,
          before: text,
          after: nextText,
          category: 'spelling_script',
          editor: 'Rohit',
        }).catch(() => {});
      } else {
        setDraft(text);
      }
    };

    return (
      <article
        data-caption-id={caption.id}
        className={[
          'cm-caption',
          selected ? 'is-selected' : '',
          playing ? 'is-playing' : '',
          caption.edited ? 'is-edited' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onMouseDown={() => onSelect(caption.id)}
      >
        <header className="cm-caption__head">
          <span className="cm-caption__index mono">{index + 1}</span>
          <button
            type="button"
            className="cm-caption__time mono"
            title="Jump to this caption"
            onClick={() => onSeek(caption.start)}
          >
            {formatTime(caption.start)} → {formatTime(caption.end)}
          </button>
          {caption.edited ? <span className="cm-caption__edited" title="Edited by hand" /> : null}
        </header>

        <textarea
          className="cm-caption__text"
          value={draft}
          rows={Math.min(4, Math.ceil(draft.length / 34) || 1)}
          aria-label={`Caption ${index + 1} text`}
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              const cursor = e.currentTarget.selectionStart;
              const textBefore = draft.slice(0, cursor);
              const wordsBefore = textBefore.trim() ? textBefore.trim().split(/\s+/).length : 0;
              if (wordsBefore > 0 && wordsBefore < caption.words.length) {
                commit();
                splitCaption(caption.id, wordsBefore);
              }
              return;
            }
            if (e.key === 'Backspace' && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0) {
              if (!isFirst) {
                e.preventDefault();
                mergeWithPrevious(caption.id);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              editing.current = false;
              setDraft(text);
              e.currentTarget.blur();
            }
          }}
        />

        {selected ? (
          <>

            <div className="cm-caption__timing">
              <TimeField
                label="Start"
                value={caption.start}
                onCommit={(start) => setCaptionTiming(caption.id, start, caption.end)}
              />
              <TimeField
                label="End"
                value={caption.end}
                onCommit={(end) => setCaptionTiming(caption.id, caption.start, end)}
              />
            </div>

            <div className="cm-caption__actions">
              <IconButton
                label="Merge with the caption above"
                disabled={isFirst}
                onClick={() => mergeWithPrevious(caption.id)}
              >
                <span style={{ transform: 'scaleY(-1)', display: 'flex' }}>
                  <IconMerge size={15} />
                </span>
              </IconButton>
              <IconButton
                label="Merge with the caption below"
                disabled={isLast}
                onClick={() => mergeWithNext(caption.id)}
              >
                <IconMerge size={15} />
              </IconButton>
              <span style={{ flex: 1 }} />
              <IconButton label="Delete caption" onClick={() => deleteCaption(caption.id)}>
                <IconTrash size={15} />
              </IconButton>
            </div>
          </>
        ) : null}
      </article>
    );
  },
);

CaptionRow.displayName = 'CaptionRow';

// ---------------------------------------------------------------------------
// 2. Word-Level Card (Kalakar Signature Chip Editor)
// ---------------------------------------------------------------------------

interface WordChipItemProps {
  captionId: string;
  wordIndex: number;
  word: CaptionWord;
  isSpeaking: boolean;
  onSeek: (time: number) => void;
  onToggleEmphasis: (captionId: string, index: number) => void;
  onSplit: (captionId: string, index: number) => void;
  onEditWord: (captionId: string, index: number, text: string) => void;
  onWordContextMenu: (
    e: React.MouseEvent,
    captionId: string,
    wordIndex: number,
    word: CaptionWord,
  ) => void;
}

const WordChipItem: React.FC<WordChipItemProps> = React.memo(
  ({
    captionId,
    wordIndex,
    word,
    isSpeaking,
    onSeek,
    onToggleEmphasis,
    onSplit,
    onEditWord,
    onWordContextMenu,
  }) => {
    const emphasisEnabled = useEditor((s) => s.project?.style.emphasisEnabled);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(word.text);

    const isEmphasized = Boolean(emphasisEnabled && word.emphasis);

    useEffect(() => {
      setDraft(word.text);
    }, [word.text]);

    const commit = () => {
      setEditing(false);
      const next = draft.trim();
      if (next && next !== word.text) {
        onEditWord(captionId, wordIndex, next);
        void api.recordCorrection({
          segment_id: captionId,
          before: word.text,
          after: next,
          category: 'spelling_script',
          editor: 'Rohit',
        }).catch(() => {});
      } else {
        setDraft(word.text);
      }
    };

    return (
      <div
        className={[
          'cm-word-card-chip',
          isEmphasized ? 'is-emphasised' : '',
          isSpeaking ? 'is-speaking' : '',
          editing ? 'is-editing' : '',
          word.locked ? 'is-locked' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onWordContextMenu(e, captionId, wordIndex, word);
        }}
      >
        {editing ? (
          <input
            className="cm-word-card-chip__input"
            value={draft}
            autoFocus
            aria-label="Edit word spelling"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setEditing(false);
                setDraft(word.text);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="cm-word-card-chip__text"
            title="Click: seek · Double-click: edit · Right-click: options"
            onClick={() => onSeek(word.start)}
            onDoubleClick={() => setEditing(true)}
          >
            {word.text}
          </button>
        )}

        <div className="cm-word-card-chip__actions">
          <button
            type="button"
            className={`cm-word-action-btn ${isEmphasized ? 'is-active' : ''}`}
            title={isEmphasized ? 'Remove emphasis' : 'Emphasise this word'}
            onClick={() => {
              if (!emphasisEnabled) {
                useEditor.getState().updateStyle({ emphasisEnabled: true });
              }
              onToggleEmphasis(captionId, wordIndex);
            }}
          >
            <IconStar size={11} filled={isEmphasized} />
          </button>
          {wordIndex > 0 ? (
            <button
              type="button"
              className="cm-word-action-btn cm-word-action-btn--split"
              title="Split line before this word"
              onClick={() => onSplit(captionId, wordIndex)}
            >
              <IconScissors size={10} />
            </button>
          ) : null}
        </div>
      </div>
    );
  },
);

WordChipItem.displayName = 'WordChipItem';

interface WordLevelGroupProps {
  caption: Caption;
  index: number;
  selected: boolean;
  playing: boolean;
  activeWordIndex: number;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onWordContextMenu: (
    e: React.MouseEvent,
    captionId: string,
    wordIndex: number,
    word: CaptionWord,
  ) => void;
}

const WordLevelCard = React.memo<WordLevelGroupProps>(
  ({ caption, index, selected, playing, activeWordIndex, onSelect, onSeek, onWordContextMenu }) => {
    const toggleEmphasis = useEditor((s) => s.toggleEmphasis);
    const splitCaption = useEditor((s) => s.splitCaption);
    const setWordText = useEditor((s) => s.setWordText);

    return (
      <div
        data-caption-id={caption.id}
        className={[
          'cm-word-level-card',
          selected ? 'is-selected' : '',
          playing ? 'is-playing' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => onSelect(caption.id)}
      >
        <div className="cm-word-level-card__header">
          <span className="cm-word-level-card__index mono">#{index + 1}</span>
          <button
            type="button"
            className="cm-word-level-card__time mono"
            onClick={(e) => {
              e.stopPropagation();
              onSeek(caption.start);
            }}
          >
            {formatTime(caption.start)} → {formatTime(caption.end)}
          </button>
          <span className="cm-word-level-card__count">{caption.words.length} words</span>
        </div>

        <div className="cm-word-level-card__grid">
          {caption.words.map((word, wIdx) => (
            <WordChipItem
              key={`${caption.id}-${wIdx}`}
              captionId={caption.id}
              wordIndex={wIdx}
              word={word}
              isSpeaking={activeWordIndex === wIdx}
              onSeek={onSeek}
              onToggleEmphasis={toggleEmphasis}
              onSplit={splitCaption}
              onEditWord={setWordText}
              onWordContextMenu={onWordContextMenu}
            />
          ))}
        </div>
      </div>
    );
  },
);

WordLevelCard.displayName = 'WordLevelCard';

// ---------------------------------------------------------------------------
// 3. Find & Replace Drawer
// ---------------------------------------------------------------------------

const FindReplaceBar: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const replaceAllText = useEditor((s) => s.replaceAllText);
  const [findText, setFindText] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const handleReplaceAll = () => {
    if (!findText.trim()) return;
    const count = replaceAllText(findText, replaceWith, matchCase);
    setResultMsg(`Replaced ${count} occurrence${count === 1 ? '' : 's'}`);
    setTimeout(() => setResultMsg(null), 3500);
  };

  return (
    <div className="cm-find-replace">
      <div className="cm-find-replace__row">
        <input
          className="cm-find-replace__input"
          placeholder="Find word (e.g. bohot)..."
          value={findText}
          aria-label="Find word"
          onChange={(e) => setFindText(e.target.value)}
        />
        <input
          className="cm-find-replace__input"
          placeholder="Replace with (e.g. bahut)..."
          value={replaceWith}
          aria-label="Replace with"
          onChange={(e) => setReplaceWith(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleReplaceAll();
          }}
        />
      </div>
      <div className="cm-find-replace__footer">
        <label className="cm-find-replace__case">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => setMatchCase(e.target.checked)}
          />
          <span>Match case</span>
        </label>
        {resultMsg ? <span className="cm-find-replace__msg">{resultMsg}</span> : null}
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button size="sm" variant="primary" onClick={handleReplaceAll} disabled={!findText.trim()}>
          Replace All
        </Button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 4. Main CaptionList Component
// ---------------------------------------------------------------------------

export const CaptionList: React.FC<{ playerRef: React.RefObject<PlayerRef | null> }> = ({
  playerRef,
}) => {
  const captions = useEditor((s) => s.project?.captions);
  const project = useEditor((s) => s.project);
  // the player's rate, not the source's — see previewFps
  const fps = useEditor((s) => previewFps(s.project));
  const selectedId = useEditor((s) => s.selectedCaptionId);
  const selectCaption = useEditor((s) => s.selectCaption);
  const hasTranscript = useEditor((s) => Boolean(s.project?.transcript));

  const [viewMode, setViewMode] = useState<'line' | 'word'>('line');
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [showSyncBar, setShowSyncBar] = useState(false);
  const [showCasingBar, setShowCasingBar] = useState(false);
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const deferredQuery = useDeferredValue(query);

  const setWordScript = useEditor((s) => s.setWordScript);
  const setWordLocked = useEditor((s) => s.setWordLocked);
  const splitCaption = useEditor((s) => s.splitCaption);
  const shiftAllCaptions = useEditor((s) => s.shiftAllCaptions);
  const syncCaptionToPlayhead = useEditor((s) => s.syncCaptionToPlayhead);
  const togglePunctuation = useEditor((s) => s.togglePunctuation);
  const toggleCaptionGaps = useEditor((s) => s.toggleCaptionGaps);
  const transformCaptionCasing = useEditor((s) => s.transformCaptionCasing);
  const splitAtTime = useEditor((s) => s.splitAtTime);
  const mergeWithPrevious = useEditor((s) => s.mergeWithPrevious);


  const hasPunctuation = useMemo(() => {
    return (captions ?? []).some((c) => c.words.some((w) => /[.?!,;:]+/.test(w.text)));
  }, [captions]);

  const gapsRemoved = useMemo(() => {
    return Boolean(captions?.some((c) => c.gapRestoreEnd !== undefined));
  }, [captions]);



  const handleWordContextMenu = useCallback(
    (e: React.MouseEvent, captionId: string, wordIndex: number, word: CaptionWord) => {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        captionId,
        wordIndex,
        word,
      });
    },
    [],
  );

  const handleMarkScript = useCallback(
    (captionId: string, wordIndex: number, script: WordScript) => {
      setWordScript(captionId, wordIndex, script);
      if (script === 'en') {
        setWordLocked(captionId, wordIndex, true);
      }
    },
    [setWordScript, setWordLocked],
  );

  const handleAddToLexicon = useCallback(
    (word: CaptionWord, captionId: string, wordIndex: number) => {
      setWordLocked(captionId, wordIndex, true);
      void api.approveLexicon(word.text, 'Rohit').catch(() => {});
    },
    [setWordLocked],
  );

  const filtered = useMemo(() => {
    const list = captions ?? [];
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => captionText(c).toLowerCase().includes(q));
  }, [captions, deferredQuery]);

  const playingId = useActiveCaptionId(captions ?? EMPTY);
  const activeWordKey = useActiveWordKey(captions ?? EMPTY);

  const handleSplitAtPlayhead = useCallback(() => {
    const currentSec = (playerRef.current?.getCurrentFrame() ?? 0) / (fps || 30);
    const targetId = selectedId ?? playingId;
    if (targetId) {
      splitAtTime(targetId, currentSec);
    }
  }, [playerRef, fps, selectedId, playingId, splitAtTime]);

  const handleMergeSelected = useCallback(() => {
    if (selectedId) {
      mergeWithPrevious(selectedId);
    }
  }, [selectedId, mergeWithPrevious]);

  const handleExportSrt = useCallback(() => {
    if (!captions || captions.length === 0) return;
    const content = toSrt(captions, { uppercase: project?.style.uppercase });
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.name ? project.name.replace(/\.[^/.]+$/, '') : 'captions'}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [captions, project]);


  const onSeek = useCallback(
    (time: number) => playerRef.current?.seekTo(Math.round(time * fps)),
    [playerRef, fps],
  );

  const onSelect = useCallback(
    (id: string) => {
      selectCaption(id);
      const caption = (captions ?? []).find((c) => c.id === id);
      if (caption) onSeek(caption.start + 0.01);
    },
    [selectCaption, captions, onSeek],
  );

  useEffect(() => {
    if (!follow || !playingId) return;
    const container = scrollRef.current;
    const row = container?.querySelector<HTMLElement>(`[data-caption-id="${playingId}"]`);
    if (!container || !row) return;

    // Measured against the scroll container itself. `offsetTop` is relative to
    // the nearest positioned ancestor — the side panel — so it carried the
    // height of the toolbar and search bar and centred the wrong spot.
    const containerTop = container.getBoundingClientRect().top;
    const rowTop = row.getBoundingClientRect().top - containerTop + container.scrollTop;
    const rowBottom = rowTop + row.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (rowTop < viewTop + 8 || rowBottom > viewBottom - 8) {
      container.scrollTo({
        top: rowTop - container.clientHeight / 2 + row.offsetHeight / 2,
        behavior: 'smooth',
      });
    }
  }, [playingId, follow]);

  const importSubtitles = useEditor((s) => s.importSubtitles);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const srtInputRef = useRef<HTMLInputElement>(null);

  const handleSrtFile = useCallback(
    async (file: File) => {
      setImportError(null);
      setImportNotice(null);
      try {
        const text = await file.text();
        const res = importSubtitles(text);
        setImportNotice(`Imported ${res.count} captions (${res.words} words) from ${file.name}. Select any template to preview!`);
      } catch (e) {
        setImportError((e as Error).message);
      }
    },
    [importSubtitles],
  );

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleSrtFile(file);
    e.target.value = '';
  };

  /**
   * Following stops when the user scrolls the list themselves — judged from
   * the input that scrolls it, not from scroll events. The list's own smooth
   * scroll also fires scroll events, and a long one outlasted the old 600 ms
   * grace period, so following kept switching itself off mid-playback.
   */
  const stopFollowing = useCallback(() => setFollow(false), []);
  const onScrollbarPointerDown = useCallback((event: React.PointerEvent) => {
    // only a press on the container itself (its scrollbar), not on a row
    if (event.target === event.currentTarget) setFollow(false);
  }, []);

  if (!captions || captions.length === 0) {
    return (
      <div
        className={`cm-caption-list-empty ${draggingFile ? 'is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDraggingFile(true);
        }}
        onDragLeave={() => setDraggingFile(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDraggingFile(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleSrtFile(file);
        }}
      >
        <EmptyState
          compact
          title={hasTranscript ? 'No captions yet' : 'No captions yet'}
          description="Transcribe your media or import an existing .srt / .vtt subtitle file to immediately apply templates."
          action={
            <div className="cm-empty-import-actions">
              <Button
                variant="primary"
                size="md"
                onClick={() => srtInputRef.current?.click()}
                icon={<IconUpload size={14} />}
              >
                Import SRT Subtitles
              </Button>
              <input
                ref={srtInputRef}
                type="file"
                accept=".srt,.vtt,text/plain"
                style={{ display: 'none' }}
                onChange={onFileInputChange}
              />
            </div>
          }
        />
        {importError ? (
          <div className="cm-caption-import-banner cm-caption-import-banner--error" style={{ marginTop: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconAlert size={13} />{importError}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setImportError(null)}><IconX size={12} /></button>
          </div>
        ) : null}
      </div>
    );
  }

  const indexOf = (id: string) => (captions ?? []).findIndex((c) => c.id === id);

  return (
    <div
      className={`cm-caption-list ${draggingFile ? 'is-dragging-file' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDraggingFile(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDraggingFile(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDraggingFile(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void handleSrtFile(file);
      }}
    >
      {/* Sleek Mac-style Unified Toolbar */}
      <div className="cm-caption-list__unified-toolbar">
        {/* Row 1: Mode Switcher + Editing Actions (Split, Merge, Punctuation, Gaps) */}
        <div className="cm-caption-list__toolbar-top">
          <div className="cm-level-toggle">
            <button
              type="button"
              className={`cm-level-toggle__btn ${viewMode === 'line' ? 'is-active' : ''}`}
              onClick={() => setViewMode('line')}
            >
              <IconText size={13} />
              <span>Lines</span>
            </button>
            <button
              type="button"
              className={`cm-level-toggle__btn ${viewMode === 'word' ? 'is-active' : ''}`}
              onClick={() => setViewMode('word')}
            >
              <IconStar size={12} />
              <span>Words</span>
            </button>
          </div>

          <div className="cm-caption-toolbar-actions">
            <button
              type="button"
              className="cm-toolbar-icon-btn"
              title="Split caption at current playhead position"
              onClick={handleSplitAtPlayhead}
            >
              <IconScissors size={12} />
              <span className="cm-toolbar-icon-btn__label">Split</span>
            </button>

            <button
              type="button"
              className="cm-toolbar-icon-btn"
              disabled={!selectedId}
              title={selectedId ? 'Merge selected caption with previous' : 'Select a caption to merge'}
              onClick={handleMergeSelected}
            >
              <IconMerge size={12} />
              <span className="cm-toolbar-icon-btn__label">Merge</span>
            </button>

            <button
              type="button"
              className={`cm-toolbar-icon-btn ${hasPunctuation ? 'is-active' : ''}`}
              title={
                hasPunctuation
                  ? 'Remove all punctuation (.?!,;) from captions'
                  : 'Add sentence punctuation (.?!,;) to captions'
              }
              onClick={() => togglePunctuation()}
            >
              <IconPunctuation size={12} />
              <span className="cm-toolbar-icon-btn__label">Punct</span>
            </button>

            <button
              type="button"
              className={`cm-toolbar-icon-btn ${gapsRemoved ? 'is-active' : ''}`}
              title={
                gapsRemoved
                  ? 'Restore natural silence gaps between captions'
                  : 'Remove silence gaps (extend captions to keep on screen)'
              }
              onClick={() => toggleCaptionGaps()}
            >
              <IconGaps size={12} />
              <span className="cm-toolbar-icon-btn__label">Gaps</span>
            </button>

            <button
              type="button"
              className={`cm-toolbar-icon-btn ${showCasingBar ? 'is-active' : ''}`}
              title="Change caption text casing (UPPERCASE, Title Case, lowercase)"
              onClick={() => setShowCasingBar((v) => !v)}
            >
              <IconCasing size={12} />
              <span className="cm-toolbar-icon-btn__label">Case</span>
            </button>
          </div>
        </div>

        {/* Row 2: Search Box + Tools (Sync, Find, SRT, Follow) */}
        <div className="cm-caption-list__search-row">
          <div className="cm-caption-search-box">
            <IconSearch size={13} />
            <input
              value={query}
              placeholder={`Search ${captions.length} captions...`}
              aria-label="Search captions"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button
                type="button"
                className="cm-search-clear-btn"
                onClick={() => setQuery('')}
                title="Clear search"
              >
                <IconX size={12} />
              </button>
            ) : null}
          </div>

          <div className="cm-caption-toolbar-actions">
            <button
              type="button"
              className={`cm-toolbar-icon-btn ${showSyncBar ? 'is-active' : ''}`}
              title="Sync & Nudge Timing"
              onClick={() => setShowSyncBar((v) => !v)}
            >
              <IconSync size={12} />
              <span className="cm-toolbar-icon-btn__label">Sync</span>
            </button>

            <button
              type="button"
              className={`cm-toolbar-icon-btn ${showFindReplace ? 'is-active' : ''}`}
              title="Find & Replace Text"
              onClick={() => setShowFindReplace((v) => !v)}
            >
              <IconReplace size={13} />
              <span className="cm-toolbar-icon-btn__label">Find</span>
            </button>

            <button
              type="button"
              className="cm-toolbar-icon-btn"
              title="Import .srt or .vtt subtitle file"
              onClick={() => srtInputRef.current?.click()}
            >
              <IconUpload size={13} />
              <span className="cm-toolbar-icon-btn__label">SRT</span>
            </button>
            <input
              ref={srtInputRef}
              type="file"
              accept=".srt,.vtt,text/plain"
              style={{ display: 'none' }}
              onChange={onFileInputChange}
            />

            <button
              type="button"
              className="cm-toolbar-icon-btn"
              title="Download .srt subtitle file directly"
              onClick={handleExportSrt}
            >
              <IconSubtitles size={13} />
              <span className="cm-toolbar-icon-btn__label">Export</span>
            </button>

            <button
              type="button"
              className={`cm-toolbar-icon-btn ${follow ? 'is-active' : ''}`}
              title={
                follow
                  ? 'Following playback (Click to unlock)'
                  : 'Follow playback'
              }
              onClick={() => setFollow((v) => !v)}
            >
              <span className={`cm-follow-dot ${follow ? 'is-active' : ''}`} />
              <span className="cm-toolbar-icon-btn__label">Follow</span>
            </button>
          </div>
        </div>
      </div>

      {showSyncBar ? (
        <div
          className="cm-caption-sync-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 12px',
            background: 'var(--panel-bg, #1a1a1a)',
            borderBottom: '1px solid var(--line, #333)',
            fontSize: '12px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--muted)', fontSize: '11px' }}>NUDGE:</span>
          <button
            type="button"
            className="cm-button cm-button--secondary cm-button--sm"
            onClick={() => shiftAllCaptions(-0.5)}
            title="Shift all -0.5s"
          >
            −0.5s
          </button>
          <button
            type="button"
            className="cm-button cm-button--secondary cm-button--sm"
            onClick={() => shiftAllCaptions(-0.1)}
            title="Shift all -0.1s"
          >
            −0.1s
          </button>
          <button
            type="button"
            className="cm-button cm-button--primary cm-button--sm"
            onClick={() => {
              const target = selectedId ?? playingId ?? captions?.[0]?.id;
              if (target) {
                const currentSec = (playerRef.current?.getCurrentFrame() ?? 0) / (fps || 30);
                syncCaptionToPlayhead(target, currentSec);
              }
            }}
            title="Snap selected caption start to current video playback position and shift all captions in sync"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <IconZap size={12} />
            Sync to Playhead
          </button>
          <button
            type="button"
            className="cm-button cm-button--secondary cm-button--sm"
            onClick={() => shiftAllCaptions(0.1)}
            title="Shift all +0.1s"
          >
            +0.1s
          </button>
          <button
            type="button"
            className="cm-button cm-button--secondary cm-button--sm"
            onClick={() => shiftAllCaptions(0.5)}
            title="Shift all +0.5s"
          >
            +0.5s
          </button>
          <button
            type="button"
            className="cm-button cm-button--ghost cm-button--sm"
            onClick={() => setShowSyncBar(false)}
            style={{ marginLeft: 'auto' }}
            title="Close sync bar"
          >
            <IconX size={13} />
          </button>
        </div>
      ) : null}

      {showCasingBar ? (
        <div
          className="cm-caption-sync-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 12px',
            background: 'var(--panel-bg, #1a1a1a)',
            borderBottom: '1px solid var(--line, #333)',
            fontSize: '12px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--muted)', fontSize: '11px' }}>CASING:</span>
          <button
            type="button"
            className="cm-button cm-button--secondary cm-button--sm"
            onClick={() => transformCaptionCasing('upper')}
            title="Convert all captions to UPPERCASE"
          >
            UPPERCASE
          </button>
          <button
            type="button"
            className="cm-button cm-button--secondary cm-button--sm"
            onClick={() => transformCaptionCasing('title')}
            title="Convert all captions to Title Case"
          >
            Title Case
          </button>
          <button
            type="button"
            className="cm-button cm-button--secondary cm-button--sm"
            onClick={() => transformCaptionCasing('sentence')}
            title="Convert all captions to Sentence case"
          >
            Sentence case
          </button>
          <button
            type="button"
            className="cm-button cm-button--secondary cm-button--sm"
            onClick={() => transformCaptionCasing('lower')}
            title="Convert all captions to lowercase"
          >
            lowercase
          </button>
          <button
            type="button"
            className="cm-button cm-button--ghost cm-button--sm"
            onClick={() => setShowCasingBar(false)}
            style={{ marginLeft: 'auto' }}
            title="Close casing bar"
          >
            <IconX size={12} />
          </button>
        </div>
      ) : null}

      {showFindReplace ? <FindReplaceBar onClose={() => setShowFindReplace(false)} /> : null}

      {importNotice ? (
        <div className="cm-caption-import-banner cm-caption-import-banner--success">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconSparkle size={13} />{importNotice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setImportNotice(null)}><IconX size={12} /></button>
        </div>
      ) : null}

      {importError ? (
        <div className="cm-caption-import-banner cm-caption-import-banner--error">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconAlert size={13} />{importError}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setImportError(null)}><IconX size={12} /></button>
        </div>
      ) : null}


      <div
        className="cm-caption-list__scroll"
        ref={scrollRef}
        onWheel={stopFollowing}
        onTouchMove={stopFollowing}
        onPointerDown={onScrollbarPointerDown}
      >
        {filtered.length === 0 ? (
          <EmptyState compact title="No matches" description={`Nothing contains “${query}”.`} />
        ) : viewMode === 'line' ? (
          filtered.map((caption) => {
            const index = indexOf(caption.id);
            return (
              <CaptionRow
                key={caption.id}
                caption={caption}
                index={index}
                selected={selectedId === caption.id}
                playing={playingId === caption.id}
                activeWord={
                  activeWordKey && activeWordKey.startsWith(`${caption.id}:`)
                    ? Number(activeWordKey.split(':')[1])
                    : -1
                }
                isFirst={index === 0}
                isLast={index === captions.length - 1}
                onSelect={onSelect}
                onSeek={onSeek}
                onWordContextMenu={handleWordContextMenu}
              />
            );
          })
        ) : (
          filtered.map((caption) => {
            const index = indexOf(caption.id);
            return (
              <WordLevelCard
                key={caption.id}
                caption={caption}
                index={index}
                selected={selectedId === caption.id}
                playing={playingId === caption.id}
                activeWordIndex={
                  activeWordKey && activeWordKey.startsWith(`${caption.id}:`)
                    ? Number(activeWordKey.split(':')[1])
                    : -1
                }
                onSelect={onSelect}
                onSeek={onSeek}
                onWordContextMenu={handleWordContextMenu}
              />
            );
          })
        )}
      </div>

      {contextMenu ? (
        <WordContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onMarkScript={handleMarkScript}
          onAddToLexicon={handleAddToLexicon}
          onSplit={splitCaption}
        />
      ) : null}
    </div>
  );
};
