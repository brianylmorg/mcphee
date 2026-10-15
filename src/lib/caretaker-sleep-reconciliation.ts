import { createHash } from "node:crypto";

import type {
  CaretakerSleepCoverage,
  CaretakerSleepReconciliationSummary,
} from "./caretaker-import-contract";

export type ExistingSleepActivity = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  details: string | null;
  createdAt: number;
  createdBy: string | null;
};

export type AuthoritativeCaretakerNap = {
  rowId: string;
  startedAt: number;
  endedAt: number;
};

export type RetainedCaretakerNap = AuthoritativeCaretakerNap & {
  activityId: string;
};

export type SleepActivityUpdate = {
  activityId: string;
  startedAt: number;
  endedAt: number;
};

export type SleepActivitySplit = {
  sourceActivityId: string;
  startedAt: number;
  endedAt: number;
  details: string | null;
  createdAt: number;
  createdBy: string | null;
};

export type CaretakerSleepReconciliationPlan = CaretakerSleepReconciliationSummary & {
  fingerprint: string;
  retainedExact: RetainedCaretakerNap[];
  removedActivityIds: string[];
  updates: SleepActivityUpdate[];
  splits: SleepActivitySplit[];
  inserts: AuthoritativeCaretakerNap[];
};

function orderedSleeps(sleeps: readonly ExistingSleepActivity[]) {
  return [...sleeps].sort((left, right) =>
    left.startedAt - right.startedAt
    || (left.endedAt ?? Number.MAX_SAFE_INTEGER) - (right.endedAt ?? Number.MAX_SAFE_INTEGER)
    || left.createdAt - right.createdAt
    || left.id.localeCompare(right.id));
}

export function fingerprintCaretakerSleepActivities(sleeps: readonly ExistingSleepActivity[]): string {
  const canonical = orderedSleeps(sleeps).map((sleep) => ({
    id: sleep.id,
    startedAt: sleep.startedAt,
    endedAt: sleep.endedAt,
    details: sleep.details,
    createdAt: sleep.createdAt,
    createdBy: sleep.createdBy,
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Builds a deterministic half-open-interval plan. Callers must pass only
 * existing sleeps that overlap [coverage.startedAt, coverage.endedAt).
 */
export function planCaretakerSleepReconciliation(
  coverage: CaretakerSleepCoverage,
  naps: readonly AuthoritativeCaretakerNap[],
  existingSleeps: readonly ExistingSleepActivity[],
): CaretakerSleepReconciliationPlan {
  if (!Number.isSafeInteger(coverage.startedAt) || !Number.isSafeInteger(coverage.endedAt)
      || coverage.startedAt <= 0 || coverage.startedAt >= coverage.endedAt) {
    throw new Error("INVALID_SLEEP_COVERAGE");
  }
  const orderedExisting = orderedSleeps(existingSleeps);
  const existingIds = new Set<string>();
  for (const sleep of orderedExisting) {
    if (!sleep.id || existingIds.has(sleep.id)
        || !Number.isSafeInteger(sleep.startedAt) || !Number.isSafeInteger(sleep.createdAt)
        || sleep.startedAt <= 0 || sleep.createdAt <= 0
        || (sleep.endedAt != null && (!Number.isSafeInteger(sleep.endedAt) || sleep.endedAt <= sleep.startedAt))
        || sleep.startedAt >= coverage.endedAt
        || (sleep.endedAt != null && sleep.endedAt <= coverage.startedAt)) {
      throw new Error("INVALID_EXISTING_SLEEP");
    }
    existingIds.add(sleep.id);
  }
  const orderedNaps = [...naps].sort((left, right) =>
    left.startedAt - right.startedAt || left.endedAt - right.endedAt || left.rowId.localeCompare(right.rowId));
  for (let index = 0; index < orderedNaps.length; index++) {
    const nap = orderedNaps[index];
    if (!nap.rowId || !Number.isSafeInteger(nap.startedAt) || !Number.isSafeInteger(nap.endedAt)
        || nap.startedAt < coverage.startedAt || nap.endedAt > coverage.endedAt
        || nap.startedAt >= nap.endedAt
        || (index > 0 && nap.startedAt < orderedNaps[index - 1].endedAt)) {
      throw new Error("INVALID_AUTHORITATIVE_NAPS");
    }
  }
  const unusedExisting = new Map(orderedExisting.map((sleep) => [sleep.id, sleep]));
  const retainedExact: RetainedCaretakerNap[] = [];
  const inserts: AuthoritativeCaretakerNap[] = [];

  for (const nap of orderedNaps) {
    const exact = [...unusedExisting.values()].find((sleep) =>
      sleep.startedAt === nap.startedAt && sleep.endedAt === nap.endedAt);
    if (exact) {
      retainedExact.push({ ...nap, activityId: exact.id });
      unusedExisting.delete(exact.id);
    } else {
      inserts.push({ ...nap });
    }
  }

  const removedActivityIds: string[] = [];
  const updates: SleepActivityUpdate[] = [];
  const splits: SleepActivitySplit[] = [];
  for (const sleep of unusedExisting.values()) {
    if (sleep.endedAt == null) {
      if (sleep.startedAt < coverage.startedAt) {
        updates.push({
          activityId: sleep.id,
          startedAt: sleep.startedAt,
          endedAt: coverage.startedAt,
        });
      } else {
        removedActivityIds.push(sleep.id);
      }
      continue;
    }

    const hasPrefix = sleep.startedAt < coverage.startedAt;
    const hasTail = sleep.endedAt > coverage.endedAt;
    if (hasPrefix && hasTail) {
      updates.push({
        activityId: sleep.id,
        startedAt: sleep.startedAt,
        endedAt: coverage.startedAt,
      });
      splits.push({
        sourceActivityId: sleep.id,
        startedAt: coverage.endedAt,
        endedAt: sleep.endedAt,
        details: sleep.details,
        createdAt: sleep.createdAt,
        createdBy: sleep.createdBy,
      });
    } else if (hasPrefix) {
      updates.push({
        activityId: sleep.id,
        startedAt: sleep.startedAt,
        endedAt: coverage.startedAt,
      });
    } else if (hasTail) {
      updates.push({
        activityId: sleep.id,
        startedAt: coverage.endedAt,
        endedAt: sleep.endedAt,
      });
    } else {
      removedActivityIds.push(sleep.id);
    }
  }

  return {
    coverage: { startedAt: coverage.startedAt, endedAt: coverage.endedAt },
    authoritativeNapCount: orderedNaps.length,
    retainedExactCount: retainedExact.length,
    removedCount: removedActivityIds.length,
    trimmedCount: updates.length,
    splitCount: splits.length,
    insertedCount: inserts.length,
    fingerprint: fingerprintCaretakerSleepActivities(orderedExisting),
    retainedExact,
    removedActivityIds,
    updates,
    splits,
    inserts,
  };
}

export function summarizeCaretakerSleepPlan(
  plan: CaretakerSleepReconciliationPlan,
): CaretakerSleepReconciliationSummary {
  return {
    coverage: plan.coverage,
    authoritativeNapCount: plan.authoritativeNapCount,
    retainedExactCount: plan.retainedExactCount,
    removedCount: plan.removedCount,
    trimmedCount: plan.trimmedCount,
    splitCount: plan.splitCount,
    insertedCount: plan.insertedCount,
  };
}
