"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useHousehold } from "@/lib/context/household-context";
import { Baby as BabyIcon, BarChart3, Bell, BellOff, ChevronDown, ChevronLeft, ChevronRight, Download, Droplet, Heart, LogOut, Milk, Pencil, Plus, Scale, Trash2, TriangleAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatAge, timeSince, median, formatTime, formatDate, formatWeight } from "@/lib/utils";
import { bottleBreastmilkLibraryDeduction, parseMlCalculation } from "@/lib/milk-calculation";
import { MilkAsOfHistoryChart, MilkHistoryChart } from "@/components/MilkHistoryChart";

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

interface MilkDaySummary {
  date: string;
  totalMl: number;
  breastmilkMl: number;
  formulaMl: number;
  expectedMl: number | null;
  asOfNowMl: number;
}

interface PumpedMilkBatch {
  id: string;
  pumpedAt: number;
  amountMl: number;
  remainingMl: number;
  expiresAt: number;
  isExpired: boolean;
  isAdjustment?: boolean;
}

const sgtHourFormatter = new Intl.DateTimeFormat("en-SG", {
  hour: "2-digit",
  timeZone: "Asia/Singapore",
  hourCycle: "h23",
});

// The milk charts show a recent window, not the full history (which now spans
// months); the day-by-day navigation still uses the complete milkHistory.
const MILK_CHART_WINDOW_DAYS = 30;

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function LiveTimerStatus({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt));

  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Date.now() - startedAt));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        <Heart aria-hidden="true" className="h-7 w-7 text-accent-strong" />
        <div>
          <p className="text-sm text-muted">Live feeding</p>
          <p className="font-display text-3xl text-accent-strong font-semibold tabular-nums">
            {formatElapsed(elapsed)}
          </p>
        </div>
      </div>
      {elapsed > 2 * 60 * 60 * 1000 && (
        <span className="text-xs bg-surface-muted text-warning px-2 py-1 rounded-lg">Safety check</span>
      )}
    </div>
  );
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
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTimer, setActiveTimer] = useState<Record<string, unknown> | null>(null);
  const [breastfeedPromptShown, setBreastfeedPromptShown] = useState(false);
  const [isStartingTimer, setIsStartingTimer] = useState(false);
  const [isStoppingTimer, setIsStoppingTimer] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [dailyMilkMl, setDailyMilkMl] = useState(0);
  const [dailyBreastmilkMl, setDailyBreastmilkMl] = useState(0);
  const [dailyFormulaMl, setDailyFormulaMl] = useState(0);
  const [breastmilkLibraryMl, setBreastmilkLibraryMl] = useState(0);
  const [breastmilkBatches, setBreastmilkBatches] = useState<PumpedMilkBatch[]>([]);
  const [lastPumpedMl, setLastPumpedMl] = useState(0);
  const [lastPumpedAt, setLastPumpedAt] = useState<number | null>(null);
  const [expectedDailyMilkMl, setExpectedDailyMilkMl] = useState<number | null>(null);
  const [milkHistory, setMilkHistory] = useState<MilkDaySummary[]>([]);
  const [milkHistoryCutoffAt, setMilkHistoryCutoffAt] = useState<number | null>(null);
  const [asOfDayOffset, setAsOfDayOffset] = useState(-1);
  const milkHistoryRequestRef = useRef(0);
  const dashboardRequestRef = useRef<AbortController | null>(null);
  const dashboardSnapshotRef = useRef("");
  const [selectedMilkDate, setSelectedMilkDate] = useState("");
  const [showMilkHistoryChart, setShowMilkHistoryChart] = useState(false);
  const [isMilkHistoryLoading, setIsMilkHistoryLoading] = useState(false);
  const [activityDateFilter, setActivityDateFilter] = useState("");
  const [activityTypeFilters, setActivityTypeFilters] = useState<string[]>([]);
  const [filteredActivities, setFilteredActivities] = useState<Activity[]>([]);
  const [isActivityFilterLoading, setIsActivityFilterLoading] = useState(false);
  const [activityFilterRefresh, setActivityFilterRefresh] = useState(0);
  const [showReconcileBank, setShowReconcileBank] = useState(false);
  const [reconcileBankMl, setReconcileBankMl] = useState("");
  const [isReconcilingBank, setIsReconcilingBank] = useState(false);

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
  useEffect(() => {
    setSelectedMilkDate((current) => current || todayDateKey);
  }, [todayDateKey]);
  const isActivityFiltered = Boolean(activityDateFilter || activityTypeFilters.length > 0);
  const activityActionTypes = ["bottlefeed", "breastfeed", "pump", "diaper", "vomit"];
  const activityIcons: Record<string, LucideIcon> = {
    bottlefeed: Milk,
    breastfeed: Heart,
    pump: Droplet,
    diaper: BabyIcon,
    vomit: TriangleAlert,
    bankadjust: Scale,
  };

  const activityTypeOptions = [
    { value: "bottlefeed", label: "Bottlefeed" },
    { value: "breastfeed", label: "Breastfeed" },
    { value: "pump", label: "Pump" },
    { value: "diaper", label: "Diaper" },
    { value: "vomit", label: "Vomit" },
  ];

  const selectedActivityTypeLabels = activityTypeOptions
    .filter((option) => activityTypeFilters.includes(option.value))
    .map((option) => option.label);
  const activityTypeFilterLabel = selectedActivityTypeLabels.length === 0
    ? "All activity types"
    : selectedActivityTypeLabels.length <= 2
      ? selectedActivityTypeLabels.join(", ")
      : `${selectedActivityTypeLabels[0]} + ${selectedActivityTypeLabels.length - 1} more`;
  const toggleActivityTypeFilter = (value: string) => {
    setActivityTypeFilters((current) => {
      const selected = new Set(current);
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      return activityTypeOptions.map((option) => option.value).filter((type) => selected.has(type));
    });
  };

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

  const fetchMilkHistory = useCallback(async (babyId: string, showLoading = true) => {
    if (!householdId || !babyId) return;
    const requestId = ++milkHistoryRequestRef.current;
    if (showLoading) setIsMilkHistoryLoading(true);
    try {
      const res = await fetch(`/api/milk-history?babyId=${encodeURIComponent(babyId)}&asOf=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load milk history");
      const data = await res.json();
      if (requestId !== milkHistoryRequestRef.current) return;
      setMilkHistory(Array.isArray(data.days) ? data.days : []);
      const cutoffAt = Number(data.asOfTimestamp);
      setMilkHistoryCutoffAt(Number.isFinite(cutoffAt) ? cutoffAt : null);
    } catch (error) {
      console.error("Milk history error:", error);
    } finally {
      if (showLoading) setIsMilkHistoryLoading(false);
    }
  }, [householdId]);

  const fetchData = useCallback(async () => {
    if (!householdId) return;

    dashboardRequestRef.current?.abort();
    const controller = new AbortController();
    dashboardRequestRef.current = controller;

    try {
      const res = await fetch("/api/dashboard", { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error("Failed to load dashboard");

      const data = await res.json();
      const snapshot = JSON.stringify(data);
      if (snapshot === dashboardSnapshotRef.current) return;
      dashboardSnapshotRef.current = snapshot;

      if (data.babies?.length > 0) {
        setBaby(data.babies[0]);
        fetchMilkHistory(String(data.babies[0].id), false);
      }
      setActivities(data.activities || []);
      if (data.household?.inviteCode) {
        setInviteCode(data.household.inviteCode);
      }
      if (data.measurement?.weight_g != null) {
        setLatestWeight(Number(data.measurement.weight_g));
      }
      setDailyMilkMl(Number(data.dailyMilk?.totalMl ?? 0));
      setDailyBreastmilkMl(Number(data.dailyMilk?.breastmilkMl ?? 0));
      setDailyFormulaMl(Number(data.dailyMilk?.formulaMl ?? 0));
      setBreastmilkLibraryMl(Number(data.pumpedMilk?.walletMl ?? 0));
      setBreastmilkBatches(Array.isArray(data.pumpedMilk?.batches) ? data.pumpedMilk.batches : []);
      setLastPumpedMl(Number(data.pumpedMilk?.lastPumpMl ?? 0));
      const lastPumpAt = Number(data.pumpedMilk?.lastPumpAt);
      setLastPumpedAt(Number.isFinite(lastPumpAt) && lastPumpAt > 0 ? lastPumpAt : null);
      const expectedMilk = Number(data.dailyMilk?.expectedMl);
      setExpectedDailyMilkMl(Number.isFinite(expectedMilk) ? expectedMilk : null);
      if (data.timers?.length > 0) {
        setActiveTimer(data.timers[0]);
      } else {
        setActiveTimer(null);
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") console.error("Fetch error:", error);
    } finally {
      if (dashboardRequestRef.current === controller) {
        dashboardRequestRef.current = null;
        setIsLoading(false);
      }
    }
  }, [householdId, fetchMilkHistory]);

  useEffect(() => {
    if (!householdId) {
      router.push("/");
      return;
    }
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") fetchData();
    };
    fetchData();

    const interval = window.setInterval(refreshIfVisible, 30_000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      dashboardRequestRef.current?.abort();
    };
  }, [householdId, router, fetchData]);

  useEffect(() => {
    if (!baby?.id) return;
    const refreshMilkHistory = () => {
      if (document.visibilityState === "visible") fetchMilkHistory(baby.id, false);
    };
    fetchMilkHistory(baby.id);
    document.addEventListener("visibilitychange", refreshMilkHistory);
    return () => {
      document.removeEventListener("visibilitychange", refreshMilkHistory);
    };
  }, [baby?.id, fetchMilkHistory, activityFilterRefresh]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowMilkHistoryChart(false);
      setShowLeaveConfirm(false);
      setDeleteActivity(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  useEffect(() => {
    if (!householdId || !baby?.id) return;

    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "500", babyId: baby.id });
    if (activityDateFilter) {
      params.set("date", activityDateFilter);
    } else if (!showHistory) {
      params.set("date", todayDateKey);
    }
    activityTypeFilters.forEach((type) => params.append("type", type));

    setIsActivityFilterLoading(true);
    fetch("/api/activities?" + params.toString(), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load activities");
        return res.json();
      })
      .then((data) => setFilteredActivities(data.activities || []))
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          console.error("Activity list error:", error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsActivityFilterLoading(false);
      });

    return () => controller.abort();
  }, [householdId, baby?.id, activityDateFilter, activityTypeFilters, showHistory, todayDateKey, activityFilterRefresh]);

  const handleLeave = async () => {
    setIsLeaving(true);
    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave" }),
      });
      if (!res.ok) throw new Error("Failed to leave household");
      setShowLeaveConfirm(false);
      setHouseholdId(null);
      router.push("/");
    } catch (error) {
      console.error("Leave error:", error);
    } finally {
      setIsLeaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteActivity) return;
    setIsDeletingActivity(true);
    try {
      const res = await fetch(`/api/activities?id=${encodeURIComponent(deleteActivity.id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete activity");
      setDeleteActivity(null);
      await fetchData();
      setActivityFilterRefresh((value) => value + 1);
    } catch (error) {
      console.error("Delete error:", error);
      alert(error instanceof Error ? error.message : "Could not delete activity. Try again.");
    } finally {
      setIsDeletingActivity(false);
    }
  };

  const handleStartTimer = async (type: string, side?: string) => {
    if (!baby?.id) return null;
    const requestedSide = side || "L";
    try {
      const res = await fetch("/api/active-timers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ babyId: baby.id, type, side: requestedSide }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) throw new Error(data.error || "Failed to start timer");
      return {
        id: String(data.id),
        type,
        started_at: Number(data.startedAt) || Date.now(),
        current_side: typeof data.side === "string" ? data.side : requestedSide,
      };
    } catch (error) {
      console.error("Start timer error:", error);
      return null;
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
    if (!activeTimer || !baby?.id || isStoppingTimer) return;
    setIsStoppingTimer(true);
    try {
      const params = new URLSearchParams({ babyId: baby.id });
      if (activeTimer.id != null) params.set("id", String(activeTimer.id));
      const res = await fetch(`/api/active-timers?${params.toString()}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to stop timer");
      setActiveTimer(null);
      await fetchData();
      setActivityFilterRefresh((value) => value + 1);
    } catch (error) {
      console.error("Stop timer error:", error);
      alert(error instanceof Error ? error.message : "Could not stop and log the timer. Try again.");
    } finally {
      setIsStoppingTimer(false);
    }
  };

  const handleReconcileBank = async (event: React.FormEvent) => {
    event.preventDefault();
    const targetBankMl = Number(reconcileBankMl);
    if (reconcileBankMl.trim() === "" || !Number.isFinite(targetBankMl) || targetBankMl < 0) {
      alert("Enter the actual amount of milk on hand, in ml.");
      return;
    }
    if (!baby?.id || isReconcilingBank) return;
    setIsReconcilingBank(true);
    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          babyId: baby.id,
          type: "bankadjust",
          startedAt: Date.now(),
          details: { targetBankMl },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to reconcile bank");
      setShowReconcileBank(false);
      setReconcileBankMl("");
      await fetchData();
      setActivityFilterRefresh((value) => value + 1);
    } catch (error) {
      console.error("Reconcile bank error:", error);
      alert(error instanceof Error ? error.message : "Could not reconcile the bank. Try again.");
    } finally {
      setIsReconcilingBank(false);
    }
  };

  const handleActivityAction = async (type: string) => {
    if (type === "breastfeed" && !activeTimer) {
      if (!breastfeedPromptShown) {
        setBreastfeedPromptShown(true);
        return;
      }
      if (isStartingTimer) return;

      setIsStartingTimer(true);
      setBreastfeedPromptShown(false);
      setShowActivityMenu(false);
      const timer = await handleStartTimer("breastfeed", "L");
      if (timer) {
        setActiveTimer(timer);
        // Refresh immediately: aborts any in-flight poll whose stale
        // timers:[] would otherwise hide the live-timer card for up to 30s.
        await fetchData();
      } else {
        setBreastfeedPromptShown(true);
        alert("Could not start the breastfeeding timer. Try again.");
      }
      setIsStartingTimer(false);
      return;
    }

    setLogType(type);
    setShowLogModal(true);
    setShowActivityMenu(false);
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
    if (type === "bankadjust") return "Bank adjustment";
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
          breastmilkAmount > 0 ? breastmilkAmount + " ml" : "",
          formulaAmount > 0 ? formulaAmount + " ml" : "",
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
      case "bankadjust": {
        const amount = Number(d.amount);
        const target = Number(d.targetBankMl);
        return {
          title: "Bank adjustment",
          subcategory: Number.isFinite(target) ? `Reconciled to ${target} ml` : "",
          quantity: Number.isFinite(amount) && amount !== 0 ? `${amount > 0 ? "+" : ""}${amount} ml` : "",
        };
      }
      default:
        return { title: activityTitle(activity.type), subcategory: "", quantity: "" };
    }
  };

  const getActivityDeleteDescription = (activity: Activity): string => {
    const display = getActivityDisplay(activity);
    const details = [display.title, display.subcategory, display.quantity].filter(Boolean).join(" · ");
    return `${details || "Activity"} logged at ${formatTime(activity.started_at)} on ${formatDate(activity.started_at)}`;
  };

  const formatHourMark = (timestamp: number): string => {
    const parts = sgtHourFormatter.formatToParts(new Date(timestamp));
    const hour = parts.find((item) => item.type === "hour")?.value ?? "00";
    return `${hour.padStart(2, "0")}:00 hrs`;
  };

  const shiftMilkDate = (date: string, offsetDays: number): string => {
    const timestamp = Date.parse(date + "T12:00:00+08:00") + offsetDays * 24 * 60 * 60 * 1000;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(timestamp));
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
    return [part("year"), part("month"), part("day")].join("-");
  };
  const selectMilkDate = (date: string) => {
    setSelectedMilkDate(date);
    setActivityDateFilter(date);
    setShowHistory(false);
  };
  const shiftActivityDate = (offsetDays: number) => {
    selectMilkDate(shiftMilkDate(activityDateFilter || todayDateKey, offsetDays));
  };
  const formatFilterDate = (date: string): string => {
    const [year, month, day] = date.split("-");
    return `${day}/${month}/${year}`;
  };

  const activeMilkDate = selectedMilkDate || todayDateKey;
  const isSelectedMilkToday = activeMilkDate === todayDateKey;
  const historicalMilkSummary = milkHistory.find((day) => day.date === activeMilkDate);
  const selectedMilkSummary: MilkDaySummary = isSelectedMilkToday
    ? { date: todayDateKey, totalMl: dailyMilkMl, breastmilkMl: dailyBreastmilkMl, formulaMl: dailyFormulaMl, expectedMl: expectedDailyMilkMl, asOfNowMl: dailyMilkMl }
    : historicalMilkSummary ?? { date: activeMilkDate, totalMl: 0, breastmilkMl: 0, formulaMl: 0, expectedMl: null, asOfNowMl: 0 };
  const selectedExpectedMilkMl = selectedMilkSummary.expectedMl;
  const milkProgress = selectedExpectedMilkMl
    ? Math.min(100, Math.round((selectedMilkSummary.totalMl / selectedExpectedMilkMl) * 100))
    : 0;
  const breastmilkPercent = selectedMilkSummary.totalMl > 0
    ? (selectedMilkSummary.breastmilkMl / selectedMilkSummary.totalMl * 100).toFixed(2)
    : "0.00";
  const formulaPercent = selectedMilkSummary.totalMl > 0
    ? (selectedMilkSummary.formulaMl / selectedMilkSummary.totalMl * 100).toFixed(2)
    : "0.00";
  const earliestMilkDate = milkHistory[0]?.date ?? todayDateKey;
  const canGoToPreviousMilkDay = activeMilkDate > earliestMilkDate;
  const canGoToNextMilkDay = activeMilkDate < todayDateKey;
  const effectiveActivityDate = activityDateFilter || todayDateKey;
  const canGoToPreviousActivityDay = effectiveActivityDate > earliestMilkDate;
  const canGoToNextActivityDay = effectiveActivityDate < todayDateKey;
  const selectedMilkDateLabel = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore", weekday: "short", day: "numeric", month: "short", year: "numeric",
  }).format(new Date(activeMilkDate + "T12:00:00+08:00"));
  const comparisonMilkDate = shiftMilkDate(todayDateKey, asOfDayOffset);
  const comparisonMilkSummary = milkHistory.find((day) => day.date === comparisonMilkDate);
  const milkHistoryCutoffLabel = milkHistoryCutoffAt == null ? "this time" : formatTime(milkHistoryCutoffAt);
  const comparisonMilkDateLabel = comparisonMilkDate === yesterdayDateKey
    ? "yesterday"
    : new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short" }).format(new Date(comparisonMilkDate + "T12:00:00+08:00"));
  const canGoToPreviousComparisonDay = comparisonMilkDate > earliestMilkDate;
  const canGoToNextComparisonDay = asOfDayOffset < -1;

  // Median of milk consumed "by this time" over the trailing 7 days ending at
  // the selected comparison day (default: yesterday). Days with no milk logged
  // are skipped so a missed logging day doesn't drag the typical value down.
  const medianWindowStart = shiftMilkDate(comparisonMilkDate, -6);
  const medianDataDays = milkHistory.filter(
    (day) => day.date >= medianWindowStart && day.date <= comparisonMilkDate && day.totalMl > 0
  );
  const asOfMedianMl = medianDataDays.length > 0
    ? median(medianDataDays.map((day) => day.asOfNowMl))
    : null;
  const medianDataDayCountLabel = medianDataDays.length > 0 && medianDataDays.length < 7
    ? ` (${medianDataDays.length} ${medianDataDays.length === 1 ? "day" : "days"})`
    : "";

  const chartMilkDays = [
    ...milkHistory.filter((day) => day.date !== todayDateKey),
    { date: todayDateKey, totalMl: dailyMilkMl, breastmilkMl: dailyBreastmilkMl, formulaMl: dailyFormulaMl, expectedMl: expectedDailyMilkMl, asOfNowMl: dailyMilkMl },
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(-MILK_CHART_WINDOW_DAYS);

  const asOfMilkDays = chartMilkDays.filter((day) => day.date <= todayDateKey);

  if (isLoading) {
    return (
      <main className="min-h-dvh bg-cream flex items-center justify-center">
        <p className="text-warm-brown-light">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-cream pb-24">
      <header className="bg-surface border-b border-border px-6 py-4">
        <div className="mx-auto max-w-lg">
          <div className="text-center">
            <div className="inline-flex max-w-full items-center justify-center gap-2">
              <Image
                src="/icon.svg"
                alt=""
                width={36}
                height={40}
                priority
                className="h-9 w-8 shrink-0 object-contain"
              />
              <h1 className="truncate font-display text-2xl text-accent-strong">
                {baby?.name || "Baby"}
              </h1>
            </div>
            {(baby?.birth_date || latestWeight) && (
              <p className="mt-1 text-center text-sm text-warm-brown-light">
                {baby?.birth_date ? formatAge(baby.birth_date) : ""}
                {baby?.birth_date && latestWeight ? " · " : ""}
                {latestWeight ? formatWeight(latestWeight) : ""}
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <Link
              href="/weight"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-terracotta/30 bg-terracotta/10 px-3 py-2 text-xs font-semibold text-accent-strong shadow-sm transition-colors hover:bg-terracotta/15"
            >
              <Scale aria-hidden="true" className="h-4 w-4" />
              Weight details
            </Link>
            <div className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2">
              <span className="whitespace-nowrap text-xs text-muted">Invite code</span>
              <span className="truncate font-mono text-sm font-semibold text-accent-strong">{inviteCode}</span>
            </div>
          </div>
          {userName && <p className="mt-2 text-center text-xs text-muted">You are {userName}</p>}
        </div>
      </header>

      <div className="max-w-lg mx-auto px-6 py-6 space-y-4">
        {/* Daily Milk Total */}
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-display text-lg text-accent-strong">
                {isSelectedMilkToday ? "Today’s milk consumption" : "Milk consumption"}
              </h2>
              <p className="mt-1 text-xs text-muted">{selectedMilkDateLabel}</p>
            </div>
            <div className="-mt-2 flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => {
                  setShowMilkHistoryChart(true);
                  if (baby?.id) fetchMilkHistory(baby.id);
                }}
                aria-label="View total milk consumption history"
                title="Consumption history"
                className="flex h-11 w-11 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted"
              >
                <BarChart3 aria-hidden="true" className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => selectMilkDate(shiftMilkDate(activeMilkDate, -1))}
                disabled={!canGoToPreviousMilkDay}
                aria-label="Show previous day milk summary"
                title="Previous day"
                className="flex h-11 w-11 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
              >
                <ChevronLeft aria-hidden="true" className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => selectMilkDate(shiftMilkDate(activeMilkDate, 1))}
                disabled={!canGoToNextMilkDay}
                aria-label="Show next day milk summary"
                title="Next day"
                className="flex h-11 w-11 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
              >
                <ChevronRight aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-end justify-between gap-4">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-semibold tabular-nums text-warm-brown">
                {selectedMilkSummary.totalMl}
              </span>
              <span className="text-base text-warm-brown-light">ml</span>
            </div>
            <div className="border-l border-border pl-4 text-right">
              <p className="text-xs text-muted">Expected</p>
              <p className="font-display text-base tabular-nums text-warm-brown">
                {selectedExpectedMilkMl ? selectedExpectedMilkMl + " ml" : "-- ml"}
              </p>
            </div>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-muted">
            {selectedMilkSummary.breastmilkMl}ml breastmilk ({breastmilkPercent}%) + {selectedMilkSummary.formulaMl}ml formula ({formulaPercent}%) consumed
          </p>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-cream">
            <div
              className="h-full rounded-full bg-terracotta transition-[width]"
              style={{ width: selectedExpectedMilkMl ? milkProgress + "%" : "0%" }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>Total for day</span>
            <span>{selectedExpectedMilkMl ? milkProgress + "%" : "Target pending"}</span>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="min-w-0 text-left text-xs text-muted">
              <span className="font-semibold tabular-nums text-warm-brown">{comparisonMilkSummary?.asOfNowMl ?? 0}ml</span>{" "}
              as of {milkHistoryCutoffLabel} {comparisonMilkDateLabel}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setAsOfDayOffset((value) => value - 1)}
                disabled={!canGoToPreviousComparisonDay}
                aria-label="Show same-time milk total for previous day"
                title="Previous comparison day"
                className="flex h-11 w-11 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setAsOfDayOffset((value) => Math.min(-1, value + 1))}
                disabled={!canGoToNextComparisonDay}
                aria-label="Show same-time milk total for next day"
                title="Next comparison day"
                className="flex h-11 w-11 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="min-w-0 text-left text-xs text-muted">
              <span className="font-semibold tabular-nums text-warm-brown">{asOfMedianMl == null ? "--" : asOfMedianMl}ml</span>{" "}
              median · same time, last 7 days{medianDataDayCountLabel}
            </p>
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-sm font-medium text-muted">Breastmilk bank</p>
              <div className="flex items-center gap-1">
                <p className="font-display text-lg tabular-nums text-warm-brown">{breastmilkLibraryMl} ml</p>
                <button
                  type="button"
                  onClick={() => {
                    setReconcileBankMl(String(breastmilkLibraryMl));
                    setShowReconcileBank((value) => !value);
                  }}
                  aria-label="Reconcile breastmilk bank"
                  title="Reconcile bank with the actual amount on hand"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted"
                >
                  <Scale aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
            {showReconcileBank && (
              <form onSubmit={handleReconcileBank} className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  autoFocus
                  value={reconcileBankMl}
                  onChange={(event) => setReconcileBankMl(event.target.value)}
                  placeholder="Actual ml on hand"
                  aria-label="Actual breastmilk on hand in ml"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm tabular-nums text-warm-brown focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40"
                />
                <button
                  type="submit"
                  disabled={isReconcilingBank}
                  className="shrink-0 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-dark disabled:opacity-50"
                >
                  {isReconcilingBank ? "Saving…" : "Set"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowReconcileBank(false)}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-muted"
                >
                  Cancel
                </button>
              </form>
            )}
            {breastmilkBatches.length > 0 && (
              <div className="mt-3 space-y-2">
                {breastmilkBatches.map((batch) => (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-cream px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium tabular-nums text-warm-brown">
                        {Math.round(batch.remainingMl * 100) / 100} ml
                      </p>
                      <p className="text-xs text-muted">
                        {batch.isAdjustment
                          ? `Bank adjustment · ${formatTime(batch.pumpedAt)}`
                          : `Pumped ${formatTime(batch.pumpedAt)} · expires ${formatTime(batch.expiresAt)}`}
                      </p>
                    </div>
                    {batch.isExpired && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/10 px-2 py-1 text-xs font-medium text-warning"
                        aria-label="Expired breastmilk batch"
                        title="Expired breastmilk batch"
                      >
                        <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
                        Expired
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>


        </section>
        {/* Live Timer */}
        {activeTimer && (
          <div className="bg-surface rounded-lg border border-terracotta/30 p-5 shadow-sm">
            <LiveTimerStatus startedAt={Number(activeTimer.started_at)} />
            <div className="flex gap-2 mb-4">
              {["L", "R"].map((s) => (
                <button
                  key={s}
                  onClick={() => handleSwitchSide(s)}
                  className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                    activeTimer.current_side === s
                      ? "bg-terracotta-dark text-white"
                      : "bg-cream border border-border"
                  }`}
                >
                  {s === "L" ? "Left" : "Right"} side
                </button>
              ))}
            </div>
            <button
              onClick={handleStopTimer}
              disabled={isStoppingTimer}
              className="min-h-11 w-full rounded-lg bg-success py-3 text-sm font-medium text-white transition-colors hover:bg-warm-brown disabled:opacity-60"
            >
              {isStoppingTimer ? "Stopping & logging…" : "Stop & log"}
            </button>
          </div>
        )}

        {/* Recent activity */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-warm-brown-light">Recent activity</h2>
            <div className="flex items-center gap-2">
              {baby?.id && (
                <a
                  href={`/api/activities/export?babyId=${encodeURIComponent(baby.id)}`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface min-h-11 whitespace-nowrap px-3 py-2 text-xs font-semibold text-accent-strong shadow-sm transition-colors hover:bg-terracotta/10"
                >
                  <Download aria-hidden="true" className="h-4 w-4" />
                  Export CSV
                </a>
              )}
              {isActivityFiltered && (
                <button
                  onClick={() => {
                    setActivityDateFilter("");
                    setActivityTypeFilters([]);
                    setShowHistory(false);
                    setSelectedMilkDate(todayDateKey);
                  }}
                  className="min-h-11 px-2 text-xs font-semibold text-accent-strong transition-colors hover:text-warm-brown"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="mb-3 space-y-3 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => shiftActivityDate(-1)}
                disabled={!canGoToPreviousActivityDay}
                aria-label="Show previous day activities"
                title="Previous day"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </button>
              <div className="relative min-w-0 flex-1">
                <div className="flex min-h-11 w-full items-center justify-center rounded-lg border border-border bg-cream px-3 py-2 text-xs font-medium tabular-nums text-warm-brown">
                  {showHistory && !activityDateFilter
                    ? "All days"
                    : formatFilterDate(effectiveActivityDate) + (effectiveActivityDate === todayDateKey ? " (today)" : "")}
                </div>
                <input
                  aria-label="Select activity date"
                  type="date"
                  value={effectiveActivityDate}
                  max={todayDateKey}
                  onChange={(e) => selectMilkDate(e.target.value || todayDateKey)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </div>
              <button
                type="button"
                onClick={() => shiftActivityDate(1)}
                disabled={!canGoToNextActivityDay}
                aria-label="Show next day activities"
                title="Next day"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                if (showHistory && !activityDateFilter) selectMilkDate(todayDateKey);
                else {
                  setActivityDateFilter("");
                  setShowHistory(true);
                  setSelectedMilkDate(todayDateKey);
                }
              }}
              className="mx-auto block min-h-8 px-3 text-[11px] text-muted underline decoration-border underline-offset-4 transition-colors hover:text-accent-strong"
            >
              {showHistory && !activityDateFilter ? "Back to today" : "All days"}
            </button>
            <details className="group relative">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-border bg-cream px-3 py-2 text-left transition-colors hover:border-terracotta/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/30 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-[10px] font-medium uppercase text-muted">Activity type</span>
                  <span className="block truncate text-sm font-medium text-warm-brown">{activityTypeFilterLabel}</span>
                </span>
                <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
              </summary>
              <fieldset className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                <legend className="sr-only">Filter by activity type</legend>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm font-medium text-warm-brown transition-colors hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={activityTypeFilters.length === 0}
                    onChange={() => setActivityTypeFilters([])}
                    className="h-4 w-4 accent-terracotta-dark"
                  />
                  All activity types
                </label>
                {activityTypeOptions.map((option) => (
                  <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm text-warm-brown transition-colors last:border-b-0 hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      checked={activityTypeFilters.includes(option.value)}
                      onChange={() => toggleActivityTypeFilter(option.value)}
                      className="h-4 w-4 accent-terracotta-dark"
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
            </details>
          </div>
          <div className="space-y-2">
            {(() => {
              const visible = filteredActivities;
              const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
              const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });

              if (isActivityFilterLoading) {
                return <p className="text-center text-warm-brown-light py-8">Loading activities…</p>;
              }
              if (visible.length === 0) {
                return (
                  <p className="text-center text-warm-brown-light py-8">
                    {isActivityFiltered ? "No activities match these filters." : showHistory ? "No activities yet. Tap + to log one." : "No activities logged today."}
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
                const ActivityIcon = activityIcons[activity.type] ?? BabyIcon;
                const comment = getActivityComment(activity);

                return (
                  <div key={activity.id}>
                    {showDateHeader && (
                      <p className="text-xs font-medium text-muted pt-3 pb-1 first:pt-0">
                        {dateLabel}
                      </p>
                    )}
                    {showHourHeader && (
                      <p className="pt-2 pb-1 font-display text-base text-accent-strong tabular-nums">
                        {hourKey}
                      </p>
                    )}
                    <div className="flex items-start gap-2 rounded-lg border border-border bg-surface p-1 transition-colors hover:border-terracotta/30">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingActivity(activity);
                          setLogType(activity.type);
                          setShowLogModal(true);
                        }}
                        className="min-w-0 flex-1 rounded-lg p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-muted tabular-nums">
                            {formatTime(activity.started_at)} · {timeSince(activity.started_at)}
                          </p>
                          <div className="mt-1 flex min-w-0 items-center gap-2">
                            <ActivityIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-accent-strong" />
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
                            <p className="mt-2 text-xs text-muted">Entered by {activity.created_by}</p>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${display.title.toLowerCase()} activity`}
                        onClick={() => setDeleteActivity(activity)}
                        className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-muted transition-colors hover:bg-red-50 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        title="Delete"
                      >
                        <Trash2 aria-hidden="true" className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                );
              });
            })()}
            {!isActivityFiltered && activities.length > 0 && !showHistory && (
              <button
                onClick={() => setShowHistory(true)}
                className="w-full py-3 text-sm text-accent-strong hover:text-warm-brown transition-colors"
              >
                View all activities
              </button>
            )}
          </div>
        </section>

        {/* Settings */}
        <section className="pt-4 border-t border-border space-y-4">
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
              className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium transition-colors ${
                pushEnabled
                  ? "bg-success text-white"
                  : "bg-surface border border-border text-warm-brown"
              } disabled:opacity-50`}
            >
              {pushEnabled ? <Bell aria-hidden="true" className="h-4 w-4" /> : <BellOff aria-hidden="true" className="h-4 w-4" />}
              <span>{pushLoading ? "Updating…" : pushEnabled ? "Notifications on" : "Enable notifications"}</span>
            </button>
          )}
          <button
            onClick={() => setShowLeaveConfirm(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 w-full py-3 text-sm text-muted hover:text-danger transition-colors"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            Leave household
          </button>
        </section>
      </div>

      {/* Floating Add Activity Menu */}
      <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
        {showActivityMenu && (
          <div className="w-[min(320px,calc(100vw-2.5rem))] rounded-lg border border-border bg-surface p-2 shadow-xl">
            {activityActionTypes.map((type) => {
              const last = getLastActivity(type);
              const overdue = isOverdue(type);
              const isBreastfeeding = activeTimer?.type === "breastfeed";
              const isBreastfeed = type === "breastfeed";
              const label = type === "bottlefeed" ? "Bottlefeed" : type === "vomit" ? "Vomit" : type.charAt(0).toUpperCase() + type.slice(1);
              const ActivityIcon = activityIcons[type] ?? BabyIcon;
              const meta = isBreastfeed && isStartingTimer
                ? "Starting…"
                : isBreastfeed && isBreastfeeding
                ? "Feeding…"
                : isBreastfeed && !activeTimer && breastfeedPromptShown
                ? "Tap again to start"
                : last
                ? timeSince(last.started_at)
                : "No entries yet";

              return (
                <button
                  key={type}
                  onClick={() => handleActivityAction(type)}
                  disabled={isBreastfeed && isStartingTimer}
                  className={"flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-colors " + (overdue ? "bg-terracotta-dark text-white" : "hover:bg-cream text-warm-brown") + " disabled:opacity-60"}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <ActivityIcon aria-hidden="true" className="h-5 w-5 shrink-0" />
                    <span className="text-sm font-medium">{label}</span>
                  </span>
                  <span className={"shrink-0 text-xs tabular-nums " + (overdue ? "text-white" : "text-muted")}>{meta}</span>
                </button>
              );
            })}
          </div>
        )}
        <button
          onClick={() => setShowActivityMenu((value) => !value)}
          aria-label={showActivityMenu ? "Close activity menu" : "Add activity"}
          aria-expanded={showActivityMenu}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-terracotta-dark text-white shadow-lg transition-colors hover:bg-warm-brown"
        >
          {showActivityMenu ? <X aria-hidden="true" className="h-6 w-6" /> : <Plus aria-hidden="true" className="h-6 w-6" />}
        </button>
      </div>

      {/* Milk Consumption History */}
      {showMilkHistoryChart && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-warm-brown/55 px-4 pb-4 sm:items-center sm:pb-0"
          role="dialog"
          aria-modal="true"
          aria-labelledby="milk-history-title"
        >
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="milk-history-title" className="font-display text-xl text-warm-brown">Milk consumption charts</h2>
                <p className="mt-1 text-sm text-muted">Last {MILK_CHART_WINDOW_DAYS} days — full-day totals and same-time comparisons</p>
              </div>
              <button
                type="button"
                onClick={() => setShowMilkHistoryChart(false)}
                aria-label="Close milk consumption charts"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-muted hover:text-warm-brown"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <section className="mt-5">
              <h3 className="text-sm font-semibold text-warm-brown">Total milk consumption history</h3>
              <p className="mt-1 text-xs text-muted">Daily breastmilk, formula, and expected totals</p>
              <MilkHistoryChart days={chartMilkDays} isLoading={isMilkHistoryLoading} />
            </section>
            <section className="mt-6 border-t border-border pt-5">
              <h3 className="text-sm font-semibold text-warm-brown">Consumed by {milkHistoryCutoffLabel}</h3>
              <p className="mt-1 text-xs text-muted">Total milk consumed by the same time each day, including today</p>
              <MilkAsOfHistoryChart days={asOfMilkDays} isLoading={isMilkHistoryLoading} />
            </section>
          </div>
        </div>
      )}

      {/* Leave Household Confirmation */}
      {showLeaveConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-warm-brown/55 px-4 pb-4 sm:items-center sm:pb-0"
          role="dialog"
          aria-modal="true"
          aria-labelledby="leave-household-title"
        >
          <div className="w-full max-w-sm rounded-lg bg-surface p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <LogOut aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
              <div>
                <h2 id="leave-household-title" className="font-display text-xl text-warm-brown">Leave household?</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  This device will lose access to {baby?.name || "this baby"}&apos;s activity history. The household data remains available to other members.
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => setShowLeaveConfirm(false)}
                disabled={isLeaving}
                className="min-h-11 rounded-lg border border-border bg-surface px-4 py-3 text-sm font-semibold text-warm-brown disabled:opacity-50"
              >
                Stay
              </button>
              <button
                type="button"
                onClick={handleLeave}
                disabled={isLeaving}
                className="min-h-11 rounded-lg bg-danger px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-warm-brown disabled:opacity-50"
              >
                {isLeaving ? "Leaving…" : "Leave"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteActivity && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-warm-brown/55 px-4 pb-4 sm:items-center sm:pb-0" role="dialog" aria-modal="true" aria-labelledby="delete-activity-title">
          <div className="w-full max-w-sm rounded-lg bg-surface p-5 shadow-xl">
            <h2 id="delete-activity-title" className="font-display text-xl text-warm-brown">Delete activity?</h2>
            <p className="mt-2 text-sm text-warm-brown-light">
              {getActivityDeleteDescription(deleteActivity)} will be permanently removed.
            </p>
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setDeleteActivity(null)}
                autoFocus
                disabled={isDeletingActivity}
                className="min-h-11 flex-1 rounded-lg border border-border bg-surface py-3 text-sm font-medium text-warm-brown"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeletingActivity}
                className="min-h-11 flex-1 rounded-lg bg-danger py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {isDeletingActivity ? "Deleting…" : "Delete"}
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
      alert("Breastmilk amount exceeds the available breastmilk bank.");
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
    } else if (type === "bankadjust") {
      // The modal has no fields for adjustments; carry the original values so
      // editing notes/time doesn't wipe the correction.
      details.amount = detailsObj.amount;
      details.targetBankMl = detailsObj.targetBankMl;
      details.bankBeforeMl = detailsObj.bankBeforeMl;
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
      alert(error instanceof Error ? error.message : "Could not save activity. Try again.");
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-warm-brown/55" role="dialog" aria-modal="true" aria-labelledby="log-activity-title">
      <div className="bg-surface w-full max-w-lg rounded-t-3xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 id="log-activity-title" className="font-display text-xl text-accent-strong capitalize">
            {isEditing ? "Edit" : "Log"} {type === "bottlefeed" ? "Bottlefeed" : type}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close activity form" className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-muted hover:text-warm-brown">
            <X aria-hidden="true" className="h-5 w-5" />
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
                  className={`min-h-11 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    when === opt.value
                      ? "bg-terracotta-dark text-white"
                      : "bg-surface border border-border"
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
                  aria-label="Activity date"
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-border focus:border-accent-strong outline-none"
                />
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label htmlFor="custom-hour" className="block text-xs text-warm-brown-light mb-1 text-center">Hour</label>
                    <select
                      id="custom-hour"
                      value={customHour}
                      onChange={(e) => setCustomHour(Number(e.target.value))}
                      className="w-full px-4 py-3 rounded-lg border border-border focus:border-accent-strong outline-none text-center text-lg tabular-nums bg-surface"
                    >
                      {hourOptions.map((hour) => (
                        <option key={hour} value={hour}>{pad2(hour)}</option>
                      ))}
                    </select>
                  </div>
                  <span className="text-2xl text-warm-brown-light pt-4">:</span>
                  <div className="flex-1">
                    <label htmlFor="custom-minute" className="block text-xs text-warm-brown-light mb-1 text-center">Min</label>
                    <select
                      id="custom-minute"
                      value={customMinute}
                      onChange={(e) => setCustomMinute(Number(e.target.value))}
                      className="w-full px-4 py-3 rounded-lg border border-border focus:border-accent-strong outline-none text-center text-lg tabular-nums bg-surface"
                    >
                      {minuteOptions.map((minute) => (
                        <option key={minute} value={minute}>{pad2(minute)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {/* Preview in SGT */}
                {customDate && (
                  <p className="text-xs text-muted text-center">
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
                <div key={index} className="rounded-lg border border-border bg-surface p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <label className="text-sm font-medium text-warm-brown-light">
                      {index === 0 ? "Bottlefeed" : "Bottlefeed supplement"}
                    </label>
                    {bottleFeeds.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeBottleFeed(index)}
                        className="min-h-11 px-2 text-xs font-semibold text-danger transition-colors hover:text-warm-brown"
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
                          "py-3 rounded-lg text-sm font-medium transition-colors " +
                          (feed.milkType === option.value
                            ? "bg-terracotta-dark text-white"
                            : "bg-surface border border-border")
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3">
                    <label htmlFor={`bottle-amount-${index}`} className="block text-sm font-medium text-warm-brown-light mb-2">
                      Amount (ml)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {bottleAmountOptions.map((ml) => (
                        <button
                          key={ml}
                          type="button"
                          onClick={() => setBottleFeedAmount(index, String(ml))}
                          className={
                            "min-h-11 px-4 py-2 rounded-lg text-sm font-medium transition-colors " +
                            (feed.amount === String(ml)
                              ? "bg-terracotta-dark text-white"
                              : "bg-surface border border-border")
                          }
                        >
                          {ml}
                        </button>
                      ))}
                    </div>
                    <input
                      id={`bottle-amount-${index}`}
                      type="text"
                      value={feed.amount}
                      onChange={(e) => setBottleFeedAmount(index, e.target.value)}
                      placeholder={index === 0 && suggestedBottleAmount ? "Breastmilk bank amount" : "Enter amount or calculation"}
                      className="mt-2 w-full px-4 py-3 rounded-lg border border-border focus:border-accent-strong outline-none"
                    />
                    {hasMlCalculation(feed.amount) && evaluateMlExpression(feed.amount) != null && (
                      <p className="mt-1.5 text-xs font-medium text-accent-strong">
                        Consumed: {evaluateMlExpression(feed.amount)} ml
                        {(parseMlCalculation(feed.amount)?.wastedMl ?? 0) > 0 && (
                          <> · {parseMlCalculation(feed.amount)?.wastedMl} ml wasted</>
                        )}
                      </p>
                    )}
                    {feed.amount.trim() !== "" && evaluateMlExpression(feed.amount) == null && (
                      <p className="mt-1.5 text-xs font-medium text-danger">Use a valid amount, such as 90 or 90-50.</p>
                    )}
                  </div>
                </div>
              ))}

              <p className="text-xs text-muted">
                Breastmilk bank: {availableBreastmilkMl} ml available
              </p>
              {bottlefeedBreastmilkOverLimit && (
                <p className="text-xs font-medium text-danger">
                  This feed removes more breastmilk than the library contains, including waste.
                </p>
              )}

              <button
                type="button"
                onClick={addBottleFeedSupplement}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-terracotta/20 bg-surface px-4 py-3 text-sm font-semibold text-accent-strong transition-colors hover:bg-terracotta/10"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add bottlefeed supplement
              </button>
            </div>
          )}

          {type === "pump" && (
            <>
              <div>
                <label htmlFor="pump-amount" className="block text-sm font-medium text-warm-brown-light mb-2">
                  Amount (ml)
                </label>
                <input
                  id="pump-amount"
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.+\-\s]/g, ""))}
                  placeholder={lastPumpHint}
                  className="w-full px-4 py-3 rounded-lg border border-border focus:border-accent-strong outline-none"
                />
                {hasMlCalculation(amount) && pumpEffectiveAmount != null && (
                  <p className="mt-1.5 text-xs font-medium text-accent-strong">Effective amount: {pumpEffectiveAmount} ml</p>
                )}
                {pumpHasInvalidAmount && (
                  <p className="mt-1.5 text-xs font-medium text-danger">Use a valid amount, such as 90 or 90-50.</p>
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
                      className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                        side === s
                          ? "bg-terracotta-dark text-white"
                          : "bg-surface border border-border"
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
                    className={`flex-[3] py-3 rounded-lg text-sm font-medium capitalize transition-colors ${
                      diaperPoop === "no"
                        ? "bg-terracotta-dark text-white"
                        : "bg-surface border border-border"
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
                      className={`flex-1 py-3 rounded-lg text-sm font-medium capitalize transition-colors ${
                        diaperPoop === s
                          ? "bg-terracotta-dark text-white"
                          : "bg-surface border border-border"
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
                    className={`flex-[2] py-3 rounded-lg text-sm font-medium capitalize transition-colors ${
                      diaperPeeUnits === "no"
                        ? "bg-terracotta-dark text-white"
                        : "bg-surface border border-border"
                    }`}
                  >
                    No
                  </button>
                  {["1", "2", "3", "4", "5"].map((units) => (
                    <button
                      key={units}
                      onClick={() => setDiaperPeeUnits(units)}
                      className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                        diaperPeeUnits === units
                          ? "bg-terracotta-dark text-white"
                          : "bg-surface border border-border"
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
                    className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                      side === s
                        ? "bg-terracotta-dark text-white"
                        : "bg-surface border border-border"
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
                    className={`py-3 rounded-lg text-sm font-medium transition-colors ${
                      vomitType === opt.value
                        ? "bg-terracotta-dark text-white"
                        : "bg-surface border border-border"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label htmlFor="activity-notes" className="block text-sm font-medium text-warm-brown-light mb-2">
              Notes
            </label>
            <textarea
              id="activity-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Add a note (optional)"
              className="w-full resize-none rounded-lg border border-border bg-surface px-4 py-3 text-sm text-warm-brown outline-none transition-colors focus:border-accent-strong"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={isLoading || bottlefeedBreastmilkOverLimit || bottlefeedHasInvalidAmount || pumpHasInvalidAmount}
            className="w-full py-4 bg-terracotta-dark text-white font-medium rounded-lg text-lg hover:bg-warm-brown transition-colors disabled:opacity-50"
          >
            {isLoading ? "Saving…" : isEditing ? "Save changes" : "Log activity"}
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
  const fieldId = `setting-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  if (!editing) {
    return (
      <div className="flex items-center justify-between bg-surface p-4 rounded-lg border border-border">
        <div>
          <p className="text-xs text-muted">{label}</p>
          <p className="text-sm text-warm-brown">{value || "—"}</p>
        </div>
        <button
          onClick={() => { setDraft(value); setEditing(true); }}
          className="inline-flex items-center gap-1.5 min-h-11 px-2 text-xs font-semibold text-accent-strong transition-colors hover:text-warm-brown"
        >
          <Pencil aria-hidden="true" className="h-4 w-4" />
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="bg-surface p-4 rounded-lg border border-terracotta/30 space-y-2">
      <label htmlFor={fieldId} className="text-xs text-muted">{label}</label>
      <input
        id={fieldId}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        className="min-h-11 w-full px-3 py-2 rounded-lg border border-border focus:border-accent-strong outline-none text-sm"
      />
      <div className="flex gap-2">
        <button
          onClick={() => setEditing(false)}
          className="min-h-11 flex-1 py-2 rounded-lg text-sm text-warm-brown-light border border-border"
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
          className="min-h-11 flex-1 py-2 rounded-lg text-sm bg-terracotta-dark text-white font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
