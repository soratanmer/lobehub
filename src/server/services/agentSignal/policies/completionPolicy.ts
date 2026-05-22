import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import type { RuntimeProcessorContext } from '../runtime/context';
import { defineAgentSignalHandlers } from '../runtime/middleware';

/**
 * Handles `agent.execution.completed` source events emitted after every
 * execAgent run (including builtin background agents).
 *
 * Routing table:
 * - nightly-review  → write review brief (via briefs/selfReview)
 * - self-reflection → write reflection receipt
 * - self-feedback-intent → write intent receipt
 * - anything else   → no-op (front-end chat already handled by clientRuntime* sources)
 *
 * All post-completion writes are fire-and-forget from the worker's perspective;
 * failures are logged but do not re-trigger the source pipeline.
 */
export interface CreateCompletionPolicyOptions {
  /**
   * Called when a nightly-review run completes. Receives the operationId so
   * the writer can load finalState from the snapshot store.
   */
  onNightlyReviewCompleted?: (params: {
    agentId: string;
    operationId: string;
    userId: string;
  }) => Promise<void>;
  /**
   * Called when a self-feedback-intent run completes.
   */
  onSelfFeedbackIntentCompleted?: (params: {
    agentId: string;
    operationId: string;
    userId: string;
  }) => Promise<void>;
  /**
   * Called when a self-reflection run completes.
   */
  onSelfReflectionCompleted?: (params: {
    agentId: string;
    operationId: string;
    userId: string;
  }) => Promise<void>;
}

export const createCompletionPolicy = (options: CreateCompletionPolicyOptions = {}) => {
  return defineAgentSignalHandlers([
    {
      handle: async (source, context: RuntimeProcessorContext) => {
        if (source.sourceType !== AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted) return;

        const { agentId, operationId } = source.payload as {
          agentId?: string;
          operationId: string;
        };
        const userId = context.userId;

        if (!agentId || !operationId || !userId) return;

        try {
          if (agentId === BUILTIN_AGENT_SLUGS.nightlyReview) {
            await options.onNightlyReviewCompleted?.({ agentId, operationId, userId });
          } else if (agentId === BUILTIN_AGENT_SLUGS.selfReflection) {
            await options.onSelfReflectionCompleted?.({ agentId, operationId, userId });
          } else if (agentId === BUILTIN_AGENT_SLUGS.selfFeedbackIntent) {
            await options.onSelfFeedbackIntentCompleted?.({ agentId, operationId, userId });
          }
        } catch (err) {
          // Non-fatal: log and continue. Completion policy failures must not
          // block the AgentSignal worker or cause source re-processing.
          console.error('[completionPolicy] post-completion handler failed', { agentId, err });
        }
      },
      sourceType: AGENT_SIGNAL_SOURCE_TYPES.agentExecutionCompleted,
    },
  ]);
};
