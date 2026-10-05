import { describe, it, expect } from 'vitest';
import {
  toAssTime,
  toAssColour,
  compileToAss,
} from '../server/services/assCompiler';
import type {
  AnimationSettings,
  Caption,
  CaptionPosition,
  CaptionStyle,
} from '../src/core/types/project';

describe('assCompiler', () => {
  it('formats seconds to ASS timestamp format H:MM:SS.CC', () => {
    expect(toAssTime(0)).toBe('0:00:00.00');
    expect(toAssTime(1.5)).toBe('0:00:01.50');
    expect(toAssTime(65.25)).toBe('0:01:05.25');
    expect(toAssTime(3661.12)).toBe('1:01:01.12');
  });

  it('converts hex colors to ASS &HAABBGGRR& format', () => {
    // White #FFFFFF -> &H00FFFFFF&
    expect(toAssColour('#FFFFFF')).toBe('&H00FFFFFF');
    // Pure Red #FF0000 -> &H000000FF& (BB GGRR)
    expect(toAssColour('#FF0000')).toBe('&H000000FF');
    // Pure Blue #0000FF -> &H00FF0000&
    expect(toAssColour('#0000FF')).toBe('&H00FF0000');
  });

  it('compiles karaoke tags for karaoke preset', () => {
    const captions: Caption[] = [
      {
        id: 'c1',
        start: 0,
        end: 1.5,
        edited: false,
        words: [
          { text: 'Namaste', start: 0, end: 0.5, emphasis: false },
          { text: 'dosto', start: 0.5, end: 1.0, emphasis: false },
          { text: 'welcome', start: 1.0, end: 1.5, emphasis: false },
        ],
      },
    ];

    const style: CaptionStyle = {
      fontFamily: 'Inter',
      fontSize: 50,
      fontWeight: 700,
      color: '#FFFFFF',
      futureWordColor: '#B4B4B4',
  activeWordColor: '#FFD400',
      activeWordScale: 1,
      emphasisEnabled: false,
      emphasisColor: '#FF3B5C',
      emphasisScale: 1.1,
      strokeEnabled: true,
      strokeWidth: 4,
      strokeColor: '#000000',
      shadowEnabled: false,
      shadowBlur: 0,
      shadowOffsetY: 0,
      shadowColor: '#000000',
      boxEnabled: false,
      boxColor: '#000000',
      boxPaddingX: 0,
      boxPaddingY: 0,
      boxRadius: 0,
      activeBoxEnabled: false,
      activeBoxColor: '#000000',
      activeBoxRadius: 0,
      align: 'center',
      uppercase: false,
      letterSpacing: 0,
      lineHeight: 1.2,
      wordSpacing: 0,
      opacity: 1,
    };

    const position: CaptionPosition = { x: 50, y: 80, preset: 'bottom', maxWidth: 90 };
    const animation: AnimationSettings = {
      enter: 'wordHighlight',
      enterDuration: 0.2,
      exit: 'cut',
      exitDuration: 0.2,
      bounciness: 0,
      travel: 0,
    };

    const ass = compileToAss(captions, style, position, animation, {
      width: 1080,
      height: 1920,
      presetId: 'karaoke',
    });

    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain('{\\k50}Namaste {\\k50}dosto {\\k50}welcome');
  });
});
