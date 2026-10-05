import fsp from 'node:fs/promises';

// Lazy-import pdfjs-dist to avoid DOMMatrix crash in Electron's utilityProcess
let _getDocument: typeof import('pdfjs-dist/legacy/build/pdf.mjs').getDocument | null = null;
const getDocumentLazy = async () => {
  if (!_getDocument) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    _getDocument = pdfjs.getDocument;
  }
  return _getDocument;
};
import type { TerminologyRule, TranscriptWord } from '../../src/core/types/project';

const MAX_TERMS = 200;
const MAX_TERM_LENGTH = 64;
const MAX_SAMPLE_LENGTH = 900;

const STOP_WORDS = new Set(
  [
    'about', 'after', 'again', 'also', 'always', 'among', 'another', 'because', 'before',
    'alternative', 'being', 'between', 'both', 'business', 'cleaner', 'company',
    'correct', 'could', 'edition', 'editorial', 'every', 'first', 'formal', 'from', 'guide',
    'have', 'into', 'more', 'most', 'must', 'only', 'other', 'over', 'page', 'please',
    'preferred', 'process', 'revised', 'should', 'singular', 'some', 'standard', 'such',
    'than', 'that', 'their', 'there', 'these', 'they',
    'this', 'those', 'through', 'under', 'using', 'very', 'what', 'when', 'where', 'which',
    'while', 'with', 'within', 'would', 'your',
    // Common Roman-Hindi glue words should not become spelling overrides.
    'aap', 'aapka', 'aapke', 'aapko', 'agar', 'aur', 'bahut', 'hai', 'hain', 'hum',
    'isme', 'karna', 'karte', 'kya', 'lekin', 'liye', 'main', 'mein', 'nahi', 'nhi',
    'par', 'phir', 'se', 'tha', 'the', 'toh', 'wala', 'wali', 'yeh',
  ],
);

export interface TerminologyAnalysis {
  terms: string[];
  rules: TerminologyRule[];
  transcriptionSample: string | null;
  extractedCharacterCount: number;
}

export interface PdfTerminologyAnalysis extends TerminologyAnalysis {
  pageCount: number;
}

const normalise = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const tidyCandidate = (value: string): string =>
  value
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

export const cleanExtractedPdfText = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(/([\p{L}\p{N}])-\s*\r?\n\s*([\p{L}\p{N}])/gu, '$1$2')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/ *\r?\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const isAcronym = (word: string): boolean =>
  /^[A-Z][A-Z0-9&/-]{1,}$/.test(word) && /[A-Z]/.test(word.slice(1));

const hasInternalSignal = (word: string): boolean =>
  /[a-z][A-Z]|[A-Za-z]\d|\d[A-Za-z]|[A-Za-z]-[A-Za-z]/.test(word);

const isTitleWord = (word: string): boolean =>
  /^\p{Lu}[\p{Ll}\p{M}][\p{L}\p{M}\p{N}'’-]*$/u.test(word);

const normaliseGlossaryTerm = (value: string): string =>
  (() => {
    const cleaned = tidyCandidate(value)
    .replace(/\s*[-–—]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
    // PDF text positioning occasionally inserts spaces inside a word
    // ("sake i n", "p u ra"). A standalone one-letter fragment is a strong
    // signal that the cell was split visually, not a genuine multi-word term.
    const fragments = cleaned.split(/\s+/);
    const visuallySplit =
      /(?:^|\s)\p{L}(?:\s|$)/u.test(cleaned) ||
      (fragments.length > 1 && fragments.every((fragment) => fragment.length <= 2));
    return visuallySplit ? cleaned.replace(/\s+/g, '') : cleaned;
  })();

const isUsefulGlossaryTerm = (value: string): boolean => {
  const words = value.split(/\s+/);
  const key = normalise(value);
  return (
    value.length >= 2 &&
    value.length <= 48 &&
    words.length <= 4 &&
    /\p{L}/u.test(value) &&
    !STOP_WORDS.has(key) &&
    !/:/.test(value) &&
    !/\b(preferred|alternative|notes?|listen to speaker|both acceptable)\b/i.test(value)
  );
};

/** Reads explicit Preferred / Avoid columns and simple "X not Y" appendix rows. */
export const extractGlossaryRules = (text: string): TerminologyRule[] => {
  const rules = new Map<string, TerminologyRule>();
  let insidePreferredTable = false;

  const add = (preferredValue: string, alternativeValues: string[]) => {
    const preferred = normaliseGlossaryTerm(preferredValue);
    if (!isUsefulGlossaryTerm(preferred) || /\bor\b/i.test(preferred)) return;
    const alternatives = alternativeValues
      .map(normaliseGlossaryTerm)
      .filter((value) =>
        isUsefulGlossaryTerm(value) &&
        value.toLocaleLowerCase('en') !== preferred.toLocaleLowerCase('en'),
      );
    if (alternatives.length === 0) return;
    const key = normalise(preferred);
    const previous = rules.get(key);
    rules.set(key, {
      preferred,
      alternatives: [...new Set([...(previous?.alternatives ?? []), ...alternatives])],
    });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^preferred\s+avoid\s*\/\s*alternative/i.test(line)) {
      insidePreferredTable = true;
      continue;
    }

    const explicit = /^(\p{L}[\p{L}\p{M}'’-]{1,30})\s+not\s+(\p{L}[\p{L}\p{M}'’-]{1,30})$/iu.exec(line);
    if (explicit) {
      add(explicit[1], [explicit[2]]);
      continue;
    }

    if (!insidePreferredTable || /^[A-Z](?:\s*\/\s*[A-Z])?$/.test(line)) continue;
    const columns = line.split(/\s{2,}/).map((column) => column.trim()).filter(Boolean);
    if (columns.length < 2) continue;
    add(columns[0], columns[1].split(/\s*(?:,|;|\bor\b)\s*/i));
  }

  return [...rules.values()];
};

/**
 * Finds likely client vocabulary without pretending that every long PDF word
 * is a glossary entry. Acronyms, branded casing, repeated uncommon words and
 * title-cased phrases receive the strongest scores.
 */
export const analyseTerminology = (rawText: string): TerminologyAnalysis => {
  const text = cleanExtractedPdfText(rawText);
  if (!text) {
    return { terms: [], rules: [], transcriptionSample: null, extractedCharacterCount: 0 };
  }

  const rules = extractGlossaryRules(text);

  const wordPattern = /[\p{L}\p{M}][\p{L}\p{M}\p{N}&'’.-]*/gu;
  const occurrences = new Map<string, { forms: Map<string, number>; count: number }>();

  for (const match of text.matchAll(wordPattern)) {
    const word = tidyCandidate(match[0]);
    const key = normalise(word);
    if (!key || key.length < 2) continue;
    const record = occurrences.get(key) ?? { forms: new Map<string, number>(), count: 0 };
    record.count += 1;
    record.forms.set(word, (record.forms.get(word) ?? 0) + 1);
    occurrences.set(key, record);
  }

  const scored = new Map<string, { value: string; score: number; first: number }>();
  let order = 0;
  for (const rule of rules) {
    scored.set(normalise(rule.preferred), { value: rule.preferred, score: 100, first: order++ });
  }
  for (const [key, record] of occurrences) {
    const canonical = [...record.forms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key;
    if (STOP_WORDS.has(key) || canonical.length > MAX_TERM_LENGTH || /^\d+$/.test(key)) continue;

    let score = 0;
    if (isAcronym(canonical)) score += 35;
    if (hasInternalSignal(canonical)) score += 30;
    if (isTitleWord(canonical)) score += record.count > 1 ? 18 : 8;
    if (record.count > 1 && key.length >= 6) score += 10 + Math.min(record.count, 8);
    if (score > 0) scored.set(key, { value: canonical, score, first: order++ });
  }

  const phrasePattern = /\b\p{Lu}[\p{L}\p{M}\p{N}&'’-]{2,}(?:\s+(?:(?:of|and|for|the|in|to)\s+)?\p{Lu}[\p{L}\p{M}\p{N}&'’-]{2,}){1,3}\b/gu;
  for (const match of text.matchAll(phrasePattern)) {
    const phrase = tidyCandidate(match[0]);
    const key = phrase.split(/\s+/).map(normalise).join(' ');
    if (!key || phrase.length > MAX_TERM_LENGTH) continue;
    const previous = scored.get(key);
    scored.set(key, {
      value: phrase,
      score: Math.max(previous?.score ?? 0, 28),
      first: previous?.first ?? order++,
    });
  }

  const terms = [...scored.values()]
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .slice(0, MAX_TERMS)
    .map((entry) => entry.value);

  const transcriptionSample = buildTranscriptionSample(text, terms, rules);
  return { terms, rules, transcriptionSample, extractedCharacterCount: text.length };
};

const buildTranscriptionSample = (
  text: string,
  terms: string[],
  rules: TerminologyRule[],
): string | null => {
  if (rules.length >= 4) {
    return `${rules.map((rule) => rule.preferred).join(', ')}.`.slice(0, MAX_SAMPLE_LENGTH);
  }
  const pieces = text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((piece) => piece.replace(/\s+/g, ' ').trim())
    .filter((piece) => piece.length >= 20 && piece.length <= 300);

  if (pieces.length === 0) return text.slice(0, MAX_SAMPLE_LENGTH) || null;

  const needles = terms.slice(0, 30).map((term) => term.toLocaleLowerCase('en'));
  const ranked = pieces
    .map((piece, index) => ({
      piece,
      index,
      hits: needles.reduce(
        (count, term) => count + (piece.toLocaleLowerCase('en').includes(term) ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.hits - a.hits || a.index - b.index)
    .slice(0, 8)
    .sort((a, b) => a.index - b.index);

  let sample = '';
  for (const { piece } of ranked) {
    const next = sample ? `${sample} ${piece}` : piece;
    if (next.length > MAX_SAMPLE_LENGTH) continue;
    sample = next;
  }
  return sample || pieces[0].slice(0, MAX_SAMPLE_LENGTH);
};

/** Extracts selectable text locally; no PDF contents leave the machine. */
export const extractPdfTerminology = async (filePath: string): Promise<PdfTerminologyAnalysis> => {
  const bytes = await fsp.readFile(filePath);
  const getDocument = await getDocumentLazy();
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  });

  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
        .join('');
      pages.push(pageText);
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }

  const analysis = analyseTerminology(pages.join('\n\n'));
  return { ...analysis, pageCount };
};

const editDistance = (left: string, right: string): number => {
  if (left === right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
};

const isAdjacentSwap = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  const differences: number[] = [];
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) differences.push(index);
  }
  return (
    differences.length === 2 &&
    differences[1] === differences[0] + 1 &&
    left[differences[0]] === right[differences[1]] &&
    left[differences[1]] === right[differences[0]]
  );
};

const tokenMatches = (heard: string, preferred: string, explicit = false): number | null => {
  const left = normalise(heard);
  const right = normalise(preferred);
  if (!left || !right) return null;
  if (left === right) return 0;
  const minimumLength = explicit ? 3 : 5;
  if (left[0] !== right[0] || Math.min(left.length, right.length) < minimumLength) return null;
  const distance = isAdjacentSwap(left, right) ? 1 : editDistance(left, right);
  const allowance = Math.max(left.length, right.length) >= 8 ? 2 : 1;
  return distance <= allowance ? distance : null;
};

const replaceWordCore = (heard: string, preferred: string): string => {
  const leading = heard.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
  const trailing = heard.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
  return `${leading}${preferred}${trailing}`;
};

/**
 * Applies only unique, close matches. If two PDF terms are equally plausible,
 * the original word is kept for human review instead of guessing.
 */
export const applyPreferredTerminology = (
  words: TranscriptWord[],
  terms: string[],
  rules: TerminologyRule[] = [],
): TranscriptWord[] => {
  type Entry = {
    canonical: string;
    canonicalTokens: string[];
    heardTokens: string[];
    priority: number;
  };
  const entries: Entry[] = terms.map((term) => ({
    canonical: term.trim(),
    canonicalTokens: term.trim().split(/\s+/),
    heardTokens: term.trim().split(/\s+/),
    priority: 0,
  }));
  for (const rule of rules) {
    const canonicalTokens = rule.preferred.trim().split(/\s+/);
    entries.push({
      canonical: rule.preferred,
      canonicalTokens,
      heardTokens: canonicalTokens,
      priority: 1,
    });
    for (const alternative of rule.alternatives) {
      const heardTokens = alternative.trim().split(/\s+/);
      entries.push({
        canonical: rule.preferred,
        canonicalTokens,
        heardTokens,
        priority: 2,
      });
    }
  }
  const usableEntries = entries
    .filter((entry) => entry.canonical && entry.canonicalTokens.length <= 4)
    .filter((entry, index, all) => all.findIndex((candidate) =>
      normalise(candidate.canonical) === normalise(entry.canonical) &&
      candidate.heardTokens.map(normalise).join(' ') === entry.heardTokens.map(normalise).join(' ') &&
      candidate.priority === entry.priority,
    ) === index)
    .sort((a, b) => b.heardTokens.length - a.heardTokens.length || b.priority - a.priority);

  const result = words.map((word) => ({ ...word }));

  for (let index = 0; index < result.length;) {
    const matches: { entry: Entry; score: number }[] = [];
    for (const entry of usableEntries) {
      const heard = result.slice(index, index + entry.heardTokens.length);
      if (heard.length !== entry.heardTokens.length) continue;
      let score = 0;
      let valid = true;
      for (let part = 0; part < entry.heardTokens.length; part++) {
        const distance = tokenMatches(
          heard[part].text,
          entry.heardTokens[part],
          entry.priority > 0,
        );
        if (distance === null) {
          valid = false;
          break;
        }
        score += distance;
      }
      if (valid) matches.push({ entry, score });
    }

    matches.sort((a, b) =>
      b.entry.heardTokens.length - a.entry.heardTokens.length ||
      a.score - b.score ||
      b.entry.priority - a.entry.priority,
    );
    const best = matches[0];
    const tied = best && matches.some(
      (candidate, candidateIndex) =>
        candidateIndex > 0 &&
        candidate.entry.heardTokens.length === best.entry.heardTokens.length &&
        candidate.score === best.score &&
        candidate.entry.priority === best.entry.priority,
    );

    if (!best || tied) {
      index += 1;
      continue;
    }

    const heardWords = result.slice(index, index + best.entry.heardTokens.length);
    if (best.entry.canonicalTokens.length === heardWords.length) {
      for (let part = 0; part < best.entry.canonicalTokens.length; part++) {
        result[index + part].text = replaceWordCore(
          result[index + part].text,
          best.entry.canonicalTokens[part],
        );
      }
    } else {
      const first = heardWords[0];
      const last = heardWords[heardWords.length - 1];
      const leading = first.text.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
      const trailing = last.text.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
      const span = Math.max(last.end - first.start, 0.01);
      const replacements = best.entry.canonicalTokens.map((token, part, all) => ({
        text: `${part === 0 ? leading : ''}${token}${part === all.length - 1 ? trailing : ''}`,
        start: first.start + (span * part) / all.length,
        end: first.start + (span * (part + 1)) / all.length,
        confidence: heardWords.every((word) => word.confidence !== null)
          ? Math.min(...heardWords.map((word) => word.confidence ?? 1))
          : null,
      }));
      result.splice(index, heardWords.length, ...replacements);
    }
    index += best.entry.canonicalTokens.length;
  }

  return result;
};
