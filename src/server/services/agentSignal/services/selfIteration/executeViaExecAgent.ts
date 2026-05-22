import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { createAgentSignalSelfIterationPrompt } from '@lobechat/prompts';
import { RequestTrigger } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';

import type { ExecuteSelfIterationContext } from './execute';
import type { IterationMode } from './types';

/**
 * Replacement for executeSelfIteration that routes through execAgent (async queue).
 *
 * LOBE-9454: Migrates the hand-rolled AgentRuntime loop from execute.ts
 * (new AgentRuntime + custom call_llm executor + closure accumulators) to
 * the unified execAgent entry point.
 *
 * Key differences vs. the old execute.ts path:
 * - No side-channel closures — all structured output flows through tool result
 *   `kind` field into AgentState and is persisted as a step snapshot.
 * - Runs asynchronously as queued steps → no Vercel timeout risk.
 * - Full snapshot visibility → `agent-tracing inspect` works immediately.
 *
 * Post-completion bookkeeping (brief writing, receipt projection) is handled
 * by the `agent.execution.completed` listener policy — see `completionPolicy.ts`
 * and `finalStateExtractor.ts`.
 *
 * The old executeSelfIteration function in execute.ts is retained during the
 * migration period and will be deleted by LOBE-9453 (#8 Cleanup).
 */
export interface ExecuteViaExecAgentInput {
  agentId: string;
  context: ExecuteSelfIterationContext;
  db: LobeChatDatabase;
  maxSteps: number;
  mode?: IterationMode;
  sourceId: string;
  userId: string;
  window?: { end: string; localDate?: string; start: string; timezone?: string };
}

export interface ExecuteViaExecAgentResult {
  /** Whether the run was successfully enqueued. */
  enqueued: boolean;
  /** Error message when enqueue failed. */
  error?: string;
  /** operationId returned by execAgent — use with agent-tracing inspect. */
  operationId: string;
}

const resolveSlug = (mode: IterationMode) => {
  if (mode === 'review') return BUILTIN_AGENT_SLUGS.nightlyReview;
  if (mode === 'reflection') return BUILTIN_AGENT_SLUGS.selfReflection;
  return BUILTIN_AGENT_SLUGS.selfFeedbackIntent;
};

export const executeViaExecAgent = async (
  input: ExecuteViaExecAgentInput,
): Promise<ExecuteViaExecAgentResult> => {
  const mode: IterationMode = input.mode ?? 'review';
  const slug = resolveSlug(mode);

  const prompt = createAgentSignalSelfIterationPrompt({
    agentId: input.agentId,
    context: input.context,
    mode,
    sourceId: input.sourceId,
    userId: input.userId,
    window: {
      end: input.window?.end ?? input.context.reviewWindowEnd ?? new Date(0).toISOString(),
      localDate: input.window?.localDate,
      start: input.window?.start ?? input.context.reviewWindowStart ?? new Date(0).toISOString(),
      timezone: input.window?.timezone,
    },
  });

  const aiAgentService = new AiAgentService(input.db, input.userId);

  const result = await aiAgentService.execAgent({
    appContext: {
      scope: 'agent-signal',
      suppressSignal: true,
    },
    autoStart: true,
    maxSteps: input.maxSteps,
    prompt,
    slug,
    trigger: RequestTrigger.AgentSignal,
  });

  return {
    enqueued: result.success,
    ...(result.error ? { error: result.error } : {}),
    operationId: result.operationId,
  };
};
