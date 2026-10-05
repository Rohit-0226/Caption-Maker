import { describe, expect, it } from 'vitest';
import { isWebSafeVideo } from '../server/services/ffmpeg';
import { isAccepted, mimeFor, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS } from '../server/services/media';

describe('Video Web Compatibility Checker', () => {
  it('identifies standard 8-bit H.264 MP4 as web-safe', () => {
    expect(isWebSafeVideo('video.mp4', 'h264', 'yuv420p')).toBe(true);
    expect(isWebSafeVideo('clip.m4v', 'avc1', 'yuv420p')).toBe(true);
    expect(isWebSafeVideo('video.mp4', 'h264', 'yuvj420p')).toBe(true);
    expect(isWebSafeVideo('video.mp4', 'h264', null)).toBe(true);
  });

  it('identifies VP8 and VP9 WebM as web-safe', () => {
    expect(isWebSafeVideo('video.webm', 'vp9', 'yuv420p')).toBe(true);
    expect(isWebSafeVideo('video.webm', 'vp8', 'yuv420p')).toBe(true);
  });

  it('identifies AV1 as web-safe in MP4 and WebM', () => {
    expect(isWebSafeVideo('video.mp4', 'av1', 'yuv420p')).toBe(true);
    expect(isWebSafeVideo('video.webm', 'av01', 'yuv420p')).toBe(true);
  });

  it('flags HEVC / H.265 (iPhone default) as unsafe for browser playback', () => {
    expect(isWebSafeVideo('iphone.mov', 'hevc', 'yuv420p')).toBe(false);
    expect(isWebSafeVideo('iphone.mp4', 'hevc', 'yuv420p')).toBe(false);
    expect(isWebSafeVideo('iphone.mp4', 'h265', 'yuv420p')).toBe(false);
    expect(isWebSafeVideo('hdr_iphone.mov', 'hevc', 'yuv420p10le')).toBe(false);
  });

  it('flags Apple ProRes and DNxHD as unsafe for browser playback', () => {
    expect(isWebSafeVideo('capture.mov', 'prores', 'yuv422p10le')).toBe(false);
    expect(isWebSafeVideo('export.mov', 'prores', 'yuva444p10le')).toBe(false);
    expect(isWebSafeVideo('film.mov', 'dnxhd', 'yuv422p')).toBe(false);
  });

  it('flags 10-bit H.264 profiles as unsafe for browser HTML5 <video>', () => {
    expect(isWebSafeVideo('camera.mp4', 'h264', 'yuv420p10le')).toBe(false);
    expect(isWebSafeVideo('camera.mp4', 'h264', 'yuv422p10le')).toBe(false);
    expect(isWebSafeVideo('camera.mp4', 'h264', 'yuv444p')).toBe(false);
  });

  it('flags non-web container formats as unsafe for browser playback', () => {
    expect(isWebSafeVideo('old_clip.avi', 'h264', 'yuv420p')).toBe(false);
    expect(isWebSafeVideo('stream.wmv', 'wmv3', 'yuv420p')).toBe(false);
    expect(isWebSafeVideo('broadcast.ts', 'h264', 'yuv420p')).toBe(false);
    expect(isWebSafeVideo('movie.mkv', 'h264', 'yuv420p')).toBe(false);
    expect(isWebSafeVideo('web.flv', 'flv1', 'yuv420p')).toBe(false);
  });
});

describe('Media Extensions & MIME Resolution', () => {
  it('accepts comprehensive video containers', () => {
    const testCases = [
      'video.mp4',
      'clip.mov',
      'stream.webm',
      'movie.mkv',
      'cam.m4v',
      'archive.avi',
      'lecture.wmv',
      'flash.flv',
      'broadcast.ts',
      'avchd.mts',
      'bluray.m2ts',
      'phone.3gp',
      'dvd.vob',
      'open.ogv',
      'retro.mpeg',
    ];
    for (const file of testCases) {
      expect(isAccepted(file)).toBe(true);
    }
  });

  it('accepts comprehensive audio formats', () => {
    const testCases = [
      'audio.mp3',
      'voice.wav',
      'voice.m4a',
      'track.aac',
      'sample.ogg',
      'lossless.flac',
      'legacy.wma',
      'modern.opus',
      'audiobook.m4b',
      'studio.aiff',
      'memo.amr',
    ];
    for (const file of testCases) {
      expect(isAccepted(file)).toBe(true);
    }
  });

  it('rejects unsupported file types', () => {
    expect(isAccepted('document.pdf')).toBe(false);
    expect(isAccepted('image.png')).toBe(false);
    expect(isAccepted('executable.exe')).toBe(false);
    expect(isAccepted('script.py')).toBe(false);
  });

  it('resolves correct MIME types for streaming', () => {
    expect(mimeFor('video.mp4')).toBe('video/mp4');
    expect(mimeFor('clip.mov')).toBe('video/quicktime');
    expect(mimeFor('web.webm')).toBe('video/webm');
    expect(mimeFor('file.avi')).toBe('video/x-msvideo');
    expect(mimeFor('file.wmv')).toBe('video/x-ms-wmv');
    expect(mimeFor('file.flv')).toBe('video/x-flv');
    expect(mimeFor('file.ts')).toBe('video/mp2t');
    expect(mimeFor('voice.wav')).toBe('audio/wav');
    expect(mimeFor('song.mp3')).toBe('audio/mpeg');
    expect(mimeFor('audio.opus')).toBe('audio/opus');
    expect(mimeFor('audio.flac')).toBe('audio/flac');
  });

  it('includes newly supported extensions in VIDEO_EXTENSIONS & AUDIO_EXTENSIONS', () => {
    expect(VIDEO_EXTENSIONS).toContain('.avi');
    expect(VIDEO_EXTENSIONS).toContain('.wmv');
    expect(VIDEO_EXTENSIONS).toContain('.flv');
    expect(VIDEO_EXTENSIONS).toContain('.ts');
    expect(AUDIO_EXTENSIONS).toContain('.opus');
    expect(AUDIO_EXTENSIONS).toContain('.wma');
  });
});

describe('Web Proxy Transcoding Integration', () => {
  it('transcodes non-web-safe video to web-safe MP4 proxy and deduplicates concurrent requests', async () => {
    const { spawn } = await import('node:child_process');
    const os = await import('node:os');
    const path = await import('node:path');
    const fsp = (await import('node:fs/promises')).default;
    const { ffmpegPath, mediaProcessor, ensureWebProxy } = await import('../server/services/ffmpeg');

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cm-compat-test-'));
    const inputAvi = path.join(tmpDir, 'test.avi');
    const proxyMp4 = path.join(tmpDir, 'preview.mp4');

    try {
      // Generate a 1-second AVI with MPEG-4 video and PCM audio (not web-safe)
      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpegPath(), [
          '-y',
          '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=30',
          '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
          '-c:v', 'mpeg4',
          '-c:a', 'pcm_s16le',
          inputAvi,
        ]);
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exited ${code}`))));
      });

      // Probe original AVI — must be flagged as NOT web compatible
      const originalMedia = await mediaProcessor.probe(inputAvi);
      expect(originalMedia.isWebCompatible).toBe(false);
      expect(originalMedia.duration).toBeGreaterThan(0.5);

      // Transcode web proxy via ensureWebProxy with concurrent requests
      const [res1, res2] = await Promise.all([
        ensureWebProxy(inputAvi, proxyMp4),
        ensureWebProxy(inputAvi, proxyMp4),
      ]);

      expect(res1).toBe(proxyMp4);
      expect(res2).toBe(proxyMp4);

      // Probe generated proxy — must be 100% web safe H.264 + AAC MP4
      const proxyMedia = await mediaProcessor.probe(proxyMp4);
      expect(proxyMedia.isWebCompatible).toBe(true);
      expect(proxyMedia.videoCodec).toBe('h264');
      expect(proxyMedia.audioCodec).toBe('aac');
      expect(proxyMedia.width).toBe(320);
      expect(proxyMedia.height).toBe(240);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 15000);

  it('correctly probes and remuxes MKV videos without misclassifying as audio', async () => {
    const { spawn } = await import('node:child_process');
    const os = await import('node:os');
    const path = await import('node:path');
    const fsp = (await import('node:fs/promises')).default;
    const { ffmpegPath, mediaProcessor, ensureWebProxy } = await import('../server/services/ffmpeg');

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cm-mkv-test-'));
    const inputMkv = path.join(tmpDir, 'test.mkv');
    const proxyMp4 = path.join(tmpDir, 'preview.mp4');

    try {
      // Create a 1-second H.264 MKV with AAC audio
      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpegPath(), [
          '-y',
          '-f', 'lavfi', '-i', 'testsrc=duration=1:size=640x360:rate=25',
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          inputMkv,
        ]);
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exited ${code}`))));
      });

      // Probe MKV — must be detected as video with dimensions and fps
      const probed = await mediaProcessor.probe(inputMkv);
      expect(probed.kind).toBe('video');
      expect(probed.width).toBe(640);
      expect(probed.height).toBe(360);
      expect(probed.fps).toBe(25);
      expect(probed.videoCodec).toBe('h264');
      expect(probed.isWebCompatible).toBe(false); // MKV container is not web-safe for browser <video>

      // Fast-path remux or transcode to web proxy
      const start = Date.now();
      await ensureWebProxy(inputMkv, proxyMp4, {
        videoCodec: probed.videoCodec,
        pixelFormat: probed.pixelFormat,
      });
      const elapsed = Date.now() - start;

      // Fast remux should finish in well under 3 seconds
      expect(elapsed).toBeLessThan(3000);

      const proxyProbed = await mediaProcessor.probe(proxyMp4);
      expect(proxyProbed.kind).toBe('video');
      expect(proxyProbed.isWebCompatible).toBe(true);
      expect(proxyProbed.videoCodec).toBe('h264');
      expect(proxyProbed.audioCodec).toBe('aac');
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 15000);

  it('correctly classifies audio-only files as kind: audio', async () => {
    const { spawn } = await import('node:child_process');
    const os = await import('node:os');
    const path = await import('node:path');
    const fsp = (await import('node:fs/promises')).default;
    const { ffmpegPath, mediaProcessor } = await import('../server/services/ffmpeg');

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cm-audio-test-'));
    const inputMp3 = path.join(tmpDir, 'audio.mp3');

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpegPath(), [
          '-y',
          '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
          '-c:a', 'libmp3lame',
          inputMp3,
        ]);
        child.on('error', reject);
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Exited ${code}`))));
      });

      const probed = await mediaProcessor.probe(inputMp3);
      expect(probed.kind).toBe('audio');
      expect(probed.width).toBeNull();
      expect(probed.height).toBeNull();
      expect(probed.videoCodec).toBeNull();
      expect(probed.hasAudio).toBe(true);
      expect(probed.isWebCompatible).toBe(true);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 15000);
});

