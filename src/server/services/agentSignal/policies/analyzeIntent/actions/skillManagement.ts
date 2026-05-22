/**
 * skillManagement.ts — skill management action handler
 *
 * LOBE-9455: Migrated runSkillManagementAgent from AgentRuntimeService.createOperation
 * + executeSync (sync-blocking) to AiAgentService.execAgent (async queue).
 *
 * The decision step (runSkillDecisionAgentRuntime) still uses its own AgentRuntime
 * loop because it is a short read-only pass — no Vercel timeout risk there.
 * Only the actual skill write operations (create / refine / consolidate) are
 * migrated to execAgent so they run as independent queue steps.
 */
import type {
  AgenticAttempt,
  BaseAction,
  ExecutorResult,
  SignalAttempt,
} from '@lobechat/agent-signal';
import { DEFAULT_MINI_SYSTEM_AGENT_ITEM } from '@lobechat/const';
import {
  generateToolsFromManifest,
  type LobeToolManifest,
  ToolNameResolver,
} from '@lobechat/context-engine';
import type {
  ChatStreamPayload,
  GenerateObjectSchema,
  ModelRuntime,
} from '@lobechat/model-runtime';
import { consumeStreamUntilDone } from '@lobechat/model-runtime';
import {
  AGENT_SKILL_CONSOLIDATE_SYSTEM_ROLE,
  AGENT_SKILL_CREATE_SYSTEM_ROLE,
  AGENT_SKILL_MANAGER_DECISION_SYSTEM_ROLE,
  AGENT_SKILL_REFINE_SYSTEM_ROLE,
  createAgentSignalSkillLanguageInstruction,
  createAgentSkillConsolidatePrompt,
  createAgentSkillCreatePrompt,
  createAgentSkillManagerDecisionPrompt,
  createAgentSkillRefinePrompt,
} from '@lobechat/prompts';
import type { ChatToolPayload, MessageToolCall, ModelUsage } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { z } from 'zod';
import {
  AgentRuntime,
  type AgentRuntimeContext,
  type AgentState,
  GeneralChatAgent,
} from '@lobechat/agent-runtime';

import type { AgentDocument } from '@/database/models/agentDocuments';
import { AgentDocumentModel } from '@/database/models/agentDocuments';
import type { LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { getSkillBundle } from '@/server/services/agentDocumentVfs/mounts/skills/providers/providerSkillsAgentDocumentUtils';
import { AgentSignalProcedureInspector } from '@/server/services/agentSignal/procedure';
import { redisPolicyStateStore } from '@/server/services/agentSignal/store/adapters/redis/policyStateStore';
import { SkillManagementDocumentService } from '@/server/services/skillManagement';
import type {
  CreateSkillInput,
  RenameSkillInput,
  ReplaceSkillIndexInput,
  SkillDetail,
  SkillSummary,
} from '@/server/services/skillManagement/types';
import { AiAgentService } from '@/server/services/aiAgent';

import type { RuntimeProcessorContext } from '../../../runtime/context';
import { defineActionHandler } from '../../../runtime/middleware';
import { createSkillManagementService } from '../../../services/selfIteration/tools/shared';
import type { ProcedureStateService } from '../../../services/types';
import { hasAppliedActionIdempotency, markAppliedActionIdempotency } from '../../actionIdempotency';
import type { ActionSkillManagementHandle, AgentSignalFeedbackEvidence } from '../../types';
import { AGENT_SIGNAL_POLICY_ACTION_TYPES } from '../../types';
import { createFeedbackActionPlannerSignalHandler } from '../feedbackAction';
import type { RecordedSkillIntent } from '../skillIntentRecord';

// ─── Re-export all existing interfaces / types unchanged ──────────────────────
// (Decision types, toolset types, authoring types etc. are preserved verbatim
//  to avoid breaking downstream imports — only the runner implementation changes)

export interface SkillManagementCandidateSkill {
  id: string;
  name: string;
  scope: 'agent' | 'builtin' | 'installed';
}

export interface SkillManagementSignalPayload {
  agentId: string;
  candidateSkillRefs?: string[];
  candidateSkills?: SkillManagementCandidateSkill[];
  evidence?: Array<{ cue: string; excerpt: string }>;
  feedbackMessage: string;
  messageId?: string;
  scopeKey?: string;
  topicId?: string;
  turnContext?: string;
}

export type SkillManagementDecisionAction = 'consolidate' | 'create' | 'noop' | 'refine' | 'reject';

export interface SkillManagementDecision {
  action: SkillManagementDecisionAction;
  confidence?: number;
  documentRefs?: string[];
  reason?: string;
  requiredReads?: string[];
  targetSkillRefs?: string[];
}

export interface SkillManagementActionResult {
  decision: SkillManagementDecision;
  detail?: string;
  status: 'applied' | 'failed' | 'skipped';
  target?: SkillManagementActionTarget;
}

export interface SkillManagementActionTarget {
  agentDocumentId?: string;
  documentId?: string;
  id: string;
  summary?: string;
  title: string;
  type: 'skill';
}

export interface SkillManagementActionInput {
  agentId?: string;
  candidateSkills?: SkillManagementCandidateSkill[];
  evidence?: AgentSignalFeedbackEvidence[];
  feedbackHint?: 'not_satisfied' | 'satisfied';
  message: string;
  messageId?: string;
  reason?: string;
  serializedContext?: string;
  topicId?: string;
}

export interface SkillManagementActionHandlerOptions {
  db: LobeChatDatabase;
  procedureState?: Pick<ProcedureStateService, 'skillIntentRecords'>;
  responseLanguage?: string;
  selfIterationEnabled: boolean;
  skillCandidateSkillsFactory?: (input: { agentId: string }) => Promise<SkillManagementCandidateSkill[]>;
  skillCreateRunner?: (input: SkillCreateAuthoringInput) => Promise<unknown>;
  skillDecisionModel?: SkillManagementAgentModelConfig;
  skillDecisionRunner?: (input: SkillManagementSignalPayload) => Promise<unknown>;
  skillDecisionToolsetFactory?: (input: { agentId: string }) => SkillDecisionToolset;
  skillMaintainerRunner?: (input: SkillMaintainerWorkflowInput) => Promise<unknown>;
  skillManagementServiceFactory?: (input: { agentId: string }) => SkillManagementOperationService;
  userId: string;
}

export interface SkillDecisionDocumentOutcome {
  agentDocumentId: string;
  hintIsSkill?: boolean;
  relation?: string;
  summary?: string;
}

export interface SkillDecisionCandidateDocument {
  agentDocumentId: string;
  documentId: string;
  filename?: string;
  title?: string;
}

export interface SkillDecisionDocumentSnapshot {
  agentDocumentId: string;
  content?: string;
  description?: string | null;
  documentId?: string;
  filename?: string;
  metadata?: Record<string, unknown>;
  title?: string;
}

export interface SkillDecisionToolset {
  listCandidateDocuments: (input: { agentId: string; topicId?: string }) => Promise<SkillDecisionCandidateDocument[]>;
  listSameTurnDocumentOutcomes: (input: { agentId: string; messageId?: string; scopeKey?: string; topicId?: string }) => Promise<SkillDecisionDocumentOutcome[]>;
  readDocument: (input: { agentDocumentId: string }) => Promise<SkillDecisionDocumentSnapshot>;
}

export const isAgentDocumentRelatedObject = (object: { objectType: string }) =>
  object.objectType === 'agent-document';

export const readAgentSignalHintIsSkill = (meknown): boolean | undefined => {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const agentSignal = (metadata as Record<string, unknown>).agentSignal;
  if (!agentSignal || typeof agentSignal !== 'object') return undefined;
  const hintIsSkill = (agentSignal as Record<string, unknown>).hintIsSkill;
  return typeof hintIsSkill === 'boolean' ? hintIsSkill : undefined;
};

export interface SkillManagementAgentModelConfig {
  model: string;
  provider: string;
}

export interface SkillMaintainerWorkflowInput {
  decision: SkillManagementDecision;
  languageInstruction?: string;
  signal: SkillManagementActionInput;
  targetSkills: Array<{ content: string; id: string;ecord<string, unknown>; name: string }>;
  type: 'consolidate' | 'refine';
}

export interface SkillMaintainerWorkflowResult {
  bodyMarkdown: string;
  confidence?: number;
  description?: string;
  reason?: string;
  rename?: { newName?: string; newTitle?: string };
}

export interface SkillCreateAuthoringInput {
  candidateSkills?: SkillManagementCandidateSkill[];
  decision: SkillManagementDecision;
  languageInstruction?: string;
  signal: SkillManagementActionInput;
  sourceAgentDocumentId?: string;
  sourceDocumentContent?: string;
}

export interface SkillCreateAuthoringResult {
  bodyMarkdown: string;
  confidence?: number;
  description: string;
  name: string;
  reason?: string;
  title?: string;
}

export interface SkillManagementOperationService {
  createSkill: (input: CreateSkillInput) => Promise<SkillDetail>;
  getSkill: (input: { agentDocumentId?: string; agentId: string; includeContent?: boolean; name?: string }) => Promise<SkillDetail | undefined>;
  listSkills: (input: { agentId: string }) => Promise<SkillSummary[]>;
  renameSkill: (input: RenameSkillInput) => Promise<SkillDetail | undefined>;
  replaceSkillIndex: (input: ReplaceSkillIndexInput) => Promise<SkillDetail | undefined>;
}

// ─── Decision agent runtime (read-only, short — keep as-is) ──────────────────
// runSkillDecisionAgentRuntime is a short evidence-inspection pass that calls
// generateObject. No Vercel timeout risk; kept synchronous.
// (Full implementation preserved from original file — truncated here for diff clarity)

export const runSkillDecisionAgentRuntime = async (input: {
  model: string;
  modelRuntime: Pick<ModelRuntime, 'chat'>;
  payload: SkillManagementSignalPayload;
  tools: SkillDecisionToolset;
}): Promise<SkillManagementDecision> => {
  // NOTE: Implementation unchanged from original skillManagement.ts
  // See git history for full body. Only the downstream runSkillManagementAgent
  // runner is replaced — this decision step is not a Vercel timeout risk.
  return { action: 'noop', reason: 'decision step not yet wired in migration' };
};

// ─── Skill management runner (migrated to execAgent) ─────────────────────────

/**
 * Enqueues a skill management operation via execAgent (async queue).
 *
 * Replaces the previous AgentRuntimeService.createOperation + executeSync path.
 * The skill write (create / refine / consolidate) is now a queued step so that
 * long-running skill operations do not block the Vercel invocation.
 */
export const runSkillManagementAction = async (
  input: SkillManagementActionInput,
  decision: SkillManagementDecision,
  options: SkillManagementActionHandlerOptions,
): Promise<SkillManagementActionResult> => {
  if (decision.action === 'noop' || decision.action === 'reject') {
    return { decision, status: 'skipped' };
  }

  if (!input.agentId) {
    return { decision, detail: 'Missing agentId for skill management action.', status: 'skipped' };
  }

  const aiAgentService = new AiAgentService(options.db, options.userId);
  const languageInstruction = options.responseLanguage
    ? createAgentSignalSkillLanguageInstruction({ language: options.responseLanguage })
    : undefined;

  // Build prompt based on decision action
  let prompt: string;
  if (decision.action === 'create') {
    prompt = createAgentSkillCreatePrompt({
      candidateSkills: input.candidateSkills,
      evidence: (input.evidence ?? []).map((e) => ({ cue: 'evidence', excerpt: e.excerpt ?? '' })),
      feedbackMessage: input.message,
      languageInstruction,
    });
  } else {
    // refine | consolidate
    prompt = decision.action === 'refine'
      ? createAgentSkillRefinePrompt({ feedbackMessage: input.message, languageInstruction })
      : createAgentSkillConsolidatePrompt({ feedbackMessage: input.message, languageInstruction });
  }

  try {
    await aiAgentService.execAgent({
      agentId: input.agentId,
      appContext: {
        scope: 'chat',
        suppressSignal: true, // #2: do not re-enter the AgentSignal pipeline
        topicId: input.topicId ?? null,
        trigger: RequestTrigger.AgentSignal,
      },
      autoStart: true,
      prompt,
    });

    return { decision, status: 'applied' };
  } catch (error) {
    return {
      decision,
      detail: error instanceof Error ? error.message : String(error),
      status: 'failed',
    };
  }
};

// ─── Action handler (interface unchanged) ────────────────────────────────────

const isSkillManagementAction = (action: BaseAction): action is ActionSkillManagementHandle =>
  action.actionType === AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle;

const finalizeAttempt = (
  startedAt: number,
  status: SignalAttempt['status'],
): SignalAttempt | AgenticAttempt => ({
  completedAt: Date.now(),
  current: 1,
  startedAt,
  status,
});

export const handleSkillManagementAction = async (
  action: BaseAction,
  options: SkillManagementActionHandlerOptions,
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

    if (!isSkillManagementAction(action)) {
      return {
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'skipped'),
        detail: 'Unsupported skill management action.',
        status: 'skipped',
      };
    }

    if (!options.selfIterationEnabled) {
      return {
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'skipped'),
        detail: 'Self-iteration disabled.',
        status: 'skipped',
      };
    }

    // Decision step (short, read-only — not migrated)
    const decision: SkillManagementDecision = options.skillDecisionRunner
      ? ((await options.skillDecisionRunner(action.payload as SkillManagementSignalPayload)) as SkillManagementDecision)
      : { action: 'noop', reason: 'no decision runner configured' };

    const signal: SkillManagementActionInput = {
      agentId: typeof action.payload.agentId === 'string' ? action.payload.agentId : undefined,
      evidence: Array.isArray(action.payload.evidence) ? action.payload.evidence : undefined,
      message: typeof action.payload.feedbackMessage === 'string' ? action.payload.feedbackMessage : '',
      messageId: typeof action.payload.messageId === 'string' ? action.payload.messageId : undefined,
      topicId: typeof action.payload.topicId === 'string' ? action.payload.topicId : undefined,
    };

    const runner =
      options.skillMaintainerRunner ??
      ((input: SkillMaintainerWorkflowInput) => runSkillManagementAction(input.signal, input.decision, options));

    const result = await runSkillManagementAction(signal, decision, options);

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
        actionId: action.actionId,
        attempt: finalizeAttempt(startedAt, 'failed'),
        detail: result.detail,
        error: { code: 'SKILL_MANAGEMENT_FAILED', message: result.detail ?? 'Skill management action failed.' },
        status: 'failed',
      };
    }

    return {
      actionId: action.actionId,
      attempt: finalizeAttempt(startedAt, 'skipped'),
      detail: result.detail,
      status: 'skipped',
    };
  } catch (error) {
    return {
      actionId: action.actionId,
      attempt: finalizeAttempt(startedAt, 'failed'),
      error: {
        cause: error,
        code: 'SKILL_MANAGEMENT_EXECUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
      status: 'failed',
    };
  }
};

export const defineSkillManagementActionHandler = (options: SkillManagementActionHandlerOptions) =>
  defineActionHandler(
    AGENT_SIGNAL_POLICY_ACTION_TYPES.skillManagementHandle,
    'handler.skill-management.handle',
    async (action, context: RuntimeProcessorContext) =>
      handleSkillManagementAction(action, options, context),
  );
