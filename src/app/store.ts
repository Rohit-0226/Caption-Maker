import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { api } from './api';
import type {
  AnimationSettings,
  BackgroundSettings,
  Caption,
  CaptionProject,
  CaptionPosition,
  CaptionStyle,
  SegmentationSettings,
  Transcript,
  TranscriptWord,
  WordScript,
} from '../core/types/project';
import { defaultSegmenter } from '../core/segmentation/segmenter';
import { enrichWord } from '../core/transcription/scriptClassifier';
import { transformCaptionWords, type TextCasing } from '../core/text/casing';
import { cuesToCaptions, parseSubtitles } from '../core/subtitles/formats';
import { removeCaptionGaps, restoreCaptionGaps, shiftCaptions } from '../core/subtitles/timing';
import { toggleCaptionPunctuation } from '../core/text/punctuation';
import type { SafeZonePlatform } from '../core/rendering/safeZones';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const HISTORY_LIMIT = 60;
const AUTOSAVE_DELAY = 700;

/** Only these slices go through undo; UI state and playback do not. */
type Snapshot = Pick<
  CaptionProject,
  'captions' | 'style' | 'position' | 'animation' | 'background' | 'segmentation'
>;

const snapshot = (project: CaptionProject): Snapshot => ({
  captions: project.captions,
  style: project.style,
  position: project.position,
  animation: project.animation,
  background: project.background,
  segmentation: project.segmentation,
});

const EDITOR_NAME_KEY = 'caption-maker:editor-name';

/** The name this browser's person picked, so corrections can be credited to them. */
const readEditorName = (): string => {
  try {
    return (typeof window !== 'undefined' && localStorage.getItem(EDITOR_NAME_KEY)?.trim()) || '';
  } catch {
    return '';
  }
};

interface EditorState {
  project: CaptionProject | null;
  saveStatus: SaveStatus;
  saveError: string | null;

  /**
   * Who is editing on this machine. Local to the browser (each LAN user picks
   * their own) and empty until they choose one. Used to tag vocabulary
   * corrections and, later, the "X is editing" project lock.
   */
  editorName: string;
  setEditorName(name: string): void;
  /** Saves anything pending, then leaves the editor with no project open. */
  closeProject(): Promise<void>;

  selectedCaptionId: string | null;
  duration: number;
  lastAppliedPresetId: string | null;
  safeZone: SafeZonePlatform;
  setSafeZone(zone: SafeZonePlatform): void;

  past: Snapshot[];
  future: Snapshot[];

  // --- lifecycle
  setProject(project: CaptionProject): void;
  loadProject(id: string): Promise<void>;
  save(): Promise<void>;

  // --- editing
  update(patch: Partial<CaptionProject>, options?: { history?: boolean }): void;
  /** Snapshot now, so a continuous gesture undoes as one step. */
  beginTransaction(): void;
  updateStyle(patch: Partial<CaptionStyle>): void;
  updatePosition(patch: Partial<CaptionPosition>): void;
  updateAnimation(patch: Partial<AnimationSettings>): void;
  updateBackground(patch: Partial<BackgroundSettings>): void;
  updateSegmentation(patch: Partial<SegmentationSettings>): void;
  setLastAppliedPresetId(id: string | null): void;

  // --- captions
  setCaptionText(id: string, text: string): void;
  setWordText(id: string, wordIndex: number, text: string): void;
  setWordScript(id: string, wordIndex: number, script: WordScript): void;
  setWordLocked(id: string, wordIndex: number, locked: boolean): void;
  replaceAllText(search: string, replaceWith: string, matchCase?: boolean): number;
  transformCaptionCasing(casing: TextCasing, captionIds?: string[]): void;
  togglePunctuation(enabled?: boolean): void;
  addPunctuation(): void;
  removePunctuation(): void;
  toggleCaptionGaps(remove?: boolean): void;
  setCaptionTiming(id: string, start: number, end: number): void;
  toggleEmphasis(id: string, wordIndex: number): void;
  clearAllEmphasis(): void;
  splitCaption(id: string, wordIndex: number): void;
  splitAtTime(id: string, time: number): void;
  mergeWithPrevious(id: string): void;
  mergeWithNext(id: string): void;
  deleteCaption(id: string): void;
  regenerateCaptions(settings?: Partial<SegmentationSettings>): void;
  resetCaptionEdits(): void;
  importSubtitles(rawText: string): { count: number; words: number };
  shiftAllCaptions(seconds: number): void;
  syncCaptionToPlayhead(captionId: string, playheadTime: number): void;

  // --- history
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // --- playback / selection
  selectCaption(id: string | null): void;
  setDuration(duration: number): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Guards against an older save landing after a newer one. */
let saveSequence = 0;

export const useEditor = create<EditorState>((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    set({ saveStatus: 'saving' });
    saveTimer = setTimeout(() => void get().save(), AUTOSAVE_DELAY);
  };

  /**
   * Applies a change to the project. `history: false` skips the undo stack —
   * used for continuous input like dragging a slider, where every intermediate
   * value would otherwise flood the history.
   */
  const apply = (
    mutate: (project: CaptionProject) => CaptionProject,
    options: { history?: boolean } = {},
  ) => {
    const state = get();
    const current = state.project;
    if (!current) return;

    const next = mutate(current);
    if (next === current) return;

    const withHistory = options.history !== false;

    set({
      project: next,
      past: withHistory
        ? [...state.past, snapshot(current)].slice(-HISTORY_LIMIT)
        : state.past,
      future: withHistory ? [] : state.future,
    });

    scheduleSave();
  };

  const mapCaption = (id: string, fn: (caption: Caption) => Caption) =>
    (project: CaptionProject): CaptionProject => ({
      ...project,
      captions: project.captions.map((c) => (c.id === id ? fn(c) : c)),
    });

  /** Redistributes word timings across a caption after its text changes. */
  const retime = (caption: Caption, text: string): Caption => {
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return { ...caption, words: [], edited: true };

    const previous = new Map(caption.words.map((w) => [w.text.toLowerCase(), w.emphasis]));
    const span = Math.max(caption.end - caption.start, 0.05);
    const weights = tokens.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length + 2);
    const total = weights.reduce((a, b) => a + b, 0);

    let cursor = caption.start;
    const words = tokens.map((token, i) => {
      const start = cursor;
      const end = i === tokens.length - 1 ? caption.end : start + (weights[i] / total) * span;
      cursor = end;
      return enrichWord({
        text: token,
        start,
        end,
        start_ms: Math.round(start * 1000),
        end_ms: Math.round(end * 1000),
        emphasis: previous.get(token.toLowerCase()) ?? false,
      });
    });

    return { ...caption, words, edited: true };
  };

  return {
    project: null,
    saveStatus: 'idle',
    saveError: null,
    selectedCaptionId: null,
    duration: 0,
    lastAppliedPresetId:
      (typeof window !== 'undefined' && localStorage.getItem('cm_last_preset')) || 'apple-cupertino',
    safeZone: 'none',
    setSafeZone: (safeZone) => set({ safeZone }),
    past: [],
    future: [],

    editorName: readEditorName(),

    setEditorName: (name) => {
      const clean = name.trim().slice(0, 40);
      try {
        if (clean) localStorage.setItem(EDITOR_NAME_KEY, clean);
        else localStorage.removeItem(EDITOR_NAME_KEY);
      } catch {
        // storage blocked: the name still applies for this session
      }
      set({ editorName: clean });
    },

    closeProject: async () => {
      const state = get();
      if (!state.project) return;
      // a pending autosave would otherwise be dropped with the project
      if (saveTimer || state.saveStatus === 'saving' || state.saveStatus === 'error') {
        await get().save();
        // never drop edits the server did not take; the caller keeps the editor open
        if (get().saveStatus === 'error') {
          throw new Error(get().saveError ?? 'Your latest changes could not be saved.');
        }
      }
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      saveSequence++;
      set({
        project: null,
        past: [],
        future: [],
        saveStatus: 'idle',
        saveError: null,
        selectedCaptionId: null,
        duration: 0,
      });
    },

    setProject: (project) => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      saveSequence++;
      set({
        project,
        past: [],
        future: [],
        saveStatus: 'saved',
        saveError: null,
        duration: Math.ceil(
          Math.max(
            project.media?.duration ?? 0,
            project.captions[project.captions.length - 1]?.end ?? 0,
          ),
        ),
        selectedCaptionId: project.captions[0]?.id ?? null,
      });
    },

    loadProject: async (id) => {
      const project = await api.loadProject(id);
      get().setProject(project);
    },

    save: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const project = get().project;
      if (!project) return;

      const sequence = ++saveSequence;
      set({ saveStatus: 'saving', saveError: null });

      try {
        const saved = await api.saveProject(project);
        if (sequence !== saveSequence) return; // a newer save is in flight
        set((state) => ({
          saveStatus: 'saved',
          // keep local edits made while the request was in flight
          project: state.project ? { ...state.project, updatedAt: saved.updatedAt } : saved,
        }));
      } catch (error) {
        if (sequence !== saveSequence) return;
        set({ saveStatus: 'error', saveError: (error as Error).message });
      }
    },

    /**
     * Marks the start of a gesture such as dragging the caption box. The
     * gesture itself then writes with history disabled, so undo returns to
     * where the drag began rather than stepping back through every frame of it.
     */
    beginTransaction: () => {
      const state = get();
      if (!state.project) return;
      set({
        past: [...state.past, snapshot(state.project)].slice(-HISTORY_LIMIT),
        future: [],
      });
    },

    update: (patch, options) => apply((p) => ({ ...p, ...patch }), options),

    updateStyle: (patch) =>
      apply((p) => ({ ...p, style: { ...p.style, ...patch } }), { history: false }),

    updatePosition: (patch) =>
      apply((p) => ({ ...p, position: { ...p.position, ...patch } }), { history: false }),

    updateAnimation: (patch) =>
      apply((p) => ({ ...p, animation: { ...p.animation, ...patch } }), { history: false }),

    updateBackground: (patch) =>
      apply((p) => {
        const background = { ...p.background, ...patch };
        // remember colours the user actually picked
        if (patch.color && patch.color !== p.background.color) {
          background.recentColors = [
            patch.color,
            ...p.background.recentColors.filter((c) => c !== patch.color),
          ].slice(0, 8);
        }
        return { ...p, background };
      }, { history: false }),

    updateSegmentation: (patch) =>
      apply((p) => ({ ...p, segmentation: { ...p.segmentation, ...patch } }), {
        history: false,
      }),

    setLastAppliedPresetId: (id) => {
      if (typeof window !== 'undefined') {
        if (id) localStorage.setItem('cm_last_preset', id);
        else localStorage.removeItem('cm_last_preset');
      }
      set({ lastAppliedPresetId: id });
    },

    setCaptionText: (id, text) => apply(mapCaption(id, (c) => retime(c, text))),

    setWordText: (id, wordIndex, newText) =>
      apply(
        mapCaption(id, (c) => {
          if (!c.words[wordIndex] || !newText.trim()) return c;
          const words = [...c.words];
          words[wordIndex] = enrichWord({ ...words[wordIndex], text: newText.trim() });
          return { ...c, words, edited: true };
        }),
      ),

    setWordScript: (id, wordIndex, script) =>
      apply(
        mapCaption(id, (c) => {
          if (!c.words[wordIndex]) return c;
          const words = [...c.words];
          words[wordIndex] = { ...words[wordIndex], script };
          return { ...c, words, edited: true };
        }),
      ),

    setWordLocked: (id, wordIndex, locked) =>
      apply(
        mapCaption(id, (c) => {
          if (!c.words[wordIndex]) return c;
          const words = [...c.words];
          words[wordIndex] = { ...words[wordIndex], locked };
          return { ...c, words, edited: true };
        }),
      ),

    replaceAllText: (search, replaceWith, matchCase = false) => {
      if (!search.trim()) return 0;
      let count = 0;
      const flags = matchCase ? 'g' : 'gi';
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, flags);

      apply((p) => {
        const captions = p.captions.map((c) => {
          const original = c.words.map((w) => w.text).join(' ');
          let matchedHere = false;
          const replaced = original.replace(regex, (m) => {
            count++;
            matchedHere = true;
            return replaceWith;
          });
          if (matchedHere) {
            return retime(c, replaced);
          }
          return c;
        });
        return { ...p, captions };
      });
      return count;
    },

    transformCaptionCasing: (casing, captionIds) =>
      apply((project) => {
        const targetSet = captionIds && captionIds.length > 0 ? new Set(captionIds) : null;
        const captions = project.captions.map((c) => {
          if (targetSet && !targetSet.has(c.id)) return c;
          return {
            ...c,
            words: transformCaptionWords(c.words, casing),
            edited: true,
          };
        });

        // Also if casing is not upper, turn off style.uppercase so preview doesn't force uppercase
        const style =
          casing !== 'upper' && project.style.uppercase
            ? { ...project.style, uppercase: false }
            : project.style;

        return {
          ...project,
          style,
          captions,
        };
      }),

    togglePunctuation: (enabled) =>
      apply((project) => {
        if (!project.captions || project.captions.length === 0) return project;
        const hasPunct = project.captions.some((c) =>
          c.words.some((w) => /[.?!,;:]+/.test(w.text)),
        );
        const targetState = enabled !== undefined ? enabled : !hasPunct;
        const captions = toggleCaptionPunctuation(
          project.captions,
          targetState,
          project.transcript?.text,
        );
        return {
          ...project,
          captions,
        };
      }),

    addPunctuation: () => get().togglePunctuation(true),
    removePunctuation: () => get().togglePunctuation(false),

    toggleCaptionGaps: (remove) =>
      apply((project) => {
        if (!project.captions || project.captions.length === 0) return project;
        const gapsRemoved = Boolean(project.captions.some((c) => c.gapRestoreEnd !== undefined));
        const targetState = remove !== undefined ? remove : !gapsRemoved;
        return {
          ...project,
          captions: targetState ? removeCaptionGaps(project.captions) : restoreCaptionGaps(project.captions),
        };
      }),

    setCaptionTiming: (id, start, end) =>
      apply(
        mapCaption(id, (c) => {
          const safeEnd = Math.max(start + 0.05, end);
          const scaled = retime({ ...c, start, end: safeEnd }, c.words.map((w) => w.text).join(' '));
          return scaled;
        }),
      ),

    toggleEmphasis: (id, wordIndex) =>
      apply(
        mapCaption(id, (c) => ({
          ...c,
          edited: true,
          words: c.words.map((w, i) => (i === wordIndex ? { ...w, emphasis: !w.emphasis } : w)),
        })),
      ),

    clearAllEmphasis: () =>
      apply((project) => ({
        ...project,
        captions: project.captions.map((c) => ({
          ...c,
          edited: true,
          words: c.words.map((w) => (w.emphasis ? { ...w, emphasis: false } : w)),
        })),
      })),

    splitCaption: (id, wordIndex) =>
      apply((project) => {
        const index = project.captions.findIndex((c) => c.id === id);
        if (index === -1) return project;

        const caption = project.captions[index];
        if (wordIndex <= 0 || wordIndex >= caption.words.length) return project;

        const left = caption.words.slice(0, wordIndex);
        const right = caption.words.slice(wordIndex);

        const first: Caption = {
          ...caption,
          words: left,
          end: left[left.length - 1].end,
          edited: true,
        };
        const second: Caption = {
          id: `cap_${nanoid(8)}`,
          words: right,
          start: right[0].start,
          end: caption.end,
          edited: true,
        };

        const captions = [...project.captions];
        captions.splice(index, 1, first, second);
        return { ...project, captions };
      }),

    splitAtTime: (id, time) => {
      const project = get().project;
      if (!project) return;
      const caption = project.captions.find((c) => c.id === id);
      if (!caption) return;
      // split before the first word that starts at or after the playhead
      const index = caption.words.findIndex((w) => w.start >= time);
      if (index > 0) get().splitCaption(id, index);
    },

    mergeWithPrevious: (id) =>
      apply((project) => {
        const index = project.captions.findIndex((c) => c.id === id);
        if (index <= 0) return project;
        return mergeAt(project, index - 1);
      }),

    mergeWithNext: (id) =>
      apply((project) => {
        const index = project.captions.findIndex((c) => c.id === id);
        if (index === -1 || index >= project.captions.length - 1) return project;
        return mergeAt(project, index);
      }),

    deleteCaption: (id) =>
      apply((project) => ({
        ...project,
        captions: project.captions.filter((c) => c.id !== id),
      })),

    regenerateCaptions: (settings) =>
      apply((project) => {
        if (!project.transcript) return project;
        const segmentation = { ...project.segmentation, ...settings };
        return {
          ...project,
          segmentation,
          captions: defaultSegmenter.segment(project.transcript.words, segmentation),
        };
      }),

    resetCaptionEdits: () => get().regenerateCaptions(),

    importSubtitles: (rawText: string) => {
      const cues = parseSubtitles(rawText);
      if (cues.length === 0) {
        throw new Error(
          'No valid subtitle cues found. Check that your SRT/VTT file contains timestamps (e.g. 00:00:01,000 --> 00:00:04,000).',
        );
      }

      const captions = cuesToCaptions(cues);
      const allWords: TranscriptWord[] = captions.flatMap((c) =>
        c.words.map((w) => ({
          text: w.text,
          start: w.start,
          end: w.end,
          confidence: 1,
          script: w.script ?? 'en',
        })),
      );

      const maxEnd = captions[captions.length - 1]?.end ?? 0;

      apply((p) => {
        const transcript: Transcript = {
          text: allWords.map((w) => w.text).join(' '),
          words: allWords,
          language: p.language || 'auto',
          detectedLanguage: 'en',
          providerId: 'srt-import',
          modelId: 'subtitles',
          createdAt: new Date().toISOString(),
          durationMs: 0,
        };

        return {
          ...p,
          captions,
          transcript,
        };
      });

      const currentDuration = get().duration;
      if (maxEnd > currentDuration) {
        get().setDuration(Math.ceil(maxEnd));
      }

      if (captions.length > 0) {
        get().selectCaption(captions[0].id);
      }

      return { count: captions.length, words: allWords.length };
    },

    shiftAllCaptions: (seconds: number) => {
      const state = get();
      if (!state.project || !state.project.captions.length || !Number.isFinite(seconds) || seconds === 0) return;
      const shifted = shiftCaptions(state.project.captions, seconds);
      const maxEnd = Math.max(
        ...shifted.map((c) => c.end),
        state.project.media?.duration ?? 0,
      );
      set((s) => ({
        project: s.project ? { ...s.project, captions: shifted } : null,
        duration: Math.max(s.duration, Math.ceil(maxEnd)),
        past: [...s.past, snapshot(s.project!)].slice(-HISTORY_LIMIT),
        future: [],
      }));
      scheduleSave();
    },

    syncCaptionToPlayhead: (captionId: string, playheadTime: number) => {
      const state = get();
      if (!state.project || !state.project.captions.length) return;
      const target = state.project.captions.find((c) => c.id === captionId);
      if (!target) return;
      const delta = playheadTime - target.start;
      if (Math.abs(delta) < 0.001) return;
      get().shiftAllCaptions(delta);
    },

    undo: () => {
      const state = get();
      const previous = state.past[state.past.length - 1];
      if (!previous || !state.project) return;

      set({
        project: { ...state.project, ...previous },
        past: state.past.slice(0, -1),
        future: [snapshot(state.project), ...state.future].slice(0, HISTORY_LIMIT),
      });
      scheduleSave();
    },

    redo: () => {
      const state = get();
      const next = state.future[0];
      if (!next || !state.project) return;

      set({
        project: { ...state.project, ...next },
        past: [...state.past, snapshot(state.project)].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
      });
      scheduleSave();
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    selectCaption: (id) => set({ selectedCaptionId: id }),
    setDuration: (duration) => set({ duration }),
  };
});

/** Merges caption at `index` with the one after it. */
const mergeAt = (project: CaptionProject, index: number): CaptionProject => {
  const first = project.captions[index];
  const second = project.captions[index + 1];
  if (!first || !second) return project;

  const merged: Caption = {
    ...first,
    words: [...first.words, ...second.words],
    end: second.end,
    edited: true,
  };

  const captions = [...project.captions];
  captions.splice(index, 2, merged);
  return { ...project, captions };
};

// --- narrow selectors, so a caption edit does not rerender the inspector ----

export const selectProject = (s: EditorState) => s.project;
export const selectCaptions = (s: EditorState) => s.project?.captions ?? EMPTY_CAPTIONS;
export const selectStyle = (s: EditorState) => s.project?.style;
export const selectAnimation = (s: EditorState) => s.project?.animation;
export const selectBackground = (s: EditorState) => s.project?.background;
export const selectSegmentation = (s: EditorState) => s.project?.segmentation;
export const selectPosition = (s: EditorState) => s.project?.position;

const EMPTY_CAPTIONS: Caption[] = [];
