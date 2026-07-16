import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const receiptPath = join(
  process.cwd(),
  'benchmarks',
  'results',
  'mcp-opaque-flow.first-party-macos-arm64-20260715.json',
);
const verifier = join(process.cwd(), 'bin', 'verify-receipt.js');

describe('standalone opaque-flow receipt verifier', () => {
  it('verifies the committed receipt without importing Pinpoint runtime code', () => {
    const source = JSON.parse(readFileSync(receiptPath, 'utf8'));
    const output = JSON.parse(execFileSync(process.execPath, [
      verifier,
      receiptPath,
      '--path',
      'firstReceipt',
      '--signing-key-id',
      source.firstReceipt.signingKeyId,
    ], { encoding: 'utf8' }));

    expect(output).toMatchObject({
      valid: true,
      receiptHash: source.firstReceipt.receiptHash,
      signingKeyId: source.firstReceipt.signingKeyId,
      sequence: 1,
    });
  });

  it('rejects a modified receipt and a mismatched pinned key', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-receipt-verifier-'));
    try {
      const source = JSON.parse(readFileSync(receiptPath, 'utf8'));
      source.firstReceipt.items += 1;
      const tampered = join(temporary, 'tampered.json');
      writeFileSync(tampered, JSON.stringify(source));
      const tamperedRun = spawnSync(process.execPath, [verifier, tampered, '--path', 'firstReceipt'], {
        encoding: 'utf8',
      });
      const wrongKeyRun = spawnSync(process.execPath, [
        verifier,
        receiptPath,
        '--path',
        'firstReceipt',
        '--signing-key-id',
        '0'.repeat(64),
      ], { encoding: 'utf8' });

      expect(tamperedRun.status).toBe(1);
      expect(JSON.parse(tamperedRun.stdout)).toMatchObject({ valid: false });
      expect(wrongKeyRun.status).toBe(1);
      expect(JSON.parse(wrongKeyRun.stdout)).toMatchObject({ valid: false });
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});