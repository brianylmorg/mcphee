import { MILK_DUE_FROM_MS, MILK_PAST_FROM_MS, MILK_STALE_FROM_MS } from "./milk-hint";
import type { NapHint } from "./sleep-windows";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const SGT_OFFSET_MS = 8 * HOUR_MS;

/** Push this long before his nap or bedtime zone opens. */
export const NAP_LEAD_MS = 10 * MINUTE_MS;
/** Feed and nap pushes stay quiet from 20:00 to 07:00 Singapore time. Medication pushes do not. */
export const QUIET_FROM_HOUR = 20;
export const QUIET_UNTIL_HOUR = 7;
/** A scheduled dose with no "latest interval" gets its second push this long after it fell due. */
export const MED_LATE_AFTER_MS = 30 * MINUTE_MS;
/** A dose reminder older than this is no longer pushed (the scheduler was down, or the course stopped). */
export const MED_STALE_AFTER_MS = 12 * HOUR_MS;

export type PushMedication = {
  id: string;
  name: string;
  doseText: string;
  asNeeded: boolean;
  minIntervalHours: number | null;
  maxIntervalHours: number | null;
  latestDose: { id: string; givenAt: number; givenBy: string | null } | null;
};

export type PushPlanInput = {
  now: number;
  babyName: string;
  asleep: boolean;
  atChildcare: boolean;
  /** True while a breastfeed timer is running: a feed is happening. */
  feedInProgress: boolean;
  /** Newest bottle feed or breastfeed. */
  lastFeed: { id: string; startedAt: number } | null;
  /** napHint() for the current awake stretch; null while asleep or with no zone. */
  napHint: NapHint | null;
  awakeSince: number | null;
  /** Medications of the active sick episode; empty when not sick. */
  medications: readonly PushMedication[];
};

export type PlannedPush = {
  /** Unique per event; stored in notification_log.kind so each event pushes once. */
  key: string;
  /** Notification tag: a newer push of the same tag replaces the older one on the phone. */
  tag: string;
  title: string;
  body: string;
  url: string;
};

function sgtClock(timestamp: number): string {
  const date = new Date(timestamp + SGT_OFFSET_MS);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE_MS));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/** True from QUIET_FROM_HOUR to QUIET_UNTIL_HOUR, Singapore time. */
export function isQuietHours(now: number): boolean {
  const hour = new Date(now + SGT_OFFSET_MS).getUTCHours();
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

function napPush(input: PushPlanInput): PlannedPush | null {
  const hint = input.napHint;
  if (!hint || input.asleep || input.atChildcare || input.awakeSince == null) return null;
  if (hint.source === "age") return null;
  const soon = hint.status === "before" && hint.untilMs <= NAP_LEAD_MS;
  if (!soon && hint.status !== "in") return null;
  const zone = hint.leadsTo === "bedtime" ? "Bedtime zone" : "Nap zone";
  const title = hint.status === "in" ? `${zone} now` : `${zone} in ${duration(hint.untilMs)}`;
  return {
    key: `nap:${input.awakeSince}`,
    tag: "nap",
    title,
    body: `${input.babyName} has been awake since ${sgtClock(input.awakeSince)}. He usually goes down ${duration(hint.fromMs)}–${duration(hint.toMs)} after waking.`,
    url: "/dashboard",
  };
}

function feedPush(input: PushPlanInput): PlannedPush | null {
  const feed = input.lastFeed;
  if (!feed || input.asleep || input.atChildcare || input.feedInProgress) return null;
  const elapsed = input.now - feed.startedAt;
  if (elapsed < MILK_DUE_FROM_MS || elapsed >= MILK_STALE_FROM_MS) return null;
  const past = elapsed >= MILK_PAST_FROM_MS;
  return {
    key: `feed:${feed.id}`,
    tag: "feed",
    title: past ? "Past milk time" : "Milk time",
    body: `${input.babyName}'s last feed was at ${sgtClock(feed.startedAt)}, ${duration(elapsed)} ago.`,
    url: "/dashboard",
  };
}

function medicationPushes(input: PushPlanInput): PlannedPush[] {
  const pushes: PlannedPush[] = [];
  for (const med of input.medications) {
    // As-needed medicines never push: B decided (22 Nov 2026) a "can give again" nudge is not wanted.
    if (med.asNeeded || med.minIntervalHours == null || !med.latestDose) continue;
    const dose = med.latestDose;
    const dueAt = dose.givenAt + med.minIntervalHours * HOUR_MS;
    const lateAt = med.maxIntervalHours != null && med.maxIntervalHours > med.minIntervalHours
      ? dose.givenAt + med.maxIntervalHours * HOUR_MS
      : dueAt + MED_LATE_AFTER_MS;
    if (input.now < dueAt || input.now - lateAt > MED_STALE_AFTER_MS) continue;
    const late = input.now >= lateAt;
    const by = dose.givenBy ? ` by ${dose.givenBy}` : "";
    pushes.push({
      key: `med:${med.id}:${dose.id}:${late ? "late" : "due"}`,
      tag: `med:${med.id}`,
      title: late ? `${med.name} overdue` : `${med.name} due`,
      body: `${med.doseText ? `${med.doseText}. ` : ""}${late ? `Due since ${sgtClock(dueAt)}. ` : ""}Last given at ${sgtClock(dose.givenAt)}${by}.`,
      url: "/dashboard",
    });
  }
  return pushes;
}

/**
 * The pushes this household should get now. Pure: the caller loads state,
 * drops keys already in notification_log, sends, then logs the keys.
 * Feed and nap pushes are quiet at night (B, 22 Nov 2026); medication pushes are not.
 */
export function planPushes(input: PushPlanInput): PlannedPush[] {
  const pushes: PlannedPush[] = [];
  if (!isQuietHours(input.now)) {
    const nap = napPush(input);
    if (nap) pushes.push(nap);
    const feed = feedPush(input);
    if (feed) pushes.push(feed);
  }
  pushes.push(...medicationPushes(input));
  return pushes;
}
