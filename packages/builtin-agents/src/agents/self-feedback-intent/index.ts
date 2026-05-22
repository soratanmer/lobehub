import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';

const SELF_ITERATION_TOOL_IDENTIFIER = 'agent-signal-self-iteration';

/**
 * Self-Feedback Intent Agent - executes a declared feedback intent (memory write, skill op).
 *
 * Triggered by `agent.self_feedback_intent.declared` source events.
 */
export const SELF_FEEDBACK_INTENT: BuiltinAgentDefinition = {
  runtime: {
    plugins: [SELF_ITERATION_TOOL_IDENTIFIER],
    systemRole:
      'You are the self-feedback-intent agent. Given a declared feedback intent, execute the appropriate tool operation (write memory, create/refine skill) with high confidence. Prefer direct mutation over proposals when confidence and evidence are clear.',
  },
  slug: BUILTIN_AGENT_SLUGS.selfFeedbackIntent,
};
