import type { CaretakerSleepCoverage } from "./caretaker-import-contract";

export function caretakerSleepCoverageFromAudit(value: unknown): CaretakerSleepCoverage | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as {
      version?: unknown;
      sleepReconciliation?: { coverage?: { startedAt?: unknown; endedAt?: unknown } };
    };
    const coverage = parsed.version === 2 ? parsed.sleepReconciliation?.coverage : null;
    const startedAt = Number(coverage?.startedAt);
    const endedAt = Number(coverage?.endedAt);
    return Number.isFinite(startedAt) && Number.isFinite(endedAt) && startedAt > 0 && endedAt > startedAt
      ? { startedAt, endedAt }
      : null;
  } catch {
    return null;
  }
}
