export const PULL_REFRESH_THRESHOLD_PX = 72;
const PULL_INTENT_DISTANCE_PX = 8;
const VERTICAL_INTENT_RATIO = 1.25;

export type RefreshTaskResult = "success" | "failed" | "superseded" | "skipped";

export function shouldSkipForManualRefresh(manualRefreshActive: boolean, background: boolean): boolean {
  return manualRefreshActive && background;
}

export type DashboardRefreshResult = {
  kind: "success" | "partial" | "failure";
  message: string;
};

export function aggregateDashboardRefreshResults(results: RefreshTaskResult[]): DashboardRefreshResult {
  const successful = results.filter((result) => result === "success").length;

  if (successful === results.length && results.length > 0) {
    return { kind: "success", message: "Refresh complete. Dashboard updated." };
  }
  if (successful > 0) {
    return { kind: "partial", message: "Some dashboard sections couldn’t refresh. Retry to get the latest data." };
  }
  return { kind: "failure", message: "Couldn’t refresh the dashboard. Check your connection and retry." };
}

export type PromiseHolder<T> = { current: Promise<T> | null };

/** Coalesce repeated manual refresh attempts and clear the slot after errors. */
export function runSingleFlight<T>(holder: PromiseHolder<T>, task: () => Promise<T>): Promise<T> {
  if (holder.current) return holder.current;

  const running = task();
  holder.current = running;
  void running.finally(() => {
    if (holder.current === running) holder.current = null;
  }).catch(() => {
    // The original promise remains rejected for its caller; this prevents the
    // cleanup branch from creating a second unhandled rejection.
  });
  return running;
}

export function standaloneDisplayModeMatches({
  standalone,
  fullscreen,
  navigatorStandalone,
}: {
  standalone: boolean;
  fullscreen: boolean;
  navigatorStandalone: boolean;
}): boolean {
  return standalone || fullscreen || navigatorStandalone;
}

export type PullGesturePhase = "idle" | "pending" | "pulling" | "ready";

export type PullGestureState = {
  phase: PullGesturePhase;
  startX: number;
  startY: number;
  distance: number;
};

export type PullGestureEvent =
  | { type: "start"; x: number; y: number; touchCount: number; eligible: boolean }
  | { type: "move"; x: number; y: number; touchCount: number; eligible: boolean }
  | { type: "end"; eligible: boolean }
  | { type: "cancel" };

export type PullGestureTransition = {
  state: PullGestureState;
  shouldRefresh: boolean;
  preventDefault: boolean;
};

export const IDLE_PULL_GESTURE: PullGestureState = {
  phase: "idle",
  startX: 0,
  startY: 0,
  distance: 0,
};

export function transitionPullGesture(
  current: PullGestureState,
  event: PullGestureEvent,
): PullGestureTransition {
  if (event.type === "cancel") {
    return { state: IDLE_PULL_GESTURE, shouldRefresh: false, preventDefault: false };
  }

  if (event.type === "start") {
    if (!event.eligible || event.touchCount !== 1) {
      return { state: IDLE_PULL_GESTURE, shouldRefresh: false, preventDefault: false };
    }
    return {
      state: { phase: "pending", startX: event.x, startY: event.y, distance: 0 },
      shouldRefresh: false,
      preventDefault: false,
    };
  }

  if (event.type === "end") {
    return {
      state: IDLE_PULL_GESTURE,
      shouldRefresh: event.eligible && current.phase === "ready",
      preventDefault: false,
    };
  }

  if (current.phase === "idle" || !event.eligible || event.touchCount !== 1) {
    return { state: IDLE_PULL_GESTURE, shouldRefresh: false, preventDefault: false };
  }

  const deltaX = event.x - current.startX;
  const deltaY = event.y - current.startY;
  const horizontalDistance = Math.abs(deltaX);

  if (deltaY <= 0 || (horizontalDistance >= PULL_INTENT_DISTANCE_PX && deltaY < horizontalDistance * VERTICAL_INTENT_RATIO)) {
    return { state: IDLE_PULL_GESTURE, shouldRefresh: false, preventDefault: false };
  }

  if (current.phase === "pending" && deltaY < PULL_INTENT_DISTANCE_PX) {
    return { state: current, shouldRefresh: false, preventDefault: false };
  }

  const phase = deltaY >= PULL_REFRESH_THRESHOLD_PX ? "ready" : "pulling";
  return {
    state: { ...current, phase, distance: deltaY },
    shouldRefresh: false,
    preventDefault: true,
  };
}
