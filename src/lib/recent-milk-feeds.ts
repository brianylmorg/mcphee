import { bottleVolumes, parseActivityDetails } from "./milk-volumes";

export type RecentMilkFeed = {
  id: string;
  startedAt: number;
  amountMl: number;
};

export type RecentMilkFeedActivity = {
  id: unknown;
  baby_id?: unknown;
  type?: unknown;
  details?: unknown;
  started_at?: unknown;
  created_at?: unknown;
};

export function selectRecentMilkFeeds(
  activities: RecentMilkFeedActivity[],
  babyId: unknown,
  now = Date.now(),
  limit = 2,
): RecentMilkFeed[] {
  if (babyId == null || limit <= 0) return [];
  const selectedBabyId = String(babyId);

  return activities
    .filter((activity) => {
      const startedAt = Number(activity.started_at);
      return activity.type === "bottlefeed"
        && String(activity.baby_id) === selectedBabyId
        && Number.isFinite(startedAt)
        && startedAt > 0
        && startedAt <= now;
    })
    .sort((left, right) => {
      const startedAtDelta = Number(right.started_at) - Number(left.started_at);
      if (startedAtDelta !== 0) return startedAtDelta;
      const createdAtDelta = Number(right.created_at ?? 0) - Number(left.created_at ?? 0);
      if (createdAtDelta !== 0) return createdAtDelta;
      return String(right.id).localeCompare(String(left.id));
    })
    .slice(0, limit)
    .map((activity) => {
      const volumes = bottleVolumes(parseActivityDetails(activity.details));
      return {
        id: String(activity.id),
        startedAt: Number(activity.started_at),
        amountMl: Math.round((volumes.breastmilkMl + volumes.formulaMl) * 100) / 100,
      };
    });
}
