"use client";

import { useEffect, useState } from "react";
import { HeartPulse } from "lucide-react";
import { useHousehold } from "@/lib/context/household-context";
import { CARE_MODE_EVENT, isCareModeUpdate } from "@/lib/care-mode";

// The dashboard publishes the care-mode state whenever it loads sick mode (on
// any change, and at least every 10 minutes), so this only fetches on pages
// without it, or when nothing has confirmed the state for a while.
const CONFIRMED_FRESH_MS = 11 * 60_000;
const CHECK_MS = 60_000;

export default function CareModeTheme({ initialHouseholdId, initialBabyId, initialActive = false }: {
  initialHouseholdId?: string;
  initialBabyId?: string;
  initialActive?: boolean;
}) {
  const { householdId } = useHousehold();
  const [state, setState] = useState({ householdId: initialHouseholdId ?? null, active: initialActive });
  const active = state.householdId === householdId && state.active && Boolean(householdId);

  useEffect(() => {
    let cancelled = false;
    let request = 0;
    let babyId = householdId === initialHouseholdId ? initialBabyId : undefined;
    let confirmedAt = 0;
    setState(current => current.householdId === householdId ? current : { householdId, active: false });
    const refresh = async () => {
      if (!householdId || document.visibilityState === "hidden") return;
      if (Date.now() - confirmedAt < CONFIRMED_FRESH_MS) return;
      const sequence = ++request;
      try {
        if (!babyId) {
          const response = await fetch("/api/babies", { cache: "no-store" });
          if (!response.ok) return;
          const data = await response.json();
          if (cancelled || sequence !== request) return;
          babyId = typeof data.babies?.[0]?.id === "string" ? data.babies[0].id : undefined;
          if (!babyId) { setState({ householdId, active: false }); return; }
        }
        const response = await fetch(`/api/sick-mode?babyId=${encodeURIComponent(babyId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled || sequence !== request) return;
        if (typeof data.schemaReady !== "boolean") return;
        confirmedAt = Date.now();
        setState({ householdId, active: data.schemaReady && Boolean(data.activeEpisode) });
      } catch {
        // Keep this household's last confirmed theme when offline. Never infer an end.
      }
    };
    const onUpdate = (event: Event) => {
      const update: unknown = (event as CustomEvent).detail;
      if (!isCareModeUpdate(update) || update.householdId !== householdId || (babyId && update.babyId !== babyId)) return;
      ++request; // A confirmed dashboard mutation wins over an older in-flight poll.
      babyId = update.babyId;
      confirmedAt = Date.now();
      setState({ householdId, active: update.active });
    };
    window.addEventListener(CARE_MODE_EVENT, onUpdate);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = window.setInterval(refresh, CHECK_MS);
    void refresh();
    return () => {
      cancelled = true;
      ++request;
      window.clearInterval(interval);
      window.removeEventListener(CARE_MODE_EVENT, onUpdate);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [householdId, initialHouseholdId, initialBabyId]);

  useEffect(() => {
    const root = document.documentElement;
    if (active) root.dataset.careMode = "sick";
    else delete root.dataset.careMode;
    const syncThemeColor = () => {
      const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      const color = active ? "#356B76" : "#A85D3F";
      if (themeMeta && themeMeta.content !== color) themeMeta.content = color;
    };
    // Prefetched navigation metadata may predate the latest episode mutation.
    // Keep browser chrome aligned with this household's confirmed client state.
    const observer = new MutationObserver(syncThemeColor);
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["content"] });
    syncThemeColor();
    return () => { observer.disconnect(); delete root.dataset.careMode; };
  }, [active]);

  if (!active) return null;
  return (
    <div role="status" className="care-mode-strip flex min-h-6 items-center justify-center gap-2 border-b border-border bg-surface-muted px-4 py-0.5 text-[10px] font-semibold tracking-wide text-accent-strong">
      <HeartPulse aria-hidden="true" className="h-3.5 w-3.5" />
      <span>Sick mode active</span>
      <span aria-hidden="true" className="font-normal opacity-70">·</span>
      <span className="font-normal text-muted">Until you turn it off</span>
    </div>
  );
}
