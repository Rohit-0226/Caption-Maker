import React from 'react';
import { Composition } from 'remotion';
import { CaptionScene, type CaptionSceneProps } from './CaptionScene';
import { buildScene } from '../core/rendering/scene';
import { createProject } from '../core/project/defaults';

const placeholder = buildScene(createProject('preview', 'Preview'), { mediaSrc: null });

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Captions"
    component={CaptionScene as unknown as React.FC<Record<string, unknown>>}
    defaultProps={{ scene: placeholder, preview: false } as unknown as Record<string, unknown>}
    width={placeholder.width}
    height={placeholder.height}
    fps={placeholder.fps}
    durationInFrames={placeholder.durationInFrames}
    calculateMetadata={({ props }) => {
      const scene = (props as unknown as CaptionSceneProps).scene ?? placeholder;
      return {
        width: scene.width,
        height: scene.height,
        fps: scene.fps,
        durationInFrames: Math.max(1, scene.durationInFrames),
      };
    }}
  />
);
