import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { migrateProject } from '../../src/core/project/migrate';
import { createProject } from '../../src/core/project/defaults';
import type { CaptionProject } from '../../src/core/types/project';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  mediaFileName: string | null;
  captionCount: number;
  /**
   * The rest only feeds the Projects page cards. Reading it here, while the
   * file is already parsed, saves the page loading every full project (with
   * its transcript) just to show a duration and a language tag.
   */
  createdAt?: string;
  duration?: number | null;
  mediaKind?: 'video' | 'audio' | null;
  width?: number | null;
  height?: number | null;
  language?: string;
  firstCaption?: string | null;
  /** changes whenever the media is replaced, so a cached thumbnail can be busted */
  mediaVersion?: string | null;
}

/** Derived files that are cheap to rebuild and can be large, so a copy skips them. */
const DUPLICATE_SKIP = new Set(['project.json', 'project.json.bak', 'project.json.tmp', 'audio.wav']);

const newProjectId = () =>
  `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** True when `child` sits inside `parent` (case-insensitive on Windows). */
const isInside = (child: string, parent: string): boolean => {
  const norm = (p: string) => {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const rel = path.relative(norm(parent), norm(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

export interface ProjectStore {
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<CaptionProject>;
  save(project: CaptionProject): Promise<CaptionProject>;
  create(name: string): Promise<CaptionProject>;
  remove(id: string): Promise<void>;
  directoryFor(id: string): string;
}

const PROJECT_FILE = 'project.json';

export class FileProjectStore implements ProjectStore {
  constructor(private readonly root: string) {}

  directoryFor(id: string): string {
    // ids are generated internally, but never trust one straight off the wire
    const safe = path.basename(id);
    return path.join(this.root, safe);
  }

  private fileFor(id: string) {
    return path.join(this.directoryFor(id), PROJECT_FILE);
  }

  async list(): Promise<ProjectSummary[]> {
    await fsp.mkdir(this.root, { recursive: true });
    const entries = await fsp.readdir(this.root, { withFileTypes: true });

    const summaries: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const project = await this.load(entry.name);
        const first = project.captions[0];
        summaries.push({
          id: project.id,
          name: project.name,
          updatedAt: project.updatedAt,
          mediaFileName: project.media?.fileName ?? null,
          captionCount: project.captions.length,
          createdAt: project.createdAt,
          duration: project.media?.duration ?? null,
          mediaKind: project.media?.kind ?? null,
          width: project.media?.width ?? null,
          height: project.media?.height ?? null,
          language: project.language,
          firstCaption: first ? first.words.map((w) => w.text).join(' ') : null,
          mediaVersion: project.media?.importedAt ?? null,
        });
      } catch {
        // a broken folder should not hide the rest of the library
      }
    }

    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(id: string): Promise<CaptionProject> {
    const file = this.fileFor(id);
    let raw: string;

    try {
      raw = await fsp.readFile(file, 'utf8');
    } catch {
      // fall back to the previous good copy rather than reporting data loss
      const backup = file + '.bak';
      if (fs.existsSync(backup)) {
        raw = await fsp.readFile(backup, 'utf8');
      } else {
        throw new Error(`Project "${id}" was not found.`);
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const backup = file + '.bak';
      if (fs.existsSync(backup)) {
        parsed = JSON.parse(await fsp.readFile(backup, 'utf8'));
      } else {
        throw new Error(`Project "${id}" is corrupt and there is no backup to fall back on.`);
      }
    }

    return migrateProject(parsed);
  }

  /**
   * Atomic save: write a temp file, keep the previous version as .bak, then
   * rename into place. A crash mid-write can never leave a truncated project.
   */
  async save(project: CaptionProject): Promise<CaptionProject> {
    const dir = this.directoryFor(project.id);
    await fsp.mkdir(dir, { recursive: true });

    const file = path.join(dir, PROJECT_FILE);
    const temp = file + '.tmp';
    const backup = file + '.bak';

    const next: CaptionProject = { ...project, updatedAt: new Date().toISOString() };
    const contents = JSON.stringify(next, null, 2);

    const handle = await fsp.open(temp, 'w');
    try {
      await handle.writeFile(contents, 'utf8');
      // make sure the bytes are on disk before the rename makes them official
      await handle.sync();
    } finally {
      await handle.close();
    }

    if (fs.existsSync(file)) {
      await fsp.copyFile(file, backup).catch(() => undefined);
    }

    await fsp.rename(temp, file);
    return next;
  }

  /**
   * Copies a whole project folder (media, preview copy, waveform, reference PDF)
   * under a new id. Media is copied rather than linked: a later re-import writes
   * into the same file name, and a shared file would change both projects.
   */
  async duplicate(id: string, name?: string): Promise<CaptionProject> {
    const source = await this.load(id);
    const copyId = newProjectId();
    const fromDir = this.directoryFor(id);
    const toDir = this.directoryFor(copyId);

    try {
      await fsp.cp(fromDir, toDir, {
        recursive: true,
        errorOnExist: true,
        filter: (src) => !DUPLICATE_SKIP.has(path.basename(src).toLowerCase()),
      });
    } catch (error) {
      await fsp.rm(toDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    // stored paths are absolute, so anything inside the old folder moves with it
    const rebase = (p: string) => (isInside(p, fromDir) ? path.join(toDir, path.relative(fromDir, p)) : p);
    const now = new Date().toISOString();
    const document = source.terminology.document;

    try {
      return await this.save({
        ...source,
        id: copyId,
        name: name?.trim() || `${source.name} (copy)`,
        createdAt: now,
        media: source.media ? { ...source.media, path: rebase(source.media.path) } : null,
        terminology: {
          ...source.terminology,
          document: document ? { ...document, path: rebase(document.path) } : null,
        },
      });
    } catch (error) {
      await fsp.rm(toDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async create(name: string): Promise<CaptionProject> {
    const id = newProjectId();
    const project = createProject(id, name);
    await fsp.mkdir(path.join(this.directoryFor(id), 'media'), { recursive: true });
    return this.save(project);
  }

  async remove(id: string): Promise<void> {
    await fsp.rm(this.directoryFor(id), { recursive: true, force: true });
  }
}
