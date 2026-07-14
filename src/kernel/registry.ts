import type { IntegrationId, ProcessorIntegration } from './types.js';

/** Runtime registry for request-side optimizer integrations. */
export class IntegrationRegistry {
  private readonly integrations = new Map<IntegrationId, ProcessorIntegration>();

  register(integration: ProcessorIntegration): this {
    if (this.integrations.has(integration.id)) {
      throw new Error(`duplicate integration id: ${integration.id}`);
    }
    this.integrations.set(integration.id, integration);
    return this;
  }

  get(id: IntegrationId): ProcessorIntegration | undefined {
    return this.integrations.get(id);
  }

  ordered(): readonly ProcessorIntegration[] {
    return [...this.integrations.values()].sort(
      (left, right) => left.order - right.order || left.id.localeCompare(right.id),
    );
  }

  list(): readonly ProcessorIntegration[] {
    return [...this.integrations.values()];
  }
}