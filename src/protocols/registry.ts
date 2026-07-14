import type { ProtocolAdapter, ProtocolMatchInput } from './types.js';

export class ProtocolRegistry {
  private readonly adapters = new Map<string, ProtocolAdapter>();

  register(adapter: ProtocolAdapter): this {
    if (this.adapters.has(adapter.id)) throw new Error(`duplicate protocol id: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  match(input: ProtocolMatchInput): ProtocolAdapter | undefined {
    return [...this.adapters.values()].find((adapter) => adapter.matches(input));
  }

  list(): readonly ProtocolAdapter[] {
    return [...this.adapters.values()];
  }
}