import { describe, expect, it } from 'vitest';
import { parseByteRange } from '../server/services/media';
import { isWebSafeAudio, isWebSafeVideo } from '../server/services/ffmpeg';
import { captionAt, previewFps } from '../src/app/playbackClock';
import { buildScene } from '../src/core/rendering/scene';
import { createProject } from '../src/core/project/defaults';
import type { Caption, CaptionProject, MediaInfo } from '../src/core/types/project';

describe('reading a Range header', () => {
  const size = 1000;

  it('serves an open-ended range to the last byte', () => {
    expect(parseByteRange('bytes=0-', size)).toEqual({ start: 0, end: 999 });
    expect(parseByteRange('bytes=500-', size)).toEqual({ start: 500, end: 999 });
  });

  it('serves a closed range as asked', () => {
    expect(parseByteRange('bytes=0-1', size)).toEqual({ start: 0, end: 1 });
    expect(parseByteRange('bytes=10-19', size)).toEqual({ start: 10, end: 19 });
  });

  it('serves a suffix range from the end of the file, not the start', () => {
    expect(parseByteRange('bytes=-100', size)).toEqual({ start: 900, end: 999 });
    // asking for more than there is means the whole file
    expect(parseByteRange('bytes=-5000', size)).toEqual({ start: 0, end: 999 });
  });

  it('clamps an end past the last byte instead of refusing', () => {
    expect(parseByteRange('bytes=0-99999', size)).toEqual({ start: 0, end: 999 });
  });

  it('refuses a start past the end', () => {
    expect(parseByteRange('bytes=1000-', size)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', size)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable');
  });

  it('ignores headers it cannot use, so the whole file is sent', () => {
    expect(parseByteRange('items=0-5', size)).toBeNull();
    expect(parseByteRange('bytes=-', size)).toBeNull();
    expect(parseByteRange('bytes=50-10', size)).toBeNull();
  });

  it('honours the first range of a multi-range request', () => {
    expect(parseByteRange('bytes=0-9, 20-29', size)).toEqual({ start: 0, end: 9 });
  });
});

describe('deciding what the preview can play directly', () => {
  it('sends sound the browser cannot decode through the proxy', () => {
    expect(isWebSafeVideo('clip.mp4', 'h264', 'yuv420p', 'aac')).toBe(true);
    expect(isWebSafeVideo('clip.mp4', 'h264', 'yuv420p', 'mp3')).toBe(true);
    expect(isWebSafeVideo('clip.webm', 'vp9', 'yuv420p', 'opus')).toBe(true);
    expect(isWebSafeVideo('clip.mp4', 'h264', 'yuv420p', 'ac3')).toBe(false);
    expect(isWebSafeVideo('clip.mp4', 'h264', 'yuv420p', 'pcm_s16le')).toBe(false);
  });

  it('does not hold a missing audio track against a video', () => {
    expect(isWebSafeVideo('clip.mp4', 'h264', 'yuv420p', null)).toBe(true);
    expect(isWebSafeVideo('clip.mp4', 'h264', 'yuv420p')).toBe(true);
  });

  it('plays common audio files directly', () => {
    expect(isWebSafeAudio('voice.mp3', 'mp3')).toBe(true);
    expect(isWebSafeAudio('memo.m4a', 'aac')).toBe(true);
    expect(isWebSafeAudio('take.wav', 'pcm_s16le')).toBe(true);
    expect(isWebSafeAudio('take.wav', 'pcm_s24le')).toBe(true);
    expect(isWebSafeAudio('song.flac', 'flac')).toBe(true);
    expect(isWebSafeAudio('song.ogg', 'vorbis')).toBe(true);
  });

  it('converts audio the browser would play as silence', () => {
    expect(isWebSafeAudio('call.amr', 'amr_nb')).toBe(false);
    expect(isWebSafeAudio('voice.wma', 'wmav2')).toBe(false);
    expect(isWebSafeAudio('studio.aiff', 'pcm_s16be')).toBe(false);
    expect(isWebSafeAudio('old.wav', 'adpcm_ms')).toBe(false);
  });
});

const media = (overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  path: 'C:/media/clip.mp4',
  fileName: 'clip.mp4',
  kind: 'video',
  size: 1,
  duration: 12,
  hasAudio: true,
  width: 1080,
  height: 1920,
  fps: 60,
  aspectRatio: '9:16',
  videoCodec: 'h264',
  audioCodec: 'aac',
  importedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const withMedia = (overrides: Partial<CaptionProject> = {}): CaptionProject => ({
  ...createProject('p', 'Preview'),
  media: media(),
  ...overrides,
});

describe('the preview frame rate', () => {
  it('is the rate the scene gives the player', () => {
    const project = withMedia();
    expect(previewFps(project)).toBe(buildScene(project, { mediaSrc: null }).fps);
    expect(previewFps(project)).toBe(60);
  });

  it('follows an export preset rather than the source', () => {
    // a 60 fps phone clip exported as a 30 fps Reel: seeks must use 30
    const base = withMedia();
    const project = withMedia({ exportSettings: { ...base.exportSettings, fps: 30 } });
    expect(previewFps(project)).toBe(30);
    expect(previewFps(project)).toBe(buildScene(project, { mediaSrc: null }).fps);
  });

  it('falls back to 30 with no project or an audio-only source', () => {
    expect(previewFps(null)).toBe(30);
    expect(previewFps(withMedia({ media: media({ kind: 'audio', fps: null }) }))).toBe(30);
  });
});

describe('finding the caption under the playhead after hand edits', () => {
  const cap = (id: string, start: number, end: number): Caption => ({
    id,
    start,
    end,
    edited: true,
    words: [{ text: id, start, end, emphasis: false }],
  });

  it('still finds a caption whose start was dragged over its neighbour', () => {
    // b now starts inside a, and c sits wholly inside b
    const captions = [cap('a', 0, 2), cap('b', 1, 6), cap('c', 3, 4), cap('d', 7, 8)];
    for (let t = 0; t < 8.5; t += 0.05) {
      const covering = captions.filter((c) => t >= c.start && t < c.end).map((c) => c.id);
      const found = captionAt(captions, t);
      if (covering.length === 0) expect(found).toBeNull();
      else expect(covering).toContain(found?.id);
    }
  });
});

describe('upload stream reliability and clipping prevention', () => {
  it('accepts a stream that matches expected bytes', async () => {
    const { writeStreamToFile } = await import('../server/services/media');
    const { Readable } = await import('node:stream');
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const dest = path.join(os.tmpdir(), `test-complete-${Date.now()}.bin`);
    const stream = Readable.from([Buffer.from('hello '), Buffer.from('world')]);
    const bytes = await writeStreamToFile(stream, dest, 11);

    expect(bytes).toBe(11);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf8')).toBe('hello world');
    fs.unlinkSync(dest);
  });

  it('rejects and purges partial file when received bytes do not match expected bytes', async () => {
    const { writeStreamToFile } = await import('../server/services/media');
    const { Readable } = await import('node:stream');
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const dest = path.join(os.tmpdir(), `test-truncated-${Date.now()}.bin`);
    const stream = Readable.from([Buffer.from('short data')]); // 10 bytes

    await expect(writeStreamToFile(stream, dest, 500)).rejects.toThrow(
      /Upload incomplete: expected 500 bytes/,
    );

    // Partial file must have been deleted so it cannot be mistakenly probed as clipped media
    expect(fs.existsSync(dest)).toBe(false);
  });
});
