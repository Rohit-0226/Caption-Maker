import type { TranscriptWord } from '../types/project';
import { editDistance, phoneticKey } from '../transcription/englishLexicon';
import { hasDevanagari, postProcessText } from '../transcription/languages';
import { speechFraction, speechRangesIn, speechSecondsIn, type SpeechInterval, type SpeechMap } from './speechMap';
import { allocateTokens } from './timing';

/**
 * Word-level consensus between speech engines, in the ROVER tradition.
 *
 * One engine with real word timestamps (Whisper) is the backbone. Every other
 * engine's transcript is aligned against it word by word, and each position is
 * decided by weighted vote. Two rules stop voting from doing harm:
 *
 *  - a single engine never overrules the backbone on its own; the disagreement
 *    is recorded for the arbiter instead
 *  - words are only inserted into a gap where the audio shows unclaimed speech,
 *    so an engine that repeats or misplaces a phrase cannot duplicate it
 *
 * Timing never comes from a text-only engine. Kept and corrected words keep the
 * backbone's times; inserted words are laid across the speech in their gap.
 */

// \p{M} keeps Devanagari vowel signs, which are marks rather than letters:
// without it "वीडियो" collapses to "वडय" and no longer matches "video".
const coreOf = (text: string) => text.replace(/[^\p{L}\p{M}\p{N}]/gu, '');

/**
 * A spelling- and script-insensitive key for comparing words across engines,
 * so Nemotron's "वीडियो", Whisper's "video" and Gemini's "Video" all meet.
 */
export const matchKey = (token: string): string => {
  const core = coreOf(token);
  if (!core) return '';
  const roman = hasDevanagari(core) ? coreOf(postProcessText(core, 'hinglish')) : core;
  if (!roman) return '';
  if (/^\p{N}+$/u.test(roman)) return roman;
  return phoneticKey(roman) || roman.toLocaleLowerCase('en');
};

/** 1 for the same word, falling towards 0 as the keys drift apart. */
export const tokenSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  const limit = Math.max(1, Math.floor(longest / 2));
  const distance = editDistance(a, b, limit);
  return distance > limit ? 0 : 1 - distance / longest;
};

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

export interface AlignedPair {
  /** index into the reference sequence, or null for a word only the hypothesis has */
  ref: number | null;
  /** index into the hypothesis, or null for a word it skipped */
  hyp: number | null;
  similarity: number;
}

const SAME_WORD = 0.8;
const NEAR_WORD = 0.55;
const DIAGONAL = 1;
const UP = 2;
const LEFT = 3;
const GAP_SCORE = -1;
/** past this the table would cost hundreds of megabytes; long inputs are split instead */
const MAX_CELLS = 4_000_000;

const substitutionScore = (similarity: number) =>
  similarity >= SAME_WORD ? 2 : similarity >= NEAR_WORD ? 1 : -1;

/** Needleman–Wunsch global alignment of two key sequences. */
export const alignTokens = (ref: string[], hyp: string[]): AlignedPair[] => {
  const n = ref.length;
  const m = hyp.length;
  if (n === 0) return hyp.map((_, j) => ({ ref: null, hyp: j, similarity: 0 }));
  if (m === 0) return ref.map((_, i) => ({ ref: i, hyp: null, similarity: 0 }));

  if (n * m > MAX_CELLS) {
    // Upstream chunking keeps inputs small; this is a backstop, splitting both
    // sequences at proportional points.
    const half = Math.floor(n / 2);
    const hypHalf = Math.round((m * half) / n);
    const left = alignTokens(ref.slice(0, half), hyp.slice(0, hypHalf));
    const right = alignTokens(ref.slice(half), hyp.slice(hypHalf)).map((pair) => ({
      ref: pair.ref === null ? null : pair.ref + half,
      hyp: pair.hyp === null ? null : pair.hyp + hypHalf,
      similarity: pair.similarity,
    }));
    return [...left, ...right];
  }

  const width = m + 1;
  const score = new Float32Array((n + 1) * width);
  const move = new Uint8Array((n + 1) * width);
  for (let i = 1; i <= n; i++) {
    score[i * width] = i * GAP_SCORE;
    move[i * width] = UP;
  }
  for (let j = 1; j <= m; j++) {
    score[j] = j * GAP_SCORE;
    move[j] = LEFT;
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diagonal = score[(i - 1) * width + (j - 1)] + substitutionScore(tokenSimilarity(ref[i - 1], hyp[j - 1]));
      const up = score[(i - 1) * width + j] + GAP_SCORE;
      const left = score[i * width + (j - 1)] + GAP_SCORE;
      let best = diagonal;
      let direction = DIAGONAL;
      if (up > best) {
        best = up;
        direction = UP;
      }
      if (left > best) {
        best = left;
        direction = LEFT;
      }
      score[i * width + j] = best;
      move[i * width + j] = direction;
    }
  }

  const pairs: AlignedPair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const direction = i === 0 ? LEFT : j === 0 ? UP : move[i * width + j];
    if (direction === DIAGONAL) {
      pairs.push({ ref: i - 1, hyp: j - 1, similarity: tokenSimilarity(ref[i - 1], hyp[j - 1]) });
      i--;
      j--;
    } else if (direction === UP) {
      pairs.push({ ref: i - 1, hyp: null, similarity: 0 });
      i--;
    } else {
      pairs.push({ ref: null, hyp: j - 1, similarity: 0 });
      j--;
    }
  }

  return pairs.reverse();
};

/**
 * Finds backbone words that another engine split in two.
 *
 * Names are where engines disagree most about word boundaries: Whisper wrote
 * "karanaojla" where the others heard "Karan Aujla". Plain alignment pairs one
 * half with the backbone word and calls the other half a missed word, which
 * the vote then inserts — "karan karanaojla". Two adjacent hypothesis tokens
 * whose joined key matches a backbone word are one reading of that word.
 */
const joinSplitWords = (
  pairs: AlignedPair[],
  refKeys: string[],
  tokens: string[],
): { joined: Map<number, { text: string; key: string }>; consumed: Set<number> } => {
  const joined = new Map<number, { text: string; key: string }>();
  const consumed = new Set<number>();
  const isInsertion = (k: number) => {
    const pair = pairs[k];
    return Boolean(pair) && pair.ref === null && pair.hyp !== null && !consumed.has(k);
  };

  for (const [k, pair] of pairs.entries()) {
    if (pair.ref === null || pair.similarity >= SAME_WORD) continue;
    const refKey = refKeys[pair.ref];

    // the hypothesis indices that could make up this word, with the pair each came from
    const candidates: Array<[number, number][]> = [];
    if (pair.hyp !== null) {
      if (isInsertion(k - 1)) candidates.push([[k - 1, pairs[k - 1].hyp!], [k, pair.hyp]]);
      if (isInsertion(k + 1)) candidates.push([[k, pair.hyp], [k + 1, pairs[k + 1].hyp!]]);
    } else {
      for (const [a, b] of [[k - 2, k - 1], [k - 1, k + 1], [k + 1, k + 2]] as const) {
        if (isInsertion(a) && isInsertion(b)) candidates.push([[a, pairs[a].hyp!], [b, pairs[b].hyp!]]);
      }
    }

    let best: { parts: [number, number][]; key: string; similarity: number } | null = null;
    for (const parts of candidates) {
      const [[, first], [, second]] = parts;
      if (second !== first + 1) continue;
      const key = matchKey(tokens[first] + tokens[second]);
      const similarity = tokenSimilarity(key, refKey);
      if (similarity >= SAME_WORD && similarity > pair.similarity && (!best || similarity > best.similarity)) {
        best = { parts, key, similarity };
      }
    }
    if (!best) continue;

    const [[, first], [, second]] = best.parts;
    joined.set(k, { text: `${tokens[first]} ${tokens[second]}`, key: best.key });
    for (const [pairIndex] of best.parts) if (pairIndex !== k) consumed.add(pairIndex);
  }

  return { joined, consumed };
};

// ---------------------------------------------------------------------------
// Choosing the backbone
// ---------------------------------------------------------------------------

/** Share of words two transcripts have in common, 0..1, from their match keys. */
export const transcriptAgreement = (a: string[], b: string[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  let same = 0;
  for (const pair of alignTokens(a, b)) {
    if (pair.ref !== null && pair.hyp !== null && pair.similarity >= SAME_WORD) same++;
  }
  return same / Math.max(a.length, b.length);
};

export interface Listener {
  engine: string;
  tokens: string[];
  weight: number;
  /** may become the text backbone (Roman output when Roman captions are wanted) */
  eligible: boolean;
  /** carries its own word timestamps */
  timed: boolean;
}

/** Real timestamps are worth a little agreement: prefer a timed engine on a near-tie. */
const TIMED_BONUS = 0.05;
/** how much better than the default leader another engine must agree to take over */
const LEAD_MARGIN = 0.03;

/**
 * Picks whose words the vote starts from in one part of the audio.
 *
 * Starting from Whisper every time fails when Whisper is the one that misheard:
 * on a fast Hinglish story it produced "He joke ya thai ki... Ayrin station e
 * traen station" while Gemini and Nemotron both heard "wo joke tha ki... mere
 * station me na station". The engine that agrees most with all the others is
 * the best estimate of what was said, so it leads; the others still vote on
 * every word.
 */
export const chooseTextBackbone = (listeners: Listener[]): { index: number; scores: number[] } => {
  const keys = listeners.map((listener) => listener.tokens.map(matchKey).filter(Boolean));
  const scores = listeners.map((listener, i) => {
    if (keys[i].length === 0) return -1;
    let weighted = 0;
    let total = 0;
    for (let j = 0; j < listeners.length; j++) {
      if (j === i || keys[j].length === 0) continue;
      weighted += listeners[j].weight * transcriptAgreement(keys[i], keys[j]);
      total += listeners[j].weight;
    }
    const agreement = total > 0 ? weighted / total : 0;
    return agreement + (listener.timed ? TIMED_BONUS : 0);
  });

  // The first listener is the default leader; another must beat it clearly.
  // On a near-tie (two Whisper models agreeing with each other) switching only
  // trades one set of small slips for another.
  let index = -1;
  for (let i = 0; i < listeners.length; i++) {
    if (!listeners[i].eligible || scores[i] < 0) continue;
    if (index === -1) {
      index = i;
      continue;
    }
    const margin = index === 0 ? LEAD_MARGIN : 0;
    if (scores[i] > scores[index] + margin) index = i;
  }
  // nobody eligible spoke: fall back to whoever said most
  if (index === -1) {
    for (let i = 0; i < listeners.length; i++) {
      if (scores[i] >= 0 && (index === -1 || scores[i] > scores[index])) index = i;
    }
  }
  return { index, scores };
};

/**
 * Times an untimed transcript using another engine's timestamps.
 *
 * Words both engines heard take the timed engine's exact times. The rest are
 * laid across the speech between those anchors, so even a backbone with no
 * timestamps of its own never puts a word in a pause.
 */
export const timeTokensAgainst = (
  tokens: string[],
  timed: TranscriptWord[],
  span: SpeechInterval,
  speechIn: (start: number, end: number) => SpeechInterval[],
): TranscriptWord[] => {
  const texts = tokens.filter((token) => matchKey(token));
  const out: Array<TranscriptWord | undefined> = new Array(texts.length);
  const pairs = alignTokens(texts.map(matchKey), timed.map((word) => matchKey(word.text)));

  let pending: number[] = [];
  let cursor = span.start;
  const flush = (until: number) => {
    if (pending.length === 0) return;
    const end = Math.max(until, cursor + 0.06 * pending.length);
    const placed = allocateTokens(pending.map((i) => texts[i]), { start: cursor, end }, speechIn(cursor, end));
    pending.forEach((tokenIndex, k) => {
      out[tokenIndex] = placed[k];
    });
    pending = [];
  };

  for (const pair of pairs) {
    if (pair.ref !== null && pair.hyp !== null && pair.similarity >= NEAR_WORD) {
      const anchor = timed[pair.hyp];
      flush(anchor.start);
      out[pair.ref] = { text: texts[pair.ref], start: anchor.start, end: anchor.end, confidence: null };
      cursor = Math.max(cursor, anchor.end);
    } else if (pair.ref !== null) {
      pending.push(pair.ref);
    }
    // a timed word nobody else heard leaves its time free for the pending words
  }
  flush(span.end);

  return out.filter((word): word is TranscriptWord => Boolean(word));
};

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export interface Hypothesis {
  engine: string;
  tokens: string[];
  /** how much this engine's vote counts */
  weight: number;
}

export type WordSource = 'agreed' | 'kept' | 'voted' | 'inserted';

export interface ConsensusWord extends TranscriptWord {
  source?: WordSource;
  /** engines that heard this word */
  support?: string[];
}

export interface Dispute {
  /** index of the first word concerned in the consensus output */
  index: number;
  /** how many consecutive words it covers */
  length: number;
  kind: 'substitution' | 'insertion';
  /** what each engine heard here */
  options: Record<string, string>;
}

export interface ConsensusStats {
  agreed: number;
  substituted: number;
  inserted: number;
  dropped: number;
  disputed: number;
}

export interface ConsensusInput {
  backbone: TranscriptWord[];
  backboneEngine: string;
  backboneWeight?: number;
  hypotheses: Hypothesis[];
  speech?: SpeechMap;
  /** the time span this backbone covers, bounding insertions at its edges */
  window?: SpeechInterval;
  /** choose Roman spellings over Devanagari when engines agree on the word */
  preferRoman?: boolean;
}

export interface ConsensusResult {
  words: ConsensusWord[];
  disputes: Dispute[];
  stats: ConsensusStats;
}

interface Reading {
  engine: string;
  text: string;
  key: string;
  weight: number;
}

const votesFor = (readings: Reading[]) => readings.reduce((sum, reading) => sum + reading.weight, 0);

const clusterReadings = (readings: Reading[]): Reading[][] => {
  const clusters: Reading[][] = [];
  for (const reading of readings) {
    const home = clusters.find((cluster) => tokenSimilarity(cluster[0].key, reading.key) >= SAME_WORD);
    if (home) home.push(reading);
    else clusters.push([reading]);
  }
  return clusters;
};

/**
 * The spelling to use for a word the engines agree on. The backbone's own
 * spelling stands unless Roman script is wanted and it wrote Devanagari, or
 * clearly more engines spelled it another way.
 */
const bestSpelling = (cluster: Reading[], preferRoman: boolean, own: Reading | null): Reading => {
  const groups = new Map<string, Reading[]>();
  for (const reading of cluster) {
    const key = coreOf(reading.text).toLocaleLowerCase('en');
    const group = groups.get(key);
    if (group) group.push(reading);
    else groups.set(key, [reading]);
  }

  const scored = [...groups.values()].map((group) => ({
    group,
    votes: votesFor(group),
    devanagari: hasDevanagari(group[0].text),
  }));
  const mostVoted = (list: typeof scored) => list.reduce((a, b) => (b.votes > a.votes ? b : a));

  let winner = (own ? scored.find((entry) => entry.group.includes(own)) : undefined) ?? mostVoted(scored);

  if (preferRoman && winner.devanagari) {
    const roman = scored.filter((entry) => !entry.devanagari);
    if (roman.length > 0) winner = mostVoted(roman);
  }

  const rivals = scored.filter((entry) => entry !== winner && !(preferRoman && entry.devanagari));
  if (rivals.length > 0) {
    const rival = mostVoted(rivals);
    if (rival.votes >= winner.votes + 0.5) winner = rival;
  }

  if (own && winner.group.includes(own)) return own;
  return winner.group.reduce((a, b) => (b.weight > a.weight ? b : a));
};

const leadingPunctuation = (text: string) => /^[^\p{L}\p{M}\p{N}]*/u.exec(text)?.[0] ?? '';
const trailingPunctuation = (text: string) => /[^\p{L}\p{M}\p{N}]*$/u.exec(text)?.[0] ?? '';
const stripEdges = (text: string) => text.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');

/** A corrected word keeps the punctuation and sentence capital of the word it replaces. */
const withPunctuationOf = (chosen: string, original: string): string => {
  const core = stripEdges(chosen);
  if (!core) return original;
  const originalCore = stripEdges(original);
  const cased =
    /^\p{Lu}/u.test(originalCore) && /^\p{Ll}/u.test(core)
      ? core.charAt(0).toLocaleUpperCase('en') + core.slice(1)
      : core;
  return `${leadingPunctuation(chosen) || leadingPunctuation(original)}${cased}${trailingPunctuation(chosen) || trailingPunctuation(original)}`;
};

export const buildConsensus = ({
  backbone,
  backboneEngine,
  backboneWeight = 1,
  hypotheses,
  speech,
  window,
  preferRoman = true,
}: ConsensusInput): ConsensusResult => {
  const stats: ConsensusStats = { agreed: 0, substituted: 0, inserted: 0, dropped: 0, disputed: 0 };
  const words: ConsensusWord[] = [];
  const disputes: Dispute[] = [];
  const reliable = Boolean(speech?.reliable);

  // spoken order, not timestamp order — see finaliseTimeline
  const ordered = [...backbone];
  const refKeys = ordered.map((word) => matchKey(word.text));
  const readingsAt: Reading[][] = ordered.map((word, i) => [
    { engine: backboneEngine, text: word.text, key: refKeys[i], weight: backboneWeight },
  ]);
  const insertionsAfter = new Map<number, Map<string, { tokens: string[]; weight: number }>>();

  for (const hypothesis of hypotheses) {
    const tokens = hypothesis.tokens.filter((token) => matchKey(token));
    const keys = tokens.map(matchKey);
    const pairs = alignTokens(refKeys, keys);
    const { joined, consumed } = joinSplitWords(pairs, refKeys, tokens);
    let lastRef = -1;

    for (const [k, pair] of pairs.entries()) {
      if (consumed.has(k)) continue;
      if (pair.ref !== null) {
        lastRef = pair.ref;
        const join = joined.get(k);
        if (join) {
          readingsAt[pair.ref].push({ engine: hypothesis.engine, text: join.text, key: join.key, weight: hypothesis.weight });
        } else if (pair.hyp !== null) {
          readingsAt[pair.ref].push({
            engine: hypothesis.engine,
            text: tokens[pair.hyp],
            key: keys[pair.hyp],
            weight: hypothesis.weight,
          });
        }
      } else if (pair.hyp !== null) {
        const bucket = insertionsAfter.get(lastRef) ?? new Map<string, { tokens: string[]; weight: number }>();
        insertionsAfter.set(lastRef, bucket);
        const entry = bucket.get(hypothesis.engine) ?? { tokens: [], weight: hypothesis.weight };
        entry.tokens.push(tokens[pair.hyp]);
        bucket.set(hypothesis.engine, entry);
      }
    }
  }

  /**
   * Adds one backbone word to the output. A reading that is two words — a name
   * the engines split differently, "Karan Aujla" for "karanaojla" — becomes two
   * words sharing the original word's time span.
   */
  const pushWord = (
    word: TranscriptWord,
    text: string,
    extra: Pick<ConsensusWord, 'source' | 'support'>,
  ): { index: number; length: number } => {
    const index = words.length;
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) {
      words.push({ ...word, text, ...extra });
      return { index, length: 1 };
    }
    const span = { start: word.start, end: word.end };
    for (const piece of allocateTokens(parts, span, [span])) {
      words.push({ ...word, ...piece, confidence: word.confidence ?? null, ...extra });
    }
    return { index, length: parts.length };
  };

  const windowStart = window?.start ?? 0;
  const windowEnd =
    window?.end ?? speech?.duration ?? (ordered.length > 0 ? ordered[ordered.length - 1].end + 1 : 0);

  /** Words other engines heard between backbone word `after` and the next. */
  const emitInsertions = (after: number) => {
    const bucket = insertionsAfter.get(after);
    if (!bucket) return;

    const previous = words[words.length - 1];
    const next = ordered[after + 1];
    const gapStart = previous ? previous.end : windowStart;
    const gapEnd = next ? next.start : windowEnd;
    if (!(gapEnd - gapStart > 0.06)) return;

    const neighbourKeys = [previous, next]
      .filter((word): word is TranscriptWord => Boolean(word))
      .map((word) => matchKey(word.text));
    /**
     * A word is new unless it repeats a neighbour or is the front or back of
     * one — "Karan" beside "karanaojla" is the same name split differently,
     * not a missed word. Short keys are exempt: "hai" next to "nahi" is real.
     */
    const isNew = (key: string) =>
      !neighbourKeys.some(
        (neighbour) =>
          tokenSimilarity(neighbour, key) >= SAME_WORD ||
          (key.length >= 4 &&
            neighbour.length >= key.length + 2 &&
            (neighbour.startsWith(key) || neighbour.endsWith(key))),
      );
    const speechInGap = speech ? speechSecondsIn(speech, gapStart, gapEnd) : 0;

    const entries = [...bucket.entries()].map(([engine, entry]) => ({
      engine,
      weight: entry.weight,
      tokens: entry.tokens,
      keys: entry.tokens.map(matchKey),
    }));

    let accepted: string[] = [];
    let support: string[] = [];
    let needsReview = false;

    if (entries.length >= 2) {
      // Keep the words at least two engines heard here.
      const base = entries.reduce((a, b) => (b.weight > a.weight ? b : a));
      const agreeing = base.keys.map(() => 1);
      for (const other of entries) {
        if (other === base) continue;
        for (const pair of alignTokens(base.keys, other.keys)) {
          if (pair.ref !== null && pair.hyp !== null && pair.similarity >= SAME_WORD) agreeing[pair.ref]++;
        }
      }
      accepted = base.tokens.filter((_, i) => agreeing[i] >= 2 && isNew(base.keys[i]));
      support = entries.map((entry) => entry.engine);
      // agreement on words where the audio is silent means they belong somewhere else
      if (reliable && speechInGap < 0.05 * accepted.length) accepted = [];
    } else {
      // One engine alone: only where the audio shows clearly more unclaimed
      // speech than the words need. Laughter and music also read as "speech"
      // to the energy map, so a thin gap is not enough evidence on its own.
      const only = entries[0];
      if (reliable && speechInGap >= Math.max(0.35, 0.18 * only.tokens.length)) {
        accepted = only.tokens.filter((_, i) => isNew(only.keys[i]));
        support = [only.engine];
        needsReview = true;
      }
    }

    if (accepted.length === 0 || gapEnd - gapStart < 0.06 * accepted.length) return;

    const placed = allocateTokens(
      accepted,
      { start: gapStart, end: gapEnd },
      speech && reliable ? speechRangesIn(speech, gapStart, gapEnd) : [],
    );
    const index = words.length;
    for (const word of placed) words.push({ ...word, source: 'inserted', support });
    stats.inserted += placed.length;

    if (needsReview) {
      disputes.push({ index, length: placed.length, kind: 'insertion', options: { [support[0]]: accepted.join(' ') } });
      stats.disputed++;
    }
  };

  for (let i = 0; i < ordered.length; i++) {
    emitInsertions(i - 1);

    const word = ordered[i];
    const readings = readingsAt[i];
    const own = readings[0];
    const clusters = clusterReadings(readings);
    const home = clusters.find((cluster) => cluster.includes(own)) ?? [own];
    const strongest = clusters.reduce((best, cluster) => (votesFor(cluster) > votesFor(best) ? cluster : best), home);
    const options = Object.fromEntries(readings.map((reading) => [reading.engine, reading.text]));

    // Nobody else heard it and the audio says nobody spoke: a hallucination.
    if (
      hypotheses.length >= 2 &&
      home.length === 1 &&
      speech &&
      reliable &&
      speechFraction(speech, word.start, word.end) < 0.25
    ) {
      stats.dropped++;
      continue;
    }

    if (strongest !== home && strongest.length >= 2) {
      const chosen = bestSpelling(strongest, preferRoman, null);
      const placed = pushWord(word, withPunctuationOf(chosen.text, word.text), {
        source: 'voted',
        support: strongest.map((reading) => reading.engine),
      });
      stats.substituted++;
      if (votesFor(strongest) - votesFor(home) < 1) {
        disputes.push({ ...placed, kind: 'substitution', options });
        stats.disputed++;
      }
      continue;
    }

    if (strongest !== home) {
      // A single engine disagrees. Not enough to overrule; ask.
      words.push({ ...word, source: 'kept', support: [own.engine] });
      disputes.push({ index: words.length - 1, length: 1, kind: 'substitution', options });
      stats.disputed++;
      continue;
    }

    const spelling = bestSpelling(home, preferRoman, own);
    const agreed = readings.length > 1 && home.length === readings.length;
    const placed = pushWord(word, spelling === own ? word.text : withPunctuationOf(spelling.text, word.text), {
      source: agreed ? 'agreed' : 'kept',
      support: home.map((reading) => reading.engine),
    });

    if (agreed) {
      stats.agreed++;
    } else if (clusters.some((cluster) => cluster !== home && votesFor(cluster) >= votesFor(home))) {
      disputes.push({ ...placed, kind: 'substitution', options });
      stats.disputed++;
    }
  }

  emitInsertions(ordered.length - 1);

  return { words, disputes, stats };
};
