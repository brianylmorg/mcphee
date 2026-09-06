export type SleepUndoToken = {
  kind: "started-sleep" | "woke";
  activityId: string;
  changedAt: number;
};

export type SleepWindowSnapshot = {
  id: string;
  startedAt: number;
  endedAt: number | null;
};

export function isSleepUndoToken(value: unknown): value is SleepUndoToken {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const token = value as Record<string, unknown>;
  return (token.kind === "started-sleep" || token.kind === "woke")
    && typeof token.activityId === "string"
    && token.activityId.length > 0
    && typeof token.changedAt === "number"
    && Number.isFinite(token.changedAt)
    && token.changedAt > 0;
}

export const SLEEP_UNDO_WINDOW_MS = 10_000;

/** Checks an undo token against authoritative server rows, including later transitions. */
export function canUndoSleepTransition(
  token: SleepUndoToken,
  rows: SleepWindowSnapshot[],
  now = Date.now(),
): boolean {
  if (now - token.changedAt > SLEEP_UNDO_WINDOW_MS) return false;
  const target = rows.find((row) => row.id === token.activityId);
  if (!target) return false;

  const targetMatches = token.kind === "started-sleep"
    ? target.startedAt === token.changedAt && target.endedAt == null
    : target.endedAt === token.changedAt;
  if (!targetMatches) return false;

  return !rows.some((row) =>
    row.id !== token.activityId
    && (row.startedAt >= token.changedAt || (row.endedAt != null && row.endedAt >= token.changedAt)),
  );
}
