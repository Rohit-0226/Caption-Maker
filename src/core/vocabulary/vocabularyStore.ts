import vocabularyData from './vocabulary.json';

export interface VocabularyEntry {
  word: string;
  approved_form: string;
  alternatives: string[];
  rejected_forms: string[];
  context: string;
  examples: string[];
  confidence: number;
}

export interface VocabularyDatabase {
  version: number;
  description: string;
  entries: VocabularyEntry[];
}

export interface VocabularyResolution {
  original: string;
  resolved: string;
  confidence: number;
  reason: string;
  isCorrection: boolean;
  needsReview: boolean;
}

/**
 * Controlled Vocabulary Store.
 * Centralized, fast, token-efficient lookup for project-approved Roman Hinglish spelling.
 */
export class VocabularyStore {
  private entries: Map<string, VocabularyEntry> = new Map();
  private approvedIndex: Map<string, VocabularyEntry> = new Map();
  private rejectedIndex: Map<string, { entry: VocabularyEntry; target: string }> = new Map();
  private altIndex: Map<string, VocabularyEntry> = new Map();

  constructor(database?: VocabularyDatabase) {
    this.load(database ?? (vocabularyData as VocabularyDatabase));
  }

  public load(database: VocabularyDatabase): void {
    this.entries.clear();
    this.approvedIndex.clear();
    this.rejectedIndex.clear();
    this.altIndex.clear();

    for (const entry of database.entries) {
      this.indexEntry(entry);
    }
  }

  private indexEntry(entry: VocabularyEntry): void {
    const key = entry.word.toLowerCase().trim();
    this.entries.set(key, entry);

    const approvedKey = entry.approved_form.toLowerCase().trim();
    this.approvedIndex.set(approvedKey, entry);

    if (Array.isArray(entry.rejected_forms)) {
      for (const rej of entry.rejected_forms) {
        const rejKey = rej.toLowerCase().trim();
        if (rejKey) {
          this.rejectedIndex.set(rejKey, { entry, target: entry.approved_form });
        }
      }
    }

    if (Array.isArray(entry.alternatives)) {
      for (const alt of entry.alternatives) {
        const altKey = alt.toLowerCase().trim();
        if (altKey) {
          this.altIndex.set(altKey, entry);
        }
      }
    }
  }

  public getAllEntries(): VocabularyEntry[] {
    return Array.from(this.entries.values());
  }

  public getEntry(word: string): VocabularyEntry | undefined {
    const clean = word.toLowerCase().trim();
    return this.entries.get(clean) ?? this.approvedIndex.get(clean);
  }

  public isApproved(word: string): boolean {
    const clean = word.toLowerCase().trim();
    return this.approvedIndex.has(clean);
  }

  public isRejected(word: string): boolean {
    const clean = word.toLowerCase().trim();
    return this.rejectedIndex.has(clean);
  }

  public lookup(word: string): VocabularyResolution | null {
    if (!word) return null;
    const clean = word.toLowerCase().trim();

    // 1. Direct approved match
    const approved = this.approvedIndex.get(clean);
    if (approved) {
      return {
        original: word,
        resolved: approved.approved_form,
        confidence: approved.confidence ?? 1.0,
        reason: 'Approved project vocabulary',
        isCorrection: clean !== approved.approved_form.toLowerCase(),
        needsReview: false,
      };
    }

    // 2. Direct rejected form match
    const rejectedMatch = this.rejectedIndex.get(clean);
    if (rejectedMatch) {
      return {
        original: word,
        resolved: rejectedMatch.target,
        confidence: rejectedMatch.entry.confidence ?? 0.95,
        reason: `Rejected form of "${rejectedMatch.target}" per style guide`,
        isCorrection: true,
        needsReview: (rejectedMatch.entry.confidence ?? 0.95) < 0.8,
      };
    }

    // 3. Alternative form match
    const altMatch = this.altIndex.get(clean);
    if (altMatch) {
      return {
        original: word,
        resolved: altMatch.approved_form,
        confidence: 0.9,
        reason: `Normalized alternative to "${altMatch.approved_form}"`,
        isCorrection: clean !== altMatch.approved_form.toLowerCase(),
        needsReview: false,
      };
    }

    return null;
  }

  /**
   * Token-efficient context builder.
   * Extracts only relevant vocabulary rules that match tokens in the input sentence or chunk.
   */
  public getRelevantEntries(tokens: string[], maxRules = 35): VocabularyEntry[] {
    const cleanTokens = new Set(
      tokens
        .map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '').trim())
        .filter(Boolean)
    );

    const matched: VocabularyEntry[] = [];
    const seen = new Set<string>();

    for (const token of cleanTokens) {
      const entry =
        this.approvedIndex.get(token) ||
        this.rejectedIndex.get(token)?.entry ||
        this.altIndex.get(token) ||
        this.entries.get(token);

      if (entry && !seen.has(entry.word)) {
        seen.add(entry.word);
        matched.push(entry);
        if (matched.length >= maxRules) break;
      }
    }

    return matched;
  }

  public addEntry(entry: VocabularyEntry): void {
    this.indexEntry(entry);
  }

  public removeEntry(word: string): boolean {
    const key = word.toLowerCase().trim();
    const existing = this.entries.get(key) || this.approvedIndex.get(key);
    if (!existing) return false;

    this.entries.delete(key);
    this.approvedIndex.delete(existing.approved_form.toLowerCase().trim());
    if (existing.rejected_forms) {
      for (const r of existing.rejected_forms) {
        this.rejectedIndex.delete(r.toLowerCase().trim());
      }
    }
    if (existing.alternatives) {
      for (const a of existing.alternatives) {
        this.altIndex.delete(a.toLowerCase().trim());
      }
    }
    return true;
  }

  public toJSON(): VocabularyDatabase {
    return {
      version: 1,
      description: 'Caption Maker Controlled Hinglish Vocabulary Database',
      entries: this.getAllEntries(),
    };
  }
}

export const defaultVocabularyStore = new VocabularyStore();
