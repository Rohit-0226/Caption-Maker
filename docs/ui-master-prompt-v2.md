# Caption Maker: Master UI + Feature Prompt (v2)

Status: **received 2 Oct 2026 — at step 0 (summary + plan, waiting for the owner's OK). No UI code is written until the plan is approved, and each phase waits for confirmation.**

Merged from the owner's original redesign prompt + a hands-on teardown of Kalakar's editor (October 2026). Part A is reference. Part B is the prompt.

---

## Part A: What Kalakar does, and what we're taking

### Observed (fact, from using the live editor)

- **Layout.** Four zones. Left: icon rail (Captions, Masking, Custom Fonts, Library) and the caption list. Bottom-left: timeline. Centre: full-height preview. Right: properties panel. Export opens inline in the right panel, not as a modal.
- **Caption list.** Numbered rows, each word is its own chip. Emphasis words show as tinted chips. Click a row to seek; double-click a word to edit just that word (✓ / ✕). Row icons: curve into arch, spread across line, put behind subject, per-line styling popover (typography, background, position X/Y %, apply a different template to this line only).
- **Search** opens Find & Replace: match-case, match count, prev/next, Replace, Replace All.
- **Caption Tools dropdown.** Words per caption (Default, 1–5), max characters (20), lines (1–5); toggles to remove punctuation / emphasis / gaps / emojis; Caption Delay slider −5s to +5s.
- **Timeline toolbar.** Word-level / Line-level toggle, + Add word, split at playhead, ripple delete (close the gap), snapping, link video+audio, zoom, full-width timeline toggle. Tracks: Captions (word blocks), Video, Audio (waveform).
- **Preview bar.** Replace video, Safe-zone presets (Instagram Reels / Story / Feed, TikTok, YouTube Shorts) with opacity, play, mute, timecode, fullscreen. Selecting the video clip shows resize handles on canvas.
- **Right panel.** Two levels of tabs: `Captions | Edit`, then `Text | Templates | Transitions | AI Audio`.
  - Text: font family (with up/down arrows to cycle fonts fast), font face, size slider + number, case/underline, alignment, position X/Y %, solid/gradient colour, letter + line spacing, effects (drop shadow, glow, 3D depth, stroke, arc, background box with colour/opacity/radius/size/outline).
  - Templates: Built-in / My Presets, search, Save preset, ~45 cards with sample text and tags (Bold, Shadow, Italic). The selected card expands in place with Primary / Secondary / Background colours, box padding, Remove style.
  - Transitions: apply to Line or Word; None, Fade, Pop, Zoom, Scale, Slide L/R, Slide Up/Down, Rise, Hook; Speed "Dynamic" (auto from timing) or manual.
  - AI Audio: noise / music removal (paid credits).
  - Edit (clip selected): zoom, position, rotation, flip, crop, opacity, volume.
- **Home.** Search (⌘K), big dropzone (max 2 min, 1 GB, MP4/MOV), recent project cards with caption-burned thumbnail and a language tag like "Hindi (Roman)", card menu Rename / Delete.

### Where Kalakar is weak (owner's opinion, from the same session)

- Every single field has its own reset icon. Visual noise everywhere.
- Text tab is one long scroll of seven sections.
- Timeline is squeezed into the left column; the "full-width" toggle shrinks the preview to a postage stamp.
- No visible undo/redo, no save state, no shortcut help.
- Row icons (arch, arrows, person) are cryptic until hovered.
- Its Hinglish transcription is inconsistent: "vah" and "wo" in the same clip, "ho gayi.ek" with a missing space. That's exactly the gap the vocabulary feature closes.

**Taking:** word chips + double-click word edit, Find & Replace, Caption Tools (words/chars/lines/cleanup/delay), per-line style override, Word/Line timeline toggle, split / ripple delete / snapping, safe-zone presets, template search + My Presets + quick colours on the selected card, transitions with Line/Word scope and auto speed, inline export panel, project language tag.

**Fixing / skipping:** per-field resets become "reset on hover + modified dot"; two tab levels become one; layout adapts to aspect ratio; clip transform/crop dropped (it's a caption tool); masking, AI audio, custom-font upload, arc, gradient and reframe move to optional late phases (only if free and working); no creator-named templates; no credits/upgrade UI. Added what Kalakar lacks: undo/redo + save state, shortcut map, project lock for LAN use, timing checks, playback speed/loop, vocabulary learning.

Reviewed by a second agent for contradictions and technical risk; fixes applied (one meaning per key, explicit style order and timing rule, export proven in phase 2, preview proxy for iPhone video).

---

## Part B: The prompt

You are working on my existing Caption Maker app: a Hinglish (Hindi-English code-switched) caption/subtitle tool for short-form social video. It runs locally on my PC and my team uses it over the local network. Redesign the UI into a simple, modern, professional caption editor in the class of Kalakar / Captions / VEED, and make sure every control actually works end to end.

### 0. Before you write any code

1. Read the whole codebase. List the current pages, components, API routes, how transcription works, how captions are stored (data shape, including word-level timings if any), how vocabulary is stored, and how export works.
2. Show me that summary plus a short plan mapping each new UI piece to existing code or new code. Wait for my OK.
3. Do NOT change the transcription pipeline, model calls or caption data logic unless a UI feature needs it. If it does, tell me what and why first.
4. List every external API or service the app calls today (transcription, LLM clean-up, anything) and whether it costs money or needs a key. If anything conflicts with the "100% free" rule below, flag it. Don't swap it out without asking.

### 1. Hard rules

- **100% free.** No paid APIs, libraries, SaaS or cloud services. Video export uses local FFmpeg. Check the licence of any library you add and tell me if it's not free for a small company (example: Remotion needs a paid company licence above a small team size, so don't use it unless I confirm).
- **LAN-safe.** Other machines open the app via my PC's IP. No hard-coded `localhost` in frontend calls; use relative URLs. Fonts and assets must load from the server, not only from the internet, so it still works if the LAN has no internet.
- **Hinglish rule.** English words keep correct English spelling; Hindi words are romanised; everything in Latin script. Nothing in the UI (cleanup actions, case changes, find/replace defaults, spellcheck) may "auto-correct" this away. Turn off browser spellcheck on caption inputs.
- **No dead UI.** Every visible button works. If a feature isn't ready, hide it.
- **Preview = export.** What I see in the preview is visually identical to the export: same font files, sizes, colours, positions, effects, animations, timing. (Pixel-identical across every team PC isn't realistic; visually identical is the bar.)
- **Phased delivery** (section 12). After each phase the app runs with no console errors and you tell me how to test it.

### 2. Caption data model (agree this with me in step 0)

One project holds: source media info, `aspect`, `syncOffsetMs`, `cleanup` flags, `templateId`, `styleOverrides` (global edits on top of the template), and `captions[]`. Each caption: `id`, `start`, `end`, `words[]`, optional `lineTemplateId`, optional `lineStyle` override, `flags` (review, edited). Each word: `id`, `text`, `start`, `end`, `confidence?`, `emphasis` (bool), optional `wordStyle` override, `originalText` (what the transcriber produced, for vocabulary logging).

Sizes are stored relative to canvas height (e.g. font size as % of height) and shown in the UI as px at 1080p, so a 720p export matches the preview.

**Timing rule.** Stored times are always the raw transcript times. Sync offset and "close gaps" are applied at render. The timeline, list timecodes and SRT/VTT all show the effective (shifted) times; any edit made on the timeline (drag, timing stamp) is converted back to raw time before saving.

**Style resolution, highest wins:**

1. word override (`wordStyle`)
2. line override (`lineStyle`)
3. line template (`lineTemplateId`, if set, replaces the project template for that line)
4. global overrides (`styleOverrides`)
5. project template

Quick controls in a template card and everything in the Style tab write to `styleOverrides`. Switching template asks "Keep your changes?" (Keep / Discard), one undo step. "Back to template look" clears the selected word's or line's override. "Revert to template" clears `styleOverrides` only.

One renderer function reads this and draws the caption layer for time `t`. Preview and export both call it.

**Timing checks**, run on every edit and shown as amber marks on the timeline: no overlaps, end after start, minimum caption duration (~0.3s, configurable), words inside their caption's time range.

**Undo/redo** covers the whole project state (snapshot or patch stack, your call) with sensible grouping: one drag = one step, one slider drag = one step. Undoing a text edit also removes the vocabulary entry it created, unless another edit has used that entry since.

**One editor per project.** When someone opens a project another person is editing, show "Aman is editing this" with read-only mode and a `Take over` button. Release the lock on close or after a few minutes idle. Without this, two LAN users autosaving the same project overwrite each other.

### 3. Design system

Dark-first, calm, neutral. A pro tool, not a landing page.

- Background `stone-950` (~#0C0A09). Panels `stone-900`. Cards/inputs `stone-800`. Borders `stone-700` at low opacity. 1px borders, no heavy shadows. Radius 8–12px.
- One accent only: indigo (~`indigo-500`) for primary actions, selected states, sliders, toggles, active caption. Green only for the audio waveform and "subtitle file" export. Amber only for Review warnings. Red only for destructive actions.
- Fonts: `Outfit` (headings, logo), `Inter` (body, caption text in lists), `JetBrains Mono` (small UPPERCASE labels, timecodes, numeric values). Self-host them (see LAN rule).
- Section labels: small uppercase mono (`FONT`, `SIZE`) with the current value on the right in accent (`64px`).
- Reset pattern (fixes Kalakar's clutter): no permanent reset icon per field. A field that differs from the template shows a small accent dot next to its label; hovering the row reveals a reset icon. Each section header has one "Reset section".
- Light mode toggle in the header, built on CSS variables.
- Every icon button has a plain-words tooltip ("Shift all captions 50ms earlier"), and icon-only row actions show a text label on hover.
- Empty, loading and error states for every panel. Errors show as toasts with a clear next step.

### 4. Global header

- Left: logo + app name.
- Centre: pill nav `Projects | Vocabulary`.
- Right: theme toggle, editor-name avatar (simple local name picker, used to tag who made corrections).

### 5. Projects page (home)

- Search box (Ctrl+K focuses it).
- Hero card: "Turn your words into captions.", one-line subtext, large dashed dropzone ("Drag and drop a video or audio file, or click to browse"), supported formats and max size in small text.
- After a file is dropped, a small modal before processing: Language/script (default `Hinglish (Roman)`; options for `English` and `Hindi (Roman)` if the pipeline supports them; don't show options it doesn't support), Words per caption (Auto, 1–5), Starting template (optional, a row of 4 mini previews). Then `Generate captions`.
- Progress: upload bar, then status steps: Extracting audio → Making preview copy → Transcribing → Applying vocabulary → Building captions. Then auto-open the editor.
- Preview copy: the server makes an H.264/AAC MP4 proxy at constant frame rate for the editor (iPhone HEVC/MOV often won't play in Chrome on Windows) and serves it with HTTP Range support so seeking works. Export always uses the original file.
- Secondary link under the dropzone: "Have subtitles already? Import SRT/VTT" (creates a project from the video + subtitle file, word timings split evenly within each cue).
- "Your caption projects" grid: thumbnail with a caption burned onto it, name, duration, caption count, language tag, last edited + by whom. Card menu: Rename, Duplicate, Delete (confirm).

### 6. Editor layout

Four zones: caption list, preview, properties panel, timeline. Layout adapts to the video's aspect ratio (the source file's):

- Vertical or square (9:16, 4:5, 1:1): caption list on the left, timeline under it (bottom-left), preview full height in the centre, properties on the right. Same as Kalakar, because a tall preview matters more than a wide timeline for reels.
- Horizontal (16:9 and wider): caption list left, preview centre, properties right, timeline full width across the bottom.
- Splitters between zones are draggable. The properties panel can collapse to an icon strip.

#### 6.1 Editor toolbar (row under the header)

- Left: back to projects, project name (click to rename), caption count ("69 captions"), Undo, Redo, Save state ("Saved" / "Saving…"; autosave every few seconds).
- Right: `Regenerate` (re-run transcription; confirm that edits will be lost, offer to keep the vocabulary), `?` shortcuts, `Export` (primary accent button, opens the export panel, section 10).

#### 6.2 Left: caption list

- Header: `CAPTIONS` + count, then two icon buttons: Search and Caption tools.
- Find & Replace (search icon): find field with match-case toggle, `3/12` match count, prev/next, replace field, `Replace` and `Replace all`. Matches highlight in the list and preview. Every replacement is logged to vocabulary (one entry for a Replace all, not one per occurrence).
- Caption tools (dropdown panel, grouped):
  - Display: Words per caption (Auto, 1–5), Max characters per line, Max lines (1–3). Changing these re-chunks captions from word timings and is one undo step. Word text, word timings, emphasis and word styles survive; manual splits/merges and line overrides are reset, so show a confirm that says this.
  - Cleanup (toggles, non-destructive, applied at render): Remove punctuation, Remove emphasis, Close gaps between captions.
  - Timing: Sync offset. Slider −5s to +5s plus `−` / `+` buttons for 50ms nudges and a numeric field. Applies to preview and all exports.
- Rows: index (`01`, mono), start timecode right-aligned, then the words as chips. Emphasis words are tinted chips. A small dot on rows with a line or word override.
- Active row (playing or selected): accent left border, tinted background, auto-scrolls into view during playback (pause auto-scroll while I'm scrolling the list myself).
- Low-confidence captions show an amber `REVIEW` badge. Use the transcriber's confidence if available. If there's none, flag captions with words not in the vocabulary, but only once the vocabulary has a meaningful size (say 200+ entries); before that, show no badges rather than flagging everything. Editing the caption clears the flag. A "Next review" button in the list header jumps to the next flagged caption.
- Interactions (one meaning per gesture):
  - Single click row → select it and seek to its start. Never starts editing.
  - Double-click a word → edit that word inline. Enter saves, Esc cancels.
  - Enter or F2 on a selected row (or the row's pencil icon) → edit the whole line inline. While editing a line: `Enter` saves, `Ctrl+Enter` splits the caption at the cursor, `Shift+Enter` inserts a manual line break, `Backspace` at the very start merges with the previous caption, `Esc` cancels.
  - When a line edit changes words: unchanged words keep their timings; new or changed words share the time span of the words they replaced, split by character length. Splits divide timing at the word boundary.
  - Right-click a word → Emphasise / Remove emphasis, Style this word, Delete word.
  - Hover actions on the row (icons with labels on hover): Edit line, Merge with next, Line style (popover), Delete.
- Line style popover (per-line override, from Kalakar): Template for this line only (searchable mini list), Text (font, size, colour), Background box (on/off, colour, opacity, radius, padding), Position X/Y %. "Back to template" button at the top.

#### 6.3 Centre: preview

- Video centred on a dark canvas, source aspect ratio respected, with a faint dashed safe-area outline.
- Safe-zone menu (top-right of preview): None, Instagram Reels, Instagram Story, Instagram Feed, TikTok, YouTube Shorts, plus an opacity slider. Store presets in a JSON file as percentage insets so I can correct them; tell me the values are approximate.
- Captions render live from the shared renderer (section 2).
- Click the caption on the preview to select it; click one word to select just that word (properties panel then edits that word). Drag the caption to reposition (snaps to centre lines and safe zone; Alt+Drag = no snapping).
- Transport bar: play/pause (accent circle), current / total time in mono (`00:00.378 / 01:17`), playback speed (0.5× / 0.75× / 1×), "Loop current caption" toggle (for checking hard Hinglish lines), mute, fullscreen.

#### 6.4 Timeline

- Toolbar: `Word | Line` toggle (show word blocks or one block per caption), `+ Add caption at playhead`, Split at playhead, Ripple delete (removes selection and closes the gap), Snapping toggle, `Fix word timing`, Fit (whole video), zoom − / slider / +.
- Time ruler on top, red playhead you can click or drag to seek.
- Audio waveform track (green), generated locally (FFmpeg peaks or Web Audio), cached per project.
- Caption track: rounded blocks. In Word mode each word is its own segment with thin dividers; the playing word is brighter.
- Drag block edges to change start/end. Drag the divider between two words to retime them. Double-click a block to edit text. Hovering an empty gap shows "+ Add caption".
- Ctrl+Click / Shift+Click multi-select; Del removes the selection. (Skip box-select for now.)
- Fix word timing mode: plays the selected caption; I press `T` (or Enter) on each spoken word to stamp its start. Esc exits. One undo step.
- No separate video/audio tracks unless they do something. A thin "source" bar is enough.

#### 6.5 Right: properties panel

One row of tabs (not two levels like Kalakar): `Templates | Style | Animate`. No clip/transform tab; this is a caption tool, the video goes out as it came in. When a single word or line is selected, a chip at the top says "Editing: word 'station'" or "Editing: line 12" with `Back to template look` (shortcut R) and `✕` to return to global editing.

**Templates**

- `Built-in | My presets` toggle, search field, `Save as preset` button.
- Categories with a one-line description each:
  - Clean: plain text or soft card, stays out of the way.
  - Bold: heavy text, outline or box, spoken word lit up.
  - Word-by-word: one to three words at a time, mid-frame, punchy.
  - Highlight box: spoken word sits in a coloured pill or box.
- Each card: live mini-preview with sample Hinglish ("Kya baat hai, bhai"), name in small mono caps, position tag (`BOTTOM` / `MID-FRAME`), feature tags (`BOLD`, `SHADOW`, `BOX`).
- Hover a card → previews on the main video without applying. Click → applies (one undo step).
- Selected card expands in place (from Kalakar) with quick controls: Text colour, Highlight colour (spoken word + emphasis words), Box colour, Box padding (vertical/horizontal), and `Customise in Style →`.
- My own original names only. No real creator, brand or channel names. Start with 8–10 solid templates, not 40 half-working ones.

**Style** (collapsible cards, max three open by default: Text, Position, Effects)

- Top line: "Based on: [template]" with a `MODIFIED` badge and `Revert to template`.
- Text: hint "Click the caption on the preview to edit there. Click a word to style just that word." Font picker (free fonts, each shown in its own face; ↑/↓ arrows cycle fonts quickly), Weight segmented (Regular / Medium / Bold / XBold / Black) + italic, Size slider + px field, Case segmented (As spoken / UPPER / lower / Title; never changes stored text, render only), Text colour, Highlight colour + toggle "Highlight the spoken word", Emphasis colour. `More` expander: letter spacing, line height, alignment.
- Position: 3×3 grid picker, "Distance from edge" px slider, X/Y % fields for exact placement.
- Effects: Stroke (width + colour), Shadow (blur + offset + colour), Glow (strength + colour), Background box (on/off, colour, opacity, radius, padding, box per word vs per line).
- Colour inputs everywhere: swatch + hex field + check icon when valid.

**Animate** (from Kalakar's Transitions, simplified)

- Apply to: `Line | Word` segmented. Word mode applies to selected words, or all words if none selected.
- Presets as icon tiles: None, Fade, Pop, Slide up, Rise, Zoom. Hover a tile to preview it on the current caption.
- Speed: `Auto` (fits the caption's duration, default) or `Manual` with a duration slider.

### 7. Vocabulary learning (core feature, keep and surface it)

- Every manual change to a word's text (list, timeline, preview, Find & Replace) is logged: original → corrected, editor name, project, timestamp. Ignore pure timing or style edits.
- Corrections feed the vocabulary list used by future transcriptions (and the "Applying vocabulary" step on upload). Toast after an edit: "Added 'nikalkar' to vocabulary" with `Undo` and `Don't learn` (for one-off typo fixes, so they don't pollute the list).
- An entry corrected the same way 2+ times, or by 2+ editors, is marked "confirmed" and applied automatically on upload; single-use entries are suggestions only. Show both states on the Vocabulary page.
- Support normalisation rules, not just single words, so I can force one spelling for variants (e.g. `vah`, `voh` → `wo`). Offer to apply a new rule across the current project.
- Vocabulary page: search, filter by editor, edit, delete, see how many times each entry was used, export/import as JSON.

### 8. Keyboard shortcuts

`?` opens a modal grouped by History, Playback, Captions, Words, Selection, App. Implement all. Each key has one meaning in each context:

- History: Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo
- Playback: Space play/pause; ← / → step 1 frame, Shift+← / → step 1s; J / K previous / next caption
- Captions: Enter or F2 edit selected line; while editing: Enter save, Ctrl+Enter split at cursor, Shift+Enter line break, Backspace at start merge with previous, Esc cancel. Double-click a word or timeline block to edit it.
- Words (a word is selected): Tab / Shift+Tab next / previous word; `+` / `−` bigger / smaller; R reset to template look; E toggle emphasis
- Fix word timing mode: T or Enter stamps the current word; Esc exits
- Selection: Ctrl+Click / Shift+Click multi-select; Del / Backspace deletes the selection; Esc clears selection, closes popovers, cancels
- App: Ctrl+F Find & Replace, Ctrl+K search projects (home), Ctrl+S save now, `?` this modal

Rules: shortcuts never fire while typing in a text field (except the editing keys listed above). Arrow keys and Tab are only captured when the preview, list or timeline has focus, so normal keyboard navigation in panels still works.

### 9. Rendering approach (decide in step 0, tell me before building)

Preview must match export, and the style set includes glow, per-word highlight, boxes and animations. ASS subtitles can't reproduce all of that reliably. So:

- Write one Canvas 2D renderer module: a pure function of (project state, time `t`, output size) that draws the caption layer. No reliance on playback state.
- Preview: draw it on a canvas overlay above the `<video>`. Sync with `requestVideoFrameCallback` while playing, and fall back to `requestAnimationFrame` + `video.currentTime` when paused, seeking, or for audio-only projects.
- Export: run the same module headlessly on my PC (e.g. Playwright + Chromium, Apache-2.0, free). Step through frames by time (frame n → t = n / fps) at a constant frame rate, wait for `document.fonts.ready` before the first frame, read raw RGBA pixels from the canvas and pipe them into FFmpeg (`-f rawvideo -pix_fmt rgba`) rather than taking screenshots, then overlay on the source. Convert variable-frame-rate phone footage to constant frame rate first.
- Fonts: the same font files are loaded by preview and export (self-hosted, never system fonts).
- If you find a simpler free approach that keeps preview and export visually identical, propose it with trade-offs. Don't quietly fall back to ASS.
- Add an automated check: render one frame through the preview path and the export path and compare them, so drift gets caught.

### 10. Export (one button, inline panel)

`Export` swaps the right panel into an export view (like Kalakar), with `Back`:

- Type: `Video with captions` | `Subtitle file` | `Captions only (overlay)`.
- Video: resolution (Source / 1080p / 720p), quality (Standard / High), filename.
- Subtitle file: `SRT` / `VTT`, built from current captions with sync offset applied. Plain text only (styling doesn't carry, say so in a hint).
- Captions only: `Transparent (ProRes 4444 .mov)` as the default (works in Premiere and most editors; large files), or `Green screen MP4` (small, works everywhere, but soft shadows and glow won't key cleanly; say so in a hint). Check whether my CapCut version imports alpha WebM before adding it as a third option.
- Render shows a progress bar with time remaining, runs as a background job, and I can keep editing or open other projects. A small jobs indicator in the header shows running exports and a download link when done.
- Block export only for real problems (missing font file, source missing, timing errors) and say exactly what to fix.
- Storage housekeeping: a small Settings section showing disk used by uploads, proxies and exports, with "Delete exports older than N days" and per-project "Delete files".

### 11. Optional, only if free and working (later phases; hide until done)

- Clean audio: FFmpeg denoise filter (e.g. `afftdn` or `arnndn` with a free model) as an export option.
- Captions behind subject: free local person segmentation (e.g. MediaPipe Selfie Segmentation). Only if it renders identically in export.
- Upload custom fonts (TTF/OTF/WOFF2) stored on the server and used by both preview and export.
- Curved (arc) text for a line.
- Gradient text, Typewriter animation.
- Reframe: change output aspect (e.g. 16:9 source → 9:16) with zoom, position and blur-fill background.
- Box-select on the timeline.

### 12. Phases

1. **Shell + design system + data model:** header, theme, Projects page, upload modal and progress, preview proxy, empty editor with adaptive layout and splitters. Wire to existing data. Agree the caption/word model. Project lock.
2. **Caption list + preview + playback + export proof:** shared renderer on the preview, list sync and auto-scroll, word chips, inline word/line edit, split/merge/delete, emphasis, Find & Replace, Caption tools, sync offset, timing checks, undo/redo, autosave, vocabulary logging + toast. Plus a bare-bones 5-second video export through the headless renderer + FFmpeg, so "preview = export" is proven early, not discovered at the end.
3. **Timeline:** ruler, playhead, waveform, Word/Line modes, drag to retime, add/split/ripple delete, snapping, zoom/fit, selection, Fix word timing, playback speed and loop.
4. **Templates + Style + Animate:** templates as JSON style objects, hover preview, in-card quick controls, My presets, line and word overrides, animations, reset pattern, safe zones.
5. **Export + shortcuts + polish:** full export panel, SRT/VTT export and import, overlay exports, background jobs, storage housekeeping, Vocabulary page, shortcuts modal, tooltips, empty/loading/error states.
6. **Optional extras** from section 11, one at a time, only after I ask.

After each phase give me: files changed, how to test it on my PC and from another machine on the LAN, and known issues. Don't start the next phase until I confirm.
