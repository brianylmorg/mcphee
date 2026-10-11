"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  IDLE_PULL_GESTURE,
  standaloneDisplayModeMatches,
  transitionPullGesture,
  type PullGestureState,
} from "@/lib/dashboard-refresh";

export const DASHBOARD_REFRESH_BLOCKING_SELECTOR = [
  "dialog[open]",
  '[role="dialog"]:not([hidden])',
  '[aria-modal="true"]:not([hidden])',
  '[data-dashboard-refresh-blocked="true"]',
  ".health-check-in input:not([type=\"hidden\"])",
  ".health-check-in textarea",
  ".health-check-in select",
].join(",");

const INTERACTIVE_PULL_TARGET_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "label",
  "summary",
  "[contenteditable=true]",
  '[role="button"]',
  '[role="slider"]',
  "svg",
  "canvas",
  "[data-chart]",
].join(",");

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

export function hasDashboardRefreshBlocker(root: ParentNode = document): boolean {
  return Boolean(root.querySelector(DASHBOARD_REFRESH_BLOCKING_SELECTOR));
}

function isAtDocumentTop(): boolean {
  // iOS rubber-band scrolling can report a negative scrollY at the top.
  return window.scrollY <= 0 && document.documentElement.scrollTop <= 0;
}

function isNestedScroller(element: Element): boolean {
  for (let current: Element | null = element; current && current !== document.documentElement; current = current.parentElement) {
    if (current === document.body) return false;
    const style = window.getComputedStyle(current);
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 1;
    const canScrollX = /(auto|scroll)/.test(style.overflowX) && current.scrollWidth > current.clientWidth + 1;
    if (canScrollY || canScrollX) return true;
  }
  return false;
}

function isAllowedPullTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(INTERACTIVE_PULL_TARGET_SELECTOR)) return false;
  return !isNestedScroller(target);
}

function standaloneMatches(): boolean {
  return standaloneDisplayModeMatches({
    standalone: window.matchMedia("(display-mode: standalone)").matches,
    fullscreen: window.matchMedia("(display-mode: fullscreen)").matches,
    navigatorStandalone: Boolean((navigator as NavigatorWithStandalone).standalone),
  });
}

export function useDashboardRefreshBlocked(explicitBlocked: boolean): boolean {
  const [domBlocked, setDomBlocked] = useState(false);

  useEffect(() => {
    const update = () => setDomBlocked(hasDashboardRefreshBlocker());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open", "hidden", "role", "aria-modal", "data-dashboard-refresh-blocked"],
    });
    return () => observer.disconnect();
  }, []);

  return explicitBlocked || domBlocked;
}

export function useStandalonePullToRefresh({
  disabled,
  onRefresh,
}: {
  disabled: boolean;
  onRefresh: () => void;
}): {
  isStandalone: boolean;
  pullDistance: number;
  pullPhase: "idle" | "pulling" | "ready";
} {
  const [isStandalone, setIsStandalone] = useState(false);
  const [gesture, setGesture] = useState<PullGestureState>(IDLE_PULL_GESTURE);
  const gestureRef = useRef(gesture);
  const disabledRef = useRef(disabled);
  const onRefreshRef = useRef(onRefresh);

  const updateGesture = useCallback((next: PullGestureState) => {
    gestureRef.current = next;
    setGesture(next);
  }, []);

  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const fullscreenQuery = window.matchMedia("(display-mode: fullscreen)");
    const update = () => setIsStandalone(standaloneMatches());
    update();
    standaloneQuery.addEventListener?.("change", update);
    fullscreenQuery.addEventListener?.("change", update);
    return () => {
      standaloneQuery.removeEventListener?.("change", update);
      fullscreenQuery.removeEventListener?.("change", update);
    };
  }, []);

  useEffect(() => {
    if (!isStandalone) {
      updateGesture(IDLE_PULL_GESTURE);
      return;
    }

    const eligible = (target?: EventTarget | null) => !disabledRef.current
      && !hasDashboardRefreshBlocker()
      && isAtDocumentTop()
      && (target === undefined || isAllowedPullTarget(target));

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      const transition = transitionPullGesture(gestureRef.current, {
        type: "start",
        x: touch?.clientX ?? 0,
        y: touch?.clientY ?? 0,
        touchCount: event.touches.length,
        eligible: Boolean(touch) && eligible(event.target),
      });
      updateGesture(transition.state);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      const transition = transitionPullGesture(gestureRef.current, {
        type: "move",
        x: touch?.clientX ?? 0,
        y: touch?.clientY ?? 0,
        touchCount: event.touches.length,
        eligible: Boolean(touch) && eligible(),
      });
      if (transition.preventDefault) event.preventDefault();
      updateGesture(transition.state);
    };
    const finish = () => {
      const transition = transitionPullGesture(gestureRef.current, {
        type: "end",
        eligible: eligible(),
      });
      updateGesture(transition.state);
      if (transition.shouldRefresh) onRefreshRef.current();
    };
    const cancel = () => updateGesture(IDLE_PULL_GESTURE);

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", finish, { passive: true });
    document.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", cancel);
      updateGesture(IDLE_PULL_GESTURE);
    };
  }, [isStandalone, updateGesture]);

  useEffect(() => {
    if (disabled && gestureRef.current.phase !== "idle") updateGesture(IDLE_PULL_GESTURE);
  }, [disabled, updateGesture]);

  return {
    isStandalone,
    pullDistance: gesture.distance,
    pullPhase: gesture.phase === "ready" ? "ready" : gesture.phase === "pulling" ? "pulling" : "idle",
  };
}
