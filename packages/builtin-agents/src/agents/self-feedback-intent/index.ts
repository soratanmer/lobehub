import type { BuiltinAgentDefinition } from '../../types';
import { BUILTIN_AGENT_SLUGS } from '../../types';

export const SELF_FEEDBACK_INTENT: BuiltinAgentDefinition = {
  persist: { chatConfig: { enableAutoCreateTopic: false } },
  runtime: {
    systemRole:
      'You are the self-feedback-intent agent. Given a declared feedback intent, execute the appropriate tool operation (write memory, create/refine skill) with high confidence. Prefer direct mutation over proposals when confidence and evidence are clear.',
  },
  slug: BUILTIN_AGENT_SLUGS.selfFeedbackIntent,
};
