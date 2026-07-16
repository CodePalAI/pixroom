#!/usr/bin/env node

import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value == null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const file = process.argv[2];
if (!file || file.startsWith('--')) {
  console.error('usage: pinpoint-verify-receipt <receipt.json> [--path firstReceipt] [--signing-key-id HEX]');
  process.exit(2);
}

try {
  let receipt = JSON.parse(readFileSync(file, 'utf8'));
  const path = argument('--path');
  if (path) {
    for (const segment of path.split('.').filter(Boolean)) receipt = receipt?.[segment];
  }
  if (receipt == null || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('receipt path does not resolve to an object');
  }
  const expectedKeyId = argument('--signing-key-id');
  const { receiptHash, verifier: verifierBlock, signature, ...attestation } = receipt;
  if (
    receipt.receiptVersion !== 1 ||
    verifierBlock?.algorithm !== 'Ed25519' ||
    typeof verifierBlock.publicKey !== 'string' ||
    typeof receipt.signingKeyId !== 'string' ||
    typeof receiptHash !== 'string' ||
    typeof signature !== 'string'
  ) {
    throw new Error('receipt fields are invalid');
  }
  const publicKeyBytes = Buffer.from(verifierBlock.publicKey, 'base64url');
  const keyId = createHash('sha256').update(publicKeyBytes).digest('hex');
  const attestationText = canonicalJson(attestation);
  const computedHash = createHash('sha256').update(attestationText).digest('hex');
  const publicKey = createPublicKey({ key: publicKeyBytes, format: 'der', type: 'spki' });
  const signatureValid = verify(
    null,
    Buffer.from(attestationText),
    publicKey,
    Buffer.from(signature, 'base64url'),
  );
  const valid =
    keyId === receipt.signingKeyId &&
    computedHash === receiptHash &&
    signatureValid &&
    (expectedKeyId == null || expectedKeyId === receipt.signingKeyId);
  console.log(JSON.stringify({
    valid,
    receiptHash,
    signingKeyId: receipt.signingKeyId,
    sequence: receipt.sequence,
    flow: receipt.flow,
  }, null, 2));
  if (!valid) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ valid: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}