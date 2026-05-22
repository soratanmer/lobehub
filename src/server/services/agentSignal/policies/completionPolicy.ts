import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { defineAgentSignalHandlers, defineSourceHandler } from '../runtime/middleware';

/**
 * Handles `agent.execution.completed` source events emitted after every execAgent run
 * (including builtin background agents). Routes by `payload.agentId` to optional caller
 * callbacks so that side-effects (brief writing, receipt projection, idempotency marker)
 * happen asynchronously after the agent run finishes.
 *
 * Routing table:
 * - nightly-review        → write review brief / proposal
 * - self-reflection       → write reflection receipt
 * - self-feedback-intent  → write intent receipt
 * - anything else         → no-op (front-end chat is handled by clientRuntime* sources)
 *
 * Callbacks are fire-and-forget from the worker's perspective; failures are logged
 * but never re-trigger the source pipeline.
 *
 * NOTE on userId: the `agent.execution.completed` source payload today does not carry
 * userId, and `AgentSignalSource.scope` is not populated by renderers. Callers that
 * need userId should look it up via the operations table by `operationId`.
 */
export interface CompletionCallbackParams {
  agentId: string;
  operationId: string;
  /** Optional topic id forwarded from the source payload. */
  topicId?: string;
}

export interface CreateCompletionPolicyOptions {
  /** Called when a nightly-review run completes. */
  onNightlyReviewCompleted?: (params: CompletionCallbackParams) => Promise<void>;
  /** Called when a self-feedback-intent run completes. */
  onSelfFeedbackIntentCompleted?: (params: CompletionCallbackParams) => Promise<void>;
  /** Called when a self-reflection run completes. */
  onSelfReflectionCompleted?: (params: CompletionCallbackParams) => Promise<void>;
}

export const createCompletionPolicy = (options: CreateCompletionPolicyOptions = {}) => {
  return defineAgentSignalHandlers([
    defineSourceHandler(
      AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted,
      'agent.execution.completed:completion-fanout',
      async (source) => {
        const agentId = source.payload.agentId;
        const operationId = source.payload.operationId;
        const topicId = source.payload.topicId;

        if (!agentId || !operationId) return;

        const params: CompletionCallbackParams = {
          agentId,
          operationId,
          ...(topicId ? { topicId } : {}),
        };

        try {
          if (agentId === BUILTIN_AGENT_SLUGS.nightlyReview) {
            await options.onNightlyReviewCompleted?.(params);
          } else if (agentId === BUILTIN_AGENT_SLUGS.selfReflection) {
            await options.onSelfReflectionCompleted?.(params);
          } else if (agentId === BUILTIN_AGENT_SLUGS.selfFeedbackIntent) {
            await options.onSelfFeedbackIntentCompleted?.(params);
          }
        } catch (err) {
          // Non-fatal: completion policy failures must not block the AgentSignal worker
          // or cause source re-processing.
          console.error('[completionPolicy] post-completion handler failed', { agentId, err });
        }
      },
    ),
  ]);
};
