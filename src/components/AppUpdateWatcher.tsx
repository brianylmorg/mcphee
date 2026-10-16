"use client";

import { useEffect } from "react";

import { isNewReleaseLive } from "@/lib/app-version";

const MIN_CHECK_GAP_MS = 30_000;
const BACKGROUND_CHECK_MS = 15 * 60_000;

/**
 * An installed app (PWA) stays alive in the background, so a refresh of the
 * data never picks up a new release. When the app comes back to the front, or
 * every so often, check which release is live and reload into it, unless an
 * editor or dialog is open (the page marks that with
 * data-dashboard-refresh-blocked), so nothing being typed is lost.
 */
export default function AppUpdateWatcher() {
  useEffect(() => {
    let lastCheck = 0;
    let checking = false;
    const check = async () => {
      if (checking || Date.now() - lastCheck < MIN_CHECK_GAP_MS) return;
      checking = true;
      lastCheck = Date.now();
      try {
        if (!(await isNewReleaseLive())) return;
        if (document.querySelector('[data-dashboard-refresh-blocked="true"]')) return;
        window.location.reload();
      } finally {
        checking = false;
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);
    const interval = window.setInterval(() => void check(), BACKGROUND_CHECK_MS);
    void check();
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.clearInterval(interval);
    };
  }, []);
  return null;
}
