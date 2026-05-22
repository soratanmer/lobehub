import type { LobeAgentChatConfig, LobeAgentConfig } from '@lobechat/types';

import type { GroupSupervisorContext } from './agents/group-supervisor/type';

/**
 * Builtin Agent Slugs - unique identifiers for builtin agents
 */
export const BUILTIN_AGENT_SLUGS = {
  agentBuilder: 'agent-builder',
  groupAgentBuilder: 'group-agent-builder',
  groupSupervisor: 'group-supervisor',
  inbox: 'inbox',
  nightlyReview: 'nightly-review',
  pageAgent: 'page-agent',
  selfFeedbackIntent: 'self-feedback-intent',
  selfReflection: 'self-reflection',
  taskAgent: 'task-agent',
  webOnboarding: 'web-onboarding',
} as const;

export type BuiltinAgentSlug = (typeof BUILTIN_AGENT_SLUGS)[keyof typeof BUILTIN_AGENT_SLUGS];

export interface BuiltinAgentPersistConfig {
  chatConfig?: Partial<LobeAgentChatConfig>;
  model?: string;
  provider?: string;
}

export interface BuiltinAgentRuntimeResult {
  chatConfig?: Partial<LobeAgentChatConfig>;
  plugins?: string[];
  systemRole: string;
}

export interface RuntimeContext {
  documentContent?: string;
  groupSupervisorContext?: GroupSupervisorContext;
  isDev?: boolean;
  model?: string;
  plugins?: string[];
  targetAgentConfig?: LobeAgentConfig;
  userLocale?: string;
}

export type BuiltinAgentRuntimeConfig =
  | ((ctx: RuntimeContext) => BuiltinAgentRuntimeResult)
  | BuiltinAgentRuntimeResult;

export interface BuiltinAgentDefinition {
  avatar?: string;
  persist?: BuiltinAgentPersistConfig;
  runtime: BuiltinAgentRuntimeConfig;
  slug: BuiltinAgentSlug;
}
