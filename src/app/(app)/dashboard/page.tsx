"use client";

import { useState, useEffect, useCallback } from "react";
import { useHousehold } from "@/lib/context/household-context";
import { useRouter } from "next/navigation";
import { formatAge, timeSince, median, formatTime, formatDate, formatWeight } from "@/lib/utils";

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
  const [logType, setLogType] = useState<string | null>(null);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
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
  const activityTypeOptions = [
    { value: "all", label: "All" },
    { value: "bottlefeed", label: "Bottle" },
    { value: "breastfeed", label: "Breastfeed" },
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

  const handleDelete = async (activityId: string) => {
    if (!confirm("Delete this activity?")) return;
    try {
      await fetch(`/api/activities?id=${activityId}`, { method: "DELETE" });
      fetchData();
      setActivityFilterRefresh((value) => value + 1);
    } catch (error) {
      console.error("Delete error:", error);
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

  const userColors = (() => {
    const palette = [
      { bg: "bg-terracotta/15", text: "text-terracotta", dot: "bg-terracotta" },
      { bg: "bg-blue-100", text: "text-blue-700", dot: "bg-blue-500" },
      { bg: "bg-emerald-100", text: "text-emerald-700", dot: "bg-emerald-500" },
      { bg: "bg-violet-100", text: "text-violet-700", dot: "bg-violet-500" },
    ];
    const names = [...new Set(activities.map((a) => a.created_by).filter(Boolean))] as string[];
    const map: Record<string, typeof palette[0]> = {};
    names.forEach((name, i) => {
      map[name] = palette[i % palette.length];
    });
    return map;
  })();

  const parseDetails = (activity: Activity): Record<string, unknown> => {
    if (!activity.details) return {};
    if (typeof activity.details === "object") return activity.details as Record<string, unknown>;
    try { return JSON.parse(activity.details as string) as Record<string, unknown>; }
    catch { return {}; }
  };

  const formatActivityDetails = (activity: Activity): string => {
    const d = parseDetails(activity);
    switch (activity.type) {
      case "bottlefeed": {
        const amt = d.amount != null && d.amount !== "" ? Number(d.amount) : null;
        return amt != null ? `${amt} ml ${d.milkType === "formula" ? "formula" : "breastmilk"}` : "—";
      }
      case "breastfeed":
        return d.side ? `${d.side} side` : "—";
      case "pump": {
        const amt = d.amount != null && d.amount !== "" ? Number(d.amount) : null;
        return amt != null ? `${amt} ml` : "—";
      }
      case "diaper": {
        const parts: string[] = [];
        if (d.poop === "M" || d.poop === "L") parts.push(`poop ${d.poop}`);
        if (d.peeSize === "M" || d.peeSize === "L") parts.push(`pee ${d.peeSize}`);
        return parts.length > 0 ? parts.join(", ") : "—";
      }
      case "vomit": {
        const labels: Record<string, string> = {
          projectile: "Projectile",
          "dribble-milk": "Dribble milk",
          "dribble-beancurd": "Dribble beancurd",
        };
        return labels[d.vomitType as string] || "—";
      }
      default:
        return "";
    }
  };

  const expectedDailyMilkMl: number | null = null;
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
    <main className="min-h-screen bg-cream pb-24">
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-warm-brown-light/50">
                Since 00:00 SGT
              </p>
              <h2 className="font-display text-lg text-terracotta mt-1">Today&apos;s milk</h2>
            </div>
            <span className="text-xs bg-cream text-warm-brown-light px-2 py-1 rounded-full">
              Bottle feeds
            </span>
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
                Breastmilk + formula
              </p>
            </div>
            <div className="bg-cream rounded-xl px-3 py-2 min-w-[118px] text-right">
              <p className="text-xs text-warm-brown-light/60">Expected</p>
              <p className="font-display text-lg text-warm-brown tabular-nums">
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

        {/* Activity Cards */}
        <div className="grid grid-cols-2 gap-3">
          {["bottlefeed", "breastfeed", "diaper", "vomit"].map((type) => {
            const last = getLastActivity(type);
            const overdue = isOverdue(type);
            const icons: Record<string, string> = {
              bottlefeed: "🍼",
              breastfeed: "🤱",
              pump: "🧴",
              diaper: "🧷",
              vomit: "🤮",
            };

            const isBreastfeeding = activeTimer?.type === "breastfeed";
            const isThisBreastfeed = type === "breastfeed";

            return (
              <button
                key={type}
                onClick={() => {
                  if (isThisBreastfeed && !activeTimer) {
                    if (!breastfeedPromptShown) {
                      setBreastfeedPromptShown(true);
                    } else {
                      // Start timer
                      setActiveTimer({ type: "breastfeed", started_at: Date.now(), current_side: "L" });
                      setTimerElapsed(0);
                      setBreastfeedPromptShown(false);
                      handleStartTimer("breastfeed", "L");
                    }
                  } else {
                    setLogType(type);
                    setShowLogModal(true);
                  }
                }}
                className={`p-4 rounded-2xl text-left transition-all ${
                  isThisBreastfeed && isBreastfeeding
                    ? "bg-terracotta text-white"
                    : overdue
                    ? "bg-terracotta text-white"
                    : "bg-white border border-warm-brown-light/10"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span>{icons[type]}</span>
                  <span className="text-sm font-medium capitalize">
                    {type === "bottlefeed" ? "Bottle" : type === "vomit" ? "Vomit" : type}
                  </span>
                </div>
                {isThisBreastfeed && isBreastfeeding ? (
                  <p className="text-sm font-semibold animate-pulse">
                    Feeding...
                  </p>
                ) : isThisBreastfeed && !activeTimer && breastfeedPromptShown ? (
                  <p className="text-sm font-semibold text-terracotta">
                    Tap again to start
                  </p>
                ) : last ? (
                  <p className={`text-lg font-semibold ${overdue ? "text-white" : "text-warm-brown"}`}>
                    {timeSince(last.started_at)}
                  </p>
                ) : (
                  <p className={`text-sm ${overdue ? "text-white/80" : "text-warm-brown-light"}`}>
                    {isThisBreastfeed ? "Tap to start" : "No entries yet"}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Recent Activity */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-warm-brown-light">Recent Activity</h2>
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
                    {isActivityFiltered ? "No activities match these filters." : "No activities yet. Tap a card above to log one!"}
                  </p>
                );
              }

              let lastDateKey = "";
              return visible.map((activity) => {
                const dateKey = new Date(activity.started_at).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
                const showHeader = dateKey !== lastDateKey;
                lastDateKey = dateKey;

                const dateLabel = dateKey === today ? "Today" : dateKey === yesterday ? "Yesterday" : formatDate(activity.started_at);
                const displayType = activity.type === "bottlefeed" ? "Bottle" : activity.type === "vomit" ? "Vomit" : activity.type.charAt(0).toUpperCase() + activity.type.slice(1);
                const details = formatActivityDetails(activity);
                const color = activity.created_by ? userColors[activity.created_by] : null;

                return (
                  <div key={activity.id}>
                    {showHeader && (
                      <p className="text-xs font-medium text-warm-brown-light/50 uppercase tracking-wide pt-3 pb-1 first:pt-0">
                        {dateLabel}
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
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xl shrink-0">
                            {{
                              bottlefeed: "🍼",
                              breastfeed: "🤱",
                              pump: "🧴",
                              diaper: "🧷",
                              vomit: "🤮",
                            }[activity.type]}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm text-warm-brown">
                              <span className="font-medium">{displayType}</span>
                              {details && details !== "—" && (
                                <span className="text-warm-brown-light"> {details}</span>
                              )}
                            </p>
                            <p className="text-xs text-warm-brown-light/60 mt-0.5">
                              {timeSince(activity.started_at)} at {formatTime(activity.started_at)}
                              {activity.created_by && (
                                <>
                                  {" · "}
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${color?.bg || "bg-warm-brown-light/10"} ${color?.text || "text-warm-brown-light/60"}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${color?.dot || "bg-warm-brown-light/40"}`} />
                                    {activity.created_by}
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(activity.id);
                          }}
                          className="text-warm-brown-light/40 hover:text-red-500 transition-colors text-xs shrink-0 ml-2"
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
              await fetch("/api/users", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
              });
              setUserId(userId, name);
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

      {/* Log Modal */}
      {showLogModal && (
        <LogModal
          type={logType!}
          babyId={baby?.id!}
          userId={userId}
          activity={editingActivity}
          activities={activities}
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
  onClose,
  onSuccess,
}: {
  type: string;
  babyId: string;
  userId: string | null;
  activity?: Activity | null;
  activities: Activity[];
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
  const [amount, setAmount] = useState(() => {
    if (isEditing && detailsObj.amount != null) return String(detailsObj.amount);
    if (type === "bottlefeed" && !isEditing) {
      const lastPump = activities.find((a) => {
        if (a.type !== "pump") return false;
        const d = typeof a.details === "object" ? a.details : (() => { try { return JSON.parse(a.details as string); } catch { return {}; } })();
        return d && (d as Record<string, unknown>).amount != null;
      });
      if (lastPump) {
        const d = typeof lastPump.details === "object" ? lastPump.details : (() => { try { return JSON.parse(lastPump.details as string); } catch { return {}; } })();
        const pumpAmt = (d as Record<string, unknown>)?.amount;
        if (pumpAmt != null) return String(pumpAmt);
      }
    }
    return "";
  });
  const [milkType, setMilkType] = useState(
    isEditing && detailsObj.milkType ? String(detailsObj.milkType) : "formula"
  );
  const [side, setSide] = useState(
    isEditing && detailsObj.side ? String(detailsObj.side) : "L"
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
  const [diaperPoopSize] = useState("M");
  const [diaperPeeSize, setDiaperPeeSize] = useState(
    () => {
      if (!isEditing) return "M";
      const v = detailsObj.peeSize;
      return v === "M" || v === "L" ? String(v) : "M";
    }
  );
  const [isLoading, setIsLoading] = useState(false);

  // Custom time picker state (hour/minute as numbers, 24h)
  const [customHour, setCustomHour] = useState(initialSGT.h);
  const [customMinute, setCustomMinute] = useState(initialSGT.m);
  const [customDate, setCustomDate] = useState(initialSGT.date);
  const hourOptions = Array.from({ length: 24 }, (_, hour) => hour);
  const minuteOptions = Array.from({ length: 12 }, (_, index) => index * 5);

  const handleSubmit = async () => {
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
      details.amount = amount ? parseInt(amount) : null;
      details.milkType = milkType;
    } else if (type === "breastfeed") {
      details.side = side;
    } else if (type === "pump") {
      details.amount = amount ? parseInt(amount) : null;
      details.side = side;
    } else if (type === "diaper") {
      details.poop = diaperPoop;
      details.peeSize = diaperPeeSize;
    } else if (type === "vomit") {
      details.vomitType = vomitType;
    }

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
            {isEditing ? "Edit" : "Log"} {type === "bottlefeed" ? "Bottle" : type}
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
            <>
              <div>
                <label className="block text-sm font-medium text-warm-brown-light mb-2">
                  Milk type
                </label>
                <div className="flex gap-2">
                  {["formula", "breastmilk"].map((t) => (
                    <button
                      key={t}
                      onClick={() => setMilkType(t)}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium capitalize transition-colors ${
                        milkType === t
                          ? "bg-terracotta text-white"
                          : "bg-white border border-warm-brown-light/20"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-warm-brown-light mb-2">
                  Amount (ml)
                </label>
                <div className="flex flex-wrap gap-2">
                  {[30, 60, 90, 120, 150, 180].map((ml) => (
                    <button
                      key={ml}
                      onClick={() => setAmount(String(ml))}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        amount === String(ml)
                          ? "bg-terracotta text-white"
                          : "bg-white border border-warm-brown-light/20"
                      }`}
                    >
                      {ml}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Or enter custom amount"
                  className="mt-2 w-full px-4 py-3 rounded-xl border-2 border-warm-brown-light/20 focus:border-terracotta outline-none"
                />
              </div>
            </>
          )}

          {type === "pump" && (
            <>
              <div>
                <label className="block text-sm font-medium text-warm-brown-light mb-2">
                  Amount (ml)
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter amount in ml"
                  className="w-full px-4 py-3 rounded-xl border-2 border-warm-brown-light/20 focus:border-terracotta outline-none"
                />
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
                  Pee
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setDiaperPeeSize("no");
                    }}
                    className={`flex-[3] py-3 rounded-xl text-sm font-medium capitalize transition-colors ${
                      diaperPeeSize === "no"
                        ? "bg-terracotta text-white"
                        : "bg-white border border-warm-brown-light/20"
                    }`}
                  >
                    No
                  </button>
                  {["M", "L"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setDiaperPeeSize(s)}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium capitalize transition-colors ${
                        diaperPeeSize === s
                          ? "bg-terracotta text-white"
                          : "bg-white border border-warm-brown-light/20"
                      }`}
                    >
                      {s}
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
                    {s}
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

          <button
            onClick={handleSubmit}
            disabled={isLoading}
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
            await onSave(draft.trim());
            setSaving(false);
            setEditing(false);
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
