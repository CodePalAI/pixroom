import type { PixroomConfigOverrides } from '../config.js';
import { createPixroom } from '../pixroom.js';
import { hashCaptureBody, readCaptureFile } from './store.js';

export interface ReplaySummary {
  readonly records: number;
  readonly replayable: number;
  readonly matched: number;
  readonly changed: number;
  readonly failed: number;
  readonly tokensSaved: number;
  readonly errors: readonly string[];
}

export async function replayCaptureFile(
  path: string,
  overrides: PixroomConfigOverrides = {},
): Promise<ReplaySummary> {
  const records = readCaptureFile(path);
  const runtime = createPixroom({
    ...overrides,
    capture: { ...overrides.capture, path: '' },
  });
  let replayable = 0;
  let matched = 0;
  let changed = 0;
  let failed = 0;
  let tokensSaved = 0;
  const errors: string[] = [];

  try {
    for (const record of records) {
      if (!record.originalBody) continue;
      replayable += 1;
      try {
        const routed = await runtime.route(
          record.provider,
          record.model,
          structuredClone(record.originalBody),
          record.authMode,
        );
        tokensSaved += routed.report.tokensSavedTotal;
        if (hashCaptureBody(routed.body) === record.transformedBodySha256) matched += 1;
        else changed += 1;
      } catch (error) {
        failed += 1;
        errors.push(`${record.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await runtime.shutdown();
  }

  return {
    records: records.length,
    replayable,
    matched,
    changed,
    failed,
    tokensSaved,
    errors,
  };
}