import { describe, expect, it } from 'vitest';
import { cuesToCaptions, parseSubtitles } from '../src/core/subtitles/formats';
import { useEditor } from '../src/app/store';
import { createProject } from '../src/core/project/defaults';

describe('SRT parser enhancements', () => {
  it('parses standard SRT with blank lines between cues', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,500
Hello world welcome to captions

2
00:00:03,800 --> 00:00:06,200
This is line two
`;
    const cues = parseSubtitles(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(1);
    expect(cues[0].end).toBe(3.5);
    expect(cues[0].text).toBe('Hello world welcome to captions');
    expect(cues[1].start).toBe(3.8);
    expect(cues[1].end).toBe(6.2);
    expect(cues[1].text).toBe('This is line two');
  });

  it('parses single-newline SRT where cue numbers follow immediately', () => {
    const srt = `1
00:00:00,500 --> 00:00:02,000
First cue text
2
00:00:02,100 --> 00:00:04,000
Second cue text`;
    const cues = parseSubtitles(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('First cue text');
    expect(cues[1].text).toBe('Second cue text');
  });

  it('strips inline HTML tags (<i>, <b>, <font>) and ASS tags', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
<i>Welcome</i> to <b><font color="#ffff00">Caption Maker</font></b>{\\an8}
`;
    const cues = parseSubtitles(srt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('Welcome to Caption Maker');
  });

  it('handles UTF-8 BOM and Windows CRLF line endings', () => {
    const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nCRLF caption\r\n\r\n';
    const cues = parseSubtitles(srt);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('CRLF caption');
  });
});

describe('cuesToCaptions conversion', () => {
  it('generates word-level timestamps proportionally without gaps', () => {
    const cues = [
      {
        start: 2.0,
        end: 4.0,
        text: 'Short and superlongwordhere',
      },
    ];

    const captions = cuesToCaptions(cues);
    expect(captions).toHaveLength(1);

    const caption = captions[0];
    expect(caption.start).toBe(2.0);
    expect(caption.end).toBe(4.0);
    expect(caption.words).toHaveLength(3);

    expect(caption.words[0].text).toBe('Short');
    expect(caption.words[1].text).toBe('and');
    expect(caption.words[2].text).toBe('superlongwordhere');

    expect(caption.words[0].start).toBeCloseTo(2.0, 3);
    expect(caption.words[0].end).toBeCloseTo(caption.words[1].start, 3);
    expect(caption.words[1].end).toBeCloseTo(caption.words[2].start, 3);
    expect(caption.words[2].end).toBeCloseTo(4.0, 3);

    const shortDuration = caption.words[1].end - caption.words[1].start;
    const longDuration = caption.words[2].end - caption.words[2].start;
    expect(longDuration).toBeGreaterThan(shortDuration * 2);
  });
});

describe('useEditor store importSubtitles action', () => {
  it('imports SRT into project, populates captions & transcript, and supports undo', () => {
    const initial = createProject('p-test', 'Test Project');
    initial.captions = [];
    useEditor.getState().setProject(initial);

    const srt = `1
00:00:01,000 --> 00:00:03,000
Create viral short-form videos

2
00:00:03,500 --> 00:00:05,500
With animated captions
`;

    const result = useEditor.getState().importSubtitles(srt);
    expect(result.count).toBe(2);
    expect(result.words).toBe(7);

    const updated = useEditor.getState().project;
    expect(updated?.captions).toHaveLength(2);
    expect(updated?.captions[0].words[0].text).toBe('Create');
    expect(updated?.transcript?.words).toHaveLength(7);
    expect(useEditor.getState().duration).toBeGreaterThanOrEqual(6);

    // Test Undo
    expect(useEditor.getState().canUndo()).toBe(true);
    useEditor.getState().undo();
    expect(useEditor.getState().project?.captions).toHaveLength(0);

    // Test Redo
    expect(useEditor.getState().canRedo()).toBe(true);
    useEditor.getState().redo();
    expect(useEditor.getState().project?.captions).toHaveLength(2);
  });

  it('throws a friendly error when no valid cues are found', () => {
    expect(() => {
      useEditor.getState().importSubtitles('This is just plain text without timestamps');
    }).toThrow(/No valid subtitle cues found/);
  });

  it('shifts all captions uniformly with shiftAllCaptions', () => {
    const p = createProject('p-shift', 'Shift Test');
    useEditor.getState().setProject(p);
    const srt = `1
00:00:01,000 --> 00:00:02,000
First line

2
00:00:02,500 --> 00:00:04,000
Second line`;
    useEditor.getState().importSubtitles(srt);

    useEditor.getState().shiftAllCaptions(1.5);
    const captions = useEditor.getState().project?.captions;
    expect(captions?.[0].start).toBeCloseTo(2.5, 2);
    expect(captions?.[0].end).toBeCloseTo(3.5, 2);
    expect(captions?.[1].start).toBeCloseTo(4.0, 2);
    expect(captions?.[1].end).toBeCloseTo(5.5, 2);
  });

  it('syncs caption start precisely to playhead with syncCaptionToPlayhead', () => {
    const p = createProject('p-sync', 'Sync Test');
    useEditor.getState().setProject(p);
    const srt = `1
00:00:02,000 --> 00:00:03,000
First line

2
00:00:03,500 --> 00:00:05,000
Second line`;
    useEditor.getState().importSubtitles(srt);

    const firstId = useEditor.getState().project!.captions[0].id;
    // Align first caption to playhead at 0.5s
    useEditor.getState().syncCaptionToPlayhead(firstId, 0.5);

    const captions = useEditor.getState().project?.captions;
    expect(captions?.[0].start).toBeCloseTo(0.5, 2);
    expect(captions?.[1].start).toBeCloseTo(2.0, 2);
  });
});
