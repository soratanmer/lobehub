import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { RequestTrigger } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';
import { AiAgentService } from '@/server/services/aiAgent';

import type { IterationMode } from './types';
import {
  createAgentSignalSelfIterationPrompt,
  createAgentSignalSelfIterationSystemRole,
} from '@lobechat/prompts';
import type { ExecuteSelfIterationContext, ExecuteSelfIterationInput } from './execute';
import { extractArtifacts, extractMutations } from './finalStateExtractor';

/**
 * Replacement for executeSelfIteration that routes through execAgent.
 *
 * LOBE-9454: Migrates the hand-rolled AgentRuntime loop from execute.ts
 * (new AgentRuntime + custom call_llm executor + closure accumulators)
 * to the unified execAgent entry point.
 *
 * Key differences vs. the old execute.ts path:
 * - No side-channel closures (ideas / intents / writeOutcomes stored in JS vars)
 * - All structured output flows through tool result `kind` field → AgentState
 * - extractArtifacts / extractMutations replace the six accumulator variables
 * - Runs as an async queue step → no Vercel timeout risk
 * - Full snapshot visibility → agent-tracing inspect works immediately
 *
 * The old executeSelfIteration function in execute.ts is retained during the
 * migration period and will be deleted by LOBE-9453 (#8 Cleanup) once all
 * callers have been switched to this function.
 */
export interface ExecuteViaExecAgentInput {
  agentId: string;
  context: ExecuteSelfIterationContext;
  db: LobeChatDatabase;
  maxSteps: number;
  mode?: IterationMode;
  model: string;
  sourceId: string;
  userId: string;
  window?: { end: string; localDate?: string; start: string; timezone?: string };
}

export interface ExecuteViaExecAgentResult {
  /** operationId returned by execAgent — use with agent-tracing inspect */
  operationId: string;
  /** Artifact tool results (ideas, intents) extracted from finalState */
  artifacts: ReturnType<typeof extractArtifacts>;
  /** Mutation tool results (memory writes, skill ops) extracted from finalState */
  mutations: ReturnType<typeof extractMutations>;
  /** Raw finalState for downstream projection / brief writing */
  finalState: Awaited<ReturnType<AiAgentService['execAgent']>>['finalState'];
}

export const executeViaExecAgent = async (
  input: ExecuteViaExecAgentInput,
): Promise<ExecuteViaExecAgentResult> => {
  const mode: IterationMode = input.mode ?? 'review';

  // Map mode to slug
  const slug =
    mode === 'review'
      ? BUILTIN_AGENT_SLUGS.nightlyReview
      : mode === 'reflection'
        ? BUILTIN_AGENT_SLUGS.selfReflection
        : BUILTIN_AGENT_SLUGS.selfFeedbackIntent;

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

  const systemRoleOverride = createAgentSignalSelfIterationSystemRole(mode);

  const aiAgentService = new AiAgentService(input.db, input.userId);

  const result = await aiAgentService.execAgent({
    appContext: {
      scope: 'chat',
      suppressSignal: true, // #2: do not re-enter AgentSignal pipeline
      trigger: RequestTrigger.AgentSignal,
    },
    autoStart: true,
    maxSteps: input.maxSteps,
    prompt,
    slug,
    systemRoleOverride,
  });

  const { operationId, finalState } = result;

  return {
    artifacts: finalState ? extractArtifacts(finalState) : [],
    finalState,
    mutations: finalState ? extractMutations(finalState) : [],
    operationId,
  };
};
