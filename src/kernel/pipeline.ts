import type { RequestContext } from '../types.js';
import { DeterministicPlanner } from './planner.js';
import type { IntegrationRegistry } from './registry.js';
import { cloneRequestContext, transactProposal } from './transaction.js';
import type {
  PlanDecision,
  ProcessorIntegration,
  ProposalValidation,
  RuntimeMode,
  TransactionErrorCode,
  TransactionResult,
  TransformProposal,
} from './types.js';
import type { ReversibleHandle, StageResult } from '../types.js';

export type PipelineErrorCode = TransactionErrorCode | 'proposal_failed' | 'proposal_invalid';

export interface PipelineError {
  readonly integrationId: string;
  readonly error: PipelineErrorCode;
}

export interface PipelineHooks {
  readonly mode?: RuntimeMode;
  readonly validate?: ProposalValidation;
  readonly beforeIntegration?: (
    integration: ProcessorIntegration,
    ctx: Readonly<RequestContext>,
  ) => boolean | Promise<boolean>;
}

export interface PipelineResult {
  readonly mode: RuntimeMode;
  readonly decisions: readonly PlanDecision[];
  readonly transactions: readonly TransactionResult[];
  readonly errors: readonly PipelineError[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isReversibleHandle(value: unknown): value is ReversibleHandle {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!['optical', 'semantic', 'virtual'].includes(String(value.origin))) return false;
  if (value.original !== undefined && typeof value.original !== 'string') return false;
  if (value.contentType !== undefined && typeof value.contentType !== 'string') return false;
  if (value.ratio !== undefined && (typeof value.ratio !== 'number' || !Number.isFinite(value.ratio))) {
    return false;
  }
  return value.regionId === undefined || typeof value.regionId === 'string';
}

function isStageResult(value: unknown): value is StageResult {
  if (!isRecord(value)) return false;
  if (!['optical', 'semantic', 'virtual'].includes(String(value.stage))) return false;
  if (typeof value.applied !== 'boolean' || typeof value.reason !== 'string') return false;
  if (value.detail !== undefined && typeof value.detail !== 'string') return false;
  if (!isRecord(value.counterfactual)) return false;
  const counterfactual = value.counterfactual;
  if (
    !['tokensText', 'tokensCompressed', 'tokensSaved'].every(
      (key) => typeof counterfactual[key] === 'number' && Number.isFinite(counterfactual[key]),
    ) ||
    !['anthropic-count_tokens', 'gpt-tokenizer', 'tiktoken', 'estimate'].includes(
      String(counterfactual.basis),
    )
  ) {
    return false;
  }
  return Array.isArray(value.reversible) && value.reversible.every(isReversibleHandle);
}

function ownedProposal(
  integration: ProcessorIntegration,
  rawProposal: TransformProposal,
  ctx: Readonly<RequestContext>,
): TransformProposal {
  const proposal = structuredClone(rawProposal);
  if (proposal == null || typeof proposal !== 'object' || Array.isArray(proposal)) {
    throw new TypeError('proposal must be an object');
  }
  if (typeof proposal.id !== 'string' || proposal.id.length === 0) {
    throw new TypeError('proposal id must be a non-empty string');
  }
  if (proposal.integrationId !== integration.id) {
    throw new TypeError('proposal integration id does not match its owner');
  }
  if (!Array.isArray(proposal.regions)) {
    throw new TypeError('proposal regions must be an array');
  }
  const allowedRegions = new Set(integration.capabilities.regions);
  if (
    new Set(proposal.regions).size !== proposal.regions.length ||
    proposal.regions.some((region) => !allowedRegions.has(region))
  ) {
    throw new TypeError('proposal claims an undeclared region');
  }
  if (proposal.fidelity !== integration.capabilities.fidelity) {
    throw new TypeError('proposal fidelity does not match its capabilities');
  }
  const expectedCacheImpact = proposal.regions.length === 0
    ? 'preserve'
    : integration.capabilities.cacheImpact;
  if (proposal.cacheImpact !== expectedCacheImpact) {
    throw new TypeError('proposal cache impact does not match its capabilities');
  }
  if (proposal.patch == null || typeof proposal.patch !== 'object' || Array.isArray(proposal.patch)) {
    throw new TypeError('proposal patch must be an object');
  }
  if (
    proposal.patch.replaceBody !== undefined &&
    (proposal.patch.replaceBody == null ||
      typeof proposal.patch.replaceBody !== 'object' ||
      Array.isArray(proposal.patch.replaceBody))
  ) {
    throw new TypeError('replacement body must be an object');
  }
  if (
    proposal.patch.appendReversible !== undefined &&
    (!Array.isArray(proposal.patch.appendReversible) ||
      !proposal.patch.appendReversible.every(isReversibleHandle))
  ) {
    throw new TypeError('reversible handles must be valid');
  }
  if (
    proposal.patch.appendStages !== undefined &&
    (!Array.isArray(proposal.patch.appendStages) ||
      !proposal.patch.appendStages.every(isStageResult))
  ) {
    throw new TypeError('stage results must be valid');
  }
  if (
    proposal.patch.opticalOwnsCacheControl !== undefined &&
    typeof proposal.patch.opticalOwnsCacheControl !== 'boolean'
  ) {
    throw new TypeError('cache-control ownership must be boolean');
  }
  if (
    proposal.patch.virtualQueryToolNeeded !== undefined &&
    typeof proposal.patch.virtualQueryToolNeeded !== 'boolean'
  ) {
    throw new TypeError('virtual query state must be boolean');
  }
  if (
    proposal.patch.virtualContextIds !== undefined &&
    (!Array.isArray(proposal.patch.virtualContextIds) ||
      proposal.patch.virtualContextIds.some((id) => typeof id !== 'string'))
  ) {
    throw new TypeError('virtual context ids must be strings');
  }
  const mutatesOwnedState =
    proposal.patch.replaceBody !== undefined ||
    (proposal.patch.appendReversible?.length ?? 0) > 0 ||
    proposal.patch.virtualQueryToolNeeded === true ||
    (proposal.patch.virtualContextIds?.length ?? 0) > 0 ||
    (proposal.patch.opticalOwnsCacheControl !== undefined &&
      proposal.patch.opticalOwnsCacheControl !== ctx.opticalOwnsCacheControl) ||
    (proposal.patch.virtualQueryToolNeeded !== undefined &&
      proposal.patch.virtualQueryToolNeeded !== ctx.virtualQueryToolNeeded);
  if (mutatesOwnedState && proposal.regions.length === 0) {
    throw new TypeError('state-changing proposal must claim a region');
  }
  return proposal;
}

/** Ordered analyze → plan → transactional-commit pipeline. */
export class IntegrationPipeline {
  constructor(
    private readonly registry: IntegrationRegistry,
    private readonly validate?: ProposalValidation,
  ) {}

  async run(ctx: RequestContext, hooks: PipelineHooks = {}): Promise<PipelineResult> {
    const mode = hooks.mode ?? 'optimize';
    const planner = new DeterministicPlanner();
    const decisions: PlanDecision[] = [];
    const transactions: TransactionResult[] = [];
    const errors: PipelineError[] = [];

    for (const integration of this.registry.ordered()) {
      if ((await hooks.beforeIntegration?.(integration, ctx)) === false) continue;
      if (mode === 'audit') continue;

      let rawProposal: TransformProposal;
      try {
        rawProposal = await integration.propose(cloneRequestContext(ctx));
      } catch {
        errors.push({ integrationId: integration.id, error: 'proposal_failed' });
        continue;
      }

      try {
        const proposal = ownedProposal(integration, rawProposal, ctx);
        const decision = planner.consider(proposal);
        decisions.push(decision);
        if (decision.status === 'rejected') continue;
        if (mode === 'shadow') {
          planner.commit(proposal);
          continue;
        }

        const transaction = await transactProposal(
          ctx,
          proposal,
          hooks.validate ?? this.validate,
          integration.commit
            ? (candidate, committedProposal, original) =>
                integration.commit!(candidate, committedProposal, original)
            : undefined,
        );
        transactions.push(transaction);
        if (transaction.status === 'committed') {
          planner.commit(proposal);
        } else {
          errors.push({ integrationId: integration.id, error: transaction.error });
        }
      } catch (error) {
        errors.push({ integrationId: integration.id, error: 'proposal_invalid' });
      }
    }

    return { mode, decisions, transactions, errors };
  }
}