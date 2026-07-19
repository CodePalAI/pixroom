function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function isValidMcpCallToolResult(value: unknown): value is {
  readonly content: readonly unknown[];
  readonly isError?: boolean;
} {
  return isRecord(value) &&
    Array.isArray(value.content) &&
    (value.isError === undefined || typeof value.isError === 'boolean');
}