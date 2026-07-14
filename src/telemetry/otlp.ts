import { randomBytes } from 'node:crypto';

import type { TelemetryConfig } from '../config.js';
import type { PipelineResult } from '../kernel/pipeline.js';
import type { AuthMode, Provider, SavingsReport } from '../types.js';

export interface OptimizationSpanInput {
  readonly startedAtUnixMs: number;
  readonly durationMs: number;
  readonly provider: Provider;
  readonly model: string | null;
  readonly authMode: AuthMode;
  readonly mode: string;
  readonly report: SavingsReport;
  readonly pipeline: PipelineResult;
}

export interface TelemetryStats {
  readonly queued: number;
  readonly exported: number;
  readonly failed: number;
  readonly dropped: number;
}

interface OtlpAttribute {
  readonly key: string;
  readonly value: Readonly<Record<string, unknown>>;
}

function attribute(key: string, value: string | number | boolean): OtlpAttribute {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: value } };
}

function unixNano(milliseconds: number): string {
  return BigInt(Math.round(milliseconds * 1_000_000)).toString();
}

function payload(config: TelemetryConfig, input: OptimizationSpanInput): Record<string, unknown> {
  const attributes: OtlpAttribute[] = [
    attribute('pixroom.provider', input.provider),
    attribute('pixroom.model', input.model ?? 'unknown'),
    attribute('pixroom.auth_mode', input.authMode),
    attribute('pixroom.mode', input.mode),
    attribute('pixroom.tokens.text', input.report.tokensTextTotal),
    attribute('pixroom.tokens.compressed', input.report.tokensCompressedTotal),
    attribute('pixroom.tokens.saved', input.report.tokensSavedTotal),
    attribute('pixroom.saved_fraction', input.report.savedFraction),
    attribute('pixroom.reversible_count', input.report.reversibleCount),
    attribute('pixroom.pipeline.error_count', input.pipeline.errors.length),
  ];
  for (const row of input.report.rows) {
    attributes.push(
      attribute(`pixroom.stage.${row.stage}.applied`, row.applied),
      attribute(`pixroom.stage.${row.stage}.reason`, row.reason),
      attribute(`pixroom.stage.${row.stage}.tokens_saved`, row.tokensSaved),
    );
  }
  const errorText = input.pipeline.errors.map((error) => `${error.integrationId}: ${error.error}`).join('; ');
  const endMs = input.startedAtUnixMs + input.durationMs;
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [attribute('service.name', config.serviceName)],
        },
        scopeSpans: [
          {
            scope: { name: 'pixroom', version: '0.1.0' },
            spans: [
              {
                traceId: randomBytes(16).toString('hex'),
                spanId: randomBytes(8).toString('hex'),
                name: 'pixroom.optimize',
                kind: 1,
                startTimeUnixNano: unixNano(input.startedAtUnixMs),
                endTimeUnixNano: unixNano(endMs),
                attributes,
                status: input.pipeline.errors.length > 0
                  ? { code: 2, message: errorText }
                  : { code: 1 },
                flags: 1,
              },
            ],
          },
        ],
      },
    ],
  };
}

export class OtlpHttpExporter {
  private readonly queue: OptimizationSpanInput[] = [];
  private draining: Promise<void> | undefined;
  private exported = 0;
  private failed = 0;
  private dropped = 0;

  constructor(
    private readonly config: TelemetryConfig,
    private readonly onError?: (error: unknown) => void,
  ) {}

  get enabled(): boolean {
    return this.config.endpoint.length > 0;
  }

  stats(): TelemetryStats {
    return {
      queued: this.queue.length,
      exported: this.exported,
      failed: this.failed,
      dropped: this.dropped,
    };
  }

  enqueue(input: OptimizationSpanInput): void {
    if (!this.enabled) return;
    if (this.queue.length >= Math.max(1, this.config.maxQueue)) {
      this.dropped += 1;
      return;
    }
    this.queue.push(input);
    this.draining ??= this.drain();
  }

  async flush(): Promise<void> {
    await this.draining;
  }

  private async drain(): Promise<void> {
    try {
      for (;;) {
        const input = this.queue.shift();
        if (!input) return;
        try {
          await this.send(input);
          this.exported += 1;
        } catch (error) {
          this.failed += 1;
          this.onError?.(error);
        }
      }
    } finally {
      this.draining = undefined;
      if (this.queue.length > 0) this.draining = this.drain();
    }
  }

  private async send(input: OptimizationSpanInput): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, this.config.timeoutMs));
    timer.unref();
    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify(payload(this.config, input)),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OTLP HTTP ${response.status} ${response.statusText}`);
      await response.arrayBuffer();
    } finally {
      clearTimeout(timer);
    }
  }
}