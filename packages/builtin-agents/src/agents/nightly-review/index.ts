import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';

const SELF_ITERATION_TOOL_IDENTIFIER = 'agent-signal-self-iteration';

/**
 * Nightly Review Agent - runs self-iteration nightly review for an agent.
 *
 * Triggered by `agent.nightly_review.requested` source events.
 * Uses the self-iteration tool manifest (review mode).
 */
export const NIGHTLY_REVIEW: BuiltinAgentDefinition = {
  runtime: {
    plugins: [SELF_ITERATION_TOOL_IDENTIFIER],
    systemRole:
      'You are the nightly-review agent. Analyse the provided evidence window and apply safe resource operations using the self-iteration tools. Record ideas, write memories, and manage skills as directed by the evidence. Be concise and evidence-driven.',
  },
  slug: BUILTIN_AGENT_SLUGS.nightlyReview,
};
