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
  details: Record<string, unknown>;
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
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!householdId) return;

    try {
      const [babiesRes, activitiesRes, householdRes] = await Promise.all([
        fetch("/api/babies"),
        fetch("/api/activities?limit=50"),
        fetch("/api/household"),
      ]);

      const babiesData = await babiesRes.json();
      const activitiesData = await activitiesRes.json();
      const householdData = await householdRes.json();

      if (babiesData.babies?.length > 0) {
        setBaby(babiesData.babies[0]);
      }
      setActivities(activitiesData.activities || []);
      if (householdData.inviteCode) {
        setInviteCode(householdData.inviteCode);
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

  const formatActivityDetails = (activity: Activity): string => {
    const d = activity.details || {};
    switch (activity.type) {
      case "bottlefeed":
        return `${d.amount} ml ${d.milkType === "formula" ? "formula" : "breastmilk"}`;
      case "breastfeed":
        return d.side ? `${d.side} side` : "";
      case "pump":
        return `${d.amount} ml`;
      case "diaper":
        return d.kind as string;
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

            return (
              <button
                key={type}
                onClick={() => {
                  setLogType(type);
                  setShowLogModal(true);
                }}
                className={`p-4 rounded-2xl text-left transition-all ${
                  overdue
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
                {last ? (
                  <p className={`text-lg font-semibold ${overdue ? "text-white" : "text-warm-brown"}`}>
                    {timeSince(last.started_at)}
                  </p>
                ) : (
                  <p className={`text-sm ${overdue ? "text-white/80" : "text-warm-brown-light"}`}>
                    No entries yet
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
                  setLogType(activity.type);
                  // For edit, we'd need to set editingActivity state
                  // For now just show the existing UI as edit
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
          onClose={() => setShowLogModal(false)}
          onSuccess={() => {
            setShowLogModal(false);
            fetchData();
          }}
        />
      )}

      {/* Floating Action Button */}
      <button
        onClick={() => {
          setLogType("bottlefeed");
          setShowLogModal(true);
        }}
        className="fixed bottom-6 right-6 w-14 h-14 bg-terracotta text-white rounded-full shadow-lg text-2xl flex items-center justify-center hover:bg-terracotta-dark transition-colors"
      >
        +
      </button>
    </main>
  );
}

function LogModal({
  type,
  babyId,
  onClose,
  onSuccess,
}: {
  type: string;
  babyId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [when, setWhen] = useState("now");
  const [customTime, setCustomTime] = useState("");
  const [amount, setAmount] = useState("");
  const [milkType, setMilkType] = useState("formula");
  const [side, setSide] = useState("L");
  const [diaperKind, setDiaperKind] = useState("wet");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    setIsLoading(true);

    let startedAt = Date.now();
    if (when === "5m") startedAt -= 5 * 60 * 1000;
    else if (when === "15m") startedAt -= 15 * 60 * 1000;
    else if (when === "30m") startedAt -= 30 * 60 * 1000;
    else if (when === "1h") startedAt -= 60 * 60 * 1000;
    else if (when === "2h") startedAt -= 2 * 60 * 60 * 1000;
    else if (when === "custom" && customTime) {
      startedAt = new Date(customTime).getTime();
    }

    const details: Record<string, unknown> = {};

    if (type === "bottlefeed") {
      details.amount = parseInt(amount) || 0;
      details.milkType = milkType;
    } else if (type === "breastfeed") {
      details.side = side;
    } else if (type === "pump") {
      details.amount = parseInt(amount) || 0;
      details.side = side;
    } else if (type === "diaper") {
      details.kind = diaperKind;
    }

    // Get userId from cookie
    const userCookie = document.cookie.split(';').find(c => c.trim().startsWith('mcphee_user='));
    const userId = userCookie ? userCookie.split('=')[1] : null;

    try {
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
            Log {type === "bottlefeed" ? "Bottle" : type}
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
              <input
                type="datetime-local"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className="mt-2 w-full px-4 py-3 rounded-xl border-2 border-warm-brown-light/20 focus:border-terracotta outline-none"
              />
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
            <div>
              <label className="block text-sm font-medium text-warm-brown-light mb-2">
                Kind
              </label>
              <div className="flex gap-2">
                {["wet", "dirty", "both"].map((k) => (
                  <button
                    key={k}
                    onClick={() => setDiaperKind(k)}
                    className={`flex-1 py-3 rounded-xl text-sm font-medium capitalize transition-colors ${
                      diaperKind === k
                        ? "bg-terracotta text-white"
                        : "bg-white border border-warm-brown-light/20"
                    }`}
                  >
                    {k}
                  </button>
                ))}
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
            {isLoading ? "Saving..." : "Log activity"}
          </button>
        </div>
      </div>
    </div>
  );
}
