import { describe, expect, it } from 'vitest';
import { createProject } from '../src/core/project/defaults';
import { resolveExportSpec } from '../src/core/rendering/exportPresets';

const withVideo = () => ({
  ...createProject('render-test', 'Render test'),
  media: {
    path: 'source.mp4',
    fileName: 'source.mp4',
    kind: 'video' as const,
    size: 1_000_000,
    duration: 10,
    hasAudio: true,
    width: 1080,
    height: 1920,
    fps: 59.94,
    aspectRatio: '9:16',
    videoCodec: 'h264',
    audioCodec: 'aac',
    importedAt: new Date(0).toISOString(),
  },
});

describe('export specification', () => {
  it('uses source size and frame rate for the Original preset', () => {
    expect(resolveExportSpec(withVideo())).toMatchObject({
      width: 1080,
      height: 1920,
      fps: 60,
      keepsSourceResolution: true,
      keepsSourceFps: true,
      quality: 'high',
      aspectRatio: '9:16',
    });
  });

  it('uses a selected platform size and frame rate', () => {
    const project = withVideo();
    project.exportSettings = {
      ...project.exportSettings,
      width: 1080,
      height: 1920,
      fps: 30,
    };

    expect(resolveExportSpec(project)).toMatchObject({
      width: 1080,
      height: 1920,
      fps: 30,
      keepsSourceResolution: false,
      keepsSourceFps: false,
    });
  });

  it('rounds odd dimensions up so H.264 encoding cannot fail', () => {
    const project = withVideo();
    project.media = { ...project.media!, width: 1079, height: 1919 };

    expect(resolveExportSpec(project)).toMatchObject({ width: 1080, height: 1920 });
  });

  it('supports custom aspect ratio and target weight/quality', () => {
    const project = withVideo();
    project.exportSettings = {
      ...project.exportSettings,
      aspectRatio: '16:9',
      width: 1920,
      height: 1080,
      quality: 'medium',
    };

    expect(resolveExportSpec(project)).toMatchObject({
      width: 1920,
      height: 1080,
      quality: 'medium',
      aspectRatio: '16:9',
    });
  });
});
