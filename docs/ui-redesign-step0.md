# UI redesign — step 0: what exists today, and the plan

Answers section 0 of `docs/ui-master-prompt-v2.md`. **Nothing in the redesign is built until you approve this.** The four decisions I need are at the end.

---

## 1. What the app is today

### Pages and main components
There is one page with a left icon rail of three sections (`src/app/NavRail.tsx`, `App.tsx`):

| Rail section | Component | What it holds |
| --- | --- | --- |
| Transcribe | `features/workspace/TranscribeWorkspace.tsx` | media import, transcription panel, caption list, preview, timeline, inspector |
| Presets | `features/workspace/PresetsWorkspace.tsx` | template gallery (`StyleGallery`), motion gallery, font browser |
| System | `features/workspace/SystemWorkspace.tsx` | project library, review queue, caption QA |

Plus `TopBar.tsx` (project name, undo/redo, export, settings), `features/export/ExportDialog.tsx` (a modal), `features/settings/SettingsDialog.tsx` (API keys), `features/ai/AIPanel.tsx` (AI command centre).

Sizes worth knowing: `CaptionList.tsx` 1,120 lines, `Inspector.tsx` 1,081, `Timeline.tsx` 641, `store.ts` 652.

Already present and reusable: undo/redo with gesture grouping (`store.ts` keeps `past`/`future` snapshots), a timeline with waveform, zoom and split-at-time, keyboard shortcuts (`useKeyboardShortcuts.ts`), a resizable panel splitter, safe-zone overlays, caption QA, SRT/VTT import, a playback clock that keeps the caption list following the video.

There is **no Projects home page** — the library lives inside the System tab — and **no Vocabulary page**.

### API routes (`server/index.ts`, ~50)
Projects CRUD · media upload / file (with HEVC/MOV preview proxy and HTTP Range) / waveform · transcribe / regenerate / translate (background jobs + server-sent events) · export subtitles / export video / output download · fonts CRUD · terminology PDF · vocabulary (list, add, delete, extract candidates, evaluate) · corrections + lexicon candidates (approve/reject) · AI command / compare / benchmark / status · settings + key test · caption QA · backup · health.

### How transcription works
Five engines behind one interface (`server/services/providers/`): **Hybrid** (default) runs Groq Whisper twice (turbo + large-v3), Gemini (listening to the audio), and local Nemotron via Handy; votes word by word; Gemini settles disagreements; every word is then timed against the audio itself. Also Groq-only, Nemotron-only, and an offline Whisper. This is the accuracy work you asked for separately — it continues on its own track and the redesign won't touch it.

### How captions are stored (`src/core/types/project.ts`, one `project.json` per project)
```
CaptionProject { schemaVersion 5, id, name, media, language, terminology, transcript,
                 captions[], segmentation, style, position, animation, background, exportSettings }
Caption        { id, start, end, words[], edited, gapRestoreEnd? }
CaptionWord    { text, start, end, start_ms, end_ms, script, locked, confidence?, emphasis }
Transcript     { text, words[] (raw engine output, kept so captions can be re-grouped free), quality }
```
Word-level timings: yes, on every word.

### How vocabulary is stored — two separate systems today
1. `src/core/vocabulary/vocabulary.json` — a bundled list of approved spellings (`VocabularyStore`), used to prime Whisper and in clean-up.
2. SQLite `data/studio.db` (`server/services/db.ts`, Node's built-in `node:sqlite`) — `corrections` (every manual fix logged) and `lexicon` (candidates promoted by approve/reject).

### How export works
`server/services/render.ts`: Remotion bundles the same React caption component the preview uses, renders a **transparent ProRes 4444 overlay** in headless Chromium, then FFmpeg composites it onto the original video and copies the original audio. Subtitles (SRT/VTT/ASS) come from `src/core/subtitles/formats.ts`. Exports run as background jobs.

---

## 2. Every external service the app calls

| Service | Used for | Cost | Key |
| --- | --- | --- | --- |
| Groq API (Whisper + chat models) | transcription, Hinglish clean-up, translation | free tier, rate-limited | yes |
| Google Gemini API | second listener, arbitration, translation | free tier, rate-limited | yes |
| OpenRouter | optional second-opinion clean-up (free models) | free models only as configured | yes |
| OpenAI / xAI | optional AI Command Centre providers | **paid** — only used if you add a key; none set | yes |
| Hugging Face (model download) | one-time download for offline Whisper | free | no |
| Handy / Nemotron | local GPU transcription | free, local | no |
| Google Fonts CDN | **UI fonts and caption fonts** | free | no |
| Cloudflare quick tunnel | temporary public share link | free, no account | no |

---

## 3. Conflicts with your hard rules — flagged, nothing swapped

1. **Remotion licence (100% free rule).** Remotion powers both the preview player and the video export. It is free only for individuals and companies with **up to 3 employees**; above that a paid company licence is required. → *Decision 1.*
2. **Gemini free tier and client footage.** On Google's free tier, submitted audio may be used to improve Google's products. If client videos are confidential, that matters. Groq's terms differ. → *Decision 2.*
3. **LAN-without-internet rule.** UI fonts (Inter, JetBrains Mono) and every caption font load from Google Fonts over the internet (`index.html`, `src/core/rendering/fonts.ts`, `src/remotion/FontLoader.tsx`). With no internet, captions fall back to system fonts — and preview would stop matching export. Fix: self-host the font files and serve them from the server. No decision needed; it goes in phase 1.
4. **Templates.** There are 101 built-in templates today, and some swatch names reference real creators ("Hormozi Yellow"). Your spec asks for 8–10 solid originals with no creator names. I'd curate down to ~10 and keep the rest out of the UI — plus "Founders of UAE", which you asked for by name. → *Decision 4.*

Transcription stays as it is for the redesign. The one data change a UI feature needs from it: words must carry `originalText` (for vocabulary logging) — additive, no behaviour change.

---

## 4. Data model — proposed changes (schema v6, migrated automatically)

| Spec asks for | Today | Change |
| --- | --- | --- |
| word `id`, `originalText` | no | add |
| `syncOffsetMs`, applied at render | delay **rewrites stored times** (`shiftCaptions`) | add field; stop mutating times |
| `cleanup` flags at render | "remove gaps" **rewrites stored ends** | move to render-time flags |
| `templateId` + `styleOverrides` | one flat `style` object | split: template id + overrides |
| per-line `lineTemplateId`, `lineStyle`, per-word `wordStyle` | none | add, resolved in your order: word → line → line template → overrides → template |
| sizes relative to canvas height | px | store as % of height, show px at 1080p |
| `flags` (review, edited) | `edited` only | add `review` |
| project lock | none | `lock { editor, since }` + heartbeat route |

Existing projects migrate on open; nothing is lost.

---

## 5. Rendering — the decision that shapes everything (section 9)

Your spec proposes a hand-written Canvas 2D renderer for preview, and Playwright + Chromium stepping frames into FFmpeg for export — mainly to avoid Remotion's licence.

**The app already satisfies "preview = export" today**, by a different route: preview and export run the *same* React component in the *same* engine (Chromium). So:

- **Option A — keep Remotion** (only if you have ≤ 3 employees, or buy the licence). No renderer rewrite; effort goes into the UI. The automated preview-vs-export frame check from section 9 is still added.
- **Option B — replace Remotion** with the Canvas 2D + Playwright design in your spec (all Apache-2.0/MIT, free at any size). It's the largest single piece of work in the redesign: every style and animation is reimplemented on canvas, then proven against export. Phase 2 would carry it.

My recommendation: **A if you qualify, B otherwise** — B is entirely doable, but there's no reason to pay its cost if the licence is already free for you.

---

## 6. Plan — each new UI piece mapped to existing or new code

| Phase | Builds | Reuses | New |
| --- | --- | --- | --- |
| 1. Shell, design system, data model | header with `Projects | Vocabulary`, theme toggle, editor name; Projects home + dropzone + upload modal + step progress; adaptive 4-zone editor layout with splitters; schema v6; project lock; self-hosted fonts | `ProjectLibrary`, `MediaImport`, preview proxy (exists), `PanelResizer`, job SSE | Projects page, design tokens (stone/indigo), lock route, font hosting |
| 2. List + preview + export proof | word chips, inline word/line edit, split/merge, emphasis, Find & Replace, Caption tools, sync offset, timing checks, autosave, vocabulary logging + toast; 5-second export proof | `CaptionList`, store undo, `playbackClock`, `qa.ts`, corrections DB | render-time offset/cleanup, find/replace, toast, (Option B: canvas renderer) |
| 3. Timeline | ruler, playhead, waveform, Word/Line modes, drag retime, add/split/ripple delete, snapping, fix-word-timing mode, speed/loop | `Timeline.tsx` (waveform, zoom, split exist) | word mode, ripple delete, snapping, stamp mode |
| 4. Templates + Style + Animate | ~10 curated templates as JSON, hover preview, card quick controls, My presets, line/word overrides, reset pattern, safe-zone JSON | `presets.ts`, `animations.ts` (one motion registry), `myPresets.ts`, `safeZones.ts` | override resolution, template curation, modified-dot pattern |
| 5. Export + shortcuts + polish | inline export panel, overlay exports, header jobs indicator, storage housekeeping, Vocabulary page, `?` modal | `ExportDialog`, `render.ts`, `useKeyboardShortcuts`, vocabulary DB | Vocabulary page, storage route, shortcut modal |

After each phase: files changed, how to test on your PC and from another machine on the LAN, known issues — and I wait for your OK.

---

## 7. Confirmed decisions (Approved & Active)

1. **Remotion:** **Option A — Keep Remotion.** Creator / small team (≤ 3 employees). 100% free under Remotion's license. Visual parity between preview player and export is preserved with zero rendering drift.
2. **Gemini free tier:** Keep Gemini active in the Hybrid accuracy consensus by default for maximum Hinglish transcription quality; provide a per-project `Confidential (Skip Gemini)` toggle for sensitive client footage.
3. **Data model:** **Schema v6 approved.** Dynamic render-time `syncOffsetMs` and `cleanup` flags (leaving stored raw times pristine), per-word `id` and `originalText`, per-line style/template overrides, and multi-user project locks.
4. **Templates:** Curate down to ~10 clean originals (including "Founders of UAE") without creator-named swatches; keep legacy templates available in an archive section.

---

## 8. Resolved: LAN / Wi-Fi Upload "Clipping" Root Cause & Fix

- **Root Cause:**
  1. In `server/services/media.ts`, `writeStreamToFile` piped `req` directly to disk without checking total received bytes against `x-file-size` or `Content-Length`.
  2. When uploads occurred directly over local Wi-Fi, mobile browser tab backgrounding or packet drops caused the client socket to close prematurely. The stream emitted `'close'`, triggering `out.end()`, which resolved the promise as "successful".
  3. Express accepted the truncated partial file, and FFmpeg probed the partial MP4. The video was stored as a clipped video.
  4. Cloudflare Quick Tunnel did not clip because Cloudflare edge servers buffer incoming HTTP request streams before proxying and negotiate HTTP/2 flow control over `cloudflared`. Direct LAN had no proxy buffer.
  5. Node's default `requestTimeout` (300s) severed large 4K uploads over slower Wi-Fi connections.
- **Fix Applied & Verified:**
  1. `writeStreamToFile` now strictly verifies received byte counts against `expectedBytes`. If an upload is aborted or closed prematurely, the partial file is instantly unlinked/deleted from disk and an explicit error is returned.
  2. Node server timeouts configured: `server.requestTimeout = 0`, `server.keepAliveTimeout = 61000`.
  3. Frontend `uploadMedia` converted to `XMLHttpRequest` with exact byte progress reporting (`%`, `MB / Total MB`) and `x-file-size` header.
  4. Vite proxy configured with `timeout: 0` and `proxyTimeout: 0`.
  5. Verified with 490 passing unit tests and clean production builds.
