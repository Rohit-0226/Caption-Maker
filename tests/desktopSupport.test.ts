import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

// electron/support.cjs is plain CommonJS shared by the desktop app; load it the way Electron does
const require = createRequire(import.meta.url);
const support = require('../electron/support.cjs');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

describe('desktop app: ports and project discovery', () => {
  it('uses the shared defaults and honours the test overrides', () => {
    expect(support.resolvePorts({})).toEqual({ webPort: 5173, apiPort: 5180 });
    expect(support.resolvePorts({ CM_WEB_PORT: '5185', PORT: '5192' })).toEqual({ webPort: 5185, apiPort: 5192 });
    expect(support.resolvePorts({ CM_API_PORT: '6000', PORT: '5192' }).apiPort).toBe(6000);
    expect(support.resolvePorts({ CM_WEB_PORT: 'nonsense' }).webPort).toBe(5173);
  });

  it('finds the project root by walking up from a folder inside it', () => {
    const found = support.findProjectRoot([path.join(projectRoot, 'electron')]);
    expect(support.samePath(found, projectRoot)).toBe(true);
  });

  it('does not mistake a packaged copy (same package name, no server source) for the project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-packaged-'));
    try {
      write(path.join(dir, 'resources', 'app', 'package.json'), JSON.stringify({ name: 'caption-maker' }));
      expect(support.findProjectRoot([path.join(dir, 'resources', 'app')])).toBeNull();
      // the next candidate (a remembered path) still wins
      const found = support.findProjectRoot([path.join(dir, 'resources', 'app'), projectRoot]);
      expect(support.samePath(found, projectRoot)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('desktop app: recognising a running stack', () => {
  let server: http.Server;
  let port = 0;
  let body: unknown = {};

  beforeEach(async () => {
    server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('accepts only a server that identifies as Caption Maker', async () => {
    body = { ok: true };
    expect((await support.probeStack({ webPort: port, apiPort: port })).healthy).toBe(false);

    body = { ok: true, app: 'caption-maker', pid: 1, owner: 'electron:42' };
    const stack = await support.probeStack({ webPort: port, apiPort: port });
    expect(stack.healthy).toBe(true);
    expect(stack.web.owner).toBe('electron:42');
  });

  it('tells a busy port from a free one without disturbing it', async () => {
    expect(await support.isPortInUse(port)).toBe(true);
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const freePort = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    expect(await support.isPortInUse(freePort)).toBe(false);
  });
});

describe('desktop app: moving its old data into the project', () => {
  let base: string;
  let legacy: string;
  let root: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-migrate-'));
    legacy = path.join(base, 'appdata', 'data');
    root = path.join(base, 'project');
    write(path.join(root, 'package.json'), JSON.stringify({ name: 'caption-maker' }));
    write(path.join(root, '.env'), 'GROQ_API_KEY=gsk_same\nAI_PROVIDER=groq\n');
    write(path.join(root, 'projects', 'prj_shared', 'project.json'), '{"id":"prj_shared","from":"project"}');

    write(path.join(legacy, 'projects', 'prj_desktop', 'project.json'), '{"id":"prj_desktop"}');
    write(path.join(legacy, 'projects', 'prj_desktop', 'media', 'clip.mp4'), 'video-bytes');
    write(path.join(legacy, 'projects', 'prj_shared', 'project.json'), '{"id":"prj_shared","from":"desktop"}');
    write(path.join(legacy, 'output', 'render.mp4'), 'rendered');
    write(
      path.join(legacy, 'user_settings.json'),
      JSON.stringify({ groqApiKey: 'gsk_same', geminiApiKey: 'AQ.different', defaultProvider: 'groq' }),
    );
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('plans without touching anything on a dry run', async () => {
    const report = await support.migrateLegacyData({ legacyDir: legacy, root, dryRun: true });
    expect(report.projects.copied).toEqual(['prj_desktop']);
    expect(fs.existsSync(path.join(root, 'projects', 'prj_desktop'))).toBe(false);
    expect(fs.existsSync(path.join(legacy, 'projects'))).toBe(true);
  });

  it('copies new projects, keeps existing ones, and retires the old folder without deleting it', async () => {
    const report = await support.migrateLegacyData({ legacyDir: legacy, root, now: new Date(2026, 9, 2) });

    expect(report.projects.copied).toEqual(['prj_desktop']);
    expect(report.projects.alreadyPresent).toEqual(['prj_shared']);
    expect(fs.readFileSync(path.join(root, 'projects', 'prj_desktop', 'media', 'clip.mp4'), 'utf8')).toBe('video-bytes');
    // the project's own copy of a shared id wins
    expect(fs.readFileSync(path.join(root, 'projects', 'prj_shared', 'project.json'), 'utf8')).toContain('"project"');
    expect(fs.readFileSync(path.join(root, 'output', 'render.mp4'), 'utf8')).toBe('rendered');

    expect(fs.existsSync(path.join(legacy, 'projects'))).toBe(false);
    expect(fs.existsSync(path.join(legacy, 'projects.migrated-2026-10-02', 'prj_desktop', 'project.json'))).toBe(true);
    // no staging folder left behind for the server to trip over
    expect(fs.existsSync(path.join(root, 'data', '.migration-staging'))).toBe(false);
  });

  it('points the moved project at its new media path, since the server reads it as stored', async () => {
    const oldDir = path.join(legacy, 'projects', 'prj_paths');
    write(
      path.join(oldDir, 'project.json'),
      JSON.stringify(
        {
          id: 'prj_paths',
          media: { path: path.join(oldDir, 'media', 'clip.mp4') },
          export: { lastFile: path.join(legacy, 'output', 'render.mp4') },
          // a neighbour whose name merely starts the same must be left alone
          note: path.join(legacy, 'projects', 'prj_paths_other', 'x.mp4'),
        },
        null,
        2,
      ),
    );
    write(path.join(oldDir, 'media', 'clip.mp4'), 'video-bytes');

    const report = await support.migrateLegacyData({ legacyDir: legacy, root });
    expect(report.pathsRewritten).toBe(2);

    const moved = JSON.parse(fs.readFileSync(path.join(root, 'projects', 'prj_paths', 'project.json'), 'utf8'));
    expect(moved.media.path).toBe(path.join(root, 'projects', 'prj_paths', 'media', 'clip.mp4'));
    expect(moved.export.lastFile).toBe(path.join(root, 'output', 'render.mp4'));
    expect(moved.note).toBe(path.join(legacy, 'projects', 'prj_paths_other', 'x.mp4'));
    // the original keeps its own paths
    const original = path.join(legacy, 'projects.migrated-' + report.renamedProjectsTo.split('projects.migrated-')[1], 'prj_paths', 'project.json');
    expect(JSON.parse(fs.readFileSync(original, 'utf8')).media.path).toBe(path.join(oldDir, 'media', 'clip.mp4'));
  });

  it('adds only settings the project would not already use, and only once', async () => {
    const first = await support.migrateLegacyData({ legacyDir: legacy, root });
    expect(first.settings.added).toEqual(['geminiApiKey']);
    expect(first.settings.sameAsProject.sort()).toEqual(['defaultProvider', 'groqApiKey']);
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'data', 'user_settings.json'), 'utf8'));
    expect(saved).toEqual({ geminiApiKey: 'AQ.different' });

    // a key the user clears later must not come back on the next launch
    fs.writeFileSync(path.join(root, 'data', 'user_settings.json'), '{}');
    const second = await support.migrateLegacyData({ legacyDir: legacy, root });
    expect(second.settings.skippedEarlier).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'data', 'user_settings.json'), 'utf8'))).toEqual({});
  });
});
