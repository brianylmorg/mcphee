"use client";

import { useEffect, useRef } from "react";
import { sgtDateKey } from "@/lib/milk-volumes";
import { msUntilNextSgtMidnight } from "@/lib/sgt-day";

/**
 * Calls `onNewDay(previousKey, nextKey)` when the Singapore date changes.
 * A timer fires just after midnight; because installed iOS apps pause timers
 * in the background, the date is also rechecked when the app returns to the
 * foreground and once a minute as a backstop.
 */
export function useSgtDayRollover(onNewDay: (previousKey: string, nextKey: string) => void) {
  const dayKeyRef = useRef(sgtDateKey(Date.now()));
  const onNewDayRef = useRef(onNewDay);
  onNewDayRef.current = onNewDay;

  useEffect(() => {
    let midnightTimer: number | undefined;
    const check = () => {
      const nextKey = sgtDateKey(Date.now());
      if (nextKey !== dayKeyRef.current) {
        const previousKey = dayKeyRef.current;
        dayKeyRef.current = nextKey;
        onNewDayRef.current(previousKey, nextKey);
      }
    };
    const scheduleMidnight = () => {
      window.clearTimeout(midnightTimer);
      midnightTimer = window.setTimeout(() => {
        check();
        scheduleMidnight();
      }, msUntilNextSgtMidnight(Date.now()) + 1_000);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      check();
      scheduleMidnight();
    };

    scheduleMidnight();
    const backstop = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      window.clearTimeout(midnightTimer);
      window.clearInterval(backstop);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, []);
}
