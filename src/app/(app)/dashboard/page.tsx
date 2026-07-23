"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useHousehold } from "@/lib/context/household-context";
import { useRouter } from "next/navigation";
import { formatAge, timeSince, median, formatTime, formatDate, formatWeight } from "@/lib/utils";
import { bottleBreastmilkLibraryDeduction, parseMlCalculation } from "@/lib/milk-calculation";

interface Baby {
  id: string;
  name: string;
  birth_date: number | null;
}

interface Activity {
  id: string;
  type: string;
  started_at: number;
  details: string | Record<string, unknown>; // JSON string from API, parsed client-side
  created_by?: string;
}

interface User {
  id: string;
  name: string;
}

export default function DashboardPage() {
  const { householdId, userId, userName, setHouseholdId, setUserId } = useHousehold();
  const router = useRouter();
  const [baby, setBaby] = useState<Baby | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [inviteCode, setInviteCode] = useState("");
  const [showLogModal, setShowLogModal] = useState(false);
  const [showActivityMenu, setShowActivityMenu] = useState(false);
  const [logType, setLogType] = useState<string | null>(null);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [deleteActivity, setDeleteActivity] = useState<Activity | null>(null);
  const [isDeletingActivity, setIsDeletingActivity] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTimer, setActiveTimer] = useState<Record<string, unknown> | null>(null);
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [breastfeedPromptShown, setBreastfeedPromptShown] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [dailyMilkMl, setDailyMilkMl] = useState(0);
  const [breastmilkLibraryMl, setBreastmilkLibraryMl] = useState(0);
  const [lastPumpedMl, setLastPumpedMl] = useState(0);
  const [lastPumpedAt, setLastPumpedAt] = useState<number | null>(null);
  const [expectedDailyMilkMl, setExpectedDailyMilkMl] = useState<number | null>(null);
  const [activityDateFilter, setActivityDateFilter] = useState("");
  const [activityTypeFilter, setActivityTypeFilter] = useState("all");
  const [filteredActivities, setFilteredActivities] = useState<Activity[]>([]);
  const [isActivityFilterLoading, setIsActivityFilterLoading] = useState(false);
  const [activityFilterRefresh, setActivityFilterRefresh] = useState(0);

  const sgtDateKey = (offsetDays = 0): string => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
    return [part("year"), part("month"), part("day")].join("-");
  };

  const todayDateKey = sgtDateKey(0);
  const yesterdayDateKey = sgtDateKey(-1);
  const isActivityFiltered = Boolean(activityDateFilter || activityTypeFilter !== "all");
  const activityActionTypes = ["bottlefeed", "breastfeed", "pump", "diaper", "vomit"];
  const activityIcons: Record<string, string> = {
    bottlefeed: "🍼",
    breastfeed: "🤱",
    pump: "🧴",
    diaper: "🧷",
    vomit: "🤮",
  };

  const activityTypeOptions = [
    { value: "all", label: "All" },
    { value: "bottlefeed", label: "Bottlefeed" },
    { value: "breastfeed", label: "Breastfeed" },
    { value: "pump", label: "Pump" },
    { value: "diaper", label: "Diaper" },
    { value: "vomit", label: "Vomit" },
  ];

  useEffect(() => {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      setPushSupported(true);
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setPushEnabled(!!sub);
        });
      });
    }
  }, []);

  const togglePush = async () => {
    setPushLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (pushEnabled) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch(`/api/push-subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
          await sub.unsubscribe();
        }
        setPushEnabled(false);
      } else {
        const vapidRes = await fetch("/api/push-vapid");
        const vapidData = await vapidRes.json();
        if (!vapidData.publicKey) { alert(vapidData.error || "Push not configured on server"); return; }
        const publicKey = vapidData.publicKey;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
        await fetch("/api/push-subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: sub.toJSON(), label: navigator.userAgent.slice(0, 50) }),
        });
        setPushEnabled(true);
      }
    } catch (err) {
      console.error("Push toggle error:", err);
      alert("Could not toggle notifications. Check browser permissions.");
    } finally {
      setPushLoading(false);
    }
  };

  const fetchData = useCallback(async () => {
    if (!householdId) return;

    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load dashboard");

      const data = await res.json();

      if (data.babies?.length > 0) {
        setBaby(data.babies[0]);
      }
      setActivities(data.activities || []);
      if (data.household?.inviteCode) {
        setInviteCode(data.household.inviteCode);
      }
      if (data.measurement?.weight_g != null) {
        setLatestWeight(Number(data.measurement.weight_g));
      }
      setDailyMilkMl(Number(data.dailyMilk?.totalMl ?? 0));
      setBreastmilkLibraryMl(Number(data.pumpedMilk?.walletMl ?? 0));
      setLastPumpedMl(Number(data.pumpedMilk?.lastPumpMl ?? 0));
      const lastPumpAt = Number(data.pumpedMilk?.lastPumpAt);
      setLastPumpedAt(Number.isFinite(lastPumpAt) && lastPumpAt > 0 ? lastPumpAt : null);
      const expectedMilk = Number(data.dailyMilk?.expectedMl);
      setExpectedDailyMilkMl(Number.isFinite(expectedMilk) ? expectedMilk : null);
      if (data.timers?.length > 0) {
        setActiveTimer(data.timers[0]);
        setTimerElapsed(Date.now() - Number(data.timers[0].started_at));
      } else {
        setActiveTimer(null);
        setTimerElapsed(0);
      }
    } catch (error) {
      console.error("Fetch error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    if (!householdId) {
      router.push("/");
      return;
    }
    fetchData();

    const interval = setInterval(fetchData, 10000);
    window.addEventListener("focus", fetchData);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", fetchData);
    };
  }, [householdId, router, fetchData]);

  useEffect(() => {
    if (!householdId) return;

    if (!isActivityFiltered) {
      setFilteredActivities([]);
      setIsActivityFilterLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "500" });
    if (activityDateFilter) params.set("date", activityDateFilter);
    if (activityTypeFilter !== "all") params.set("type", activityTypeFilter);

    setIsActivityFilterLoading(true);
    fetch("/api/activities?" + params.toString(), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load activity filter");
        return res.json();
      })
      .then((data) => setFilteredActivities(data.activities || []))
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          console.error("Activity filter error:", error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsActivityFilterLoading(false);
      });

    return () => controller.abort();
  }, [householdId, isActivityFiltered, activityDateFilter, activityTypeFilter, activityFilterRefresh]);

  // Live timer ticker
  useEffect(() => {
    if (!activeTimer) return;
    const tick = () => setTimerElapsed(Date.now() - Number(activeTimer.started_at));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeTimer]);

  const handleLeave = async () => {
    if (!confirm("Are you sure you want to leave this household?")) return;
    
    try {
      await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave" }),
      });
      setHouseholdId(null);
      router.push("/");
    } catch (error) {
      console.error("Leave error:", error);
    }
  };

  const handleDelete = async () => {
    if (!deleteActivity) return;
    setIsDeletingActivity(true);
    try {
      const res = await fetch(`/api/activities?id=${deleteActivity.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete activity");
      setDeleteActivity(null);
      fetchData();
      setActivityFilterRefresh((value) => value + 1);
    } catch (error) {
      console.error("Delete error:", error);
    } finally {
      setIsDeletingActivity(false);
    }
  };

  const handleStartTimer = async (type: string, side?: string) => {
    if (!baby?.id) return;
    try {
      const res = await fetch("/api/active-timers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          babyId: baby.id,
          type,
          side: side || "L",
          startedBy: userId,
        }),
      });
      if (!res.ok) throw new Error("Failed to start timer");
    } catch (error) {
      console.error("Start timer error:", error);
    }
  };

  const handleSwitchSide = async (side: string) => {
    if (!baby?.id) return;
    try {
      await fetch("/api/active-timers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ babyId: baby.id, side }),
      });
      fetchData();
    } catch (error) {
      console.error("Switch side error:", error);
    }
  };

  const handleStopTimer = async () => {
    if (!activeTimer || !baby?.id) return;
    try {
      await fetch(`/api/active-timers?id=${activeTimer.id}&babyId=${baby.id}`, {
        method: "DELETE",
      });
      setActiveTimer(null);
      fetchData();
    } catch (error) {
      console.error("Stop timer error:", error);
    }
  };

  const handleActivityAction = (type: string) => {
    if (type === "breastfeed" && !activeTimer) {
      if (!breastfeedPromptShown) {
        setBreastfeedPromptShown(true);
        return;
      }

      setActiveTimer({ type: "breastfeed", started_at: Date.now(), current_side: "L" });
      setTimerElapsed(0);
      setBreastfeedPromptShown(false);
      setShowActivityMenu(false);
      handleStartTimer("breastfeed", "L");
      return;
    }

    setLogType(type);
    setShowLogModal(true);
    setShowActivityMenu(false);
  };

  const formatElapsed = (ms: number): string => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const getLastActivity = (type: string) => {
    return activities.find((a) => a.type === type);
  };

  const getIntervalMedian = (type: string): number => {
    const typeActivities = activities.filter((a) => a.type === type);
    if (typeActivities.length < 3) return 0;

    const intervals: number[] = [];
    for (let i = 1; i < Math.min(typeActivities.length, 9); i++) {
      intervals.push(
        typeActivities[i - 1].started_at - typeActivities[i].started_at
      );
    }
    return median(intervals);
  };

  const isOverdue = (type: string): boolean => {
    const last = getLastActivity(type);
    const medianInterval = getIntervalMedian(type);
    if (!last || !medianInterval) return false;

    const elapsed = Date.now() - last.started_at;
    return elapsed > medianInterval * 1.2;
  };


  const parseDetails = (activity: Activity): Record<string, unknown> => {
    if (!activity.details) return {};
    if (typeof activity.details === "object") return activity.details as Record<string, unknown>;
    try { return JSON.parse(activity.details as string) as Record<string, unknown>; }
    catch { return {}; }
  };

  const getActivityComment = (activity: Activity): string => {
    const details = parseDetails(activity);
    const calculations: string[] = [];

    if (activity.type === "bottlefeed" && Array.isArray(details.feeds)) {
      details.feeds.forEach((item) => {
        if (!item || typeof item !== "object") return;
        const feed = item as Record<string, unknown>;
        const expression = typeof feed.amountExpression === "string" ? feed.amountExpression.trim() : "";
        if (!expression) return;
        const label = details.feeds && Array.isArray(details.feeds) && details.feeds.length > 1
          ? milkTypeLabel(feed.milkType) + ": "
          : "";
        calculations.push(label + expression + " ml");
      });
    } else if ((activity.type === "bottlefeed" || activity.type === "pump") && typeof details.amountExpression === "string") {
      const expression = details.amountExpression.trim();
      if (expression) calculations.push(expression + " ml");
    }

    const note = typeof details.notes === "string" ? details.notes.trim() : "";
    return [...calculations, note].filter(Boolean).join(" · ");
  };

  const activityTitle = (type: string): string => {
    if (type === "bottlefeed") return "Bottlefeed";
    if (type === "breastfeed") return "Breastfeed";
    if (type === "diaper") return "Diaper";
    if (type === "vomit") return "Vomit";
    if (type === "pump") return "Pump";
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  const milkTypeLabel = (value: unknown): string => {
    if (value === "formula") return "Formula";
    if (value === "breastmilk") return "Breast milk";
    return "";
  };

  const sideLabel = (value: unknown): string => {
    if (value === "L") return "Left side";
    if (value === "R") return "Right side";
    if (value === "both") return "Both sides";
    return typeof value === "string" && value ? value : "";
  };

  const peeUnitsLabel = (value: unknown): string => {
    const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
    if (/^[1-5]$/.test(raw)) return `${raw} unit${raw === "1" ? "" : "s"}`;
    if (raw === "M") return "3 units";
    if (raw === "L") return "5 units";
    return "";
  };

  const getActivityDisplay = (activity: Activity): { title: string; subcategory: string; quantity: string } => {
    const d = parseDetails(activity);
    switch (activity.type) {
      case "bottlefeed": {
        let breastmilkAmount = 0;
        let formulaAmount = 0;
        if (Array.isArray(d.feeds)) {
          d.feeds.forEach((item) => {
            if (!item || typeof item !== "object") return;
            const feed = item as Record<string, unknown>;
            const amount = Number(feed.amount);
            if (!Number.isFinite(amount) || amount <= 0) return;
            if (feed.milkType === "formula") formulaAmount += amount;
            else if (feed.milkType === "breastmilk") breastmilkAmount += amount;
          });
        } else {
          const amount = d.amount != null && d.amount !== "" ? Number(d.amount) : 0;
          const storedBreastmilk = Number(d.breastmilkAmount);
          const storedFormula = Number(d.formulaAmount);
          if (Number.isFinite(storedBreastmilk) && storedBreastmilk > 0) breastmilkAmount = storedBreastmilk;
          if (Number.isFinite(storedFormula) && storedFormula > 0) formulaAmount = storedFormula;
          if (breastmilkAmount === 0 && formulaAmount === 0 && Number.isFinite(amount) && amount > 0) {
            if (d.milkType === "formula") formulaAmount = amount;
            else breastmilkAmount = amount;
          }
        }

        const quantityParts = [
          breastmilkAmount > 0 ? "Breast milk " + breastmilkAmount + " ml" : "",
          formulaAmount > 0 ? "Formula " + formulaAmount + " ml" : "",
        ].filter(Boolean);
        return {
          title: "Bottlefeed",
          subcategory: breastmilkAmount > 0 && formulaAmount > 0 ? "Breast milk + formula" : breastmilkAmount > 0 ? "Breast milk" : formulaAmount > 0 ? "Formula" : milkTypeLabel(d.milkType),
          quantity: quantityParts.join(" · "),
        };
      }
      case "breastfeed":
        return { title: "Breastfeed", subcategory: sideLabel(d.side), quantity: "" };
      case "pump": {
        const amount = d.amount != null && d.amount !== "" ? Number(d.amount) : null;
        return {
          title: "Pump",
          subcategory: sideLabel(d.side),
          quantity: amount != null && Number.isFinite(amount) ? `${amount} ml` : "",
        };
      }
      case "diaper": {
        const peeUnits = peeUnitsLabel(d.peeUnits ?? d.peeSize);
        const poopSize = d.poop === "M" || d.poop === "L" ? String(d.poop) : "";
        const hasPee = Boolean(peeUnits);
        const hasPoop = Boolean(poopSize);
        return {
          title: "Diaper",
          subcategory: hasPee && hasPoop ? "Pee + poop" : hasPee ? "Pee" : hasPoop ? "Poop" : "Diaper change",
          quantity: [hasPee ? peeUnits : "", hasPoop ? `poop ${poopSize}` : ""].filter(Boolean).join(" · "),
        };
      }
      case "vomit": {
        const labels: Record<string, string> = {
          projectile: "Projectile",
          "dribble-milk": "Dribble milk",
          "dribble-beancurd": "Dribble beancurd",
        };
        return { title: "Vomit", subcategory: labels[d.vomitType as string] || "", quantity: "" };
      }
      default:
        return { title: activityTitle(activity.type), subcategory: "", quantity: "" };
    }
  };


  const formatHourMark = (timestamp: number): string => {
    const parts = new Intl.DateTimeFormat("en-SG", {
      hour: "2-digit",
      timeZone: "Asia/Singapore",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const hour = parts.find((item) => item.type === "hour")?.value ?? "00";
    return `${hour.padStart(2, "0")}:00 hrs`;
  };

  const dailyMilkProgress = expectedDailyMilkMl
    ? Math.min(100, Math.round((dailyMilkMl / expectedDailyMilkMl) * 100))
    : 0;

  if (isLoading) {
    return (
      <main className="min-h-screen bg-cream flex items-center justify-center">
        <p className="text-warm-brown-light">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-cream pb-32">
      <header className="bg-white border-b border-warm-brown-light/10 px-6 py-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl text-terracotta">
              {baby?.name || "Baby"}
            </h1>
            {(baby?.birth_date || latestWeight) && (
              <p className="text-sm text-warm-brown-light">
                {baby?.birth_date ? formatAge(baby.birth_date) : ""}
                {baby?.birth_date && latestWeight ? " · " : ""}
                {latestWeight ? formatWeight(latestWeight) : ""}
              </p>
            )}
            <Link
              href="/weight"
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-terracotta/20 bg-terracotta/10 px-3 py-1.5 text-xs font-semibold text-terracotta shadow-sm transition-colors hover:bg-terracotta/15"
            >
              <span aria-hidden="true">⚖</span>
              Weight details
            </Link>
            {userName && (
              <p className="text-xs text-warm-brown-light/70 mt-1">
                You are {userName}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-warm-brown-light mb-1">Invite code</p>
            <span className="font-mono text-sm bg-terracotta/10 text-terracotta px-2 py-1 rounded">
              {inviteCode}
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-6 py-6 space-y-4">
        {/* Daily Milk Total */}
        <div className="bg-white rounded-2xl border border-terracotta/20 p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-warm-brown-light/50">
              Since 00:00 hrs SGT
            </p>
            <h2 className="font-display text-lg text-terracotta mt-1">Today&apos;s milk consumption</h2>
          </div>

          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-4xl text-warm-brown font-semibold tabular-nums">
                  {dailyMilkMl}
                </span>
                <span className="text-warm-brown-light text-base">ml</span>
              </div>
              <p className="text-xs text-warm-brown-light/60 mt-1">
                Breast milk + formula consumed
              </p>
            </div>
            <div className="rounded-lg bg-cream px-2.5 py-1.5 text-right">
              <p className="text-[10px] text-warm-brown-light/60">Expected</p>
              <p className="font-display text-base text-warm-brown tabular-nums">
                {expectedDailyMilkMl ? expectedDailyMilkMl + " ml" : "-- ml"}
              </p>
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-cream">
            <div
              className="h-full rounded-full bg-terracotta transition-all"
              style={{ width: expectedDailyMilkMl ? dailyMilkProgress + "%" : "0%" }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-warm-brown-light/50">
            <span>Total today</span>
            <span>{expectedDailyMilkMl ? dailyMilkProgress + "%" : "Target pending"}</span>
          </div>
          <div className="mt-3 rounded-lg bg-cream px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-warm-brown-light/50">Breastmilk library</p>
            <p className="mt-0.5 font-display text-base text-warm-brown tabular-nums">{breastmilkLibraryMl} ml</p>
            <p className="mt-0.5 text-[11px] text-warm-brown-light/55">Available pumped breast milk for bottlefeeds</p>
          </div>
        </div>

        {/* Live Timer */}
        {activeTimer && (
          <div className="bg-white rounded-2xl border border-terracotta/30 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">🤱</span>
                <div>
                  <p className="text-sm text-warm-brown-light/60">Live feeding</p>
                  <p className="font-display text-3xl text-terracotta font-semibold tabular-nums">
                    {formatElapsed(timerElapsed)}
                  </p>
                </div>
              </div>
              {timerElapsed > 2 * 60 * 60 * 1000 && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                  Safety check
                </span>
              )}
            </div>
            <div className="flex gap-2 mb-4">
              {["L", "R"].map((s) => (
                <button
                  key={s}
                  onClick={() => handleSwitchSide(s)}
                  className={`flex-1 py-3 rounded-xl text-sm font-medium uppercase transition-colors ${
                    activeTimer.current_side === s
                      ? "bg-terracotta text-white"
                      : "bg-cream border border-warm-brown-light/20"
                  }`}
                >
                  {s === "L" ? "Left" : "Right"} side
                </button>
              ))}
            </div>
            <button
              onClick={handleStopTimer}
              className="w-full py-3 bg-green-600 text-white font-medium rounded-xl text-sm hover:bg-green-700 transition-colors"
            >
              Stop & log
            </button>
          </div>
        )}

        {/* Recent Activity */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-warm-brown-light">Recent Activity</h2>
            <div className="flex items-center gap-2">
              {baby?.id && (
                <a
                  href={`/api/activities/export?babyId=${encodeURIComponent(baby.id)}`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-full border border-terracotta/20 bg-white px-3 py-1.5 text-xs font-semibold text-terracotta shadow-sm transition-colors hover:bg-terracotta/10"
                >
                  <span aria-hidden="true">↓</span>
                  Export CSV
                </a>
              )}
              {isActivityFiltered && (
                <button
                  onClick={() => {
                    setActivityDateFilter("");
                    setActivityTypeFilter("all");
                  }}
                  className="text-xs text-terracotta hover:text-terracotta-dark transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-warm-brown-light/10 p-3 mb-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActivityDateFilter("")}
                className={"px-3 py-2 rounded-lg text-xs font-medium transition-colors " + (!activityDateFilter ? "bg-terracotta text-white" : "bg-cream border border-warm-brown-light/20 text-warm-brown")}
              >
                All days
              </button>
              <button
                onClick={() => setActivityDateFilter(todayDateKey)}
                className={"px-3 py-2 rounded-lg text-xs font-medium transition-colors " + (activityDateFilter === todayDateKey ? "bg-terracotta text-white" : "bg-cream border border-warm-brown-light/20 text-warm-brown")}
              >
                Today
              </button>
              <button
                onClick={() => setActivityDateFilter(yesterdayDateKey)}
                className={"px-3 py-2 rounded-lg text-xs font-medium transition-colors " + (activityDateFilter === yesterdayDateKey ? "bg-terracotta text-white" : "bg-cream border border-warm-brown-light/20 text-warm-brown")}
              >
                Yesterday
              </button>
              <input
                type="date"
                value={activityDateFilter}
                onChange={(e) => setActivityDateFilter(e.target.value)}
                className="min-w-[144px] flex-1 px-3 py-2 rounded-lg border border-warm-brown-light/20 bg-cream text-xs text-warm-brown outline-none focus:border-terracotta"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {activityTypeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setActivityTypeFilter(option.value)}
                  className={"px-3 py-2 rounded-lg text-xs font-medium transition-colors " + (activityTypeFilter === option.value ? "bg-terracotta text-white" : "bg-cream border border-warm-brown-light/20 text-warm-brown")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {(() => {
              const visible = isActivityFiltered ? filteredActivities : showHistory ? activities : activities.slice(0, 6);
              const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
              const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

              if (isActivityFilterLoading) {
                return <p className="text-center text-warm-brown-light py-8">Loading activities...</p>;
              }
              if (visible.length === 0) {
                return (
                  <p className="text-center text-warm-brown-light py-8">
                    {isActivityFiltered ? "No activities match these filters." : "No activities yet. Tap + to log one."}
                  </p>
                );
              }

              let lastDateKey = "";
              let lastHourKey = "";
              return visible.map((activity) => {
                const dateKey = new Date(activity.started_at).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
                const hourKey = formatHourMark(activity.started_at);
                const showDateHeader = dateKey !== lastDateKey;
                const showHourHeader = showDateHeader || hourKey !== lastHourKey;
                lastDateKey = dateKey;
                lastHourKey = hourKey;

                const dateLabel = dateKey === today ? "Today" : dateKey === yesterday ? "Yesterday" : formatDate(activity.started_at);
                const display = getActivityDisplay(activity);
                const comment = getActivityComment(activity);

                return (
                  <div key={activity.id}>
                    {showDateHeader && (
                      <p className="text-xs font-medium text-warm-brown-light/50 uppercase tracking-wide pt-3 pb-1 first:pt-0">
                        {dateLabel}
                      </p>
                    )}
                    {showHourHeader && (
                      <p className="pt-2 pb-1 font-display text-base text-terracotta tabular-nums">
                        {hourKey}
                      </p>
                    )}
                    <div
                      onClick={() => {
                        setEditingActivity(activity);
                        setLogType(activity.type);
                        setShowLogModal(true);
                      }}
                      className="bg-white p-4 rounded-xl border border-warm-brown-light/10 cursor-pointer hover:border-terracotta/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium uppercase tracking-wide text-warm-brown-light/60 tabular-nums">
                            {formatTime(activity.started_at)} · {timeSince(activity.started_at)}
                          </p>
                          <div className="mt-1 flex min-w-0 items-center gap-2">
                            <span className="text-xl shrink-0">{activityIcons[activity.type]}</span>
                            <p className="truncate text-lg font-semibold text-warm-brown">{display.title}</p>
                          </div>
                          {display.subcategory && (
                            <p className="mt-1 text-sm text-warm-brown-light">{display.subcategory}</p>
                          )}
                          {display.quantity && (
                            <p className="mt-0.5 text-sm font-medium text-warm-brown tabular-nums">{display.quantity}</p>
                          )}
                          {comment && (
                            <p className="mt-2 border-l-2 border-terracotta/20 pl-2 text-xs leading-relaxed text-warm-brown-light">
                              {comment}
                            </p>
                          )}
                          {activity.created_by && (
                            <p className="mt-2 text-[11px] text-warm-brown-light/45">Entered by {activity.created_by}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          aria-label="Delete activity"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteActivity(activity);
                          }}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-warm-brown-light/40 transition-colors hover:bg-red-50 hover:text-red-500"
                          title="Delete"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
            {!isActivityFiltered && activities.length > 6 && !showHistory && (
              <button
                onClick={() => setShowHistory(true)}
                className="w-full py-3 text-sm text-terracotta hover:text-terracotta-dark transition-colors"
              >
                View all {activities.length} activities
              </button>
            )}
          </div>
        </section>

        {/* Settings */}
        <section className="pt-4 border-t border-warm-brown-light/10 space-y-4">
          <h2 className="text-sm font-medium text-warm-brown-light">Settings</h2>

          <SettingsField
            label="Your name"
            value={userName || ""}
            onSave={async (name) => {
              const res = await fetch("/api/users", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.error || "Failed to save user name");
              setUserId(data.user?.id || userId, data.user?.name || name);
              router.refresh();
            }}
          />

          <SettingsField
            label="Baby name"
            value={baby?.name || ""}
            onSave={async (name) => {
              if (!baby?.id) return;
              await fetch("/api/babies", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: baby.id, name }),
              });
              setBaby({ ...baby, name });
            }}
          />

          {pushSupported && (
            <button
              onClick={togglePush}
              disabled={pushLoading}
              className={`w-full py-3 rounded-xl text-sm font-medium transition-colors ${
                pushEnabled
                  ? "bg-green-600 text-white"
                  : "bg-white border border-warm-brown-light/20 text-warm-brown"
              } disabled:opacity-50`}
            >
              {pushLoading
                ? "..."
                : pushEnabled
                ? "Notifications on"
                : "Enable notifications"}
            </button>
          )}
          <button
            onClick={handleLeave}
            className="w-full py-3 text-sm text-warm-brown-light/50 hover:text-red-500 transition-colors"
          >
            Leave household
          </button>
        </section>
      </div>

      {/* Floating Add Activity Menu */}
      <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
        {showActivityMenu && (
          <div className="w-[min(320px,calc(100vw-2.5rem))] rounded-2xl border border-warm-brown-light/10 bg-white p-2 shadow-xl">
            {activityActionTypes.map((type) => {
              const last = getLastActivity(type);
              const overdue = isOverdue(type);
              const isBreastfeeding = activeTimer?.type === "breastfeed";
              const isBreastfeed = type === "breastfeed";
              const label = type === "bottlefeed" ? "Bottlefeed" : type === "vomit" ? "Vomit" : type.charAt(0).toUpperCase() + type.slice(1);
              const meta = isBreastfeed && isBreastfeeding
                ? "Feeding..."
                : isBreastfeed && !activeTimer && breastfeedPromptShown
                ? "Tap again to start"
                : last
                ? timeSince(last.started_at)
                : "No entries yet";

              return (
                <button
                  key={type}
                  onClick={() => handleActivityAction(type)}
                  className={"flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors " + (overdue ? "bg-terracotta text-white" : "hover:bg-cream text-warm-brown")}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="text-xl">{activityIcons[type]}</span>
                    <span className="text-sm font-medium">{label}</span>
                  </span>
                  <span className={"shrink-0 text-xs tabular-nums " + (overdue ? "text-white/80" : "text-warm-brown-light/70")}>{meta}</span>
                </button>
              );
            })}
          </div>
        )}
        <button
          onClick={() => setShowActivityMenu((value) => !value)}
          aria-label="Add activity"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-terracotta text-3xl leading-none text-white shadow-lg transition-colors hover:bg-terracotta-dark"
        >
          {showActivityMenu ? "×" : "+"}
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteActivity && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-t-3xl bg-cream p-6 shadow-xl">
            <h2 className="font-display text-xl text-terracotta">Delete activity?</h2>
            <p className="mt-2 text-sm text-warm-brown-light">
              This will remove the selected log entry permanently.
            </p>
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setDeleteActivity(null)}
                disabled={isDeletingActivity}
                className="flex-1 rounded-xl border border-warm-brown-light/20 bg-white py-3 text-sm font-medium text-warm-brown"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeletingActivity}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {isDeletingActivity ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Modal */}
      {showLogModal && (
        <LogModal
          type={logType!}
          babyId={baby?.id!}
          userId={userId}
          activity={editingActivity}
          activities={activities}
          breastmilkLibraryMl={breastmilkLibraryMl}
          lastPumpedMl={lastPumpedMl}
          lastPumpedAt={lastPumpedAt}
          onClose={() => {
            setShowLogModal(false);
            setEditingActivity(null);
          }}
          onSuccess={() => {
            setShowLogModal(false);
            setEditingActivity(null);
            fetchData();
            setActivityFilterRefresh((value) => value + 1);
          }}
        />
      )}

      </main>
  );
}

function LogModal({
  type,
  babyId,
  userId,
  activity,
  activities,
  breastmilkLibraryMl,
  lastPumpedMl,
  lastPumpedAt,
  onClose,
  onSuccess,
}: {
  type: string;
  babyId: string;
  userId: string | null;
  activity?: Activity | null;
  activities: Activity[];
  breastmilkLibraryMl: number;
  lastPumpedMl: number;
  lastPumpedAt: number | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isEditing = !!activity;

  // Parse details - comes back from API as JSON string
  const detailsObj = (() => {
    if (!activity?.details) return {};
    if (typeof activity.details === "object") return activity.details as Record<string, unknown>;
    try { return JSON.parse(activity.details as string) as Record<string, unknown>; }
    catch { return {}; }
  })();

  const [when, setWhen] = useState(isEditing ? "custom" : "now");
  const pad2 = (value: number) => String(value).padStart(2, "0");
  const roundToMinuteStep = (minute: number) => Math.min(55, Math.round(minute / 5) * 5);
  const getSGTParts = (epochMs?: number): { date: string; h: number; m: number } => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(epochMs ?? Date.now()));
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";

    return {
      date: [part("year"), part("month"), part("day")].join("-"),
      h: Number(part("hour")),
      m: roundToMinuteStep(Number(part("minute"))),
    };
  };
  const initialSGT = getSGTParts(isEditing && activity ? activity.started_at : undefined);
  type BottleFeedLine = { milkType: "breastmilk" | "formula"; amount: string };
  const existingBreastmilkAmount = isEditing && type === "bottlefeed"
    ? bottleBreastmilkLibraryDeduction(detailsObj)
    : 0;
  const availableBreastmilkMl = Math.max(0, Math.floor(breastmilkLibraryMl + existingBreastmilkAmount));
  const suggestedBottleAmount = !isEditing && type === "bottlefeed" && availableBreastmilkMl > 0
    ? String(availableBreastmilkMl)
    : "";
  const normalizeBottleMilkType = (value: unknown): BottleFeedLine["milkType"] => value === "formula" ? "formula" : "breastmilk";
  const numberString = (value: unknown): string => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? String(amount) : "";
  };
  const buildBottleFeeds = (): BottleFeedLine[] => {
    if (Array.isArray(detailsObj.feeds)) {
      const feeds = detailsObj.feeds
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({
          milkType: normalizeBottleMilkType(item.milkType),
          amount: typeof item.amountExpression === "string" ? item.amountExpression : numberString(item.amount),
        }));
      if (feeds.length > 0) return feeds;
    }

    const breastmilkAmount = numberString(detailsObj.breastmilkAmount);
    const formulaAmount = numberString(detailsObj.formulaAmount);
    if (isEditing && (breastmilkAmount || formulaAmount)) {
      const feeds: BottleFeedLine[] = [];
      if (breastmilkAmount) feeds.push({ milkType: "breastmilk", amount: breastmilkAmount });
      if (formulaAmount) feeds.push({ milkType: "formula", amount: formulaAmount });
      if (feeds.length > 0) return feeds;
    }

    if (isEditing) {
      return [{
        milkType: normalizeBottleMilkType(detailsObj.milkType),
        amount: typeof detailsObj.amountExpression === "string" ? detailsObj.amountExpression : numberString(detailsObj.amount),
      }];
    }

    return [{ milkType: "breastmilk", amount: suggestedBottleAmount }];
  };
  const [amount, setAmount] = useState(() => {
    if (!isEditing || type !== "pump") return "";
    if (typeof detailsObj.amountExpression === "string") return detailsObj.amountExpression;
    return detailsObj.amount != null ? String(detailsObj.amount) : "";
  });
  const [bottleFeeds, setBottleFeeds] = useState<BottleFeedLine[]>(buildBottleFeeds);
  const [side, setSide] = useState(
    isEditing && detailsObj.side ? String(detailsObj.side) : type === "pump" ? "both" : "L"
  );
  const [vomitType, setVomitType] = useState(
    isEditing && detailsObj.vomitType ? String(detailsObj.vomitType) : "projectile"
  );
  const [diaperKind, setDiaperKind] = useState(
    isEditing && detailsObj.kind ? String(detailsObj.kind) : "wet"
  );
  const [diaperPoop, setDiaperPoop] = useState(
    () => {
      if (!isEditing) return "no";
      const v = detailsObj.poop;
      return v === "M" || v === "L" ? String(v) : "no";
    }
  );
  const [diaperPeeUnits, setDiaperPeeUnits] = useState(
    () => {
      if (!isEditing) return "3";
      const v = detailsObj.peeUnits ?? detailsObj.peeSize;
      if (typeof v === "number" && v >= 1 && v <= 5) return String(v);
      if (typeof v === "string" && /^[1-5]$/.test(v)) return v;
      if (v === "M") return "3";
      if (v === "L") return "5";
      return "3";
    }
  );
  const [notes, setNotes] = useState(() => {
    if (typeof detailsObj.notes === "string") return detailsObj.notes;
    if (typeof detailsObj.note === "string") return detailsObj.note;
    return "";
  });
  const [isLoading, setIsLoading] = useState(false);

  // Custom time picker state (hour/minute as numbers, 24h)
  const [customHour, setCustomHour] = useState(initialSGT.h);
  const [customMinute, setCustomMinute] = useState(initialSGT.m);
  const [customDate, setCustomDate] = useState(initialSGT.date);
  const hourOptions = Array.from({ length: 24 }, (_, hour) => hour);
  const minuteOptions = Array.from({ length: 12 }, (_, index) => index * 5);
  const amountPresets = [30, 60, 90, 120, 150, 180];
  const suggestedPreset = Number(suggestedBottleAmount);
  const bottleAmountOptions = suggestedPreset > 0
    ? [suggestedPreset, ...amountPresets.filter((ml) => ml !== suggestedPreset)]
    : amountPresets;
  const normalizeMlExpression = (value: string): string =>
    parseMlCalculation(value)?.normalized ?? value.trim().replace(/\s+/g, "").replace(/ml$/i, "");
  const evaluateMlExpression = (value: string): number | null => parseMlCalculation(value)?.effectiveMl ?? null;
  const hasMlCalculation = (value: string): boolean => parseMlCalculation(value)?.hasCalculation ?? false;
  const breastmilkLibraryDeductionForFeeds = (feeds: BottleFeedLine[]) => feeds.reduce((total, feed) => {
    if (feed.milkType !== "breastmilk") return total;
    return total + (parseMlCalculation(feed.amount)?.libraryDeductionMl ?? 0);
  }, 0);
  const setBottleFeedMilkType = (index: number, milkType: BottleFeedLine["milkType"]) => {
    setBottleFeeds((feeds) => feeds.map((feed, i) => i === index ? { ...feed, milkType } : feed));
  };
  const setBottleFeedAmount = (index: number, value: string) => {
    const cleaned = value.replace(/[^\d.+\-\s]/g, "");
    setBottleFeeds((feeds) => feeds.map((feed, i) => i === index ? { ...feed, amount: cleaned } : feed));
  };
  const addBottleFeedSupplement = () => {
    setBottleFeeds((feeds) => [...feeds, { milkType: "formula", amount: "" }]);
  };
  const removeBottleFeed = (index: number) => {
    setBottleFeeds((feeds) => feeds.filter((_, i) => i !== index));
  };
  const bottleBreastmilkLibraryDeductionMl = breastmilkLibraryDeductionForFeeds(bottleFeeds);
  const bottlefeedHasInvalidAmount = type === "bottlefeed" && bottleFeeds.some((feed) =>
    feed.amount.trim() !== "" && evaluateMlExpression(feed.amount) == null
  );
  const bottlefeedBreastmilkOverLimit = type === "bottlefeed" && bottleBreastmilkLibraryDeductionMl > availableBreastmilkMl;
  const pumpEffectiveAmount = type === "pump" ? evaluateMlExpression(amount) : null;
  const pumpHasInvalidAmount = type === "pump" && amount.trim() !== "" && pumpEffectiveAmount == null;
  const pumpAgeLabel = (timestamp: number | null) => {
    if (!timestamp) return "";
    const hours = Math.max(0, (Date.now() - timestamp) / (60 * 60 * 1000));
    if (hours < 1) return "<1h ago";
    const roundedHours = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
    return roundedHours + "h ago";
  };
  const lastPumpHint = !isEditing && type === "pump" && lastPumpedMl > 0
    ? "Last pump: " + Math.round(lastPumpedMl) + " ml" + (lastPumpedAt ? " · " + pumpAgeLabel(lastPumpedAt) : "")
    : "Enter amount in ml";

  const handleSubmit = async () => {
    if (bottlefeedHasInvalidAmount || pumpHasInvalidAmount) {
      alert("Enter a valid amount, such as 90 or 90-50.");
      return;
    }
    if (bottlefeedBreastmilkOverLimit) {
      alert("Breastmilk amount exceeds the available breastmilk library.");
      return;
    }
    setIsLoading(true);

    let startedAt = Date.now();
    if (when === "5m") startedAt -= 5 * 60 * 1000;
    else if (when === "15m") startedAt -= 15 * 60 * 1000;
    else if (when === "30m") startedAt -= 30 * 60 * 1000;
    else if (when === "1h") startedAt -= 60 * 60 * 1000;
    else if (when === "2h") startedAt -= 2 * 60 * 60 * 1000;
    else if (when === "custom" && customDate) {
      const parsed = Date.parse(customDate + "T" + pad2(customHour) + ":" + pad2(customMinute) + ":00+08:00");
      if (!Number.isFinite(parsed)) {
        setIsLoading(false);
        return;
      }
      startedAt = parsed;
    }

    const details: Record<string, unknown> = {};

    if (type === "bottlefeed") {
      const feeds = bottleFeeds.map((feed) => {
        const calculation = parseMlCalculation(feed.amount);
        return {
          milkType: feed.milkType,
          amount: calculation?.effectiveMl ?? null,
          ...(calculation?.hasCalculation ? { amountExpression: calculation.normalized } : {}),
          ...(calculation && calculation.wastedMl > 0 ? { wastedAmount: calculation.wastedMl } : {}),
          ...(feed.milkType === "breastmilk" && calculation
            ? { libraryDeductionAmount: calculation.libraryDeductionMl }
            : {}),
        };
      });
      const breastmilkAmount = feeds.reduce((total, feed) => {
        const amount = Number(feed.amount);
        return total + (feed.milkType === "breastmilk" && Number.isFinite(amount) && amount > 0 ? amount : 0);
      }, 0);
      const formulaAmount = feeds.reduce((total, feed) => {
        const amount = Number(feed.amount);
        return total + (feed.milkType === "formula" && Number.isFinite(amount) && amount > 0 ? amount : 0);
      }, 0);
      const totalAmount = breastmilkAmount + formulaAmount;
      details.feeds = feeds;
      details.amount = totalAmount > 0 ? totalAmount : null;
      details.milkType = breastmilkAmount > 0 && formulaAmount > 0 ? "mixed" : formulaAmount > 0 ? "formula" : "breastmilk";
      details.breastmilkAmount = breastmilkAmount;
      details.formulaAmount = formulaAmount;
    } else if (type === "breastfeed") {
      details.side = side;
    } else if (type === "pump") {
      details.amount = pumpEffectiveAmount;
      if (hasMlCalculation(amount)) details.amountExpression = normalizeMlExpression(amount);
      else details.amountExpression = null;
      details.side = side;
    } else if (type === "diaper") {
      details.poop = diaperPoop;
      details.peeUnits = diaperPeeUnits;
    } else if (type === "vomit") {
      details.vomitType = vomitType;
    }
    details.notes = notes.trim() || null;

    try {
      const res = await fetch("/api/activities", {
        method: isEditing && activity ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEditing && activity ? { id: activity.id } : { userId }),
          babyId,
          type,
          startedAt,
          details,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save activity");
      }

      onSuccess();
    } catch (error) {
      console.error("Log error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const whenOptions = [
    { label: "Now", value: "now" },
    { label: "5m ago", value: "5m" },
    { label: "15m ago", value: "15m" },
    { label: "30m ago", value: "30m" },
    { label: "1h ago", value: "1h" },
    { label: "2h ago", value: "2h" },
    { label: "Custom", value: "custom" },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
      <div className="bg-cream w-full max-w-lg rounded-t-3xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-xl text-terracotta capitalize">
            {isEditing ? "Edit" : "Log"} {type === "bottlefeed" ? "Bottlefeed" : type}
          </h2>
          <button onClick={onClose} className="text-warm-brown-light text-2xl">
            ×
          </button>
        </div>

        <div className="space-y-6">
          {/* When */}
          <div>
            <label className="block text-sm font-medium text-warm-brown-light mb-2">
              When
            </label>
            <div className="flex flex-wrap gap-2">
              {whenOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setWhen(opt.value)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    when === opt.value
                      ? "bg-terracotta text-white"
                      : "bg-white border border-warm-brown-light/20"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {when === "custom" && (
              <div className="mt-2 space-y-3">
                {/* Date */}
                <input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border-2 border-warm-brown-light/20 focus:border-terracotta outline-none"
                />
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-warm-brown-light mb-1 text-center">Hour</label>
                    <select
                      value={customHour}
                      onChange={(e) => setCustomHour(Number(e.target.value))}
                      className="w-full px-4 py-3 rounded-xl border-2 border-warm-brown-light/20 focus:border-terracotta outline-none text-center text-lg tabular-nums bg-white"
                    >
                      {hourOptions.map((hour) => (
                        <option key={hour} value={hour}>{pad2(hour)}</option>
                      ))}
                    </select>
                  </div>
                  <span className="text-2xl text-warm-brown-light pt-4">:</span>
                  <div className="flex-1">
                    <label className="block text-xs text-warm-brown-light mb-1 text-center">Min</label>
                    <select
                      value={customMinute}
                      onChange={(e) => setCustomMinute(Number(e.target.value))}
                      className="w-full px-4 py-3 rounded-xl border-2 border-warm-brown-light/20 focus:border-terracotta outline-none text-center text-lg tabular-nums bg-white"
                    >
                      {minuteOptions.map((minute) => (
                        <option key={minute} value={minute}>{pad2(minute)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {/* Preview in SGT */}
                {customDate && (
                  <p className="text-xs text-warm-brown-light/60 text-center">
                    {customDate} {pad2(customHour)}:{pad2(customMinute)} SGT
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Type-specific fields */}
          {type === "bottlefeed" && (
            <div className="space-y-4">
              {bottleFeeds.map((feed, index) => (
                <div key={index} className="rounded-2xl border border-warm-brown-light/10 bg-white/60 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <label className="text-sm font-medium text-warm-brown-light">
                      {index === 0 ? "Bottlefeed" : "Bottlefeed supplement"}
                    </label>
                    {bottleFeeds.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeBottleFeed(index)}
                        className="text-xs text-warm-brown-light/60 hover:text-red-500"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: "breastmilk", label: "Breast milk" },
                      { value: "formula", label: "Formula" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setBottleFeedMilkType(index, option.value as BottleFeedLine["milkType"])}
                        className={
                          "py-3 rounded-xl text-sm font-medium transition-colors " +
                          (feed.milkType === option.value
                            ? "bg-terracotta text-white"
                            : "bg-white border border-warm-brown-light/20")
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3">
                    <label className="block text-sm font-medium text-warm-brown-light mb-2">
                      Amount (ml)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {bottleAmountOptions.map((ml) => (
                        <button
                          key={ml}
                          type="button"
                          onClick={() => setBottleFeedAmount(index, String(ml))}
                          className={
                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors " +
                            (feed.amount === String(ml)
                              ? "bg-terracotta text-white"
                              : "bg-white border border-warm-brown-light/20")
                          }
                        >
                          {ml}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={feed.amount}
                      onChange={(e) => setBottleFeedAmount(index, e.target.value)}
                      placeholder={index === 0 && suggestedBottleAmount ? "Breastmilk library amount" : "Enter amount or calculation"}
                      className="mt-2 w-full px-4 py-3 rounded-xl border-2 border-warm-brown-light/20 focus:border-terracotta outline-none"
                    />
                    {hasMlCalculation(feed.amount) && evaluateMlExpression(feed.amount) != null && (
                      <p className="mt-1.5 text-xs font-medium text-terracotta">
                        Consumed: {evaluateMlExpression(feed.amount)} ml
                        {(parseMlCalculation(feed.amount)?.wastedMl ?? 0) > 0 && (
                          <> · {parseMlCalculation(feed.amount)?.wastedMl} ml wasted</>
                        )}
                      </p>
                    )}
                    {feed.amount.trim() !== "" && evaluateMlExpression(feed.amount) == null && (
                      <p className="mt-1.5 text-xs font-medium text-red-600">Use a valid amount, such as 90 or 90-50.</p>
                    )}
                  </div>
                </div>
              ))}

              <p className="text-xs text-warm-brown-light/60">
                Breastmilk library: {availableBreastmilkMl} ml available
              </p>
              {bottlefeedBreastmilkOverLimit && (
                <p className="text-xs font-medium text-red-600">
                  This feed removes more breastmilk than the library contains, including waste.
                </p>
              )}

              <button
                type="button"
                onClick={addBottleFeedSupplement}
                className="w-full rounded-xl border border-terracotta/20 bg-white px-4 py-3 text-sm font-semibold text-terracotta transition-colors hover:bg-terracotta/10"
              >
                + Add bottlefeed supplement
              </button>
            </div>
          )}

          {type === "pump" && (
            <>
              <div>
                <label className="block text-sm font-medium text-warm-brown-light mb-2">
                  Amount (ml)
                </label>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.+\-\s]/g, ""))}
                  placeholder={lastPumpHint}
                  className="w-full px-4 py-3 rounded-xl border-2 border-warm-brown-light/20 focus:border-terracotta outline-none"
                />
                {hasMlCalculation(amount) && pumpEffectiveAmount != null && (
                  <p className="mt-1.5 text-xs font-medium text-terracotta">Effective amount: {pumpEffectiveAmount} ml</p>
                )}
                {pumpHasInvalidAmount && (
                  <p className="mt-1.5 text-xs font-medium text-red-600">Use a valid amount, such as 90 or 90-50.</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-brown-light mb-2">
                  Side
                </label>
                <div className="flex gap-2">
                  {["L", "R", "both"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSide(s)}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium uppercase transition-colors ${
                        side === s
                          ? "bg-terracotta text-white"
                          : "bg-white border border-warm-brown-light/20"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {type === "diaper" && (
            <div className="space-y-4">
              {/* Poo */}
              <div>
                <label className="block text-sm font-medium text-warm-brown-light mb-2">
                  Poo
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDiaperPoop("no")}
                    className={`flex-[3] py-3 rounded-xl text-sm font-medium capitalize transition-colors ${
                      diaperPoop === "no"
                        ? "bg-terracotta text-white"
                        : "bg-white border border-warm-brown-light/20"
                    }`}
                  >
                    No
                  </button>
                  {["M", "L"].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setDiaperPoop(s);
                      }}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium capitalize transition-colors ${
                        diaperPoop === s
                          ? "bg-terracotta text-white"
                          : "bg-white border border-warm-brown-light/20"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pee */}
              <div>
                <label className="block text-sm font-medium text-warm-brown-light mb-2">
                  Pee units
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDiaperPeeUnits("no")}
                    className={`flex-[2] py-3 rounded-xl text-sm font-medium capitalize transition-colors ${
                      diaperPeeUnits === "no"
                        ? "bg-terracotta text-white"
                        : "bg-white border border-warm-brown-light/20"
                    }`}
                  >
                    No
                  </button>
                  {["1", "2", "3", "4", "5"].map((units) => (
                    <button
                      key={units}
                      onClick={() => setDiaperPeeUnits(units)}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium transition-colors ${
                        diaperPeeUnits === units
                          ? "bg-terracotta text-white"
                          : "bg-white border border-warm-brown-light/20"
                      }`}
                    >
                      {units}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {type === "breastfeed" && (
            <div>
              <label className="block text-sm font-medium text-warm-brown-light mb-2">
                Side
              </label>
              <div className="flex gap-2">
                {["L", "R"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setSide(s)}
                    className={`flex-1 py-3 rounded-xl text-sm font-medium uppercase transition-colors ${
                      side === s
                        ? "bg-terracotta text-white"
                        : "bg-white border border-warm-brown-light/20"
                    }`}
                  >
                    {s === "both" ? "Both" : s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {type === "vomit" && (
            <div>
              <label className="block text-sm font-medium text-warm-brown-light mb-2">
                Type
              </label>
              <div className="flex flex-col gap-2">
                {[
                  { value: "projectile", label: "Projectile" },
                  { value: "dribble-milk", label: "Dribble milk" },
                  { value: "dribble-beancurd", label: "Dribble beancurd" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setVomitType(opt.value)}
                    className={`py-3 rounded-xl text-sm font-medium transition-colors ${
                      vomitType === opt.value
                        ? "bg-terracotta text-white"
                        : "bg-white border border-warm-brown-light/20"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-warm-brown-light mb-2">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Add a note (optional)"
              className="w-full resize-none rounded-xl border-2 border-warm-brown-light/20 bg-white px-4 py-3 text-sm text-warm-brown outline-none transition-colors focus:border-terracotta"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={isLoading || bottlefeedBreastmilkOverLimit || bottlefeedHasInvalidAmount || pumpHasInvalidAmount}
            className="w-full py-4 bg-terracotta text-white font-medium rounded-2xl text-lg hover:bg-terracotta-dark transition-colors disabled:opacity-50"
          >
            {isLoading ? "Saving..." : isEditing ? "Save changes" : "Log activity"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-warm-brown-light/10">
        <div>
          <p className="text-xs text-warm-brown-light/60">{label}</p>
          <p className="text-sm text-warm-brown">{value || "—"}</p>
        </div>
        <button
          onClick={() => { setDraft(value); setEditing(true); }}
          className="text-xs text-terracotta hover:text-terracotta-dark transition-colors"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white p-4 rounded-xl border border-terracotta/30 space-y-2">
      <p className="text-xs text-warm-brown-light/60">{label}</p>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        className="w-full px-3 py-2 rounded-lg border-2 border-warm-brown-light/20 focus:border-terracotta outline-none text-sm"
      />
      <div className="flex gap-2">
        <button
          onClick={() => setEditing(false)}
          className="flex-1 py-2 rounded-lg text-sm text-warm-brown-light border border-warm-brown-light/20"
        >
          Cancel
        </button>
        <button
          onClick={async () => {
            if (!draft.trim()) return;
            setSaving(true);
            try {
              await onSave(draft.trim());
              setEditing(false);
            } catch (error) {
              console.error("Save setting error:", error);
              alert(error instanceof Error ? error.message : "Could not save. Please try again.");
            } finally {
              setSaving(false);
            }
          }}
          disabled={!draft.trim() || saving}
          className="flex-1 py-2 rounded-lg text-sm bg-terracotta text-white font-medium disabled:opacity-50"
        >
          {saving ? "..." : "Save"}
        </button>
      </div>
    </div>
  );
}
