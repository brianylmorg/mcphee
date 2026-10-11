import assert from "node:assert/strict";
import test from "node:test";

import {
  IDLE_PULL_GESTURE,
  PULL_REFRESH_THRESHOLD_PX,
  aggregateDashboardRefreshResults,
  runSingleFlight,
  shouldSkipForManualRefresh,
  standaloneDisplayModeMatches,
  transitionPullGesture,
  type PromiseHolder,
  type PullGestureState,
} from "./dashboard-refresh";

function startGesture(): PullGestureState {
  return transitionPullGesture(IDLE_PULL_GESTURE, {
    type: "start",
    x: 100,
    y: 20,
    touchCount: 1,
    eligible: true,
  }).state;
}

test("pull gesture refreshes once only after a vertical threshold release", () => {
  let state = startGesture();
  const moved = transitionPullGesture(state, {
    type: "move",
    x: 104,
    y: 20 + PULL_REFRESH_THRESHOLD_PX,
    touchCount: 1,
    eligible: true,
  });
  assert.equal(moved.state.phase, "ready");
  assert.equal(moved.preventDefault, true);

  const released = transitionPullGesture(moved.state, { type: "end", eligible: true });
  assert.equal(released.shouldRefresh, true);
  assert.equal(released.state.phase, "idle");
  assert.equal(transitionPullGesture(released.state, { type: "end", eligible: true }).shouldRefresh, false);
});

test("short, upward, horizontal, multitouch, cancelled, ineligible pulls do not refresh", () => {
  const short = transitionPullGesture(startGesture(), {
    type: "move", x: 100, y: 20 + PULL_REFRESH_THRESHOLD_PX - 1, touchCount: 1, eligible: true,
  }).state;
  assert.equal(transitionPullGesture(short, { type: "end", eligible: true }).shouldRefresh, false);

  const upward = transitionPullGesture(startGesture(), { type: "move", x: 100, y: 10, touchCount: 1, eligible: true });
  assert.equal(upward.state.phase, "idle");
  const horizontal = transitionPullGesture(startGesture(), { type: "move", x: 130, y: 30, touchCount: 1, eligible: true });
  assert.equal(horizontal.state.phase, "idle");
  const multitouch = transitionPullGesture(startGesture(), { type: "move", x: 100, y: 100, touchCount: 2, eligible: true });
  assert.equal(multitouch.state.phase, "idle");
  const cancelled = transitionPullGesture(startGesture(), { type: "cancel" });
  assert.equal(cancelled.state.phase, "idle");
  const scrolledOrBlocked = transitionPullGesture(startGesture(), { type: "move", x: 100, y: 100, touchCount: 1, eligible: false });
  assert.equal(scrolledOrBlocked.state.phase, "idle");
});

test("gesture cannot start when it is ineligible or has multiple touches", () => {
  assert.equal(transitionPullGesture(IDLE_PULL_GESTURE, {
    type: "start", x: 0, y: 0, touchCount: 1, eligible: false,
  }).state.phase, "idle");
  assert.equal(transitionPullGesture(IDLE_PULL_GESTURE, {
    type: "start", x: 0, y: 0, touchCount: 2, eligible: true,
  }).state.phase, "idle");
});

test("standalone mode includes standalone, fullscreen, and iOS navigator flags", () => {
  assert.equal(standaloneDisplayModeMatches({ standalone: true, fullscreen: false, navigatorStandalone: false }), true);
  assert.equal(standaloneDisplayModeMatches({ standalone: false, fullscreen: true, navigatorStandalone: false }), true);
  assert.equal(standaloneDisplayModeMatches({ standalone: false, fullscreen: false, navigatorStandalone: true }), true);
  assert.equal(standaloneDisplayModeMatches({ standalone: false, fullscreen: false, navigatorStandalone: false }), false);
});

test("refresh aggregation reports complete, partial, and honest failure states", () => {
  assert.equal(aggregateDashboardRefreshResults(["success", "success", "success", "success"]).kind, "success");
  assert.equal(aggregateDashboardRefreshResults(["success", "failed", "success", "superseded"]).kind, "partial");
  assert.equal(aggregateDashboardRefreshResults(["failed", "superseded", "skipped", "failed"]).kind, "failure");
});

test("manual refresh suppresses background polling but never explicit mutation refreshes", () => {
  assert.equal(shouldSkipForManualRefresh(true, true), true);
  assert.equal(shouldSkipForManualRefresh(true, false), false);
  assert.equal(shouldSkipForManualRefresh(false, true), false);
});

test("single-flight coalesces double refresh and permits retry after an error", async () => {
  const holder: PromiseHolder<string> = { current: null };
  let calls = 0;
  let resolve!: (value: string) => void;
  const task = () => {
    calls += 1;
    return new Promise<string>((done) => { resolve = done; });
  };

  const first = runSingleFlight(holder, task);
  const second = runSingleFlight(holder, task);
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolve("ok");
  assert.equal(await first, "ok");
  await Promise.resolve();
  assert.equal(holder.current, null);

  const failingHolder: PromiseHolder<string> = { current: null };
  await assert.rejects(runSingleFlight(failingHolder, async () => { throw new Error("offline"); }), /offline/);
  await Promise.resolve();
  assert.equal(failingHolder.current, null);
  assert.equal(await runSingleFlight(failingHolder, async () => "retried"), "retried");
});
