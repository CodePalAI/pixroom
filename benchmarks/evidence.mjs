/** Evidence classes used by result artifacts and the generated report. */
export const EVIDENCE = Object.freeze({
  UNIT_SIMULATION: 'unit-simulation',
  OFFLINE_REAL_TRANSFORM: 'offline-real-transform',
  LIVE_CONTROLLED: 'live-controlled',
  LIVE_AGENTIC: 'live-agentic',
});

/** Exact/reasoning one-shots are controlled; tool-using cases are agentic. */
export function liveEvidenceForKind(kind) {
  return kind === 'exact' || kind === 'reasoning'
    ? EVIDENCE.LIVE_CONTROLLED
    : EVIDENCE.LIVE_AGENTIC;
}