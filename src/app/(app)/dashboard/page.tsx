"use client";

import { useState, useEffect, useCallback } from "react";
import { useHousehold } from "@/lib/context/household-context";
import { useRouter } from "next/navigation";
import { formatAge, timeSince, median, formatTime } from "@/lib/utils";

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
  const { householdId, userId, userName, setHouseholdId } = useHousehold();
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

  const fetchData = useCallback(async () => {
    if (!householdId) return;

    try {
      const [babiesRes, activitiesRes, householdRes, timersRes] = await Promise.all([
        fetch("/api/babies"),
        fetch("/api/activities?limit=50"),
        fetch("/api/household"),
        fetch("/api/active-timers"),
      ]);

      const babiesData = await babiesRes.json();
      const activitiesData = await activitiesRes.json();
      const householdData = await householdRes.json();
      const timersData = await timersRes.json();

      if (babiesData.babies?.length > 0) {
        setBaby(babiesData.babies[0]);
      }
      setActivities(activitiesData.activities || []);
      if (householdData.inviteCode) {
        setInviteCode(householdData.inviteCode);
      }
      if (timersData.timers?.length > 0) {
        setActiveTimer(timersData.timers[0]);
        setTimerElapsed(Date.now() - Number(timersData.timers[0].started_at));
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
    } catch (error) {
      console.error("Delete error:", error);
    }
  };

  const handleStartTimer = async (type: string, side?: string) => {
    if (!baby?.id) return;
    try {
      const userCookie = document.cookie.split(';').find(c => c.trim().startsWith('mcphee_user='));
      const userId = userCookie ? userCookie.split('=')[1] : null;
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
      default:
        return "";
    }
  };

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
            {baby?.birth_date && (
              <p className="text-sm text-warm-brown-light">
                {formatAge(baby.birth_date)}
              </p>
            )}
            {userName && (
              <p className="text-xs text-warm-brown-light/70 mt-1">
                Logged by {userName}
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
          {["bottlefeed", "breastfeed", "pump", "diaper"].map((type) => {
            const last = getLastActivity(type);
            const overdue = isOverdue(type);
            const icons: Record<string, string> = {
              bottlefeed: "🍼",
              breastfeed: "🤱",
              pump: "🧴",
              diaper: "🧷",
            };

            const isBreastfeeding = activeTimer?.type === "breastfeed";
            const isThisBreastfeed = type === "breastfeed";

            return (
              <button
                key={type}
                onClick={() => {
                  setLogType(type);
                  setShowLogModal(true);
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
                    {type === "bottlefeed" ? "Bottle" : type}
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
          <h2 className="text-sm font-medium text-warm-brown-light mb-3">
            Recent Activity
          </h2>
          <div className="space-y-2">
            {activities.slice(0, 6).map((activity) => (
              <div
                key={activity.id}
                onClick={() => {
                  setEditingActivity(activity);
                  setLogType(activity.type);
                  setShowLogModal(true);
                }}
                className="bg-white p-4 rounded-xl border border-warm-brown-light/10 flex items-center justify-between cursor-pointer hover:border-terracotta/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">
                    {{
                      bottlefeed: "🍼",
                      breastfeed: "🤱",
                      pump: "🧴",
                      diaper: "🧷",
                    }[activity.type]}
                  </span>
                  <div>
                    <p className="font-medium capitalize">
                      {activity.type === "bottlefeed" ? "Bottle" : activity.type}
                    </p>
                    <p className="text-sm text-warm-brown-light">
                      {formatActivityDetails(activity)}
                    </p>
                    {activity.created_by && (
                      <p className="text-xs text-warm-brown-light/60">
                        by {activity.created_by}
                      </p>
                    )}
                    <p className="text-xs text-warm-brown-light/50">
                      {formatTime(activity.started_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm text-warm-brown-light">
                    {timeSince(activity.started_at)}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(activity.id);
                    }}
                    className="text-warm-brown-light/40 hover:text-red-500 transition-colors text-xs"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
            {activities.length > 6 && !showHistory && (
              <button
                onClick={() => setShowHistory(true)}
                className="w-full py-3 text-sm text-terracotta hover:text-terracotta-dark transition-colors"
              >
                View all {activities.length} activities
              </button>
            )}
            {activities.length === 0 && (
              <p className="text-center text-warm-brown-light py-8">
                No activities yet. Tap a card above to log one!
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Log Modal */}
      {showLogModal && (
        <LogModal
          type={logType!}
          babyId={baby?.id!}
          activity={editingActivity}
          onClose={() => {
            setShowLogModal(false);
            setEditingActivity(null);
          }}
          onSuccess={() => {
            setShowLogModal(false);
            setEditingActivity(null);
            fetchData();
          }}
        />
      )}

      </main>
  );
}

function LogModal({
  type,
  babyId,
  activity,
  onClose,
  onSuccess,
}: {
  type: string;
  babyId: string;
  activity?: Activity | null;
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
  // Convert UTC epoch ms → SGT datetime-local value (YYYY-MM-DDTHH:mm)
  const toSGTLocal = (epochMs: number): string => {
    return new Date(epochMs)
      .toLocaleString("en-CA", {
        timeZone: "Asia/Singapore",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      .replace(", ", "T");
  };
  const [customTime, setCustomTime] = useState(
    isEditing ? toSGTLocal(activity.started_at) : ""
  );
  const [amount, setAmount] = useState(
    isEditing && detailsObj.amount != null ? String(detailsObj.amount) : ""
  );
  const [milkType, setMilkType] = useState(
    isEditing && detailsObj.milkType ? String(detailsObj.milkType) : "formula"
  );
  const [side, setSide] = useState(
    isEditing && detailsObj.side ? String(detailsObj.side) : "L"
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
  const [customHour, setCustomHour] = useState(() => {
    if (isEditing && activity) {
      return new Date(activity.started_at).getHours();
    }
    return getSGTNow().h;
  });
  const [customMinute, setCustomMinute] = useState(() => {
    if (isEditing && activity) {
      return Math.round(new Date(activity.started_at).getMinutes() / 5) * 5;
    }
    return getSGTNow().m;
  });
  const [customDate, setCustomDate] = useState(() => {
    if (isEditing && activity) {
      return new Date(activity.started_at).toLocaleDateString("en-CA", {
        timeZone: "Asia/Singapore",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    // Default to today in SGT
    return new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  });

  // Helper to get current SGT hour/minute for default
  const getSGTNow = (): { h: number; m: number } => {
    const now = new Date();
    const sg = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
    return { h: sg.getHours(), m: Math.round(sg.getMinutes() / 5) * 5 };
  };

  const handleSubmit = async () => {
    setIsLoading(true);

    let startedAt = Date.now();
    if (when === "5m") startedAt -= 5 * 60 * 1000;
    else if (when === "15m") startedAt -= 15 * 60 * 1000;
    else if (when === "30m") startedAt -= 30 * 60 * 1000;
    else if (when === "1h") startedAt -= 60 * 60 * 1000;
    else if (when === "2h") startedAt -= 2 * 60 * 60 * 1000;
    else if (when === "custom" && customDate) {
      // Build epoch from customDate + customHour + customMinute (SGT)
      const [year, month, day] = customDate.split("-").map(Number);
      startedAt = new Date(year, month - 1, day, customHour, customMinute, 0, 0).getTime();
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
      details.poop = diaperPoop; // "no", "M", or "L"
      details.peeSize = diaperPeeSize; // "M" or "L"
    }

    // Get userId from cookie
    const userCookie = document.cookie.split(';').find(c => c.trim().startsWith('mcphee_user='));
    const userId = userCookie ? userCookie.split('=')[1] : null;

    try {
      if (isEditing && activity) {
        await fetch("/api/activities", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: activity.id,
            type,
            startedAt,
            details,
          }),
        });
      } else {
        await fetch("/api/activities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            babyId,
            type,
            startedAt,
            details,
            userId,
          }),
        });
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
                {/* Time: hour + minute spinners (24h) */}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-warm-brown-light mb-1 text-center">Hour</label>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={customHour}
                      onChange={(e) => setCustomHour(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                      className="w-full px-4 py-3 rounded-xl border-2 border-warm-brown-light/20 focus:border-terracotta outline-none text-center text-lg tabular-nums"
                    />
                  </div>
                  <span className="text-2xl text-warm-brown-light pt-4">:</span>
                  <div className="flex-1">
                    <label className="block text-xs text-warm-brown-light mb-1 text-center">Min</label>
                    <input
                      type="number"
                      min={0}
                      max={55}
                      step={5}
                      value={customMinute}
                      onChange={(e) => setCustomMinute(Math.max(0, Math.min(55, parseInt(e.target.value) || 0)))}
                      className="w-full px-4 py-3 rounded-xl border-2 border-warm-brown-light/20 focus:border-terracotta outline-none text-center text-lg tabular-nums"
                    />
                  </div>
                </div>
                {/* Preview in SGT */}
                {customDate && (
                  <p className="text-xs text-warm-brown-light/60 text-center">
                    {new Date(
                      parseInt(customDate.split("-")[0]),
                      parseInt(customDate.split("-")[1]) - 1,
                      parseInt(customDate.split("-")[2]),
                      customHour,
                      customMinute
                    ).toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false, hour: "2-digit", minute: "2-digit" })} SGT
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
