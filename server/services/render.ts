import path from 'node:path';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { CaptionProject, VideoExportFormat } from '../../src/core/types/project';
import { buildScene } from '../../src/core/rendering/scene';
import { resolveExportSpec } from '../../src/core/rendering/exportPresets';
import { compositeOverlay, ffmpegPath, mediaProcessor, muxSourceAudio } from './ffmpeg';
import { compileToAss } from './assCompiler';

export interface RenderRequest {
  project: CaptionProject;
  format: VideoExportFormat;
  outPath: string;
  /**
   * Uploaded fonts with absolute URLs. Headless Chrome has no notion of the
   * app's origin, so a relative /api/fonts path would silently fail and the
   * export would fall back to a system face.
   */
  customFonts?: { family: string; url: string }[];
  /** Absolute HTTP URL so headless Chrome can read the source video. */
  mediaUrl?: string;
  onProgress?: (progress: number, message: string) => void;
  signal?: AbortSignal;
}

export interface RenderProvider {
  render(request: RenderRequest): Promise<string>;
}

const ENTRY = path.resolve('src/remotion/index.ts');

let bundlePromise: Promise<string> | null = null;

/** The bundle is expensive and identical between renders, so build it once. */
const getBundle = (onProgress?: (p: number) => void): Promise<string> => {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: ENTRY,
      onProgress: (p) => onProgress?.(p / 100),
    }).catch((error: unknown) => {
      // let the next attempt rebuild rather than caching the failure
      bundlePromise = null;
      throw error;
    });
  }
  return bundlePromise;
};

const ALPHA_SETTINGS = {
  'mov-alpha': {
    codec: 'prores' as const,
    proResProfile: '4444' as const,
    pixelFormat: 'yuva444p10le' as const,
    imageFormat: 'png' as const,
    ext: '.mov',
  },
  'webm-alpha': {
    codec: 'vp9' as const,
    proResProfile: undefined,
    pixelFormat: 'yuva420p' as const,
    imageFormat: 'png' as const,
    ext: '.webm',
  },
};

const temporarySibling = (outPath: string, label: string, explicitExt?: string): string => {
  const extension = explicitExt ?? path.extname(outPath);
  const stem = path.basename(outPath, path.extname(outPath));
  return path.join(path.dirname(outPath), `${stem}.${label}-${randomUUID()}${extension}`);
};

const verifyOutput = async (
  output: string,
  expected: { width: number; height: number; fps: number; duration: number; hasAudio: boolean },
): Promise<void> => {
  const stat = await fsp.stat(output);
  if (stat.size === 0) throw new Error('The renderer produced an empty file.');

  const actual = await mediaProcessor.probe(output);
  if (actual.kind !== 'video') throw new Error('The rendered file has no playable video track.');
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `The rendered size is ${actual.width ?? '?'}×${actual.height ?? '?'} instead of ` +
        `${expected.width}×${expected.height}.`,
    );
  }

  const tolerance = Math.max(0.35, 3 / expected.fps);
  if (Math.abs(actual.duration - expected.duration) > tolerance) {
    throw new Error(
      `The rendered duration is ${actual.duration.toFixed(2)}s instead of ` +
        `${expected.duration.toFixed(2)}s.`,
    );
  }
  if (expected.hasAudio && !actual.hasAudio) {
    throw new Error('The rendered video is missing its audio track.');
  }
};

export class RemotionRenderProvider implements RenderProvider {
  async render({
    project,
    format,
    outPath,
    customFonts,
    onProgress,
    signal,
  }: RenderRequest): Promise<string> {
    if (project.captions.length === 0) {
      throw new Error('There are no captions to render yet.');
    }

    await fsp.mkdir(path.dirname(outPath), { recursive: true });

    onProgress?.(0.02, 'Preparing the renderer');
    const serveUrl = await getBundle((p) => onProgress?.(p * 0.1, 'Preparing the renderer'));

    const exportSpec = resolveExportSpec(project);
    const hasSourceVideo =
      format === 'mp4' &&
      project.background.mode === 'source' &&
      Boolean(project.media?.path) &&
      project.media?.kind === 'video';

    // When compositing onto source video, render transparent overlay only.
    // Chrome only needs to render HTML/CSS text & boxes (fast, <3s, no video decoding memory spikes).
    const isAlpha = format !== 'mp4' || hasSourceVideo;
    const scene = buildScene(project, {
      mediaSrc: null,
      fps: exportSpec.fps,
      width: exportSpec.width,
      height: exportSpec.height,
      customFonts,
    });
    if (isAlpha) {
      scene.background = { ...scene.background, mode: 'transparent' };
    }

    const inputProps = { scene, preview: false };
    const composition = await selectComposition({
      serveUrl,
      id: 'Captions',
      inputProps,
    });

    const isDirectAlpha = format !== 'mp4';
    const settings = isDirectAlpha ? ALPHA_SETTINGS[format as keyof typeof ALPHA_SETTINGS] : null;
    const tempOverlay = hasSourceVideo ? temporarySibling(outPath, 'overlay', '.mov') : outPath;

    try {
      onProgress?.(
        0.1,
        hasSourceVideo
          ? 'Rendering captions & boxes'
          : isDirectAlpha
            ? 'Rendering transparent captions'
            : 'Rendering high-quality video',
      );

      await renderMedia({
        composition,
        serveUrl,
        codec: hasSourceVideo ? 'prores' : (settings?.codec ?? 'h264'),
        proResProfile: hasSourceVideo ? '4444' : settings?.proResProfile,
        pixelFormat: hasSourceVideo ? 'yuva444p10le' : (settings?.pixelFormat ?? 'yuv420p'),
        imageFormat: 'png',
        outputLocation: tempOverlay,
        inputProps,
        muted: true,
        overwrite: true,
        crf:
          format === 'mp4' && !hasSourceVideo
            ? exportSpec.quality === 'low'
              ? 28
              : exportSpec.quality === 'medium'
                ? 22
                : 16
            : format === 'webm-alpha'
              ? 12
              : undefined,
        x264Preset: format === 'mp4' && !hasSourceVideo ? 'fast' : undefined,
        preferLossless: hasSourceVideo || format === 'mov-alpha',
        cancelSignal: signal
          ? (cancel) => {
              signal.addEventListener('abort', cancel, { once: true });
            }
          : undefined,
        onProgress: ({ progress }) => {
          const base = 0.1;
          const span = hasSourceVideo ? 0.7 : 0.85;
          onProgress?.(
            base + progress * span,
            hasSourceVideo
              ? `Rendering captions & boxes (${Math.round(progress * 100)}%)`
              : 'Rendering video',
          );
        },
      });

      // If compositing onto source video with FFmpeg
      if (hasSourceVideo && project.media?.path) {
        onProgress?.(0.82, 'Burning captions into video');
        await compositeOverlay(
          project.media.path,
          tempOverlay,
          outPath,
          {
            targetWidth: exportSpec.width,
            targetHeight: exportSpec.height,
            sourceAudioCodec: project.media.audioCodec,
            quality: exportSpec.quality,
            signal,
            onProgress: (seconds) => {
              const dur = project.media?.duration || 1;
              const pct = Math.min(0.98, 0.82 + (seconds / dur) * 0.16);
              onProgress?.(pct, `Compositing video (${Math.round(pct * 100)}%)`);
            },
          },
        );
      } else if (format === 'mp4' && project.media?.hasAudio && !hasSourceVideo) {
        // Mux source audio for audio-only / solid background exports
        const muxedPath = temporarySibling(outPath, 'audio');
        await muxSourceAudio(
          tempOverlay,
          project.media.path,
          muxedPath,
          project.media.audioCodec,
          signal,
        );
        await fsp.rename(muxedPath, outPath);
      }

      onProgress?.(1, 'Export complete');
      return outPath;
    } finally {
      if (hasSourceVideo) {
        await fsp.rm(tempOverlay, { force: true }).catch(() => undefined);
      }
    }
  }
}

/**
 * Fast local ASS subtitle burn-in renderer using FFmpeg + libass (Section 8).
 * 10-50x faster on CPU, completely free for commercial company use.
 */
export class FfmpegAssRenderProvider implements RenderProvider {
  async render({
    project,
    format,
    outPath,
    onProgress,
    signal,
  }: RenderRequest): Promise<string> {
    if (project.captions.length === 0) {
      throw new Error('There are no captions to render yet.');
    }

    await fsp.mkdir(path.dirname(outPath), { recursive: true });
    const exportSpec = resolveExportSpec(project);
    const assContent = compileToAss(
      project.captions,
      project.style,
      project.position,
      project.animation,
      {
        width: exportSpec.width,
        height: exportSpec.height,
        fps: exportSpec.fps,
      },
    );

    const tempDir = path.dirname(outPath);
    const assPath = path.join(tempDir, `captions-${randomUUID()}.ass`);
    await fsp.writeFile(assPath, assContent, 'utf8');

    // On Windows, backslashes and colons in ass filter path must be escaped for ffmpeg filter syntax
    const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

    try {
      onProgress?.(0.1, 'Rendering with FFmpeg libass');

      const args: string[] = ['-y'];

      if (format === 'mp4') {
        if (!project.media?.path) {
          throw new Error('No source video found for MP4 export.');
        }
        args.push('-i', project.media.path);
        args.push('-vf', `ass='${escapedAss}'`);
        args.push('-c:v', 'libx264', '-crf', '18', '-preset', 'fast');
        if (project.media.hasAudio) {
          args.push('-c:a', 'copy');
        }
      } else if (format === 'webm-alpha') {
        const duration = project.media?.duration || 10;
        args.push(
          '-f', 'lavfi',
          '-i', `color=c=black@0.0:s=${exportSpec.width}x${exportSpec.height}:r=${exportSpec.fps}:d=${duration}`,
          '-vf', `ass='${escapedAss}'`,
          '-c:v', 'libvpx-vp9',
          '-pix_fmt', 'yuva420p',
          '-b:v', '2M',
        );
      } else {
        // mov-alpha
        const duration = project.media?.duration || 10;
        args.push(
          '-f', 'lavfi',
          '-i', `color=c=black@0.0:s=${exportSpec.width}x${exportSpec.height}:r=${exportSpec.fps}:d=${duration}`,
          '-vf', `ass='${escapedAss}'`,
          '-c:v', 'prores_ks',
          '-profile:v', '4444',
          '-pix_fmt', 'yuva444p10le',
        );
      }

      args.push(outPath);

      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpegPath(), args, { signal });
        let stderr = '';
        child.stderr?.on('data', (d: Buffer) => {
          stderr += d.toString();
          const m = /time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/.exec(stderr);
          if (m && project.media?.duration) {
            const curSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
            const pct = Math.min(0.95, 0.1 + (curSec / project.media.duration) * 0.85);
            onProgress?.(pct, `Rendering video (${Math.round(pct * 100)}%)`);
          }
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg export failed with code ${code}: ${stderr.slice(-300)}`));
        });
      });

      onProgress?.(1, 'Video exported');
      return outPath;
    } finally {
      await fsp.rm(assPath, { force: true }).catch(() => undefined);
    }
  }
}

export const renderProvider: RenderProvider = new RemotionRenderProvider();

export const extensionFor = (format: VideoExportFormat): string =>
  format === 'mp4' ? '.mp4' : ALPHA_SETTINGS[format].ext;
