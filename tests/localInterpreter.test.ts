import { describe, expect, it } from 'vitest';
import { interpretCommandLocally } from '../src/core/ai/localInterpreter';
import { createProject } from '../src/core/project/defaults';

describe('interpretCommandLocally', () => {
  const project = createProject('p1', 'Test Project');

  it('interprets sentence case prompts', () => {
    const actions1 = interpretCommandLocally(project, "I want every caption's first word or letter to be uppercase");
    expect(actions1).toEqual([
      { type: 'TRANSFORM_TEXT_CASE', casing: 'sentence', target: { scope: 'project', fromCaption: null, toCaption: null } },
      { type: 'SET_UPPERCASE', value: false, target: { scope: 'project', fromCaption: null, toCaption: null } },
    ]);

    const actions2 = interpretCommandLocally(project, "sentence case");
    expect(actions2).toEqual([
      { type: 'TRANSFORM_TEXT_CASE', casing: 'sentence', target: { scope: 'project', fromCaption: null, toCaption: null } },
      { type: 'SET_UPPERCASE', value: false, target: { scope: 'project', fromCaption: null, toCaption: null } },
    ]);
  });

  it('interprets title case prompts', () => {
    const actions = interpretCommandLocally(project, "capitalize every word");
    expect(actions).toEqual([
      { type: 'TRANSFORM_TEXT_CASE', casing: 'title', target: { scope: 'project', fromCaption: null, toCaption: null } },
      { type: 'SET_UPPERCASE', value: false, target: { scope: 'project', fromCaption: null, toCaption: null } },
    ]);
  });

  it('interprets lowercase and uppercase prompts', () => {
    const lower = interpretCommandLocally(project, "make all lowercase");
    expect(lower).toEqual([
      { type: 'TRANSFORM_TEXT_CASE', casing: 'lower', target: { scope: 'project', fromCaption: null, toCaption: null } },
      { type: 'SET_UPPERCASE', value: false, target: { scope: 'project', fromCaption: null, toCaption: null } },
    ]);

    const upper = interpretCommandLocally(project, "ALL CAPS");
    expect(upper).toEqual([
      { type: 'SET_UPPERCASE', value: true, target: { scope: 'project', fromCaption: null, toCaption: null } },
    ]);
  });

  it('interprets color prompts', () => {
    const yellow = interpretCommandLocally(project, "make text color yellow");
    expect(yellow).toContainEqual(
      expect.objectContaining({ type: 'SET_TEXT_COLOR', value: '#FFD400' }),
    );

    const red = interpretCommandLocally(project, "spoken word crimson");
    expect(red).toContainEqual(
      expect.objectContaining({ type: 'SET_ACTIVE_WORD_COLOR', value: '#FF3B5C' }),
    );
  });

  it('interprets size prompts', () => {
    const bigger = interpretCommandLocally(project, "make text bigger");
    expect(bigger).toEqual([
      { type: 'SET_FONT_SIZE', amount: { value: 8, mode: 'relative' }, target: { scope: 'project', fromCaption: null, toCaption: null } },
    ]);

    const exact = interpretCommandLocally(project, "font size: 76");
    expect(exact).toEqual([
      { type: 'SET_FONT_SIZE', amount: { value: 76, mode: 'absolute' }, target: { scope: 'project', fromCaption: null, toCaption: null } },
    ]);
  });

  it('interprets font family prompts', () => {
    const quicksand = interpretCommandLocally(project, "use Quicksand font");
    expect(quicksand).toEqual([
      { type: 'SET_FONT', family: 'Quicksand', target: { scope: 'project', fromCaption: null, toCaption: null } },
    ]);
  });

  it('interprets position and alignment prompts', () => {
    const center = interpretCommandLocally(project, "align center");
    expect(center).toEqual([
      { type: 'SET_TEXT_ALIGN', value: 'center', target: { scope: 'project', fromCaption: null, toCaption: null } },
    ]);

    const higher = interpretCommandLocally(project, "move higher");
    expect(higher).toEqual([
      { type: 'SET_POSITION', x: null, y: { value: -10, mode: 'relative' }, target: { scope: 'project', fromCaption: null, toCaption: null } },
    ]);
  });
});
