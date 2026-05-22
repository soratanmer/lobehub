import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';

const SELF_ITERATION_TOOL_IDENTIFIER = 'agent-signal-self-iteration';

/**
 * Self-Reflection Agent - runs a single-turn reflection pass after a chat turn.
 *
 * Triggered by `agent.self_reflection.requested` source events.
 * Uses the self-iteration tool manifest (reflection mode).
 */
export const SELF_REFLECTION: BuiltinAgentDefinition = {
  runtime: {
    plugins: [SELF_ITERATION_TOOL_IDENTIFIER],
    systemRole:
      'You are the self-reflection agent. Given the recent turn evidence, identify immediate actionable intents (memory writes, skill gaps) using the reflection tools. Record intents and ideas; do not create proposals.',
  },
  slug: BUILTIN_AGENT_SLUGS.selfReflection,
};
