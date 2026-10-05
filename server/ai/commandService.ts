import type { CaptionProject } from '../../src/core/types/project';
import { aiActionSchema, type AIAction } from '../../src/core/ai/actions';
import { applyActions, type AIChange } from '../../src/core/ai/executor';
import { requestActions, redact, AIError } from './aiClient';
import { normaliseAction, type FlatAction } from './schemas';
import { buildSystemPrompt, buildUserPrompt, type CommandContext } from './contextBuilder';
import { runCaptionQA, type QAReport } from '../../src/core/captions/qa';

export interface CommandResult {
  reply: string;
  /** what would change, for the confirm panel */
  changes: AIChange[];
  /** actions that could not be carried out, with reasons */
  rejected: string[];
  /** the project with every valid action applied — not yet saved */
  project: CaptionProject;
  /** validated actions, kept so the client can replay them */
  actions: AIAction[];
  qa: QAReport | null;
  model: string;
}

/**
 * Turns one natural-language request into a validated, previewable change set.
 *
 * The model's output is never executed. It is parsed, reshaped, validated
 * against the Zod union, and only then handed to the pure executor. Anything
 * that fails validation becomes a line in `rejected` — the rest still applies,
 * so one bad action does not lose the whole request.
 */
export const runCommand = async (
  project: CaptionProject,
  prompt: string,
  context: CommandContext,
  signal?: AbortSignal,
): Promise<CommandResult> => {
  const raw = await requestActions({
    system: buildSystemPrompt(),
    user: buildUserPrompt(project, context, prompt),
    signal,
  });

  const actions: AIAction[] = [];
  const rejected: string[] = [];
  let wantsQA = false;

  for (const candidate of raw.actions) {
    const flat = candidate as FlatAction;
    const shaped = normaliseAction(flat);

    if (shaped === null) {
      rejected.push(`The assistant asked for something unsupported: "${String(flat?.type)}".`);
      continue;
    }

    const parsed = aiActionSchema.safeParse(shaped);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      rejected.push(
        `Ignored a "${String(flat?.type)}" change: ${issue?.message ?? 'it was not valid'}.`,
      );
      continue;
    }

    if (parsed.data.type === 'RUN_CAPTION_QA') {
      wantsQA = true;
      continue;
    }

    actions.push(parsed.data);
  }

  const applied = applyActions(project, actions, {
    selectedCaptionIds: context.selectedCaptionIds,
  });

  return {
    reply: raw.reply,
    changes: applied.changes,
    rejected: [...rejected, ...applied.rejected],
    project: applied.project,
    actions,
    qa: wantsQA ? runCaptionQA(applied.project) : null,
    model: raw.model,
  };
};

export { AIError, redact };
