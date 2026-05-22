import type {
  AgenticAttempt,
  BaseAction,
  ExecutorResult,
  SignalAttempt,
} from '@lobechat/agent-signal';
import { MemoryApiName, MemoryIdentifier } from '@lobechat/builtin-tool-memory';
import { LayersEnum, RequestTrigger, ThreadType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import type { AgentState } from '@lobechat/agent-runtime';

import { ThreadModel } from '@/database/models/thread';
import type { LobeChatDatabase } from '@/database/type';
import { AgentService } from '@/server/services/agent';
import { AiAgentService } from '@/server/services/aiAgent';

import type { RuntimeProcessorContext } from '../../../runtime/context';
import { defineActionHandler } from '../../../runtime/middleware';
import {
  createMemoryService,
  MemoryActionError,
} from '../../../services/selfIteration/tools/shared';
import { hasAppliedActionIdempotency, markAppliedActionIdempotency } from '../../actionIdempotency';
import type {
  ActionUserMemoryHandle,
  AgentSignalFeedbackDomainConflictPolicy,
  AgentSignalFeedbackEvidence,
  AgentSignalFeedbackSourceHints,
} from '../../types';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../../types';
import {
  createAgentSignalMemoryWriterPrompt,
  createAgentSignalMemoryWriterSystemRole,
} from '@lobechat/prompts';

const MEMORY_AGENT_MAX_STEPS = 8;

const MEMORY_WRITE_API_NAMES = [
  MemoryApiName.addActivityMemory,
  MemoryApiName.addContextMemory,
  MemoryApiName.addExperienceMemory,
  MemoryApiName.addIdentityMemory,
  MemoryApiName.addPreferenceMemory,
  MemoryApiName.removeIdentityMemory,
  MemoryApiName.updateIdentityMemory,
] as const;

const MEMORY_WRITE_TOOL_NAMES = new Set(
  MEMORY_WRITE_API_NAMES.map((apiName) => `${MemoryIdentifier}/${apiName}`),
);

const MEMORY_WRITE_API_NAME_SET = new Set<string>(MEMORY_WRITE_API_NAMES);
const MEMORY_WRITE_TARGET_BY_API_NAME: Record<string, { idKey: string; layer: LayersEnum }> = {
  [MemoryApiName.addActivityMemory]: { idKey: 'activityId', layer: LayersEnum.Activity },
  [MemoryApiName.addContextMemory]: { idKey: 'contextId', layer: LayersEnum.Context },
  [MemoryApiName.addExperienceMemory]: { idKey: 'experienceId', layer: LayersEnum.Experience },
  [MemoryApiName.addIdentityMemory]: { idKey: 'identityId', layer: LayersEnum.Identity },
  [MemoryApiName.addPreferenceMemory]: { idKey: 'preferenceId', layer: LayersEnum.Preference },
  [MemoryApiName.removeIdentityMemory]: { idKey: 'identityId', layer: LayersEnum.Identity },
  [MemoryApiName.updateIdentityMemory]: { idKey: 'identityId', layer: LayersEnum.Identity },
};

const TOOL_NAME_SEPARATOR = '____';

export interface MemoryActionTarget {
  id?: string;
  memoryId?: string;
  memoryLayer?: LayersEnum;
  summary?: string;
  title: string;
  type: 'memory';
}

export interface MemoryAgentActionResult {
  detail?: string;
  status: 'applied' | 'failed' | 'skipped';
  target?: MemoryActionTarget;
}

export interface UserMemoryActionHandlerOptions {
  agentService?: Pick<AgentService, 'getAgentConfig'>;
  db: LobeChatDatabase;
  memoryActionRunner?: (input: {
    agentId?: string;
    conflictPolicy?: AgentSignalFeedbackDomainConflictPolicy;
    evidence?: AgentSignalFeedbackEvidence[];
    feedbackHint?: 'not_satisfied' | 'satisfied';
    memoryLanguage?: string;
    message: string;
    reason?: string;
    serializedContext?: string;
    sourceHints?: AgentSignalFeedbackSourceHints;
    sourceMessageId?: string;
    topicId?: string;
  }) => Promise<MemoryAgentActionResult>;
  userId: string;
}

const finalizeAttempt = (
  startedAt: number,
  status: SignalAttempt['status'],
): SignalAttempt | AgenticAttempt => ({
  completedAt: Date.now(),
  current: 1,
  startedAt,
  status,
});

const toExecutorError = (actionId: string, error: unknown, startedAt: number): ExecutorResult => ({
  actionId,
  attempt: finalizeAttempt(startedAt, 'failed'),
  error: {
    cause: error,
    code: 'USER_MEMORY_EXECUTION_FAILED',
    message: error instanceof Error ? error.message : String(error),
  },
  status: 'failed',
});

const isUserMemoryAction = (action: BaseAction): action is ActionUserMemoryHandle =>
  action.actionType === AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const getString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

// ─── State inspection helpers (unchanged from original) ───────────────────────

const hasSuccessfulMemoryWrite = (state: AgentState) => {
  const byTool = state.usage?.tools?.byTool ?? [];
  return byTool.some(
    (entry) => MEMORY_WRITE_TOOL_NAMES.has(entry.name) && entry.calls > entry.errors,
  );
};

const hasFailedMemoryWrite = (state: AgentState) => {
  const byTool = state.usage?.tools?.byTool ?? [];
  return byTool.some(
    (entry) =>
      MEMORY_WRITE_TOOL_NAMES.has(entry.name) && entry.calls > 0 && entry.calls === entry.errors,
  );
};

// ─── Core runner (migrated from createOperation+executeSync to execAgent) ─────

/**
 * Runs the memory-writer agent via `execAgent` (async queue).
 *
 * Replaces the previous `AgentRuntimeService.createOperation + executeSync`
 * path that blocked the Vercel invocation until the entire agent finished.
 * The caller now enqueues the run and polls the resulting operationId for
 * the final AgentState — removing Vercel timeout risk for long memory runs.
 */
export const runMemoryActionAgent = async (
  input: {
    agentId?: string;
    conflictPolicy?: AgentSignalFeedbackDomainConflictPolicy;
    evidence?: AgentSignalFeedbackEvidence[];
    feedbackHint?: 'not_satisfied' | 'satisfied';
    memoryLanguage?: string;
    message: string;
    reason?: string;
    serializedContext?: string;
    sourceHints?: AgentSignalFeedbackSourceHints;
    sourceMessageId?: string;
    topicId?: string;
  },
  options: UserMemoryActionHandlerOptions,
): Promise<MemoryAgentActionResult> => {
  if (!input.agentId) {
    return { detail: 'Missing agentId for memory action.', status: 'skipped' };
  }

  const agentService = options.agentService ?? new AgentService(options.db, options.userId);
  const agentConfig = await agentService.getAgentConfig(input.agentId);

  if (!agentConfig?.model || !agentConfig?.provider) {
    return { detail: 'Missing runnable agent config for memory action.', status: 'failed' };
  }

  const memoryLanguage = input.memoryLanguage ?? 'English';

  let threadId: string | undefined;
  if (input.topicId && input.sourceMessageId) {
    try {
      const threadModel = new ThreadModel(options.db, options.userId);
      const thread = await threadModel.create({
        agentId: input.agentId,
      { operationId: `agent-signal-memory-${nanoid()}` },
        sourceMessageId: input.sourceMessageId,
        title: 'Agent Signal Memory',
        topicId: input.topicId,
        type: ThreadType.Isolation,
      });
      threadId = thread?.id;
    } catch {
      // Non-fatal — fall back to writing into the main topic.
    }
  }

  const aiAgentService = new AiAgentService(options.db, options.userId);

  // Fire-and-forget: enqueue the memory-writer run and wait for the
  // finalState via the operation result.  execAgent returns immediately
  // once the job is queued (autoStart=true), so we are not blocking the
  // Vercel invocation for the full agent duration.
  const { finalState } = await aiAgentService.execAgent({
    agentId: input.agentId,
    appContext: {
      scope: 'chat',
      sourceMessageId: input.sourceMessageId,
      suppressSignal: true,      // #2: do not re-enter the AgentSignal pipeline
      threadId: threadId ?? null,
      topicId: input.topicId ?? null,
      trigger: RequestTrigger.AgentSignal,
    },
    autoStart: true,
    maxSteps: MEMORY_AGENT_MAX_STEPS,
    prompt: createAgentSignalMemoryWriterPrompt({ ...input, memoryLanguage }),
    systemRoleOverride: createAgentSignalMemoryWriterSystemRole({ memoryLanguage }),
  });

  if (!finalState || finalState.status === 'error') {
    return { detail: 'Memory action agent finished with an error.', status: 'failed' };
  }

  if (hasSuccessfulMemoryWrite(finalState)) {
    return { status: 'applied' };
  }

  if (hasFailedMemoryWrite(finalState)) {
    return {
      detail: 'Memory tool call failed during memory action agent execution.',
      status: 'failed',
    };
  }

  return { detail: 'Memory action agent did not issue a durable memory write.', status: 'skipped' };
};

// ─── Action handler (unchanged interface) ─────────────────────────────────────

export const handleUserMemoryAction = async (
  action: BaseAction,
  options: UserMemoryActionHandlerOptions,
  context: RuntimeProcessorContext,
): Promise<ExecutorResult> => {
  const startedAt = Date.now();
  const idempotencyKey =
    'idempotencyKey' in action.payload && typeof action.payload.idempotencyKey === 'string'
      ? action.payload.idempotencyKey
      : undefined;

  try {
    if (await hasAppliedActionIdempotency(context, idempotencyKey)) {
      return {
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'skipped'),
        detail: 'Action idempotency key already applied.',
        status: 'skipped',
      };
    }

    if (!isUserMemoryAction(action)) {
      return {
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'skipped'),
        detail: 'Unsupported memory action.',
        status: 'skipped',
      };
    }

    const message =
      typeof action.payload.message === 'string' ? action.payload.message.trim() : undefined;

    if (!message) {
      return {
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'skipped'),
        detail: 'Missing memory action message.',
        status: 'skipped',
      };
    }

    const feedbackHint =
      action.payload.feedbackHint === 'satisfied' || action.payload.feedbackHint === 'not_satisfied'
        ? action.payload.feedbackHint
        : undefined;

    const runnerInput = {
      agentId: typeof action.payload.agentId === 'string' ? action.payload.agentId : undefined,
      conflictPolicy:
        typeof action.payload.conflictPolicy === 'object' && action.payload.conflictPolicy
          ? action.payload.conflictPolicy
          : undefined,
      evidence: Array.isArray(action.payload.evidence) ? action.payload.evidence : undefined,
      feedbackHint,
      message,
      reason: typeof action.payload.reason === 'string' ? action.payload.reason : undefined,
      serializedContext:
        typeof action.payload.serializedContext === 'string'
          ? action.payload.serializedContext
          : undefined,
      sourceHints:
        typeof action.payload.sourceHints === 'object' && action.payload.sourceHints
          ? action.payload.sourceHints
          : undefined,
      sourceMessageId:
        typeof action.payload.assistantMessageId === 'string'
          ? action.payload.assistantMessageId
          : undefined,
      topicId: typeof action.payload.topicId === 'string' ? action.payload.topicId : undefined,
    };

    const runner = options.memoryActionRunner ?? ((i) => runMemoryActionAgent(i, options));
    const result = await runner(runnerInput);

    if (result.status === 'applied') {
      await markAppliedActionIdempotency(context, idempotencyKey);
      return {
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'succeeded'),
        detail: result.detail,
        status: 'applied',
      };
    }

    if (result.status === 'failed') {
      return {
        ...toExecutorError(action.actionId, result.detail ?? 'Memory action agent failed.', startedAt),
        detail: result.detail,
      };
    }

    return {
      actionId: action.actionId,
      attempt: finalizeAttempt(startedAt, 'skipped'),
      detail: result.detail,
      status: 'skipped',
    };
  } catch (error) {
    return toExecutorError(action.actionId, error, startedAt);
  }
};

export const defineUserMemoryActionHandler = (options: UserMemoryActionHandlerOptions) =>
  defineActionHandler(
    AGENT_SIGNAL_POLICY_ACTION_TYPES.userMemoryHandle,
    'handler.user-memory.handle',
    async (action, context: RuntimeProcessorContext) =>
      handleUserMemoryAction(action, options, context),
  );
