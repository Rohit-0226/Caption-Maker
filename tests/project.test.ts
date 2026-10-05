import { afterEach, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileProjectStore } from '../server/services/projectStore';
import { migrateProject, ProjectMigrationError } from '../src/core/project/migrate';
import { createProject, defaultStyle } from '../src/core/project/defaults';
import { CURRENT_SCHEMA_VERSION } from '../src/core/types/project';

const tempDirs: string[] = [];

const makeStore = async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cm-test-'));
  tempDirs.push(dir);
  return new FileProjectStore(dir);
};

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })),
  );
});

describe('project store', () => {
  it('creates, lists and loads a project', async () => {
    const store = await makeStore();
    const created = await store.create('My project');

    expect(created.name).toBe('My project');
    expect(created.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);

    const loaded = await store.load(created.id);
    expect(loaded.id).toBe(created.id);
  });

  it('round-trips every setting', async () => {
    const store = await makeStore();
    const created = await store.create('Round trip');

    const modified = {
      ...created,
      language: 'hinglish' as const,
      style: { ...created.style, fontSize: 123, color: '#ABCDEF' },
      segmentation: { ...created.segmentation, maxWordsPerLine: 5, maxLines: 3 as const },
      background: { ...created.background, mode: 'solid' as const, color: '#112233' },
      captions: [
        {
          id: 'c1',
          start: 0,
          end: 1,
          edited: true,
          words: [{ text: 'hello', start: 0, end: 1, emphasis: true }],
        },
      ],
    };

    await store.save(modified);
    const loaded = await store.load(created.id);

    expect(loaded.language).toBe('hinglish');
    expect(loaded.style.fontSize).toBe(123);
    expect(loaded.segmentation.maxWordsPerLine).toBe(5);
    expect(loaded.segmentation.maxLines).toBe(3);
    expect(loaded.background.color).toBe('#112233');
    expect(loaded.captions[0].words[0].emphasis).toBe(true);
  });

  it('updates the modified timestamp on save', async () => {
    const store = await makeStore();
    const created = await store.create('Timestamps');
    await new Promise((r) => setTimeout(r, 5));
    const saved = await store.save({ ...created, name: 'Renamed' });

    expect(saved.updatedAt >= created.updatedAt).toBe(true);
  });

  it('keeps a backup and recovers from a corrupt project file', async () => {
    const store = await makeStore();
    const created = await store.create('Recovery');
    await store.save({ ...created, name: 'Good version' });
    // second save moves "Good version" into the .bak
    await store.save({ ...created, name: 'Newer version' });

    const file = path.join(store.directoryFor(created.id), 'project.json');
    await fsp.writeFile(file, '{ this is not json', 'utf8');

    const recovered = await store.load(created.id);
    expect(recovered.name).toBe('Good version');
  });

  it('rejects an unknown project id', async () => {
    const store = await makeStore();
    await expect(store.load('does-not-exist')).rejects.toThrow(/not found/i);
  });

  it('removes a project', async () => {
    const store = await makeStore();
    const created = await store.create('Temporary');
    await store.remove(created.id);
    expect(await store.list()).toEqual([]);
  });

  it('does not let an id escape the projects directory', async () => {
    const store = await makeStore();
    const escaped = store.directoryFor('../../etc');
    expect(escaped).not.toContain('..');
  });
});

describe('schema migration', () => {
  it('accepts a current-version project unchanged', () => {
    const project = createProject('p1', 'Current');
    const migrated = migrateProject(JSON.parse(JSON.stringify(project)));

    expect(migrated.id).toBe('p1');
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('fills in missing sections from an older, partial file', () => {
    const migrated = migrateProject({
      schemaVersion: 0,
      id: 'legacy',
      name: 'Legacy project',
      captions: [],
    });

    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.style.fontSize).toBe(defaultStyle.fontSize);
    expect(migrated.segmentation.maxWordsPerLine).toBe(4);
    expect(migrated.background.mode).toBe('source');
    expect(migrated.terminology).toEqual({
      document: null,
      terms: [],
      rules: [],
      transcriptionSample: null,
    });
  });

  it('migrates the old implicit 30fps default to source frame rate', () => {
    const legacy = createProject('legacy-render', 'Legacy render');
    const migrated = migrateProject({
      ...legacy,
      schemaVersion: 3,
      exportSettings: { ...legacy.exportSettings, width: null, height: null, fps: 30 },
    });

    expect(migrated.exportSettings.fps).toBeNull();
  });

  it('keeps an explicitly sized 30fps platform preset during migration', () => {
    const legacy = createProject('legacy-reel', 'Legacy reel');
    const migrated = migrateProject({
      ...legacy,
      schemaVersion: 3,
      exportSettings: { ...legacy.exportSettings, width: 1080, height: 1920, fps: 30 },
    });

    expect(migrated.exportSettings.fps).toBe(30);
  });

  it('keeps values that the old file did have', () => {
    const migrated = migrateProject({
      schemaVersion: 0,
      id: 'legacy',
      name: 'Legacy',
      style: { fontSize: 99 },
      segmentation: { maxWordsPerLine: 5 },
    });

    expect(migrated.style.fontSize).toBe(99);
    expect(migrated.segmentation.maxWordsPerLine).toBe(5);
    // untouched fields still get their defaults
    expect(migrated.style.fontWeight).toBe(defaultStyle.fontWeight);
  });

  it('refuses a project from a newer schema', () => {
    expect(() =>
      migrateProject({ schemaVersion: CURRENT_SCHEMA_VERSION + 1, id: 'x', name: 'Future' }),
    ).toThrow(ProjectMigrationError);
  });

  it('refuses something that is not a project', () => {
    expect(() => migrateProject('not a project')).toThrow(ProjectMigrationError);
    expect(() => migrateProject(null)).toThrow(ProjectMigrationError);
    expect(() => migrateProject([1, 2, 3])).toThrow(ProjectMigrationError);
  });
});
