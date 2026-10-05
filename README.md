# Caption Maker

Upload a video or audio file, transcribe it, style the captions, and export.
Everything runs locally: a Vite/React editor talking to a small Node server that
handles media, transcription jobs, project storage and rendering.

```
Upload → Transcribe → Style → Motion → Export
```

---

## Running with Web Hub & Cloudflare Public Link

Double-click **`Caption Maker Web & Share.exe`** in the project root or the **`Caption Maker Web & Share`** shortcut on the Desktop.

### What it does:
1. **Self-rebuilding**: Automatically detects if `launcher/Launcher.cs` was edited and re-compiles itself.
2. **Preflight**: Checks Node.js, npm, FFmpeg, and cloudflared.
3. **Smart Dependency Sync**: Only runs `npm install` if `node_modules` is missing or `package.json`/`package-lock.json` content hash changed.
4. **Stale Port Cleanup**: Detects and cleanly frees ports `5173` and `5180` from lingering dev processes (`node`, `cmd`, `tsx`, `esbuild`) while leaving external apps alone.
5. **Starts dev servers**: Runs `npm run dev` in the background with process tree tracking in a Windows Job Object (guarantees zero orphaned processes on exit or force-kill).
6. **Opens browser**: Automatically launches `http://localhost:5173` upon readiness.
7. **Cloudflare Quick Tunnel**: Starts an automatic temporary public link (`https://*.trycloudflare.com`) via `cloudflared`.

> [!WARNING]
> **Public Link Security Notice**: Anyone with the temporary `*.trycloudflare.com` link can access the entire Caption Maker web application, including projects, captions, and AI tools, while the launcher is open. You can disable public sharing at any time by unchecking *"Share a public link"* in the launcher window.
> 
> *Note on uploads*: Cloudflare's free quick tunnel limits request payloads to 100 MB. Files larger than 100 MB should be imported locally or via LAN.

### Change Handling Table

| You change | What happens |
| --- | --- |
| `src/`, `server/`, `public/` | Vite and `tsx watch` hot-reload automatically (logged in launcher). |
| `package.json`, `package-lock.json` | Stops dev server, runs `npm install`, updates hash stamp, and restarts. |
| `.env` | Dev server automatically restarts to reload environment variables. |
| `launcher/Launcher.cs` | Launcher notes the update in the footer; recompiles on next launch. |

### Manual Rebuild Command
To recompile the launcher by hand at any time:
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "launcher\build.ps1"
```
*(If the launcher is currently running, the build script atomically renames the active executable aside to `.old-<timestamp>` and swaps the new build in seamlessly).*

---
Prefer a terminal:

```bash
npm install
npm run dev
```

Opens the editor on <http://localhost:5173>, with the API server on `5180`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Server and editor together |
| `npm run dev:server` | API only |
| `npm run dev:web` | Editor only |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest |
| `npm run build` | Typecheck, then production bundle into `dist/` |

**Requires** Node 18+ and FFmpeg on the `PATH`. On Windows:
`winget install Gyan.FFmpeg`, then restart the terminal. If FFmpeg lives
somewhere unusual, set `FFMPEG_PATH` and `FFPROBE_PATH`.

---

## Transcription

Two engines sit behind one `TranscriptionProvider` interface. Nothing in the UI
knows which is in use.

### Groq (recommended)

Get a free key at <https://console.groq.com/keys>, then:

```bash
cp .env.example .env
# add GROQ_API_KEY=gsk_...
```

Restart the server. The key is read server-side only — it is never exposed to
the browser, never written into a project file, and `.env` / `.env.local` are
gitignored.

- Default model `whisper-large-v3-turbo`, temperature 0, word and segment
  timestamps via `verbose_json`
- `GROQ_WHISPER_MODEL=whisper-large-v3` opts into the larger model
- Audio over ten minutes is split into chunks automatically, with timestamps
  offset back to absolute time — you never manage this
- A key beginning `xai-` is rejected with a clear message. Groq and xAI (Grok)
  are different companies and the credentials are not interchangeable

### Local Whisper (offline)

Runs on the CPU through Transformers.js. No key, no cost, no network. Fine for
English; **not** recommended for Hinglish (see Known limitations).

---

## Languages

`Auto Detect` · `English` · `English (India)` · `Hinglish`

**Hinglish** is treated as code-switched Hindi and English, not as either one.
The model is asked for English so the output stays in Roman script, and primed
with a sample of real Hinglish so the vocabulary comes out right.

One thing worth knowing, because it caused a real bug here: Whisper's `prompt`
parameter is *preceding context*, not an instruction. An earlier version passed
"Do not translate the Hindi into English" and the model dutifully transcribed
that sentence into the captions. Prompts in `src/core/transcription/languages.ts`
must therefore be **samples of the wanted output**, never instructions — there
is a test enforcing this.

If a provider still returns Devanagari, `postProcessText` transliterates it to
Roman. The raw transcript is stored separately from the captions, so caption
grouping can be regenerated any number of times without re-transcribing.

### Client terminology PDFs

Each project can optionally store a company SOP, glossary or brand-reference
PDF. Use **Client terminology PDF → Add PDF** before transcribing. Caption Maker
extracts selectable text locally, identifies likely branded words, acronyms and
short phrases, and shows the preferred terms for review. You can edit that list
before starting the transcript.

The PDF context is used in two conservative ways:

- capable Whisper providers receive representative prose from the document as
  preceding context, which helps them recognise the client's vocabulary;
- returned words are changed only when a PDF term is an exact match or a unique,
  very close spelling match. Ambiguous matches are left alone for human review.

The original PDF is stored under the project's `reference/` folder and never
leaves the machine. The selected transcription provider receives only the
compact representative text sample. Image-only scanned PDFs need OCR before
upload; Caption Maker reports this clearly instead of silently pretending that
no terminology was found.

---

## AI Command Center

The **AI** tab takes plain-English requests — "make all captions 3 words per
line and the spoken word yellow" — and turns them into validated changes you
approve before anything is applied.

```bash
# in .env, separate from the transcription key so quota and rotation stay independent
AI_PROVIDER=groq
AI_API_KEY=gsk_...
AI_MODEL=openai/gpt-oss-120b
```

### How it stays safe

Model output is never executed. Every request goes:

1. project context + the list of real template, motion and font ids
2. one call constrained by a **strict JSON schema**
3. each returned action reshaped and validated against a Zod union
4. anything invalid is rejected with a reason; the rest still applies
5. the result is **previewed**, not saved — Cancel truly cancels
6. Apply commits it as **one undoable transaction**

There is no path from model output to a filesystem write, a shell command or
evaluated code. Unknown action types, out-of-range numbers, unresolvable
colours and non-existent caption numbers are all refused.

**Groq and xAI are different companies** with confusingly similar names. A key
whose prefix does not match `AI_PROVIDER` is refused rather than sent, so a
`gsk_` key can never be posted to `api.x.ai`. Keys are redacted from every log
line and never appear in a response.

### Two things the live API taught us

- **Parallel tool calls are unreliable.** Asked for three changes, the model
  returned one. A single response containing an array of actions returns all of
  them. Strict mode also requires every property to appear in `required`, so
  optional fields are nullable rather than absent.
- **The model speaks loosely.** It answers "yellow" as often as `#FFD400`, and
  reads "move captions slightly higher" as a *delta* of −5 rather than a
  position. Colours are resolved (or refused), and every number carries an
  explicit `absolute` or `relative` mode.

### Caption quality check

"Check this project before export" runs a QA pass for overlaps, invalid or
zero durations, captions too fast to read, too many words or lines, a missing
font, missing media, and captions sitting under a platform's interface. It
reports what is wrong and whether a safe fix exists — it never rewrites your
wording.

---

## Caption grouping

Readability is controlled by **words**, not characters.

| Control | Range | Default |
| --- | --- | --- |
| Words per line | 1–10 | 4 |
| Max lines | 1 / 2 / 3 | 2 |
| Reading pace | Relaxed 2.2 · Normal 3.0 · Fast 4.0 w/s | Normal |

A caption holds up to `words per line × max lines` words. Slider and number box
are always in sync — type `3` and the slider moves, drag to `6` and the box
reads 6.

Layout presets: **Compact** (3), **Balanced** (4), **Spacious** (6, relaxed),
**Single line**.

Boundaries are chosen in this order: real word timestamps, sentence
punctuation, speech pauses, then the word budget. A word is never split.
Character count survives only as a backstop against a run of very long words
overflowing the frame, and lives in Advanced.

**Reading pace does not split captions.** Speech delivered at four words a
second displays at four words a second however it is grouped — splitting cannot
change that. What helps is leaving a dense caption on screen longer, so the pace
setting extends a caption's end time into the silence that follows it, never
past the next caption, and never altering the spoken word timings.

---

## Styles and motion

They are deliberately independent. Picking a style never disturbs your motion,
and picking a motion never disturbs your style. **Quick Presets** are the one
place both are set together.

- **31 style presets** across Clean, Creator, Karaoke, Dynamic and Professional.
  Every card is a real render of that style — same renderer as the export, not a
  thumbnail.
- **30 motions** across Basic, Pop, Word, Reveal and Dynamic, each with an
  animated card.
- **10 quick presets** combining the two.

### One motion engine

`computeCaptionFrame()` in `src/core/rendering/frame.ts` resolves a caption at a
moment in time into pure transform values. It is called by the Remotion layer
for the editor preview and the final export, and by the gallery cards for their
previews. A card physically cannot disagree with the export, because there is
only one implementation.

Adding a motion is one object in `ENTER_ANIMATIONS` plus its id in the
`EnterAnimationId` union. No rendering code changes.

---

## Fonts

**32 bundled families** plus custom uploads, in categories: Recommended, Bold,
Clean, Condensed, Creator, Editorial, Fun, Hindi (Devanagari), System, Custom —
with search, favourites and recents.

Every Google font here is under the SIL Open Font License, which permits
embedding in rendered video. System fonts are referenced by name only. No font
file is copied from any other application.

Nothing is loaded at startup. A family is fetched when its row scrolls into view
or when something selects it, then cached.

**Upload Font** accepts TTF, OTF, WOFF and WOFF2. Uploads are stored in
`fonts/`, content-addressed so re-uploading the same file is idempotent, and
served over HTTP — which is how the same file renders identically in the editor
and in headless Chrome at export time.

---

## Export

**Subtitles** — SRT, VTT, ASS, or the whole project as JSON. UTF-8 with a BOM so
Hinglish survives Windows tooling. Timestamps are validated before writing.

**Video** — captioned MP4, transparent MOV (ProRes 4444), transparent WebM
(VP9). Presets for Instagram Reel, YouTube Short, TikTok, Original and
Transparent Overlay.

For a burned-in MP4 the captions are rendered on transparency and composited
onto the source with FFmpeg, so the original video and its audio are never
re-encoded through the caption pass.

---

## Safe zones

Preview-only overlays approximating where TikTok, Reels and Shorts draw their
own interface. Never baked into an export.

---

## Performance

- One video preview. Style and motion cards are lightweight DOM, not Remotion
  players.
- All preview cards share a single `requestAnimationFrame` loop, and a card
  joins it only while mid-cycle — thirty idle cards cost nothing.
- Cards render only once scrolled into view (`IntersectionObserver`), and fonts
  load on the same signal.
- Caption rows are memoised so editing one does not re-render the rest; the
  store exposes narrow selectors so a caption edit does not re-render the
  inspector.
- Waveforms are computed once and cached to disk, keyed on the media path, size
  and bucket count.
- Transcription and rendering run as background jobs with progress over SSE, so
  the UI stays usable and both can be cancelled.
- Segmentation changes are debounced.

---

## Project files

Projects live in `projects/<id>/project.json`, versioned by `schemaVersion` with
migrations in `src/core/project/migrate.ts`. Saves are atomic — temp file, then
a `.bak` of the previous version, then a rename — and a corrupt file falls back
to the backup rather than reporting data loss.

The v1 → v2 migration converts old character-based settings to words per line.

---

## Tests

```bash
npm run test
```

90 tests over segmentation (word budgets, no word splitting, punctuation and
pause preference, timestamp ordering, Unicode and Hinglish), subtitle formats
(round-tripping, timecodes, validation), project save/load/migration, language
configuration and romanisation, and the motion registry — including a test that
every motion except **None** actually produces movement, and that presets settle
to a steady state.

---

## Known limitations

Stated plainly, because some of these will bite:

- **Local Whisper is poor at Hinglish.** The small model it can afford to run on
  a CPU translates Hindi into English rather than transcribing it, and runs
  slower than realtime. Use Groq for anything but English. The provider marks
  Hinglish unsupported rather than quietly returning a bad transcript.
- **`whisper-large-v3` skipped the opening of a test clip.** On a 20-second
  Hinglish sample it deterministically dropped the first 10.5 seconds across
  three runs, while turbo transcribed the whole thing. Turbo is the default for
  that reason. Verify on your own audio before switching.
- **Hinglish proper nouns are imperfect.** Names and uncommon words come back
  approximately ("mere saab se" for "mere hisab se"). Fix them in the caption
  editor.
- **Word timings come from the provider.** Where a provider returns only segment
  timings, per-word timing is interpolated across the segment.
- **ASS export approximates styling.** Font, colour, outline and position carry
  across; per-word animation cannot be represented in the format.
- **Transparent WebM is not universally supported.** It is far smaller than
  ProRes and does carry alpha, but check your editor reads it before committing
  to a long render.
- **Custom fonts need the server running at export time**, since headless Chrome
  fetches them over HTTP from it.
- **The bundle is ~590 KB** (183 KB gzipped), mostly Remotion. Fine locally;
  worth code-splitting before any hosted deployment.
- **Animated previews were verified by test, not by eye.** The automated browser
  used during development did not composite frames, so `requestAnimationFrame`
  never fired in it. The motion engine is covered by tests asserting every
  preset changes over time; give the gallery a look in a real browser.

---

## Future work

Brand Kit, saved custom presets, caption quality checks with one-click fixes,
before/after compare, smart positioning that respects safe zones automatically,
and forced alignment for exact per-word timing.

---

## Controlled Hinglish Vocabulary & Style Guide

Caption Maker includes a **controlled vocabulary system** and **context-aware normalization pipeline** designed specifically for Roman Hindi / Hinglish captions.

Instead of blindly correcting words using standard English grammar, the application strictly adheres to your established vocabulary database and style conventions (e.g. *bahut* not *bohot*, *zyada* not *jyada*, *zaroor* not *jarur*, *chahiye* not *chaiye*, *isliye* not *esliye*, *ekdum* not *ek dam*).

### 1. Where the Vocabulary is Stored
The central vocabulary database is located at:
```
src/core/vocabulary/vocabulary.json
```
It is a single, clean JSON file containing approved spellings, rejected forms, alternatives, usage context, and confidence ratings.

### 2. How to Add a New Approved Word
You can add words either in the Studio UI or by editing the JSON directly:

- **Via Studio UI**: Go to the **Review & QA** tab → click the **Controlled Vocabulary** tab → click **+ Add Word**.
- **Via JSON File**: Open `src/core/vocabulary/vocabulary.json` and add an entry:
```json
{
  "word": "zabardast",
  "approved_form": "zabardast",
  "alternatives": [],
  "rejected_forms": ["jabardast", "zbardaast"],
  "context": "expressive adjective meaning 'terrific/awesome'",
  "examples": ["zabardast video hai"],
  "confidence": 1.0
}
```

### 3. How to Reject a Word
Add the unwanted or incorrect spelling to the `rejected_forms` array of the corresponding approved word in `vocabulary.json`:
```json
{
  "word": "bahut",
  "approved_form": "bahut",
  "alternatives": [],
  "rejected_forms": ["bohot", "bhut", "bhot", "bahuth"]
}
```
Any time Groq or Whisper produces a word in `rejected_forms`, the deterministic validation layer will automatically replace it with the `approved_form`.

### 4. How the 6-Stage Pipeline Works
Every Hinglish caption flows through 6 modular stages:

```
1. RAW TRANSCRIPT           (Tokenized speech stream with Whisper timestamps)
        ↓
2. TEXT CLEANING            (Trimming, Unicode NFC normalization, whitespace cleanup)
        ↓
3. VOCAB NORMALIZATION      (Fast pre-pass: catches unambiguous rejected spellings & context rules)
        ↓
4. GROQ AI PROCESSING       (Contextual pass with llama-3.3-70b-versatile and strict JSON Schema)
        ↓
5. VOCAB VALIDATION         (Deterministic post-pass: checks DB, rejects bad spellings, checks proper nouns)
        ↓
6. FINAL CAPTION            (Synchronized tokens, structured changes log, and human review triage)
```

### 5. Context-Aware Rules (No Blind Replacement)
Context matters for homophones:
- **`main` vs `mein`**: `main` is recognized as the first-person pronoun ("I", e.g., *Main ja raha hoon*), while `mein` is recognized as the locative preposition ("in/inside", e.g., *video mein*, *ghar mein*).
- **`hai` vs `hain`**: `hai` is used for singular subjects (*Ram ghar par hai*), while `hain` is used for plural subjects (*log pareshaan hain*) and honorific respect (*Aap kaise hain?*, *Sir meeting mein hain*).
- **`aur` vs `or`**: `aur` is used for the Hindi conjunction ("and", e.g. *video aur audio*), while English `or` is preserved in English idioms (*yes or no*).

### 6. Where the Groq Model is Configured
The Hinglish cleanup model is configured in your `.env` file:
```bash
GROQ_HINGLISH_MODEL=llama-3.3-70b-versatile
```
**Why `llama-3.3-70b-versatile`?**
- Speed: Generates 250–300+ tokens/second on Groq free tier.
- 128k context window: Handles large transcripts with ease.
- Reliable JSON Schema structured outputs.
- Superior multilingual understanding for Roman Hindi transliteration.
*(Fallback model: `openai/gpt-oss-120b`)*

### 7. Token Efficiency
Instead of sending the entire vocabulary file on every API request, the system scans the input chunk and dynamically retrieves only the matching vocabulary rules for the words spoken in that specific sentence.

### 8. How to Run the Accuracy Test
To run the internal regression evaluation suite:
```bash
npm test tests/vocabularyAccuracy.test.ts
```
This outputs a report measuring:
- **Vocabulary Accuracy**: % of approved vocabulary tokens correctly preserved.
- **Rejected-Word Detection**: % of rejected words caught and converted.
- **Correction Accuracy**: % of corrections matching expected target.
- **Unchanged-Word Accuracy**: % of correct words left untouched (no over-processing).
- **JSON Output Validity**: % of responses adhering strictly to schema.
- **Low-Confidence Rate**: % of tokens appropriately flagged for review.

### 9. How to Add New Test Cases
Open `tests/fixtures/vocabulary-dataset.json` and add a test case to the `cases` array:
```json
{
  "id": "rej-11",
  "category": "rejected",
  "input": "Yeh kaam jarur karna",
  "expected": "Yeh kaam zaroor karna",
  "notes": "Normalizes 'jarur' to 'zaroor'"
}
```

---

## Dual-AI Architecture (Groq + OpenRouter)

Caption Maker implements a resilient Dual-AI Provider architecture designed for high accuracy on Roman Hinglish captions while staying token-efficient on free API limits.

```
                     AUDIO / VIDEO
                          ↓
                     GROQ WHISPER
                          ↓
                    RAW TRANSCRIPT
                          ↓
                  VOCABULARY ENGINE
                          ↓
               PRIMARY GROQ TEXT MODEL
                          ↓
               DETERMINISTIC VALIDATOR
                          ↓
                  CONFIDENCE CHECK
                 /                \
 (Confidence >= 0.88)       (Confidence < 0.88 or Conflict or Groq 429/Timeout)
          ↓                                       ↓
   FINAL CAPTION                       OPENROUTER SECOND OPINION
 (0 extra API calls)                              ↓
                                       MODEL AGREEMENT & ARBITRATION
                                                  ↓
                                            FINAL CAPTION
```

### 1. Configuration in `.env`
```bash
# Primary AI Provider (Groq)
PRIMARY_AI_PROVIDER=groq
PRIMARY_AI_MODEL=openai/gpt-oss-120b
GROQ_API_KEY=gsk_...

# Secondary AI Provider (OpenRouter)
SECONDARY_AI_PROVIDER=openrouter
SECONDARY_AI_MODEL=openrouter/free
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEY=sk-or-v1-...
```

### 2. When OpenRouter Gets Called
OpenRouter is **never** called unnecessarily. This preserves your free OpenRouter quota:
1. **Zero Secondary Calls on High Confidence**: When Groq produces clean, high-confidence (>= 0.88) tokens with zero rejected forms and zero ambiguous conflicts, Groq's output is validated and finalized immediately. OpenRouter is not contacted.
2. **Automatic Resilience Fallback**: If Groq encounters rate limiting (HTTP 429), gateway timeout (504), network failure, or downtime, the orchestrator automatically routes the request to OpenRouter.
3. **Second-Opinion Arbitration**: When Groq returns uncertain words, homophone ambiguities (`main` vs `mein`), or low confidence (< 0.88), OpenRouter is consulted as an independent second opinion.

### 3. How Confidence is Calculated
Confidence is computed in a multi-stage deterministic scoring pass:
* **Base Score**: 1.0 (100%)
* **Uncertain / Low-Phonetic Tokens**: -0.12 per token
* **Rejected Forms Detected**: -0.10 per token
* **Unindexed New Words**: -0.08 per token
* **Primary Model Review Flag**: -0.15
* **Model Agreement Boost**: +0.15 when Groq and OpenRouter independently agree on uncertain words.

### 4. Strict Vocabulary Hierarchy (Cannot Be Overridden)
Even if both AI models hallucinate or return an incorrect spelling, Caption Maker enforces a strict priority hierarchy:
```
PROJECT VOCABULARY RULE > DETERMINISTIC VALIDATOR > MODEL AGREEMENT > PRIMARY AI MODEL > SECONDARY AI MODEL > MODEL GUESS
```
No AI model can ever override an approved word in `src/core/vocabulary/vocabulary.json`.

### 5. Whisper Prompt Enhancement
Groq Whisper imposes an 896-character limit on the transcription prompt. The system injects approved vocabulary hints dynamically:
* Keeps language prompt and domain context first.
* Appends approved vocabulary hints and terminology within available character headroom.
* Strictly clips to 896 characters to prevent provider rejection.

### 6. Side-by-Side Comparison & Benchmarking
* **Live Comparison UI**: Available in the Review Queue under the **Dual-AI & Compare** tab.
* **API Endpoints**:
  * `GET /api/ai/providers/status` - Live health and configuration of both providers.
  * `GET /api/ai/logs` - Recent audit logs (latency, confidence, fallbacks, second-opinions).
  * `POST /api/ai/compare` - Compares Groq and OpenRouter side-by-side on any input sentence.
  * `POST /api/ai/benchmark` - Runs benchmark evaluation across both models.
* **Automated Vitest Suite**:
  ```bash
  npm test tests/ai-orchestrator.test.ts
  ```
