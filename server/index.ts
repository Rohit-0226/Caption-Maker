// Node / Electron utilityProcess DOMMatrix polyfill for pdfjs or canvas libraries
if (typeof (globalThis as any).DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;
    multiply() { return this; }
    translate() { return this; }
    scale() { return this; }
    rotate() { return this; }
    inverse() { return this; }
    transformPoint(p: any) { return p; }
    toFloat32Array() { return new Float32Array(16); }
    toFloat64Array() { return new Float64Array(16); }
  };
}

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileProjectStore } from './services/projectStore';
import {
  mediaProcessor,
  isWebSafeVideo,
  isWebSafeAudio,
  ensureWebProxy,
  ensureWebAudioProxy,
  getFFmpegStatus,
} from './services/ffmpeg';
import { defaultSettingsStore } from './services/configStore';
import { jobs } from './services/jobs';
import { getProvider, defaultProvider, summarise } from './services/providers/registry';
import { locateHandy } from './services/providers/nemotron';
import { renderProvider, extensionFor } from './services/render';
import { FontStore, fontMime, isFontFile } from './services/fonts';
import {
  listJobs,
  getJob,
  upsertJob,
  deleteJob,
  getCorrections,
  recordCorrection,
  getLexiconCandidates,
  getPromotableCandidates,
  approveLexiconEntry,
  rejectLexiconEntry,
  backupDatabase,
} from './services/db';
import { runCommand, AIError, redact } from './ai/commandService';
import { aiStatus } from './ai/aiClient';
import { runCaptionQA } from '../src/core/captions/qa';
import { extractPdfTerminology } from './services/terminology';
import { translateTranscriptWordsToEnglishWithGroq } from './services/providers/englishTranslation';
import { cleanRomanHinglishWithGroq } from './services/providers/hinglishCleanup';
import { defaultOrchestrator } from './services/ai/orchestrator';
import { defaultVocabularyStore, type VocabularyEntry } from '../src/core/vocabulary/vocabularyStore';
import { VocabularyEvaluator } from '../src/core/vocabulary/evaluator';
import { postProcessText } from '../src/core/transcription/languages';
import {
  ACCEPTED_EXTENSIONS,
  isAccepted,
  safeFileName,
  serveFileWithRanges,
  writeStreamToFile,
} from './services/media';
import { ensureThumbnail } from './services/thumbnails';

import { defaultSegmenter } from '../src/core/segmentation/segmenter';
import { toSrt, toVtt, toAss, validateCaptions } from '../src/core/subtitles/formats';
import { buildScene } from '../src/core/rendering/scene';
import { defaultTerminology } from '../src/core/project/defaults';
import type {
  CaptionProject,
  LanguageCode,
  SubtitleFormat,
  VideoExportFormat,
} from '../src/core/types/project';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CAPTION_MAKER_ROOT?.trim()
  ? path.resolve(process.env.CAPTION_MAKER_ROOT.trim())
  : path.resolve(here, '..');
const DATA_DIR = process.env.CAPTION_MAKER_DATA_DIR && process.env.CAPTION_MAKER_DATA_DIR.trim()
  ? path.resolve(process.env.CAPTION_MAKER_DATA_DIR.trim())
  : ROOT;
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');
const FONTS_DIR = path.join(DATA_DIR, 'fonts');
const PORT = Number(process.env.PORT ?? 5180);
const MAX_REFERENCE_PDF_BYTES = 20 * 1024 * 1024;
// reported by /api/health, so a client can tell this server from one that restarted
const STARTED_AT = new Date().toISOString();

// Ensure persistent storage directories exist
for (const dir of [PROJECTS_DIR, OUTPUT_DIR, FONTS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Minimal .env reader — avoids a dependency for one file we control.
const loadEnv = () => {
  const envFiles = [path.join(ROOT, '.env'), path.join(DATA_DIR, '.env')];
  for (const file of envFiles) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = value;
    }
  }
};

loadEnv();

const store = new FileProjectStore(PROJECTS_DIR);
const fontStore = new FontStore(FONTS_DIR);
const app = express();

app.use(cors());
app.use(express.json({ limit: '64mb' }));

/**
 * Health doubles as the server's identity card. The desktop app and the Web &
 * Share launcher both probe it before starting anything, so whichever opens
 * first owns the dev stack and the other attaches to it instead of fighting
 * over the ports or killing it. `app` tells a real Caption Maker server from
 * any other program on the port; `owner` echoes the tag the starting app put
 * in CM_STACK_OWNER, so that app can recognise its own stack. Folder paths are
 * left out when the request came through the public tunnel (Cloudflare adds
 * these headers): someone using the shared link has no need for them.
 */
app.get('/api/health', (req, res) => {
  const viaTunnel = Boolean(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
  res.json({
    ok: true,
    app: 'caption-maker',
    pid: process.pid,
    startedAt: STARTED_AT,
    port: PORT,
    owner: process.env.CM_STACK_OWNER?.trim() || null,
    ...(viaTunnel ? {} : { root: ROOT, dataDir: DATA_DIR }),
  });
});

/**
 * Express 5 types route params as `string | string[]`, since a pattern can
 * repeat. Ours never do, so narrow once here instead of at every call site.
 */
const param = (req: express.Request, name: string): string => {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
};

/** Wraps an async handler so a rejection becomes a clean 500 instead of a hang. */
const handle =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response) => {
    fn(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unexpected server error';
      // eslint-disable-next-line no-console
      console.error(`[${req.method} ${req.path}]`, message);
      if (!res.headersSent) res.status(500).json({ error: message });
    });
  };

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, acceptedExtensions: ACCEPTED_EXTENSIONS });
});

app.get('/api/providers', (_req, res) => {
  res.json(summarise());
});

// ---------------------------------------------------------------------------
// Settings & Configuration
// ---------------------------------------------------------------------------

app.get('/api/settings', handle(async (_req, res) => {
  const summary = defaultSettingsStore.getSummary();
  const ffmpeg = getFFmpegStatus();
  const handyPath = locateHandy();
  const nemotron = {
    installed: Boolean(handyPath),
    path: handyPath,
    model: 'nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf',
    accelerator: 'Vulkan (NVIDIA GeForce GPU)',
  };
  res.json({
    ...summary,
    ffmpeg,
    nemotron,
  });
}));

app.post('/api/settings', handle(async (req, res) => {
  const { groqApiKey, openRouterApiKey, openaiApiKey, geminiApiKey, geminiModel, defaultProvider, groqWhisperModel } = req.body ?? {};
  await defaultSettingsStore.saveSettings({
    ...(groqApiKey !== undefined ? { groqApiKey } : {}),
    ...(openRouterApiKey !== undefined ? { openRouterApiKey } : {}),
    ...(openaiApiKey !== undefined ? { openaiApiKey } : {}),
    ...(geminiApiKey !== undefined ? { geminiApiKey } : {}),
    ...(geminiModel !== undefined ? { geminiModel } : {}),
    ...(defaultProvider !== undefined ? { defaultProvider } : {}),
    ...(groqWhisperModel !== undefined ? { groqWhisperModel } : {}),
  });
  const summary = defaultSettingsStore.getSummary();
  const ffmpeg = getFFmpegStatus();
  const handyPath = locateHandy();
  const nemotron = {
    installed: Boolean(handyPath),
    path: handyPath,
    model: 'nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf',
    accelerator: 'Vulkan (NVIDIA GeForce GPU)',
  };
  res.json({
    ok: true,
    settings: {
      ...summary,
      ffmpeg,
      nemotron,
    },
  });
}));

app.post('/api/settings/test', handle(async (req, res) => {
  const { provider, apiKey } = req.body ?? {};
  if (!provider || !apiKey) {
    res.status(400).json({ ok: false, message: 'Provider and apiKey are required.' });
    return;
  }
  if (provider === 'groq') {
    const result = await defaultSettingsStore.testGroqKey(apiKey);
    res.json(result);
    return;
  }
  if (provider === 'openrouter') {
    const result = await defaultSettingsStore.testOpenRouterKey(apiKey);
    res.json(result);
    return;
  }
  if (provider === 'gemini') {
    const result = await defaultSettingsStore.testGeminiKey(apiKey);
    res.json(result);
    return;
  }
  res.status(400).json({ ok: false, message: `Unknown provider: ${provider}` });
}));

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

app.get('/api/projects', handle(async (_req, res) => {
  res.json(await store.list());
}));

app.post('/api/projects', handle(async (req, res) => {
  const name = typeof req.body?.name === 'string' && req.body.name.trim()
    ? req.body.name.trim()
    : 'Untitled project';
  res.json(await store.create(name));
}));

app.get('/api/projects/:id', handle(async (req, res) => {
  try {
    res.json(await store.load(param(req, 'id')));
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
  }
}));

app.put('/api/projects/:id', handle(async (req, res) => {
  const incoming = req.body as CaptionProject;
  if (!incoming || incoming.id !== param(req, 'id')) {
    res.status(400).json({ error: 'Project id in the body does not match the URL.' });
    return;
  }
  res.json(await store.save(incoming));
}));

app.delete('/api/projects/:id', handle(async (req, res) => {
  const projectId = param(req, 'id');
  // A transcription can save after it finishes, so cancel project work first
  // or a just-deleted folder could be recreated by an in-flight job.
  for (const job of jobs.listFor(projectId)) {
    if (job.status === 'running') jobs.cancel(job.id);
  }
  await store.remove(projectId);
  res.json({ ok: true });
}));

/** A still frame for the Projects page card; cut once, then served from the project folder. */
app.get('/api/projects/:id/thumbnail', handle(async (req, res) => {
  let project: CaptionProject;
  try {
    project = await store.load(param(req, 'id'));
  } catch (error) {
    res.status(404).json({ error: (error as Error).message });
    return;
  }
  if (!project.media || project.media.kind !== 'video' || !fs.existsSync(project.media.path)) {
    res.status(404).json({ error: 'This project has no video to take a picture from.' });
    return;
  }
  const file = await ensureThumbnail(store.directoryFor(project.id), project.media);
  res.setHeader('Content-Type', 'image/jpeg');
  // the client adds the media version to the URL, so a stale copy is never asked for
  res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(file).pipe(res);
}));

/** Copies a project (media included) under a new id and name. */
app.post('/api/projects/:id/duplicate', handle(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : undefined;
  try {
    res.json(await store.duplicate(param(req, 'id'), name));
  } catch (error) {
    const message = (error as Error).message;
    res.status(/not found/i.test(message) ? 404 : 500).json({ error: message });
  }
}));

// ---------------------------------------------------------------------------
// Studio Jobs, Corrections & Lexicon (Sections 4, 5, 9)
// ---------------------------------------------------------------------------

app.get('/api/jobs', (_req, res) => {
  res.json(listJobs());
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(param(req, 'id'));
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/api/jobs', (req, res) => {
  const job = upsertJob(req.body);
  res.json(job);
});

app.delete('/api/jobs/:id', (req, res) => {
  deleteJob(param(req, 'id'));
  res.json({ ok: true });
});

app.get('/api/corrections', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  res.json(getCorrections(limit));
});

app.post('/api/corrections', (req, res) => {
  const { segment_id, before, after, left_context, right_context, category, editor } = req.body;
  if (!segment_id || !before || !after) {
    return res.status(400).json({ error: 'Missing required correction fields' });
  }
  const id = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  recordCorrection({
    id,
    segment_id,
    before,
    after,
    left_context: left_context || null,
    right_context: right_context || null,
    category: category || 'spelling_script',
    editor: editor || 'Rohit',
    created_at: new Date().toISOString(),
  });
  res.json({ ok: true, id });
});

app.get('/api/lexicon/candidates', (_req, res) => {
  res.json({
    all: getLexiconCandidates(),
    promotable: getPromotableCandidates(),
  });
});

app.post('/api/lexicon/approve', handle(async (req, res) => {
  const { surface_form, approved_by } = req.body;
  if (!surface_form) {
    res.status(400).json({ error: 'Missing surface_form' });
    return;
  }
  await approveLexiconEntry(surface_form, approved_by || 'Owner');
  res.json({ ok: true });
}));

app.post('/api/lexicon/reject', (req, res) => {
  const { surface_form } = req.body;
  if (!surface_form) return res.status(400).json({ error: 'Missing surface_form' });
  rejectLexiconEntry(surface_form);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Controlled Vocabulary System & Candidate Extractor
// ---------------------------------------------------------------------------

const VOCAB_FILE_PATH = path.join(ROOT, 'src', 'core', 'vocabulary', 'vocabulary.json');

app.get('/api/vocabulary', handle(async (_req, res) => {
  if (!fs.existsSync(VOCAB_FILE_PATH)) {
    res.json(defaultVocabularyStore.toJSON());
    return;
  }
  const content = await fsp.readFile(VOCAB_FILE_PATH, 'utf8');
  res.json(JSON.parse(content));
}));

app.post('/api/vocabulary/entry', handle(async (req, res) => {
  const entry = req.body as VocabularyEntry;
  if (!entry || !entry.word || !entry.approved_form) {
    res.status(400).json({ error: 'Entry must include word and approved_form' });
    return;
  }
  defaultVocabularyStore.addEntry(entry);
  await fsp.writeFile(VOCAB_FILE_PATH, JSON.stringify(defaultVocabularyStore.toJSON(), null, 2), 'utf8');
  res.json({ ok: true, entry });
}));

app.delete('/api/vocabulary/entry', handle(async (req, res) => {
  const word = typeof req.body?.word === 'string' ? req.body.word.trim() : '';
  if (!word) {
    res.status(400).json({ error: 'Missing word parameter' });
    return;
  }
  const removed = defaultVocabularyStore.removeEntry(word);
  if (removed) {
    await fsp.writeFile(VOCAB_FILE_PATH, JSON.stringify(defaultVocabularyStore.toJSON(), null, 2), 'utf8');
  }
  res.json({ ok: true, removed });
}));

app.post('/api/vocabulary/extract-candidates', handle(async (req, res) => {
  const captions = Array.isArray(req.body?.captions) ? (req.body.captions as string[]) : [];
  const textCorpus = captions.join(' ');
  const tokens = textCorpus.match(/[\p{L}\p{N}-]+/gu) || [];

  const wordFrequency = new Map<string, { count: number; examples: string[] }>();
  for (const t of tokens) {
    const clean = t.toLowerCase().trim();
    if (clean.length < 3 || /^\d+$/.test(clean)) continue;
    if (defaultVocabularyStore.isApproved(clean) || defaultVocabularyStore.isRejected(clean)) continue;

    const existing = wordFrequency.get(clean) || { count: 0, examples: [] };
    existing.count += 1;
    if (existing.examples.length < 2) {
      const idx = textCorpus.indexOf(t);
      const snippet = textCorpus.slice(Math.max(0, idx - 20), idx + 30).trim();
      existing.examples.push(snippet);
    }
    wordFrequency.set(clean, existing);
  }

  const candidates = Array.from(wordFrequency.entries())
    .map(([word, data]) => ({
      word,
      count: data.count,
      examples: data.examples,
      suggested_form: word,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  res.json({ candidates });
}));

app.post('/api/vocabulary/evaluate', handle(async (_req, res) => {
  const datasetPath = path.join(ROOT, 'tests', 'fixtures', 'vocabulary-dataset.json');
  if (!fs.existsSync(datasetPath)) {
    res.status(404).json({ error: 'Evaluation dataset not found' });
    return;
  }
  const datasetContent = JSON.parse(await fsp.readFile(datasetPath, 'utf8'));
  const evaluator = new VocabularyEvaluator();
  const report = evaluator.evaluateDataset(datasetContent.cases);
  res.json(report);
}));

app.post('/api/backup', handle(async (req, res) => {
  const destDir = req.body?.path || path.join(ROOT, 'data', 'backups');
  const backupFile = await backupDatabase(destDir);
  res.json({ ok: true, backupFile });
}));

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

app.post('/api/projects/:id/media', handle(async (req, res) => {
  const project = await store.load(param(req, 'id'));
  const rawName = String(req.headers['x-file-name'] ?? '');
  const fileName = safeFileName(decodeURIComponent(rawName));

  if (!isAccepted(fileName)) {
    res.status(415).json({
      error: `"${fileName}" is not a supported format. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`,
    });
    return;
  }

  const rawSize = req.headers['x-file-size'] ?? req.headers['content-length'];
  const expectedBytes = rawSize && !isNaN(Number(rawSize)) ? Number(rawSize) : undefined;
  const destination = path.join(store.directoryFor(project.id), 'media', fileName);
  await writeStreamToFile(req, destination, expectedBytes);

  let media;
  try {
    media = await mediaProcessor.probe(destination);
  } catch (error) {
    await fsp.rm(destination, { force: true }).catch(() => undefined);
    res.status(422).json({ error: `Could not read that file: ${(error as Error).message}` });
    return;
  }

  // Remove any stale preview proxy from previous media
  const previewProxyPath = path.join(store.directoryFor(project.id), 'media', 'preview.mp4');
  await fsp.rm(previewProxyPath, { force: true }).catch(() => undefined);

  // If video is not directly web-compatible (e.g. iPhone HEVC/H.265, ProRes, 10-bit H.264, AVI, MKV, WMV),
  // proactively generate a web-safe preview proxy now so the preview player plays instantly.
  if (media.kind === 'video' && !isWebSafeVideo(destination, media.videoCodec, media.pixelFormat)) {
    try {
      await ensureWebProxy(destination, previewProxyPath, {
        videoCodec: media.videoCodec,
        pixelFormat: media.pixelFormat,
      });
    } catch (err) {
      console.warn('[media] Proactive preview proxy generation warning:', err);
    }
  }

  if (!media.hasAudio) {
    // still importable — the user may only want to style captions over it
    // eslint-disable-next-line no-console
    console.warn(`[media] ${fileName} has no audio track`);
  }

  // a new source invalidates the old transcript, captions and cached waveform
  const updated: CaptionProject = {
    ...project,
    media,
    transcript: null,
    captions: [],
    name: project.name === 'Untitled project' ? path.parse(fileName).name : project.name,
  };

  await fsp
    .rm(path.join(store.directoryFor(project.id), 'waveform.json'), { force: true })
    .catch(() => undefined);

  res.json(await store.save(updated));
}));

app.get('/api/projects/:id/media/file', handle(async (req, res) => {
  const project = await store.load(param(req, 'id'));
  if (!project.media) {
    res.status(404).json({ error: 'This project has no media yet.' });
    return;
  }

  // Prevent browsers from serving stale cached media bytes across re-uploads
  res.setHeader('Cache-Control', 'no-cache');

  const projectDir = store.directoryFor(project.id);

  if (project.media.kind === 'audio') {
    // Chrome cannot play WMA, AMR, AIFF and friends, so those get an AAC copy
    // — otherwise an audio-only project previews in silence.
    if (isWebSafeAudio(project.media.path, project.media.audioCodec)) {
      serveFileWithRanges(project.media.path, req, res);
      return;
    }
    try {
      const audioProxy = await ensureWebAudioProxy(
        project.media.path,
        path.join(projectDir, 'media', 'preview-audio.m4a'),
      );
      serveFileWithRanges(audioProxy, req, res);
    } catch (err) {
      console.error('[media] On-demand audio proxy transcode failed:', err);
      res.status(500).json({ error: 'Could not generate a browser-playable preview for this audio.' });
    }
    return;
  }

  if (project.media.kind === 'video') {
    // A source that is itself called preview.mp4 must never be mistaken for
    // its own proxy (Windows paths compare case-insensitively).
    const defaultProxy = path.join(projectDir, 'media', 'preview.mp4');
    const proxyPath =
      path.resolve(defaultProxy).toLowerCase() === path.resolve(project.media.path).toLowerCase()
        ? path.join(projectDir, 'media', 'preview-proxy.mp4')
        : defaultProxy;

    // 1. If web-safe preview proxy exists on disk, serve it
    if (fs.existsSync(proxyPath)) {
      serveFileWithRanges(proxyPath, req, res);
      return;
    }

    // 2. If source video is already web-safe, serve original source
    const isSafe = isWebSafeVideo(
      project.media.path,
      project.media.videoCodec,
      project.media.pixelFormat,
      project.media.audioCodec,
    );
    if (isSafe) {
      serveFileWithRanges(project.media.path, req, res);
      return;
    }

    // 3. Source is not web-safe and proxy has not been created yet:
    // Generate web proxy on-the-fly and serve it.
    // NOTE: Never fall back to serving incompatible MKV/HEVC/MOV to the browser,
    // as browsers will play AAC audio while rendering a black screen.
    try {
      await ensureWebProxy(project.media.path, proxyPath, {
        videoCodec: project.media.videoCodec,
        pixelFormat: project.media.pixelFormat,
      });
      serveFileWithRanges(proxyPath, req, res);
      return;
    } catch (err) {
      console.error('[media] On-demand web proxy transcode failed:', err);
      res.status(500).json({ error: 'Could not generate a browser-playable preview for this video.' });
      return;
    }
  }

  serveFileWithRanges(project.media.path, req, res);
}));

app.get('/api/projects/:id/waveform', handle(async (req, res) => {
  const project = await store.load(param(req, 'id'));
  if (!project.media) {
    res.status(404).json({ error: 'This project has no media yet.' });
    return;
  }
  if (!project.media.hasAudio) {
    res.json({ peaks: [], duration: project.media.duration });
    return;
  }

  // a missing or junk value would otherwise become NaN and an empty waveform
  const requestedBuckets = Math.round(Number(req.query.buckets ?? 1200));
  const buckets = Number.isFinite(requestedBuckets)
    ? Math.min(4000, Math.max(200, requestedBuckets))
    : 1200;
  const cacheFile = path.join(store.directoryFor(project.id), 'waveform.json');

  // The cache is keyed on the source path, its size and the bucket count, so it
  // survives reopening the project but not swapping the media.
  const key = `${project.media.path}:${project.media.size}:${buckets}`;

  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(await fsp.readFile(cacheFile, 'utf8')) as {
        key: string;
        peaks: number[];
      };
      if (cached.key === key) {
        res.json({ peaks: cached.peaks, duration: project.media.duration, cached: true });
        return;
      }
    } catch {
      // regenerate below
    }
  }

  const peaks = await mediaProcessor.waveform(project.media.path, buckets);
  await fsp.writeFile(cacheFile, JSON.stringify({ key, peaks }), 'utf8');
  res.json({ peaks, duration: project.media.duration, cached: false });
}));

// ---------------------------------------------------------------------------
// Client terminology PDF
// ---------------------------------------------------------------------------

app.post('/api/projects/:id/terminology', handle(async (req, res) => {
  const project = await store.load(param(req, 'id'));
  const rawName = String(req.headers['x-file-name'] ?? '');
  const fileName = safeFileName(decodeURIComponent(rawName));

  if (path.extname(fileName).toLowerCase() !== '.pdf') {
    res.status(415).json({ error: 'Upload a PDF document for client terminology.' });
    return;
  }

  const declaredSize = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REFERENCE_PDF_BYTES) {
    res.status(413).json({ error: 'The terminology PDF must be 20 MB or smaller.' });
    return;
  }

  const referenceDir = path.join(store.directoryFor(project.id), 'reference');
  const destination = path.join(referenceDir, fileName);
  const rawSize = req.headers['x-file-size'] ?? req.headers['content-length'];
  const expectedBytes = rawSize && !isNaN(Number(rawSize)) ? Number(rawSize) : undefined;
  const bytes = await writeStreamToFile(req, destination, expectedBytes);

  if (bytes === 0 || bytes > MAX_REFERENCE_PDF_BYTES) {
    await fsp.rm(destination, { force: true }).catch(() => undefined);
    res.status(bytes === 0 ? 400 : 413).json({
      error: bytes === 0 ? 'The uploaded PDF was empty.' : 'The terminology PDF must be 20 MB or smaller.',
    });
    return;
  }

  const handle = await fsp.open(destination, 'r');
  const signature = Buffer.alloc(5);
  try {
    await handle.read(signature, 0, signature.length, 0);
  } finally {
    await handle.close();
  }
  if (signature.toString('ascii') !== '%PDF-') {
    await fsp.rm(destination, { force: true }).catch(() => undefined);
    res.status(422).json({ error: 'That file is not a valid PDF.' });
    return;
  }

  let analysis;
  try {
    analysis = await extractPdfTerminology(destination);
  } catch (error) {
    await fsp.rm(destination, { force: true }).catch(() => undefined);
    res.status(422).json({ error: `Could not read that PDF: ${(error as Error).message}` });
    return;
  }

  if (analysis.extractedCharacterCount < 20) {
    await fsp.rm(destination, { force: true }).catch(() => undefined);
    res.status(422).json({
      error: 'No usable selectable text was found. This may be a scanned PDF; use a text-based or OCR-processed copy.',
    });
    return;
  }

  const previousPath = project.terminology.document?.path;
  const updated = await store.save({
    ...project,
    terminology: {
      document: {
        path: destination,
        fileName,
        size: bytes,
        pageCount: analysis.pageCount,
        extractedCharacterCount: analysis.extractedCharacterCount,
        uploadedAt: new Date().toISOString(),
      },
      terms: analysis.terms,
      rules: analysis.rules,
      transcriptionSample: analysis.transcriptionSample,
    },
  });

  const safeReferenceRoot = `${path.resolve(referenceDir)}${path.sep}`.toLocaleLowerCase('en');
  if (
    previousPath &&
    path.resolve(previousPath) !== path.resolve(destination) &&
    `${path.resolve(previousPath)}`.toLocaleLowerCase('en').startsWith(safeReferenceRoot)
  ) {
    await fsp.rm(previousPath, { force: true }).catch(() => undefined);
  }

  res.json(updated);
}));

app.delete('/api/projects/:id/terminology', handle(async (req, res) => {
  const project = await store.load(param(req, 'id'));
  const referenceDir = path.join(store.directoryFor(project.id), 'reference');
  const documentPath = project.terminology.document?.path;
  const safeReferenceRoot = `${path.resolve(referenceDir)}${path.sep}`.toLocaleLowerCase('en');

  if (
    documentPath &&
    `${path.resolve(documentPath)}`.toLocaleLowerCase('en').startsWith(safeReferenceRoot)
  ) {
    await fsp.rm(documentPath, { force: true }).catch(() => undefined);
  }

  res.json(await store.save({ ...project, terminology: { ...defaultTerminology } }));
}));

// ---------------------------------------------------------------------------
// Custom fonts
// ---------------------------------------------------------------------------

app.get('/api/fonts', handle(async (_req, res) => {
  const records = await fontStore.list();
  res.json(
    records.map((r) => ({ ...r, url: `/api/fonts/${r.id}/file` })),
  );
}));

app.post('/api/fonts', handle(async (req, res) => {
  const rawName = String(req.headers['x-file-name'] ?? '');
  const fileName = decodeURIComponent(rawName);
  const family = req.headers['x-font-family']
    ? decodeURIComponent(String(req.headers['x-font-family']))
    : undefined;

  if (!isFontFile(fileName)) {
    res.status(415).json({
      error: `"${fileName || 'That file'}" is not a font. Upload a .ttf, .otf, .woff or .woff2.`,
    });
    return;
  }

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve());
    req.on('error', reject);
  });

  const bytes = Buffer.concat(chunks);
  if (bytes.length === 0) {
    res.status(400).json({ error: 'The uploaded font was empty.' });
    return;
  }

  try {
    const record = await fontStore.add(fileName, bytes, family);
    res.json({ ...record, url: `/api/fonts/${record.id}/file` });
  } catch (error) {
    res.status(422).json({ error: (error as Error).message });
  }
}));

app.get('/api/fonts/:id/file', (req, res) => {
  const file = fontStore.fileFor(param(req, 'id'));
  if (!file) {
    res.status(404).json({ error: 'That font is no longer stored.' });
    return;
  }
  res.setHeader('Content-Type', fontMime(file));
  // fonts are content-addressed, so they can be cached hard
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Access-Control-Allow-Origin', '*');
  fs.createReadStream(file).pipe(res);
});

app.patch('/api/fonts/:id', handle(async (req, res) => {
  const family = typeof req.body?.family === 'string' ? req.body.family : '';
  const record = await fontStore.rename(param(req, 'id'), family);
  if (!record) {
    res.status(404).json({ error: 'That font is no longer stored.' });
    return;
  }
  res.json({ ...record, url: `/api/fonts/${record.id}/file` });
}));

app.delete('/api/fonts/:id', handle(async (req, res) => {
  await fontStore.remove(param(req, 'id'));
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

app.post('/api/projects/:id/transcribe', handle(async (req, res) => {
  const project = await store.load(param(req, 'id'));

  if (!project.media) {
    res.status(400).json({ error: 'Add a video or audio file first.' });
    return;
  }
  if (!project.media.hasAudio) {
    res.status(400).json({ error: 'That file has no audio track, so there is nothing to transcribe.' });
    return;
  }

  const providerId = typeof req.body?.providerId === 'string' ? req.body.providerId : null;
  const provider = providerId ? getProvider(providerId) : defaultProvider();

  if (!provider) {
    res.status(400).json({ error: `Unknown transcription provider "${providerId}".` });
    return;
  }

  const status = provider.status();
  if (!status.configured) {
    res.status(400).json({ error: status.reason ?? 'That provider is not configured.', code: 'not-configured' });
    return;
  }

  const language = (req.body?.language ?? project.language) as LanguageCode;
  const hinglishDomain = req.body?.hinglishDomain ?? project.hinglishDomain;
  const mediaPath = project.media.path;
  const projectDir = store.directoryFor(project.id);

  const job = jobs.start('transcribe', project.id, async (ctx) => {
    ctx.report(null, 'Extracting audio');
    const audioPath = path.join(projectDir, 'audio.wav');
    await mediaProcessor.extractAudio(mediaPath, audioPath, ctx.signal);

    const started = Date.now();
    const result = await provider.transcribe({
      audioPath,
      language,
      hinglishDomain,
      terminology: project.terminology,
      signal: ctx.signal,
      onProgress: (p) => ctx.report(p.progress, p.message),
    });

    ctx.report(null, 'Building captions');

    // reload rather than closing over stale state — the user may have kept editing
    const latest = await store.load(project.id);
    const captions = defaultSegmenter.segment(result.words, latest.segmentation);

    const saved = await store.save({
      ...latest,
      language,
      ...(hinglishDomain ? { hinglishDomain } : {}),
      transcript: {
        text: result.text,
        words: result.words,
        language,
        detectedLanguage: result.detectedLanguage,
        providerId: provider.id,
        modelId: result.modelId,
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        ...(result.quality ? { quality: result.quality } : {}),
      },
      captions,
    });

    return { wordCount: result.words.length, captionCount: saved.captions.length };
  });

  res.json(job);
}));

/** Re-runs segmentation from the stored transcript — no re-transcription. */
app.post('/api/projects/:id/regenerate', handle(async (req, res) => {
  const project = await store.load(param(req, 'id'));

  if (!project.transcript) {
    res.status(400).json({ error: 'Transcribe the media before generating captions.' });
    return;
  }

  const segmentation = { ...project.segmentation, ...(req.body?.segmentation ?? {}) };
  const captions = defaultSegmenter.segment(project.transcript.words, segmentation);

  res.json(await store.save({ ...project, segmentation, captions }));
}));

/** Translates an existing project's transcript & captions to English or Hinglish using Groq AI. */
app.post('/api/projects/:id/translate', handle(async (req, res) => {
  const project = await store.load(param(req, 'id'));

  if (!project.transcript || !project.transcript.words.length) {
    res.status(400).json({ error: 'Transcribe the media before translating captions.' });
    return;
  }

  const targetLanguage = (req.body?.targetLanguage ?? 'en') as LanguageCode;
  const key = defaultSettingsStore.getGroqKey();

  if (!key) {
    res.status(400).json({
      error: 'No Groq API key available for translation. Open Settings (⚙️) to add your Groq API key.',
      code: 'not-configured',
    });
    return;
  }

  const job = jobs.start('transcribe', project.id, async (ctx) => {
    ctx.report(null, `Translating captions to ${targetLanguage === 'en' ? 'English' : 'Hinglish'} with AI`);

    let translatedWords = project.transcript!.words;

    if (targetLanguage === 'en' || targetLanguage === 'en-IN') {
      translatedWords = await translateTranscriptWordsToEnglishWithGroq({
        sourceWords: project.transcript!.words,
        apiKey: key,
        terms: project.terminology?.terms,
        signal: ctx.signal,
        onProgress: (p, msg) => ctx.report(p, msg),
      });
    } else if (targetLanguage === 'hinglish') {
      const romanizedFallback = project.transcript!.words.map((w) => ({
        ...w,
        text: postProcessText(w.text, 'hinglish'),
      }));
      const cleaned = await cleanRomanHinglishWithGroq({
        sourceWords: project.transcript!.words,
        fallbackWords: romanizedFallback,
        apiKey: key,
        terms: project.terminology?.terms,
        rules: project.terminology?.rules,
        signal: ctx.signal,
      });
      translatedWords = (cleaned ?? romanizedFallback).map((w) => ({
        ...w,
        text: postProcessText(w.text, 'hinglish'),
      }));
    }

    ctx.report(null, 'Rebuilding captions');

    const captions = defaultSegmenter.segment(translatedWords, project.segmentation);
    const saved = await store.save({
      ...project,
      language: targetLanguage,
      transcript: {
        ...project.transcript!,
        text: translatedWords.map((w) => w.text).join(' '),
        words: translatedWords,
        language: targetLanguage,
      },
      captions,
    });

    return { wordCount: translatedWords.length, captionCount: saved.captions.length };
  });

  res.json(job);
}));

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(param(req, 'id'));
  if (!job) {
    res.status(404).json({ error: 'That job has finished and been cleared.' });
    return;
  }
  res.json(job);
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  res.json({ cancelled: jobs.cancel(param(req, 'id')) });
});

/** Server-sent events so the UI can follow progress without polling. */
app.get('/api/jobs-stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;

  for (const state of projectId ? jobs.listFor(projectId) : []) {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  }

  const onUpdate = (state: unknown) => {
    const job = state as { projectId: string };
    if (projectId && job.projectId !== projectId) return;
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };

  jobs.on('update', onUpdate);

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    jobs.off('update', onUpdate);
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

app.post('/api/projects/:id/export/subtitles', handle(async (req, res) => {
  const project = await store.load(param(req, 'id'));
  const format = (req.body?.format ?? 'srt') as SubtitleFormat;

  if (project.captions.length === 0) {
    res.status(400).json({ error: 'There are no captions to export yet.' });
    return;
  }

  const issues = validateCaptions(project.captions);
  if (issues.length > 0) {
    res.status(422).json({
      error: 'Some captions have invalid timings.',
      issues: issues.slice(0, 20),
    });
    return;
  }

  const scene = buildScene(project, { mediaSrc: null });
  const options = { uppercase: project.style.uppercase };

  let body: string;
  let extension: string;

  switch (format) {
    case 'vtt':
      body = toVtt(project.captions, options);
      extension = 'vtt';
      break;
    case 'ass':
      body = toAss(
        project.captions,
        project.style,
        project.position,
        { width: scene.width, height: scene.height },
        options,
      );
      extension = 'ass';
      break;
    case 'json':
      body = JSON.stringify(project, null, 2);
      extension = 'json';
      break;
    default:
      body = toSrt(project.captions, options);
      extension = 'srt';
  }

  const fileName = `${safeFileName(project.name)}.${extension}`;
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  await fsp.writeFile(path.join(OUTPUT_DIR, fileName), body, 'utf8');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  // BOM keeps Hinglish and other non-ASCII text readable in Windows tools
  res.send('﻿' + body);
}));

app.post('/api/projects/:id/export/video', handle(async (req, res) => {
  const project = await store.load(param(req, 'id'));
  const format = (req.body?.format ?? project.exportSettings.videoFormat) as VideoExportFormat;

  if (project.captions.length === 0) {
    res.status(400).json({ error: 'There are no captions to render yet.' });
    return;
  }
  if (format === 'mp4' && !project.media) {
    res.status(400).json({ error: 'Add media before exporting a video.' });
    return;
  }

  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  const fileName = `${safeFileName(project.name)}-${Date.now()}${extensionFor(format)}`;
  const outPath = path.join(OUTPUT_DIR, fileName);

  // headless Chrome needs absolute URLs — it has no notion of the app's origin
  const records = await fontStore.list();
  const origin = `http://localhost:${PORT}`;
  const customFonts = records.map((r) => ({
    family: r.family,
    url: `${origin}/api/fonts/${r.id}/file`,
  }));

  const runningRender = jobs
    .listFor(project.id)
    .find((candidate) => candidate.type === 'render' && candidate.status === 'running');
  if (runningRender) {
    res.status(409).json({ error: 'A video render is already running for this project.' });
    return;
  }

  const job = jobs.start('render', project.id, async (ctx) => {
    await renderProvider.render({
      project,
      format,
      outPath,
      customFonts,
      mediaUrl: `${origin}/api/projects/${encodeURIComponent(project.id)}/media/file`,
      signal: ctx.signal,
      onProgress: (progress, message) => ctx.report(progress, message),
    });
    const stat = await fsp.stat(outPath);
    return { fileName, size: stat.size, url: `/api/output/${encodeURIComponent(fileName)}` };
  });

  res.json(job);
}));

app.get('/api/output/:file', (req, res) => {
  const file = path.join(OUTPUT_DIR, path.basename(param(req, 'file')));
  if (!fs.existsSync(file)) {
    res.status(404).json({ error: 'That export is no longer on disk.' });
    return;
  }
  res.download(file);
});

// ---------------------------------------------------------------------------
// AI Command Center
// ---------------------------------------------------------------------------

app.get('/api/ai/providers/status', (_req, res) => {
  res.json(defaultOrchestrator.getProviderStatuses());
});

app.get('/api/ai/logs', (_req, res) => {
  res.json(defaultOrchestrator.getRecentLogs());
});

app.post('/api/ai/compare', handle(async (req, res) => {
  const text = typeof req.body?.text === 'string'
    ? req.body.text.trim()
    : typeof req.body?.sentence === 'string'
      ? req.body.sentence.trim()
      : '';
  if (!text) {
    res.status(400).json({ error: 'Provide text to compare.' });
    return;
  }
  const properNouns = Array.isArray(req.body?.properNouns) ? req.body.properNouns : [];
  const result = await defaultOrchestrator.compareProviders(text, properNouns);
  res.json(result);
}));

app.post('/api/ai/benchmark', handle(async (req, res) => {
  let cases = req.body?.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    const datasetPath = path.join(ROOT, 'tests', 'fixtures', 'vocabulary-dataset.json');
    if (fs.existsSync(datasetPath)) {
      const parsed = JSON.parse(await fsp.readFile(datasetPath, 'utf8'));
      cases = parsed.cases?.slice(0, 15);
    }
  }
  const result = await defaultOrchestrator.benchmarkProviders(cases || []);
  res.json(result);
}));

app.get('/api/ai/status', (_req, res) => {
  const status = aiStatus();
  // the key itself never leaves the server, only whether one is usable
  res.json({
    configured: status.configured,
    provider: status.provider,
    model: status.model,
    reason: status.reason,
  });
});

app.post('/api/projects/:id/ai/command', handle(async (req, res) => {
  let project: CaptionProject;
  if (req.body?.project && typeof req.body.project === 'object' && Array.isArray(req.body.project.captions)) {
    project = req.body.project as CaptionProject;
  } else {
    project = await store.load(param(req, 'id'));
  }

  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    res.status(400).json({ error: 'Say what you would like changed.' });
    return;
  }
  if (prompt.length > 2000) {
    res.status(400).json({ error: 'That request is too long. Try a shorter one.' });
    return;
  }

  const selectedCaptionIds: string[] = Array.isArray(req.body?.selectedCaptionIds)
    ? req.body.selectedCaptionIds.filter((v: unknown) => typeof v === 'string').slice(0, 200)
    : [];
  const playheadSeconds = Number.isFinite(req.body?.playheadSeconds)
    ? Number(req.body.playheadSeconds)
    : 0;

  try {
    const result = await runCommand(project, prompt, { selectedCaptionIds, playheadSeconds });

    // The changed project is returned for preview only. Nothing is written to
    // disk until the client applies it and saves, so Cancel truly cancels.
    res.json({
      reply: result.reply,
      changes: result.changes,
      rejected: result.rejected,
      actions: result.actions,
      project: result.project,
      qa: result.qa,
      model: result.model,
    });
  } catch (error) {
    const err = error as AIError;
    const status =
      err.code === 'not-configured' ? 400 : err.code === 'timeout' ? 504 : 502;
    // eslint-disable-next-line no-console
    console.error('[ai]', redact(err.message ?? 'unknown'));
    res.status(status).json({
      error: redact(err.message ?? 'The assistant failed.'),
      code: err.code ?? 'provider-error',
      retryable: err.retryable ?? true,
    });
  }
}));

app.post('/api/projects/:id/qa', handle(async (req, res) => {
  const project = await store.load(param(req, 'id'));
  const records = await fontStore.list();
  res.json(
    runCaptionQA(project, {
      safeZone: req.body?.safeZone,
      customFonts: records.map((r) => r.family),
    }),
  );
}));

// ---------------------------------------------------------------------------
// Static Assets (Production / Packaged Desktop App)
// ---------------------------------------------------------------------------

const PUBLIC_FONTS_DIR = path.join(ROOT, 'public', 'fonts');
if (fs.existsSync(PUBLIC_FONTS_DIR)) {
  app.use('/fonts', express.static(PUBLIC_FONTS_DIR));
}

const DIST_DIR = path.join(ROOT, 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/media/') ||
      req.path.startsWith('/output/') ||
      req.path.startsWith('/fonts/')
    ) {
      return next();
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

// ---------------------------------------------------------------------------

/** This machine's LAN IPv4 addresses (Wi-Fi / Ethernet), so the start-up line is never stale. */
const lanAddresses = (): string[] =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => Boolean(a) && a!.family === 'IPv4' && !a!.internal)
    .map((a) => a.address)
    .filter((ip) => !ip.startsWith('169.254.'));

const server = app.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddresses();
  // eslint-disable-next-line no-console
  console.log(
    `Caption Maker server listening on http://localhost:${PORT}` +
      (lan.length ? ` and LAN ${lan.map((ip) => `http://${ip}:${PORT}`).join(', ')}` : ''),
  );
  const ai = aiStatus();
  console.log(`  ${ai.configured ? '✓' : '·'} AI · ${ai.provider} · ${ai.model}${ai.configured ? '' : ` — ${ai.reason}`}`);
  const providers = summarise();
  for (const p of providers) {
    // eslint-disable-next-line no-console
    console.log(`  ${p.configured ? '✓' : '·'} ${p.label}${p.configured ? '' : ` — ${p.reason}`}`);
  }
});

// Configure server timeouts to prevent premature socket closure during large video uploads over LAN / Wi-Fi
server.requestTimeout = 0; // Disable automatic 5-minute request kill
server.headersTimeout = 65000;
server.keepAliveTimeout = 61000;
