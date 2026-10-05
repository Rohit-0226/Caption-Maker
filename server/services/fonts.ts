import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface CustomFontRecord {
  id: string;
  family: string;
  fileName: string;
  size: number;
  uploadedAt: string;
}

const EXTENSIONS: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const isFontFile = (fileName: string) =>
  path.extname(fileName).toLowerCase() in EXTENSIONS;

export const fontMime = (fileName: string) =>
  EXTENSIONS[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';

/** "Bebas Neue Bold.ttf" -> "Bebas Neue Bold" */
export const familyFromFileName = (fileName: string) =>
  path
    .basename(fileName, path.extname(fileName))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Custom Font';

/**
 * Stores user-uploaded font files and the small index that names them.
 *
 * Fonts live outside any single project so they can be reused, and are served
 * back over HTTP — which is what lets the same file render identically in the
 * editor preview and in headless Chrome at export time.
 */
export class FontStore {
  constructor(private readonly root: string) {}

  private get indexFile() {
    return path.join(this.root, 'index.json');
  }

  private async readIndex(): Promise<CustomFontRecord[]> {
    try {
      const raw = await fsp.readFile(this.indexFile, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as CustomFontRecord[]) : [];
    } catch {
      return [];
    }
  }

  private async writeIndex(records: CustomFontRecord[]): Promise<void> {
    await fsp.mkdir(this.root, { recursive: true });
    const temp = this.indexFile + '.tmp';
    await fsp.writeFile(temp, JSON.stringify(records, null, 2), 'utf8');
    await fsp.rename(temp, this.indexFile);
  }

  list(): Promise<CustomFontRecord[]> {
    return this.readIndex();
  }

  fileFor(id: string): string | null {
    const safe = path.basename(id);
    const dir = path.join(this.root, safe);
    if (!fs.existsSync(dir)) return null;
    const [file] = fs.readdirSync(dir);
    return file ? path.join(dir, file) : null;
  }

  async add(fileName: string, bytes: Buffer, family?: string): Promise<CustomFontRecord> {
    if (!isFontFile(fileName)) {
      throw new Error(
        `"${fileName}" is not a font. Accepted: ${Object.keys(EXTENSIONS).join(', ')}`,
      );
    }

    // content hash as the id, so re-uploading the same file is idempotent
    const id = createHash('sha1').update(bytes).digest('hex').slice(0, 16);
    const safeName = path.basename(fileName);
    const dir = path.join(this.root, id);

    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, safeName), bytes);

    const record: CustomFontRecord = {
      id,
      family: family?.trim() || familyFromFileName(safeName),
      fileName: safeName,
      size: bytes.length,
      uploadedAt: new Date().toISOString(),
    };

    const records = await this.readIndex();
    const next = [record, ...records.filter((r) => r.id !== id)];
    await this.writeIndex(next);

    return record;
  }

  async rename(id: string, family: string): Promise<CustomFontRecord | null> {
    const records = await this.readIndex();
    const record = records.find((r) => r.id === id);
    if (!record) return null;
    record.family = family.trim() || record.family;
    await this.writeIndex(records);
    return record;
  }

  async remove(id: string): Promise<void> {
    const records = await this.readIndex();
    await this.writeIndex(records.filter((r) => r.id !== id));
    await fsp.rm(path.join(this.root, path.basename(id)), {
      recursive: true,
      force: true,
    });
  }
}
