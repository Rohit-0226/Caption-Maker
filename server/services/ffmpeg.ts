import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { MediaInfo, MediaKind } from '../../src/core/types/project';
import { AUDIO_EXTENSIONS } from './media';

// ---------------------------------------------------------------------------
// Locating the binaries
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');

const WINGET_FFMPEG = path.join(
  os.homedir(),
  'AppData/Local/Microsoft/WinGet/Links',
);

const candidates = (bin: string): string[] => {
  const exe = process.platform === 'win32' ? `${bin}.exe` : bin;
  const explicit = process.env[`${bin.toUpperCase()}_PATH`];
  const resourcesDir = (process as any).resourcesPath || process.env.RESOURCES_PATH;
  const dataDir = process.env.CAPTION_MAKER_DATA_DIR;

  return [
    ...(explicit ? [explicit] : []),
    ...(resourcesDir ? [path.join(resourcesDir, 'bin', exe)] : []),
    ...(dataDir ? [path.join(dataDir, 'bin', exe)] : []),
    path.join(ROOT, 'bin', exe),
    exe, // on PATH
    path.join(WINGET_FFMPEG, exe),
  ];
};

const probeBinary = (candidate: string): boolean => {
  try {
    const result = spawn(candidate, ['-version']);
    result.kill();
    return true;
  } catch {
    return false;
  }
};

let cachedFfmpeg: string | null = null;
let cachedFfprobe: string | null = null;

const resolveBinary = (bin: 'ffmpeg' | 'ffprobe'): string => {
  const cached = bin === 'ffmpeg' ? cachedFfmpeg : cachedFfprobe;
  if (cached) return cached;

  for (const candidate of candidates(bin)) {
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
    if (probeBinary(candidate)) {
      if (bin === 'ffmpeg') cachedFfmpeg = candidate;
      else cachedFfprobe = candidate;
      return candidate;
    }
  }

  throw new Error(
    `${bin} was not found. Install it with "winget install Gyan.FFmpeg" and restart the server, or set ${bin.toUpperCase()}_PATH.`,
  );
};

export const ffmpegPath = () => resolveBinary('ffmpeg');
export const ffprobePath = () => resolveBinary('ffprobe');

export interface FFmpegStatus {
  installed: boolean;
  path?: string;
  version?: string;
}

export const getFFmpegStatus = (): FFmpegStatus => {
  try {
    const bin = resolveBinary('ffmpeg');
    return {
      installed: true,
      path: bin,
      version: 'Ready',
    };
  } catch {
    return {
      installed: false,
    };
  }
};

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

interface RunOptions {
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}

const run = (bin: string, args: string[], options: RunOptions = {}): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { signal: options.signal });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on('data', (c: Buffer) => {
      const text = c.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(bin)} exited ${code}\n${stderr.slice(-1500)}`));
    });
  });

// ---------------------------------------------------------------------------
// MediaProcessor
// ---------------------------------------------------------------------------

export interface MediaProcessor {
  probe(filePath: string): Promise<MediaInfo>;
  extractAudio(filePath: string, outPath: string, signal?: AbortSignal): Promise<string>;
  waveform(filePath: string, buckets: number): Promise<number[]>;
}

interface FfprobeStream {
  codec_type: 'video' | 'audio' | string;
  codec_name?: string;
  pix_fmt?: string;
  profile?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  disposition?: Record<string, number | boolean>;
  duration?: string;
  tags?: Record<string, unknown>;
  side_data_list?: Array<Record<string, unknown>>;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; size?: string };
}

const parseFrameRate = (value: string | undefined): number | null => {
  if (!value) return null;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : null;
};

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

const aspectRatio = (w: number | null, h: number | null): string | null => {
  if (!w || !h) return null;
  const d = gcd(w, h) || 1;
  return `${w / d}:${h / d}`;
};

const getRotation = (stream?: FfprobeStream): number => {
  if (!stream) return 0;
  if (stream.side_data_list) {
    for (const item of stream.side_data_list) {
      if (typeof item.rotation === 'number') return item.rotation;
      if (typeof item.rotation === 'string') {
        const val = parseInt(item.rotation, 10);
        if (Number.isFinite(val)) return val;
      }
    }
  }
  if (stream.tags?.rotate !== undefined) {
    const val =
      typeof stream.tags.rotate === 'number'
        ? stream.tags.rotate
        : parseInt(String(stream.tags.rotate), 10);
    if (Number.isFinite(val)) return val;
  }
  return 0;
};

export class FfmpegMediaProcessor implements MediaProcessor {
  async probe(filePath: string): Promise<MediaInfo> {
    const stat = await fsp.stat(filePath);

    const raw = await run(ffprobePath(), [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    const parsed = JSON.parse(raw) as FfprobeOutput;
    const streams = parsed.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');

    const isAudioExt = AUDIO_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
    const isCoverArt = Boolean(
      video?.disposition?.attached_pic ||
      video?.disposition?.still_image ||
      isAudioExt,
    );

    // If an audio file has an embedded album art video stream, treat it as audio-only.
    // If it is a video file, it must have real dimensions (> 0) and not be an attached picture.
    const isRealVideo = Boolean(
      video &&
      !isCoverArt &&
      typeof video.width === 'number' &&
      video.width > 0 &&
      typeof video.height === 'number' &&
      video.height > 0,
    );
    const kind: MediaKind = isRealVideo ? 'video' : 'audio';

    const duration = Number(parsed.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Could not read a duration from this file — it may be corrupt.');
    }

    const rawWidth = isRealVideo ? video?.width ?? null : null;
    const rawHeight = isRealVideo ? video?.height ?? null : null;
    const rotation = isRealVideo ? getRotation(video) : 0;
    const isRotated90 = Math.abs(rotation % 180) === 90;
    const width = isRotated90 ? rawHeight : rawWidth;
    const height = isRotated90 ? rawWidth : rawHeight;

    const parsedFps = isRealVideo
      ? (parseFrameRate(video?.avg_frame_rate) ?? parseFrameRate(video?.r_frame_rate) ?? 30)
      : null;

    const isWebCompatible = isRealVideo
      ? isWebSafeVideo(filePath, video?.codec_name, video?.pix_fmt, audio?.codec_name)
      : true;

    return {
      path: filePath,
      fileName: path.basename(filePath),
      kind,
      size: stat.size,
      duration,
      hasAudio: Boolean(audio),
      width,
      height,
      fps: parsedFps,
      aspectRatio: aspectRatio(width, height),
      videoCodec: isRealVideo ? video?.codec_name ?? null : null,
      audioCodec: audio?.codec_name ?? null,
      pixelFormat: isRealVideo ? video?.pix_fmt ?? null : null,
      isWebCompatible,
      importedAt: new Date().toISOString(),
    };
  }

  /** 16 kHz mono WAV with speech bandpass filtering and loudness normalization for Whisper accuracy. */
  async extractAudio(filePath: string, outPath: string, signal?: AbortSignal): Promise<string> {
    await fsp.mkdir(path.dirname(outPath), { recursive: true });

    // Speech-optimised audio filter:
    // 1. highpass=f=80 strips mic pops, air conditioning and desk rumble
    // 2. lowpass=f=7500 strips high-frequency hiss outside human speech
    // 3. loudnorm=I=-16:TP=-1.5:LRA=11 normalises speech volume so quiet syllables are clearly audible to Whisper
    const filterArgs = [
      '-y',
      '-i', filePath,
      '-vn',
      '-af', 'highpass=f=80,lowpass=f=7500,loudnorm=I=-16:TP=-1.5:LRA=11',
      '-ac', '1',
      '-ar', '16000',
      '-acodec', 'pcm_s16le',
      outPath,
    ];

    try {
      await run(ffmpegPath(), filterArgs, { signal });
      return outPath;
    } catch {
      // If complex filter fails on an unconventional audio stream, fall back to basic extraction
      await run(
        ffmpegPath(),
        [
          '-y',
          '-i', filePath,
          '-vn',
          '-ac', '1',
          '-ar', '16000',
          '-acodec', 'pcm_s16le',
          outPath,
        ],
        { signal },
      );
      return outPath;
    }
  }

  /**
   * Peak amplitudes for the timeline, normalised to 0..1.
   * Decodes to raw 16-bit PCM and reduces to `buckets` maxima.
   */
  async waveform(filePath: string, buckets: number): Promise<number[]> {
    const bin = ffmpegPath();

    const samples = await new Promise<Int16Array>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const child = spawn(bin, [
        '-i', filePath,
        '-vn',
        '-ac', '1',
        '-ar', '8000',
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-',
      ]);
      child.stdout.on('data', (c: Buffer) => chunks.push(c));
      child.stderr.on('data', () => {});
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error('ffmpeg failed while reading audio'));
        const buf = Buffer.concat(chunks);
        // guard against an odd trailing byte
        const usable = buf.length - (buf.length % 2);
        resolve(new Int16Array(buf.buffer, buf.byteOffset, usable / 2));
      });
    });

    if (samples.length === 0) return new Array(buckets).fill(0);

    const perBucket = Math.max(1, Math.floor(samples.length / buckets));
    const peaks: number[] = [];

    for (let b = 0; b < buckets; b++) {
      const start = b * perBucket;
      const end = Math.min(start + perBucket, samples.length);
      let peak = 0;
      for (let i = start; i < end; i++) {
        const v = Math.abs(samples[i]);
        if (v > peak) peak = v;
      }
      peaks.push(peak / 32768);
    }

    const max = Math.max(...peaks, 0.0001);
    return peaks.map((p) => Math.min(1, p / max));
  }
}

export const mediaProcessor = new FfmpegMediaProcessor();

/**
 * Attach the original source audio after Remotion has rendered the picture.
 * AAC can be copied byte-for-byte into MP4. Other codecs are converted at a
 * high bitrate so exports remain broadly playable without needlessly reducing
 * the quality of already-compatible audio.
 */
export const muxSourceAudio = async (
  silentVideo: string,
  sourceMedia: string,
  outPath: string,
  sourceAudioCodec: string | null,
  signal?: AbortSignal,
): Promise<string> => {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });

  const audioArgs =
    sourceAudioCodec?.toLowerCase() === 'aac'
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '320k'];

  await run(
    ffmpegPath(),
    [
      '-y',
      '-i', silentVideo,
      '-i', sourceMedia,
      '-map', '0:v:0',
      '-map', '1:a:0?',
      '-map_metadata', '1',
      '-c:v', 'copy',
      ...audioArgs,
      '-movflags', '+faststart',
      outPath,
    ],
    { signal },
  );

  return outPath;
};

export interface CompositeOptions {
  targetWidth?: number;
  targetHeight?: number;
  sourceAudioCodec?: string | null;
  quality?: 'high' | 'medium' | 'low';
  onProgress?: (seconds: number) => void;
  signal?: AbortSignal;
}

/** Burn a rendered alpha overlay onto the source video with resolution safety and audio preservation. */
export const compositeOverlay = async (
  sourceVideo: string,
  overlay: string,
  outPath: string,
  options: CompositeOptions = {},
): Promise<string> => {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });

  const crf = options.quality === 'low' ? '28' : options.quality === 'medium' ? '22' : '16';
  const audioArgs =
    options.sourceAudioCodec?.toLowerCase() === 'aac'
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '256k'];

  let filterComplex: string;
  if (options.targetWidth && options.targetHeight) {
    const tw = options.targetWidth;
    const th = options.targetHeight;
    filterComplex = `[0:v]scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2,setsar=1[base];[base][1:v]overlay=0:0:format=auto[out]`;
  } else {
    filterComplex = '[0:v][1:v]overlay=0:0:format=auto[out]';
  }

  await run(
    ffmpegPath(),
    [
      '-y',
      '-i', sourceVideo,
      '-i', overlay,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', crf,
      '-pix_fmt', 'yuv420p',
      ...audioArgs,
      '-movflags', '+faststart',
      outPath,
    ],
    {
      signal: options.signal,
      onStderr: (chunk) => {
        const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(chunk);
        if (m && options.onProgress) {
          options.onProgress(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
        }
      },
    },
  );

  return outPath;
};

/** Audio codecs every browser the editor targets can decode inside MP4/WebM. */
const WEB_SAFE_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

/**
 * Determines whether a video format is guaranteed to decode and display in modern
 * desktop and mobile web browsers without codec incompatibility / black screen errors.
 */
export const isWebSafeVideo = (
  filePath: string,
  videoCodec?: string | null,
  pixelFormat?: string | null,
  audioCodec?: string | null,
): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  const codec = (videoCodec ?? '').toLowerCase().trim();
  const pix = (pixelFormat ?? '').toLowerCase().trim();

  // Container checks: only MP4, M4V, and WebM are natively playable in modern HTML5 <video>
  // QuickTime MOV and containers like AVI, WMV, MKV, FLV, TS cannot be rendered reliably.
  if (ext !== '.mp4' && ext !== '.m4v' && ext !== '.webm') {
    return false;
  }

  // A picture the browser can decode is not enough: an MP4 carrying AC-3,
  // E-AC-3, DTS or PCM sound plays silently in Chrome, so the preview looked
  // fine but had no audio to judge caption timing by. Those go through the
  // proxy too, which keeps the picture (stream copy for H.264) and converts
  // the sound to AAC. Unknown (absent) audio is not held against the file.
  const audio = (audioCodec ?? '').toLowerCase().trim();
  if (audio && !WEB_SAFE_AUDIO_CODECS.has(audio)) {
    return false;
  }

  // H.264 / AVC1 in MP4/M4V
  if (codec === 'h264' || codec === 'avc1') {
    // Chrome and HTML5 <video> only support 8-bit 4:2:0 chroma (yuv420p or yuvj420p).
    // High 10-bit profile (yuv420p10le), 4:2:2, or 4:4:4 fail in Chrome.
    if (pix && !['yuv420p', 'yuvj420p'].includes(pix)) {
      return false;
    }
    return ext === '.mp4' || ext === '.m4v';
  }

  // VP8 / VP9 in WebM
  if ((codec === 'vp8' || codec === 'vp9') && ext === '.webm') {
    return true;
  }

  // AV1 in MP4 or WebM
  if (codec === 'av1' || codec === 'av01') {
    return ext === '.mp4' || ext === '.webm';
  }

  // Any other codec (hevc/h265, prores, dnxhd, mpeg4, msmpeg4, etc.) is NOT safe in browser
  return false;
};

export interface WebProxyOptions {
  signal?: AbortSignal;
  videoCodec?: string | null;
  pixelFormat?: string | null;
}

/**
 * Transcodes or remuxes an incompatible video (e.g. MKV, MOV, HEVC/H.265, ProRes, 10-bit H.264, AVI, WMV)
 * into a lightweight, fast-loading, 100% web-safe H.264 / AAC MP4 proxy with faststart.
 */
export const transcodeWebProxy = async (
  inputPath: string,
  outputPath: string,
  options?: WebProxyOptions | AbortSignal,
): Promise<string> => {
  const opts: WebProxyOptions =
    options instanceof AbortSignal ? { signal: options } : options ?? {};
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  // FAST PATH: Stream-copy remux
  // If the video is already standard 8-bit H.264 (e.g. inside an MKV, MOV, or AVI container),
  // we do not need to re-encode video frames. We can copy the video stream directly into MP4
  // and transcode/copy audio to AAC. This completes in < 1 second!
  const isH264 = opts.videoCodec === 'h264' || opts.videoCodec === 'avc1';
  const is8BitYuv =
    !opts.pixelFormat || ['yuv420p', 'yuvj420p'].includes(opts.pixelFormat.toLowerCase());

  if (isH264 && is8BitYuv) {
    try {
      await run(
        ffmpegPath(),
        [
          '-y',
          '-i', inputPath,
          '-map', '0:v:0',
          '-map', '0:a:0?',
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ac', '2',
          '-movflags', '+faststart',
          outputPath,
        ],
        { signal: opts.signal },
      );
      return outputPath;
    } catch {
      // If stream-copy fails (e.g. incompatible bitstream filters), fall through to transcode
    }
  }

  // ULTRAFAST PROXY TRANSCODE:
  // Downscale to max 720p (1280px wide) with bilinear scaling for blazing speed,
  // ensure even dimensions, ultrafast preset + fastdecode tune, CRF 23 for crisp clarity.
  // AAC 2-channel 48kHz audio. +faststart puts moov atom at the front for immediate byte streaming.
  await run(
    ffmpegPath(),
    [
      '-y',
      '-i', inputPath,
      '-vf', 'scale=min(1280\\,iw):-2:flags=bilinear,pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-tune', 'fastdecode',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      outputPath,
    ],
    { signal: opts.signal },
  );

  return outputPath;
};

const activeProxies = new Map<string, Promise<string>>();

/**
 * Builds `proxyPath` once with `make`, writing to a temporary file first so a
 * half-written proxy is never served. Concurrent callers (the browser fires
 * several range requests at once) share a single job.
 */
const ensureProxy = async (
  proxyPath: string,
  make: (tempPath: string) => Promise<unknown>,
): Promise<string> => {
  if (fs.existsSync(proxyPath)) return proxyPath;

  const existing = activeProxies.get(proxyPath);
  if (existing) return existing;

  const promise = (async () => {
    const ext = path.extname(proxyPath) || '.mp4';
    const tempPath = `${proxyPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
    try {
      await make(tempPath);
      await fsp.rename(tempPath, proxyPath);
      return proxyPath;
    } catch (err) {
      await fsp.rm(tempPath, { force: true }).catch(() => undefined);
      throw err;
    } finally {
      activeProxies.delete(proxyPath);
    }
  })();

  activeProxies.set(proxyPath, promise);
  return promise;
};

/**
 * Ensures a web-safe preview proxy exists on disk. If already transcoded, returns immediately.
 * If concurrently requested by multiple range requests, deduplicates to a single transcode job.
 */
export const ensureWebProxy = async (
  inputPath: string,
  proxyPath: string,
  options?: WebProxyOptions | AbortSignal,
): Promise<string> =>
  ensureProxy(proxyPath, (tempPath) => transcodeWebProxy(inputPath, tempPath, options));

/** Containers an <audio> element plays directly, whatever the browser. */
const WEB_SAFE_AUDIO_EXTENSIONS = new Set([
  '.mp3', '.m4a', '.m4b', '.aac', '.ogg', '.oga', '.opus', '.flac', '.wav', '.mp4', '.webm',
]);

/**
 * Whether an audio-only source can go straight to the browser. WMA, AMR (old
 * Android voice notes), AIFF, AC-3 and ADPCM WAV cannot — the preview would
 * be silent with the captions running over nothing.
 */
export const isWebSafeAudio = (filePath: string, audioCodec?: string | null): boolean => {
  const ext = path.extname(filePath).toLowerCase();
  if (!WEB_SAFE_AUDIO_EXTENSIONS.has(ext)) return false;

  const codec = (audioCodec ?? '').toLowerCase().trim();
  if (!codec) return true;
  if (WEB_SAFE_AUDIO_CODECS.has(codec)) return true;
  // plain integer or float PCM in WAV is fine; ADPCM and friends are not
  return ext === '.wav' && /^pcm_(u8|s16le|s24le|s32le|f32le)$/.test(codec);
};

/** An AAC copy of an audio source the browser cannot play, for the preview only. */
export const ensureWebAudioProxy = async (
  inputPath: string,
  proxyPath: string,
  signal?: AbortSignal,
): Promise<string> =>
  ensureProxy(proxyPath, (tempPath) =>
    run(
      ffmpegPath(),
      [
        '-y',
        '-i', inputPath,
        '-vn',
        '-map', '0:a:0',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ac', '2',
        '-movflags', '+faststart',
        tempPath,
      ],
      { signal },
    ),
  );

