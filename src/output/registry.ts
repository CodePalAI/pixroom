import type { OutputEventContext, OutputIntegration, ResponseEvent } from './types.js';

export class OutputIntegrationRegistry {
  private readonly integrations = new Map<string, OutputIntegration>();

  constructor(private readonly onError?: (integrationId: string, error: string) => void) {}

  register(integration: OutputIntegration): this {
    if (this.integrations.has(integration.id)) {
      throw new Error(`duplicate output integration id: ${integration.id}`);
    }
    this.integrations.set(integration.id, integration);
    return this;
  }

  get size(): number {
    return this.integrations.size;
  }

  dispatch(event: ResponseEvent, context: OutputEventContext): void {
    for (const integration of this.integrations.values()) {
      try {
        void Promise.resolve(integration.onEvent(event, context)).catch((error: unknown) => {
          this.onError?.(
            integration.id,
            error instanceof Error ? error.message : String(error),
          );
        });
      } catch (error) {
        this.onError?.(
          integration.id,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  list(): readonly OutputIntegration[] {
    return [...this.integrations.values()];
  }
}