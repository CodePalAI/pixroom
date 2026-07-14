import type { IntegrationId, PlanDecision, RegionKind, TransformProposal } from './types.js';

/** Deterministic v1 planner: dependencies/conflicts first, then exclusive regions. */
export class DeterministicPlanner {
  private readonly selected = new Set<IntegrationId>();
  private readonly regionOwners = new Map<RegionKind, IntegrationId>();

  consider(proposal: TransformProposal): PlanDecision {
    const missing = proposal.dependsOn?.find((id) => !this.selected.has(id));
    if (missing !== undefined) {
      return { status: 'rejected', proposal, reason: 'missing_dependency' };
    }

    const conflict = proposal.conflictsWith?.find((id) => this.selected.has(id));
    if (conflict !== undefined) {
      return { status: 'rejected', proposal, reason: 'conflict' };
    }

    const owned = proposal.regions.find((region) => this.regionOwners.has(region));
    if (owned !== undefined) {
      return { status: 'rejected', proposal, reason: 'region_owned' };
    }

    return { status: 'selected', proposal };
  }

  commit(proposal: TransformProposal): void {
    this.selected.add(proposal.integrationId);
    for (const region of proposal.regions) {
      this.regionOwners.set(region, proposal.integrationId);
    }
  }
}