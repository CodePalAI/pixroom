/**
 * pixroom ContentRouter (planning/end_product.md §5.1).
 *
 * A thin orchestration layer over the two engines that enforces the §3 partition —
 * exactly one engine per region — and unifies reversibility through one CCR store:
 *
 *   1. semantic stage (headroom): compress tool_result/content regions
 *   2. optical stage (pxpipe): image the static system+tools slab; own cache_control
 *   3. register both engines' reversible handles into the single CCR store
 *   4. inject `headroom_retrieve` last (after optical) so its description stays sharp
 *
 * Ordering matches the §4.3 data flow. Both stages self-gate and degrade to a safe
 * pass-through, so `route()` never fails closed.
 */

import type { Logger } from '../logger.js';
import { CCR_TOOL_NAME, type CcrStore } from '../ccr/store.js';
import { PXPIPE_OPTICAL_INTEGRATION_ID } from '../integrations/legacy-compressor.js';
import type { IntegrationPipeline } from '../kernel/pipeline.js';
import type { PipelineResult } from '../kernel/pipeline.js';
import type { RuntimeMode } from '../kernel/types.js';
import { buildReport, summarizeReport } from '../measurement/savings.js';
import { classifyContent } from '../policy/content-type.js';
import { readSystemText } from '../anthropic.js';
import type { CrossModalController, EngineDecision } from '../policy/controller.js';
import {
  passthroughResult,
  type AuthMode,
  type ContentType,
  type Provider,
  type RequestContext,
  type ReversibleHandle,
  type SavingsReport,
} from '../types.js';

export interface RouteResult {
  /** The transformed request body ready to forward upstream. */
  readonly body: Record<string, unknown>;
  readonly report: SavingsReport;
  readonly reversible: readonly ReversibleHandle[];
  /** True when pxpipe pinned the single Anthropic `cache_control` breakpoint. */
  readonly opticalOwnsCacheControl: boolean;
  /** Proposal/transaction trace for audit, shadow, and explain surfaces. */
  readonly pipeline: PipelineResult;
  /** Cross-modal controller decision for the slab region, when the adaptive path is on. */
  readonly adaptive?: {
    readonly slabContentType: ContentType;
    readonly decision: EngineDecision;
  };
}

function toolName(tool: unknown): string | undefined {
  if (tool == null || typeof tool !== 'object') return undefined;
  const t = tool as { name?: unknown; function?: { name?: unknown } };
  if (typeof t.name === 'string') return t.name;
  if (t.function && typeof t.function.name === 'string') return t.function.name;
  return undefined;
}

export class ContentRouter {
  constructor(
    private readonly pipeline: IntegrationPipeline,
    private readonly ccr: CcrStore,
    private readonly log: Logger,
    private readonly mode: RuntimeMode = 'optimize',
    /** Optional adaptive controller; when present, may defer optical for a slab type. */
    private readonly controller?: CrossModalController,
  ) {}

  async route(
    provider: Provider,
    model: string | null,
    body: Record<string, unknown>,
    authMode: AuthMode = 'payg',
  ): Promise<RouteResult> {
    const ctx: RequestContext = {
      provider,
      authMode,
      model,
      body,
      reversible: [],
      stages: [],
      opticalOwnsCacheControl: false,
    };

    let adaptive: RouteResult['adaptive'];
    const pipelineResult = await this.pipeline.run(ctx, {
      mode: this.mode,
      beforeIntegration: (integration) => {
        if (integration.id !== PXPIPE_OPTICAL_INTEGRATION_ID || !this.controller) return true;

        const slabContentType = classifyContent(readSystemText(ctx.body));
        const decision = this.controller.chooseEngine({
          contentType: slabContentType,
          eligible: ['optical', 'semantic'],
          defaultEngine: 'optical',
          fallbackSaved: { optical: 0.7, semantic: 0.4 },
        });
        adaptive = { slabContentType, decision };
        if (decision.engine === 'optical') return true;

        ctx.stages.push(
          passthroughResult('optical', 'not_profitable', `adaptive: deferred slab (${slabContentType})`),
        );
        this.log.debug(`adaptive: optical deferred for slab content=${slabContentType}`);
        return false;
      },
    });
    for (const failure of pipelineResult.errors) {
      this.log.warn(`integration ${failure.integrationId} degraded: ${failure.error}`);
    }

    // Unify reversibility: both engines' handles live in one store (§5.2).
    this.ccr.registerReversible(ctx.reversible);

    // Inject the retrieve tool last so its description isn't imaged by pxpipe.
    if (this.ccr.hasOffloaded()) {
      this.injectCcrTool(ctx);
    }

    const report = buildReport(ctx);
    this.log.info(summarizeReport(report));

    return {
      body: ctx.body,
      report,
      reversible: ctx.reversible,
      opticalOwnsCacheControl: ctx.opticalOwnsCacheControl,
      pipeline: pipelineResult,
      adaptive,
    };
  }

  private injectCcrTool(ctx: RequestContext): void {
    const existing = Array.isArray(ctx.body.tools) ? ctx.body.tools : [];
    if (existing.some((t) => toolName(t) === CCR_TOOL_NAME)) return;
    ctx.body.tools = [...existing, this.ccr.toolSchema(ctx.provider)];
    this.log.debug(`injected ${CCR_TOOL_NAME} tool (${this.ccr.size} offloaded originals)`);
  }
}
