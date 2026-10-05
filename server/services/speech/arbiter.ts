import { defaultSettingsStore } from '../configStore';
import { matchKey, tokenSimilarity, type ConsensusWord, type Dispute } from '../../../src/core/speech/consensus';
import { allocateTokens } from '../../../src/core/speech/timing';
import { cachedCall } from './devCache';

/**
 * Settles the disagreements the word-level vote could not.
 *
 * The model sees only the disputed words, what each engine heard there and a
 * few words either side. Its answer is checked before it is used: a decision
 * must match at least one engine's option, so the arbiter can pick and spell
 * but never invent. Timing is never its call — replacements inherit the times
 * of the words they replace.
 */

export type ArbiterStyle = 'hinglish' | 'hindi';

export interface ArbitrationTrace {
  kind: Dispute['kind'];
  current: string;
  options: Record<string, string>;
  decision: { text: string; keep: boolean } | null;
  outcome: 'applied' | 'kept' | 'removed' | 'rejected' | 'unanswered';
}

export interface ArbitrationResult {
  words: ConsensusWord[];
  applied: number;
  removed: number;
  rejected: number;
  model: string | null;
  /** what was asked and what happened to each answer, for diagnostics */
  trace: ArbitrationTrace[];
}

interface ChatTarget {
  endpoint: string;
  key: string;
  model: string;
}

const resolveChat = (): ChatTarget | null => {
  const gemini = defaultSettingsStore.getGeminiKey();
  if (gemini) {
    return {
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      key: gemini,
      model: defaultSettingsStore.getGeminiModel(),
    };
  }
  const groq = defaultSettingsStore.getGroqKey();
  if (groq) {
    return { endpoint: 'https://api.groq.com/openai/v1/chat/completions', key: groq, model: 'openai/gpt-oss-120b' };
  }
  return null;
};

const STYLE_RULES: Record<ArbiterStyle, string> = {
  hinglish:
    'Write Hindi words in Roman script (Hinglish), never Devanagari. English words keep normal English spelling, and brand names their official spelling.',
  hindi: 'Write Hindi words in Devanagari. English words keep normal English spelling.',
};

const systemPrompt = (style: ArbiterStyle, terms: string[]) =>
  [
    'Several speech recognisers transcribed the same audio and disagree about some words.',
    'For each item, decide what the speaker most likely said, using the words before and after it.',
    'Answer with one of the options, or a corrected spelling of one. Never add words that no option contains, and never paraphrase.',
    'An "insertion" item holds words only some recognisers heard between its neighbours. Set keep to false if they echo the neighbouring words, repeat part of a neighbouring name, translate a neighbouring word into the other language (e.g. "lekin" beside "But", "aur" beside "and"), or were probably not spoken.',
    STYLE_RULES[style],
    terms.length > 0 ? `Spell these names exactly: ${terms.slice(0, 40).join(', ')}.` : '',
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n');

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'caption_arbitration',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              text: { type: 'string' },
              keep: { type: 'boolean' },
            },
            required: ['id', 'text', 'keep'],
            additionalProperties: false,
          },
        },
      },
      required: ['decisions'],
      additionalProperties: false,
    },
  },
} as const;

interface RawDecision {
  id?: unknown;
  text?: unknown;
  keep?: unknown;
}

const callChat = async (
  chat: ChatTarget,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<RawDecision[] | null> => {
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch(chat.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chat.key}`, 'Content-Type': 'application/json' },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({
      model: chat.model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: RESPONSE_FORMAT,
    }),
  });

  if (!response.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[arbiter] ${chat.model} answered ${response.status}; keeping the vote's result.`);
    return null;
  }

  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as { decisions?: RawDecision[] };
    return Array.isArray(parsed.decisions) ? parsed.decisions : null;
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[arbiter] The model returned unreadable JSON; keeping the vote\'s result.');
    return null;
  }
};

/** Keys whole phrases, so "getting themselves" can be compared with "Gemini themselves". */
const phraseKey = (text: string) => matchKey(text.replace(/\s+/g, ''));

const BATCH_SIZE = 40;
const CONTEXT_WORDS = 8;

export const arbitrateDisputes = async ({
  words,
  disputes,
  style,
  terms = [],
  signal,
}: {
  words: ConsensusWord[];
  disputes: Dispute[];
  style: ArbiterStyle;
  terms?: string[];
  signal?: AbortSignal;
}): Promise<ArbitrationResult> => {
  const chat = resolveChat();
  const result: ArbitrationResult = {
    words: [...words],
    applied: 0,
    removed: 0,
    rejected: 0,
    model: chat?.model ?? null,
    trace: [],
  };
  if (!chat || disputes.length === 0) return result;

  const items = disputes.map((dispute, k) => ({ id: `d${k}`, dispute }));
  const decisions = new Map<string, { text: string; keep: boolean }>();

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = items.slice(i, i + BATCH_SIZE).map(({ id, dispute }) => ({
      id,
      kind: dispute.kind,
      before: words.slice(Math.max(0, dispute.index - CONTEXT_WORDS), dispute.index).map((w) => w.text).join(' '),
      current: words.slice(dispute.index, dispute.index + dispute.length).map((w) => w.text).join(' '),
      after: words
        .slice(dispute.index + dispute.length, dispute.index + dispute.length + CONTEXT_WORDS)
        .map((w) => w.text)
        .join(' '),
      options: dispute.options,
    }));

    const system = systemPrompt(style, terms);
    const user = JSON.stringify({ items: batch });
    const answer = await cachedCall('arbiter', [chat.model, system, user], () =>
      callChat(chat, system, user, signal),
    ).catch(
      (error: Error) => {
        if (!signal?.aborted) {
          // eslint-disable-next-line no-console
          console.warn(`[arbiter] ${error.message}; keeping the vote's result for this batch.`);
        }
        return null;
      },
    );

    for (const decision of answer ?? []) {
      if (typeof decision.id !== 'string' || typeof decision.text !== 'string') continue;
      decisions.set(decision.id, { text: decision.text.trim(), keep: decision.keep !== false });
    }
  }

  // Apply from the end so earlier indices stay valid as lengths change.
  for (const { id, dispute } of [...items].sort((a, b) => b.dispute.index - a.dispute.index)) {
    const decision = decisions.get(id);
    const span = result.words.slice(dispute.index, dispute.index + dispute.length);
    const current = span.map((word) => word.text).join(' ');
    const note = (outcome: ArbitrationTrace['outcome']) =>
      result.trace.push({ kind: dispute.kind, current, options: dispute.options, decision: decision ?? null, outcome });

    if (!decision) {
      note('unanswered');
      continue;
    }
    if (span.length === 0) continue;

    if (dispute.kind === 'insertion' && !decision.keep) {
      result.words.splice(dispute.index, dispute.length);
      result.removed += span.length;
      note('removed');
      continue;
    }

    const tokens = decision.text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.join(' ') === current) {
      note('kept');
      continue;
    }

    const options = [...Object.values(dispute.options), current];
    const supported = options.some((option) => tokenSimilarity(phraseKey(option), phraseKey(decision.text)) >= 0.6);
    const longestOption = Math.max(...options.map((option) => option.split(/\s+/).filter(Boolean).length));
    if (!supported || tokens.length > longestOption + 1) {
      result.rejected++;
      note('rejected');
      continue;
    }
    note('applied');

    const replacement: ConsensusWord[] =
      tokens.length === span.length
        ? span.map((word, k) => ({ ...word, text: tokens[k], source: 'voted' }))
        : allocateTokens(
            tokens,
            { start: span[0].start, end: span[span.length - 1].end },
            span.map((word) => ({ start: word.start, end: word.end })),
          ).map((word) => ({ ...word, source: 'voted' as const }));

    result.words.splice(dispute.index, dispute.length, ...replacement);
    result.applied++;
  }

  return result;
};
