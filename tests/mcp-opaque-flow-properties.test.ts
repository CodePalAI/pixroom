import { describe, expect, it } from 'vitest';

import {
  McpOpaqueFlowEngine,
  parseMcpOpaqueFlowConfig,
  verifyMcpOpaqueFlowReceipt,
  type McpOpaqueFlowPolicy,
} from '../src/mcp/flow.js';
import { McpResultFirewall } from '../src/mcp/gateway.js';
import { VirtualContextStore, type VirtualContextQuery } from '../src/virtual-context/store.js';

const rows = Array.from({ length: 40 }, (_, id) => ({
  id,
  active: id % 2 === 0,
  region: id % 4 === 0 ? 'eu' : 'us',
  email: `property-user-${id}@example.invalid`,
  secret: `property-secret-${id}`,
}));

const basePolicy: McpOpaqueFlowPolicy = {
  name: 'deliver_active',
  sourceTool: 'accounts_list',
  sourceKind: 'json-array',
  destinationTool: 'campaign_deliver',
  destinationArgument: 'recipients',
  fixedDestinationArguments: { campaign: 'renewal' },
  allowedOps: ['json_select'],
  fixedWhere: { active: true },
  allowedWhereFields: ['region'],
  allowedFields: ['email'],
  maxItems: 30,
  maxBytes: 4096,
};

function harness(policy: McpOpaqueFlowPolicy = basePolicy) {
  const store = new VirtualContextStore(32_000, 32, 1024 * 1024);
  const descriptor = store.put(JSON.stringify(rows));
  const queries: VirtualContextQuery[] = [];
  const artifacts = {
    artifactInfo(id: string) {
      return id === descriptor.id ? { descriptor, sourceTool: 'accounts_list' } : undefined;
    },
    queryArtifact(query: VirtualContextQuery) {
      queries.push(query);
      return store.query(query);
    },
  };
  return {
    descriptor,
    engine: new McpOpaqueFlowEngine(artifacts, [policy]),
    queries,
  };
}

function prepare(engine: McpOpaqueFlowEngine, id: string, extra: Record<string, unknown> = {}) {
  return engine.prepare({
    flow: 'deliver_active',
    id,
    op: 'json_select',
    fields: ['email'],
    ...extra,
  });
}

function receipt(result: ReturnType<McpOpaqueFlowEngine['complete']>) {
  return JSON.parse(result.content[0]?.text ?? '{}').pinpointFlow;
}

describe('opaque-flow safety properties', () => {
  it('always applies operator-fixed predicates and rejects model override attempts', () => {
    const { descriptor, engine, queries } = harness();
    const plan = prepare(engine, descriptor.id, { where: { region: 'eu' } });

    expect(queries[0]?.where).toEqual({ active: true, region: 'eu' });
    expect(plan.payload).toEqual(rows
      .filter(({ active, region }) => active && region === 'eu')
      .map(({ email }) => ({ email })));
    expect(() => prepare(engine, descriptor.id, { where: { active: false } })).toThrow(
      'where field not allowed by flow policy: active',
    );
    expect(JSON.stringify(engine.tool)).not.toContain('"active":true');
  });

  it('produces byte-identical projections for repeated identical queries', () => {
    const { descriptor, engine } = harness();
    const outputs = Array.from({ length: 100 }, () =>
      JSON.stringify(prepare(engine, descriptor.id, { where: { region: 'eu' } }).payload),
    );
    expect(new Set(outputs)).toEqual(new Set([outputs[0]]));
  });

  it('keeps the public policy-shape hash stable without exposing fixed values', () => {
    const first = harness();
    const second = harness();
    const firstReceipt = receipt(first.engine.complete(
      prepare(first.engine, first.descriptor.id),
      { content: [{ type: 'text', text: 'accepted' }] },
    ));
    const secondReceipt = receipt(second.engine.complete(
      prepare(second.engine, second.descriptor.id),
      { content: [{ type: 'text', text: 'accepted' }] },
    ));

    expect(firstReceipt.policyShapeSha256).toBe(secondReceipt.policyShapeSha256);
    expect(JSON.stringify(firstReceipt)).not.toContain('renewal');
    expect(JSON.stringify(firstReceipt)).not.toContain('"active":true');
  });

  it('rejects selected payloads above the policy byte bound before completion', () => {
    const { descriptor, engine } = harness({ ...basePolicy, maxBytes: 16 });
    expect(() => prepare(engine, descriptor.id)).toThrow(/flow payload has \d+ bytes; limit is 16/);
  });

  it('generates unique random public capabilities for repeated identical protected content', () => {
    const firewall = new McpResultFirewall({
      minChars: 1,
      exposeQueryTool: false,
      opaqueArtifactIds: true,
      flowToolAvailable: true,
      protectedSourceTools: ['accounts_list'],
    });
    const source = { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    const ids = Array.from({ length: 1_000 }, () =>
      firewall.transformResult('accounts_list', source).descriptor?.id,
    );

    expect(ids.every((id) => /^vctx_[a-f0-9]{32}$/.test(id ?? ''))).toBe(true);
    expect(new Set(ids).size).toBe(1_000);
    expect(firewall.artifactInfo(`vctx_${'f'.repeat(32)}`)).toBeUndefined();
  });

  it('emits value-free receipts and rejects tampering or a wrong session verifier', () => {
    const { descriptor, engine } = harness();
    const plan = prepare(engine, descriptor.id);
    const value = receipt(engine.complete(plan, {
      content: [{ type: 'text', text: 'destination-private-result' }],
    }));
    const serialized = JSON.stringify(value);

    for (const row of rows) {
      expect(serialized).not.toContain(row.email);
      expect(serialized).not.toContain(row.secret);
    }
    expect(serialized).not.toContain('destination-private-result');
    expect(verifyMcpOpaqueFlowReceipt(value, engine.receiptVerifier)).toBe(true);
    expect(verifyMcpOpaqueFlowReceipt({ ...value, items: value.items + 1 }, engine.receiptVerifier)).toBe(false);
    expect(verifyMcpOpaqueFlowReceipt(value, { ...engine.receiptVerifier, signingKeyId: '0'.repeat(64) })).toBe(false);
  });

  it('advances and links fifty receipt sequences exactly once', () => {
    const { descriptor, engine } = harness();
    const receipts = Array.from({ length: 50 }, () => receipt(engine.complete(
      prepare(engine, descriptor.id),
      { content: [{ type: 'text', text: 'accepted' }] },
    )));

    for (const [index, current] of receipts.entries()) {
      expect(current.sequence).toBe(index + 1);
      expect(current.previousReceiptHash).toBe(index === 0 ? '0'.repeat(64) : receipts[index - 1].receiptHash);
      expect(verifyMcpOpaqueFlowReceipt(current, engine.receiptVerifier)).toBe(true);
    }
  });

  it('returns a signed value-free error receipt when the destination reports failure', () => {
    const { descriptor, engine } = harness();
    const result = engine.complete(prepare(engine, descriptor.id), {
      content: [{ type: 'text', text: 'destination-error-private-value' }],
      isError: true,
    });
    const value = receipt(result);

    expect(result.isError).toBe(true);
    expect(value.destinationSucceeded).toBe(false);
    expect(JSON.stringify(result)).not.toContain('destination-error-private-value');
    expect(verifyMcpOpaqueFlowReceipt(value, engine.receiptVerifier)).toBe(true);
  });

  it('rejects invalid fixed-predicate policy shapes and overlaps', () => {
    expect(() => parseMcpOpaqueFlowConfig({
      version: 1,
      flows: [{ ...basePolicy, fixedWhere: { active: { not: true } } }],
    })).toThrow('fixedWhere must contain 1 to 16 exact JSON primitive fields');
    expect(() => parseMcpOpaqueFlowConfig({
      version: 1,
      flows: [{ ...basePolicy, allowedWhereFields: ['active'] }],
    })).toThrow('fixed and dynamic where fields overlap: active');
  });
});