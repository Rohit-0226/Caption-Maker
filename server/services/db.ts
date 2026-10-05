import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { defaultSettingsStore } from './configStore';

export type JobStatus =
  | 'Uploading'
  | 'Transcribing'
  | 'Ready to edit'
  | 'In progress'
  | 'Rendering'
  | 'Done'
  | 'Failed';

export interface DbJob {
  id: string;
  name: string;
  media_file: string | null;
  duration: number;
  status: JobStatus;
  assigned_editor: string;
  locked_by: string | null;
  updated_at: string;
}

export interface DbSegment {
  id: string;
  job_id: string;
  start_ms: number;
  end_ms: number;
  asr_raw: string;
  pipeline_output: string;
  final_text: string;
  editor: string | null;
  edited_at: string | null;
  model_version: string | null;
  lexicon_version: number;
}

export interface DbCorrection {
  id: string;
  segment_id: string;
  before: string;
  after: string;
  left_context: string | null;
  right_context: string | null;
  category: 'spelling_script' | 'wrong_word' | 'style';
  editor: string;
  created_at: string;
}

export interface DbLexiconEntry {
  surface_form: string;
  canonical: string;
  devanagari_form: string | null;
  hit_count: number;
  distinct_editors: number;
  status: 'candidate' | 'approved' | 'rejected';
  approved_by: string | null;
  approved_at: string | null;
}

/**
 * The same data folder the settings store uses. This used to be
 * `path.resolve('data')`, which follows whatever folder the server was started
 * from — fine for `npm run dev` in the project, but the desktop app's bundled
 * fallback would have created a second, empty vocabulary database elsewhere.
 */
const DATA_DIR = defaultSettingsStore.getDataDir();
const DB_PATH = path.join(DATA_DIR, 'studio.db');

let dbInstance: DatabaseSync | null = null;

export const getDb = (): DatabaseSync => {
  if (!dbInstance) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    dbInstance = new DatabaseSync(DB_PATH);
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA synchronous = NORMAL;');
    initSchema(dbInstance);
  }
  return dbInstance;
};

const initSchema = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      media_file TEXT,
      duration REAL DEFAULT 0,
      status TEXT DEFAULT 'Ready to edit',
      assigned_editor TEXT DEFAULT 'Rohit',
      locked_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      asr_raw TEXT NOT NULL,
      pipeline_output TEXT NOT NULL,
      final_text TEXT NOT NULL,
      editor TEXT,
      edited_at TEXT,
      model_version TEXT,
      lexicon_version INTEGER DEFAULT 1,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS corrections (
      id TEXT PRIMARY KEY,
      segment_id TEXT NOT NULL,
      before TEXT NOT NULL,
      after TEXT NOT NULL,
      left_context TEXT,
      right_context TEXT,
      category TEXT NOT NULL,
      editor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(segment_id) REFERENCES segments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lexicon (
      surface_form TEXT PRIMARY KEY,
      canonical TEXT NOT NULL,
      devanagari_form TEXT,
      hit_count INTEGER DEFAULT 1,
      distinct_editors INTEGER DEFAULT 1,
      status TEXT DEFAULT 'candidate',
      approved_by TEXT,
      approved_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_segments_job ON segments(job_id);
    CREATE INDEX IF NOT EXISTS idx_corrections_segment ON corrections(segment_id);
    CREATE INDEX IF NOT EXISTS idx_corrections_category ON corrections(category);
    CREATE INDEX IF NOT EXISTS idx_lexicon_status ON lexicon(status);
  `);
};

// --- Job Operations ---

export const listJobs = (): DbJob[] => {
  const db = getDb();
  const query = db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC');
  return query.all() as unknown as DbJob[];
};

export const getJob = (id: string): DbJob | null => {
  const db = getDb();
  const query = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const result = query.get(id);
  return (result as unknown as DbJob) || null;
};

export const upsertJob = (job: Partial<DbJob> & { id: string; name: string }): DbJob => {
  const db = getDb();
  const existing = getJob(job.id);
  const now = new Date().toISOString();

  if (existing) {
    const updated: DbJob = {
      ...existing,
      ...job,
      updated_at: now,
    };
    const stmt = db.prepare(`
      UPDATE jobs SET
        name = ?, media_file = ?, duration = ?, status = ?,
        assigned_editor = ?, locked_by = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(
      updated.name,
      updated.media_file,
      updated.duration,
      updated.status,
      updated.assigned_editor,
      updated.locked_by,
      updated.updated_at,
      updated.id,
    );
    return updated;
  }

  const created: DbJob = {
    id: job.id,
    name: job.name,
    media_file: job.media_file ?? null,
    duration: job.duration ?? 0,
    status: job.status ?? 'Ready to edit',
    assigned_editor: job.assigned_editor ?? 'Rohit',
    locked_by: job.locked_by ?? null,
    updated_at: now,
  };
  const stmt = db.prepare(`
    INSERT INTO jobs (id, name, media_file, duration, status, assigned_editor, locked_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    created.id,
    created.name,
    created.media_file,
    created.duration,
    created.status,
    created.assigned_editor,
    created.locked_by,
    created.updated_at,
  );
  return created;
};

export const deleteJob = (id: string): void => {
  const db = getDb();
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
};

// --- Segment Operations ---

export const saveSegment = (segment: DbSegment): void => {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO segments (id, job_id, start_ms, end_ms, asr_raw, pipeline_output, final_text, editor, edited_at, model_version, lexicon_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      final_text = excluded.final_text,
      editor = excluded.editor,
      edited_at = excluded.edited_at,
      start_ms = excluded.start_ms,
      end_ms = excluded.end_ms
  `);
  stmt.run(
    segment.id,
    segment.job_id,
    segment.start_ms,
    segment.end_ms,
    segment.asr_raw,
    segment.pipeline_output,
    segment.final_text,
    segment.editor,
    segment.edited_at,
    segment.model_version,
    segment.lexicon_version,
  );
};

export const getSegmentsForJob = (jobId: string): DbSegment[] => {
  const db = getDb();
  return db
    .prepare('SELECT * FROM segments WHERE job_id = ? ORDER BY start_ms ASC')
    .all(jobId) as unknown as DbSegment[];
};

// --- Corrections & Lexicon Loop ---

export const recordCorrection = (correction: DbCorrection): void => {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO corrections (id, segment_id, before, after, left_context, right_context, category, editor, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    correction.id,
    correction.segment_id,
    correction.before,
    correction.after,
    correction.left_context,
    correction.right_context,
    correction.category,
    correction.editor,
    correction.created_at,
  );

  // If spelling/script, update or insert into lexicon candidate pool
  if (correction.category === 'spelling_script') {
    updateLexiconCandidate(correction.before.toLowerCase().trim(), correction.after.trim(), correction.editor);
  }
};

const updateLexiconCandidate = (surface: string, canonical: string, editor: string) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM lexicon WHERE surface_form = ?').get(surface) as unknown as DbLexiconEntry | undefined;

  if (existing) {
    if (existing.status === 'approved') return; // already approved, no need to touch

    // Check distinct editors count
    const editorQuery = db.prepare(`
      SELECT COUNT(DISTINCT editor) as count
      FROM corrections
      WHERE LOWER(TRIM(before)) = ?
    `).get(surface) as { count: number };

    db.prepare(`
      UPDATE lexicon
      SET hit_count = hit_count + 1,
          canonical = ?,
          distinct_editors = ?
      WHERE surface_form = ?
    `).run(canonical, Math.max(existing.distinct_editors, editorQuery.count), surface);
  } else {
    db.prepare(`
      INSERT INTO lexicon (surface_form, canonical, hit_count, distinct_editors, status)
      VALUES (?, ?, 1, 1, 'candidate')
    `).run(surface, canonical);
  }
};

export const getLexiconCandidates = (): DbLexiconEntry[] => {
  const db = getDb();
  // As per Section 9 promotion gate: seen 3+ times, 2+ distinct editors, category spelling_script
  return db.prepare(`
    SELECT * FROM lexicon
    WHERE status = 'candidate'
    ORDER BY hit_count DESC
  `).all() as unknown as DbLexiconEntry[];
};

export const getPromotableCandidates = (): DbLexiconEntry[] => {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM lexicon
    WHERE status = 'candidate' AND hit_count >= 3 AND distinct_editors >= 2
    ORDER BY hit_count DESC
  `).all() as unknown as DbLexiconEntry[];
};

export const approveLexiconEntry = async (surfaceForm: string, approvedBy: string): Promise<void> => {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM lexicon WHERE surface_form = ?').get(surfaceForm) as unknown as DbLexiconEntry | undefined;
  if (existing) {
    db.prepare(`
      UPDATE lexicon
      SET status = 'approved', approved_by = ?, approved_at = ?
      WHERE surface_form = ?
    `).run(approvedBy, now, surfaceForm);
  } else {
    db.prepare(`
      INSERT INTO lexicon (surface_form, canonical, hit_count, distinct_editors, status, approved_by, approved_at)
      VALUES (?, ?, 1, 1, 'approved', ?, ?)
    `).run(surfaceForm, surfaceForm, approvedBy, now);
  }

  // Also sync to protected_terms.json
  try {
    const entry = db.prepare('SELECT * FROM lexicon WHERE surface_form = ?').get(surfaceForm) as unknown as DbLexiconEntry | undefined;
    if (entry) {
      const protectedPath = path.join(DATA_DIR, 'protected_terms.json');
      if (fs.existsSync(protectedPath)) {
        const raw = await fsp.readFile(protectedPath, 'utf8');
        const data = JSON.parse(raw);
        data.canonical_hinglish = data.canonical_hinglish || {};
        data.canonical_hinglish[entry.surface_form] = entry.canonical;
        await fsp.writeFile(protectedPath, JSON.stringify(data, null, 2), 'utf8');
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to sync approved term to protected_terms.json:', err);
  }
};

export const rejectLexiconEntry = (surfaceForm: string): void => {
  const db = getDb();
  db.prepare(`
    UPDATE lexicon
    SET status = 'rejected'
    WHERE surface_form = ?
  `).run(surfaceForm);
};

export const getCorrections = (limit = 100): DbCorrection[] => {
  const db = getDb();
  return db.prepare('SELECT * FROM corrections ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as DbCorrection[];
};

// --- Backups ---

export const backupDatabase = async (destinationDir: string): Promise<string> => {
  await fsp.mkdir(destinationDir, { recursive: true });
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
  const destDb = path.join(destinationDir, `studio-${dateStr}.db`);
  const destTerms = path.join(destinationDir, `protected_terms-${dateStr}.json`);

  const db = getDb();
  // Safe SQLite backup using checkpoint
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  await fsp.copyFile(DB_PATH, destDb);

  const protectedPath = path.join(DATA_DIR, 'protected_terms.json');
  if (fs.existsSync(protectedPath)) {
    await fsp.copyFile(protectedPath, destTerms);
  }

  return destDb;
};
