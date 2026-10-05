# Architectural Decisions

This document records deliberate design and technical decisions made within the non-negotiable constraints of the Hinglish Caption Studio build specification.

---

## 1. Database Layer: Node 24 Built-in `node:sqlite`
- **Choice**: `import { DatabaseSync } from 'node:sqlite'`
- **Rationale**: Node v24 includes native SQLite3 directly in the runtime. No compilation step on Windows, no external binary dependencies (e.g. better-sqlite3 build failures on Windows with Python/msvs), and zero recurring cost.
- **Configuration**: Running in WAL mode (`PRAGMA journal_mode = WAL;`) with synchronous NORMAL for fast concurrent editor access on a single local PC.

---

## 2. Rendering Engine: FFmpeg + libass Burn-in
- **Choice**: Compiling caption styles and word timings to `.ass` (Advanced SubStation Alpha) and burning with `ffmpeg -vf "ass=captions.ass"`.
- **Rationale**: Section 8 explicitly requires zero company license encumbrance (Remotion company license requires paid subscription). FFmpeg with libass is already installed on the system, renders 10-50x faster on CPU than canvas/headless browser renders, supports karaoke tags (`\k`), position (`\pos`), fade (`\fad`), and exports burned-in MP4, SRT, ASS, and transparent WebM (VP9).

---

## 3. Visual Script Classification as First-Class UI
- **Choice**: Word tokens in the segment list are tagged with `script: 'en' | 'hi' | 'num' | 'punct'`.
- **Rationale**: Section 1 & 6.1: The primary problem in Hinglish subtitle editing is misclassified English loanwords appearing as corrupted transliterations (e.g. "velkam" instead of "welcome"). By coloring English words in `--script-en` (`#79A9F5`) and romanised Hindi in `--script-hi` (`#E5A93C`), editors detect classification mistakes at a glance without listening to audio.

---

## 4. Protected Terms & Integrity Assertion
- **Choice**: Load `data/protected_terms.json`. Any protected term present at pipeline input must remain present and correctly spelled at output, verified by `assertProtectedTermsIntegrity`.
- **Rationale**: Protects brand names, creator tools, and technical terms from being erroneously romanised or altered during transliteration runs.

---

## 5. Corrections and Lexicon Promotion Loop
- **Choice**: Derived via word-level diffing of `pipeline_output` against `final_text`.
- **Promotion Gate**: Requires 3+ occurrences across 2+ distinct editors before surfacing for owner approval. No automatic promotion to prevent lexicon poisoning.

