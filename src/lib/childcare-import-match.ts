/**
 * Pairs committed caretaker screenshot imports that were never linked to a
 * childcare session (imported from outside the session's "Import screenshot"
 * action) with the closed session they describe. Read-only: nothing is
 * written back, so existing records reconcile without a data migration.
 *
 * Rule: an unlinked batch matches a closed, not-yet-imported session for the
 * same baby whose Singapore check-in date equals the batch's selected date.
 * When several sessions qualify, the one overlapping the batch's reviewed care
 * window the most wins (ties: earliest check-in). Each session and each batch
 * is matched at most once; batches are considered in commit order.
 */

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

export type MatchableSession = {
  id: string;
  babyId: string;
  checkedInAt: number;
  checkedOutAt: number | null;
  importBatchId: string | null;
};

export type MatchableBatch = {
  id: string;
  babyId: string;
  childcareSessionId: string | null;
  selectedDate: string | null;
  committedAt: number | null;
  coverage: { startedAt: number; endedAt: number } | null;
};

/** Singapore calendar date (UTC+08:00 all year) as YYYY-MM-DD. */
export function sgtDateKeyOf(timestamp: number): string {
  return new Date(timestamp + SGT_OFFSET_MS).toISOString().slice(0, 10);
}

function overlapMs(
  session: MatchableSession,
  coverage: { startedAt: number; endedAt: number } | null,
): number {
  if (!coverage || session.checkedOutAt == null) return 0;
  const start = Math.max(session.checkedInAt, coverage.startedAt);
  const end = Math.min(session.checkedOutAt, coverage.endedAt);
  return Math.max(0, end - start);
}

/** Returns sessionId -> batch for every unlinked batch that found its session. */
export function matchUnlinkedImports(
  sessions: MatchableSession[],
  batches: MatchableBatch[],
): Map<string, MatchableBatch> {
  const matches = new Map<string, MatchableBatch>();
  const ordered = [...batches].sort((a, b) =>
    (a.committedAt ?? 0) - (b.committedAt ?? 0) || a.id.localeCompare(b.id));

  for (const batch of ordered) {
    if (batch.childcareSessionId) continue;
    const date = batch.selectedDate
      ?? (batch.coverage ? sgtDateKeyOf(batch.coverage.startedAt) : null);
    if (!date) continue;

    const candidates = sessions.filter((session) =>
      session.babyId === batch.babyId
      && session.checkedOutAt != null
      && session.importBatchId == null
      && !matches.has(session.id)
      && sgtDateKeyOf(session.checkedInAt) === date);
    if (candidates.length === 0) continue;

    candidates.sort((a, b) =>
      overlapMs(b, batch.coverage) - overlapMs(a, batch.coverage)
      || a.checkedInAt - b.checkedInAt
      || a.id.localeCompare(b.id));
    matches.set(candidates[0].id, batch);
  }
  return matches;
}
