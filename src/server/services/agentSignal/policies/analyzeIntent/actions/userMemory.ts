import type {
  AgenticAttempt,
  BaseAction,
  ExecutorResult,
  SignalAttempt,
} from '@lobechat/agent-signal';
import {
  createAgentSignalMemoryWriterPrompt,
  createAgentSignalMemoryWriterSystemRole,
} from '@lobechat/prompts';
import { RequestTrigger, ThreadType } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

import { ThreadModel } from '@/database/models/thread';
import type { LobeChatDatabase } from '@/database/type';
import { AgentService } from '@/server/services/agent';
import { AiAgentService } from '@/server/services/aiAgent';

import type { RuntimeProcessorContext } from '../../../runtime/context';
import { defineActionHandler } from '../../../runtime/middleware';
import { hasAppliedActionIdempotency, markAppliedActionIdempotency } from '../../actionIdempotency';
import type {
  ActionUserMemoryHandle,
  AgentSignalFeedbackDomainConflictPolicy,
  AgentSignalFeedbackEvidence,
  AgentSignalFeedbackSourceHints,
} from '../../types';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../../types';

const MEMORY_AGENT_MAX_STEPS = 8;

export interface MemoryAgentActionResult {
  detail?: string;
  /** Set when execAgent successfully enqueued the run. */
  operationId?: string;
  status: 'applied' | 'failed' | 'skipped';
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

// ─── Core runner (migrated from createOperation+executeSync to execAgent) ─────

/**
 * Enqueues the memory-writer agent via `execAgent` and returns once the run is queued.
 *
 * Replaces the previous `AgentRuntimeService.createOperation + executeSync` path that
 * blocked the Vercel invocation until the entire agent finished. The actual memory
 * write happens asynchronously across subsequent QStash workflow steps.
 *
 * Post-completion bookkeeping (idempotency marker, receipt) is handled by the
 * `agent.execution.completed` listener policy — see `completionPolicy.ts` (#4).
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
        metadata: { operationId: `agent-signal-memory-${nanoid()}` },
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

  // Enqueue async memory-writer run. execAgent returns immediately after queueing;
  // the actual memory write happens in later QStash workflow invocations.
  const result = await aiAgentService.execAgent({
    agentId: input.agentId,
    appContext: {
      scope: 'agent-signal',
      sourceMessageId: input.sourceMessageId,
      suppressSignal: true,
      threadId: threadId ?? null,
      topicId: input.topicId ?? null,
    },
    autoStart: true,
    // No `systemRoleOverride` field exists on ExecAgentParams; the writer-specific
    // guidance is appended via `instructions` instead. A future iteration may
    // introduce a `memory-writer` builtin agent so the systemRole replaces, not appends.
    instructions: createAgentSignalMemoryWriterSystemRole({ memoryLanguage }),
    maxSteps: MEMORY_AGENT_MAX_STEPS,
    prompt: createAgentSignalMemoryWriterPrompt({ ...input, memoryLanguage }),
    trigger: RequestTrigger.AgentSignal,
  });

  if (!result.success) {
    return {
      detail: result.error ?? 'Failed to enqueue memory writer.',
      status: 'failed',
    };
  }

  return {
    detail: `Memory writer enqueued (operationId=${result.operationId}).`,
    operationId: result.operationId,
    status: 'applied',
  };
};

// ─── Action handler ──────────────────────────────────────────────────────────

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

    // 'applied' here means "successfully enqueued". The downstream completion
    // policy is responsible for marking idempotency only after the actual
    // memory write succeeds in finalState. We mark the idempotency key here
    // to prevent re-enqueueing while the queued run is in-flight — this
    // matches the pre-migration behaviour where the marker was set after the
    // synchronous run, but trades retry-on-failure for no-double-enqueue.
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
