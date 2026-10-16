"use client";

import { useState, useEffect, useCallback, useRef, useId } from "react";
import Link from "next/link";
import { useHousehold } from "@/lib/context/household-context";
import { Baby as BabyIcon, BarChart3, Bell, BellOff, ChevronDown, ChevronLeft, ChevronRight, Download, Droplet, Eye, EyeOff, Heart, ImageUp, Info, LineChart, ListFilter, LogOut, Milk, Moon, NotebookPen, Pencil, Pill, Plus, RotateCw, Scale, Snowflake, Thermometer, Trash2, TriangleAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatAge, timeSince, median, formatTime, formatDate, formatWeight } from "@/lib/utils";
import { bottleBreastmilkLibraryDeduction, parseMlCalculation } from "@/lib/milk-calculation";
import { activityNoteText } from "@/lib/activity-note";
import { MilkAsOfHistoryChart, MilkHistoryChart } from "@/components/MilkHistoryChart";
import { SleepStateControl } from "@/components/SleepStateControl";
import { DailyNapSummary } from "@/components/DailyNapSummary";
import { MilkBank } from "@/components/MilkBank";
import RecentBottleFeeds from "@/components/RecentBottleFeeds";
import ActivityRecency from "@/components/ActivityRecency";
import ActivityTimelineCard from "@/components/ActivityTimelineCard";
import ThemePreferenceControl from "@/components/ThemePreferenceControl";
import SickModePanel from "@/components/SickModePanel";
import MedicationLogModal from "@/components/MedicationLogModal";
import CaretakerImportModal from "@/components/CaretakerImportModal";
import ChildcareHeaderMenu from "@/components/ChildcareHeaderMenu";
import MedicationDoseEditModal from "@/components/MedicationDoseEditModal";
import MedicationPrescriptionModal from "@/components/MedicationPrescriptionModal";
import SickMilkProgress from "@/components/SickMilkProgress";
import BabyCareMenu from "@/components/BabyCareMenu";
import { publishCareMode } from "@/lib/care-mode";
import type { SleepUndoToken } from "@/lib/sleep-transition";
import type { ConfirmedSleepCoverage, DailyNapSession } from "@/lib/daily-naps";
import type { AvailableMilkBatch, FrozenMilkPacket, MilkBankHistoryItem } from "@/lib/milk-bank-ledger";
import type { SickModeResponse } from "@/lib/sick-mode";
import type { MedicationDoseReference } from "@/lib/activity-timeline";
import type { HistoricalMedicationReference } from "@/lib/historical-medication";
import { entryForActiveEpisode, medicationAddEntry, medicationLogEntry, type MedicationEntry, type MedicationPrescriptionDraftInput } from "@/lib/medication-entry";
import { formatElapsedDuration, formatElapsedSince } from "@/lib/elapsed-time";
import { mutateSickMode } from "@/lib/sick-mode-client";
import { applyMilkActivityChangeToTotals, sameTimeMilkMedianReference, shouldHoldDashboardForSickMode, updateRecentMilkFeedList, updateSickLatestMilkFeeds } from "@/lib/dashboard-milk-state";
import { sgtDateKey as sgtDateKeyForTimestamp } from "@/lib/milk-volumes";
import { aggregateDashboardRefreshResults, runSingleFlight, shouldSkipForManualRefresh, type DashboardRefreshResult, type RefreshTaskResult } from "@/lib/dashboard-refresh";
import { useDashboardRefreshBlocked, useStandalonePullToRefresh } from "@/hooks/use-standalone-pull-to-refresh";
import type { ChildcareModeCommandResponse, ChildcareModeState, ChildcareSessionSummary } from "@/lib/childcare-mode-contract";
import { ChildcareConfirmationDeclinedError, fetchWithChildcareConfirmation } from "@/lib/childcare-mode-client";

interface Baby {
  id: string;
  name: string;
  birth_date: number | null;
}

interface Activity {
  id: string;
  type: string;
  started_at: number;
  ended_at?: number | null;
  details: string | Record<string, unknown>; // JSON string from API, parsed client-side
  created_by?: string;
  medicationDose?: MedicationDoseReference;
  historicalMedication?: HistoricalMedicationReference;
  /** Present only on the virtual, read-only care markers projected from a
   * committed caretaker import. */
  careBoundary?: "start" | "end";
}

interface SleepState {
  state: "awake" | "sleeping";
  since: number | null;
  activity: Activity | null;
}

interface TimelineActivity extends Activity {
  sourceActivity?: Activity;
  sleepEvent?: "start" | "wake";
}

interface MilkDaySummary {
  date: string;
  totalMl: number;
  breastmilkMl: number;
  formulaMl: number;
  expectedMl: number | null;
  asOfNowMl: number;
  isSickDay?: boolean;
}

interface RecentMilkFeed {
  id: string;
  startedAt: number;
  amountMl: number;
}

interface PumpedMilkBatch extends AvailableMilkBatch {
  pumpedAt: number;
  isAdjustment?: boolean;
}

type DashboardRefreshFeedback = DashboardRefreshResult | { kind: "refreshing"; message: string };

const sgtHourFormatter = new Intl.DateTimeFormat("en-SG", {
  hour: "2-digit",
  timeZone: "Asia/Singapore",
  hourCycle: "h23",
});

// The milk charts show a recent window, not the full history (which now spans
// months); the day-by-day navigation still uses the complete milkHistory.
const MILK_CHART_WINDOW_DAYS = 30;

// Bank transfers are edited and deleted through the milk-bank ledger, never
// through the generic activity API, so the diary routes them separately.
const BANK_TRANSFER_TYPES = new Set(["bankfreeze", "bankthaw", "bankdiscard"]);

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
          <p className="font-display text-2xl text-accent-strong font-semibold tabular-nums">
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
  const [showCaretakerImport, setShowCaretakerImport] = useState(false);
  const [caretakerImportSession, setCaretakerImportSession] = useState<ChildcareSessionSummary | null>(null);
  const [childcareMode, setChildcareMode] = useState<ChildcareModeState>({ schemaReady: false, activeSession: null, pendingSessions: [], historySessions: [] });
  // Browsing lifts the childcare grey-out for the current session only.
  const [childcareBrowseSessionId, setChildcareBrowseSessionId] = useState<string | null>(null);
  const [childcareBusy, setChildcareBusy] = useState(false);
  const [childcareError, setChildcareError] = useState<string | null>(null);
  const [childcareOverride, setChildcareOverride] = useState(false);
  const childcareCommandRef = useRef<{ action: "checkIn" | "checkOut" | "editCheckIn"; requestId: string; at: number; expectedCheckedInAt?: number; sessionId?: string } | null>(null);
  const [logType, setLogType] = useState<string | null>(null);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [editingDose, setEditingDose] = useState<Activity | null>(null);
  const [deleteActivity, setDeleteActivity] = useState<Activity | null>(null);
  const [historyEditRequest, setHistoryEditRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [isDeletingActivity, setIsDeletingActivity] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTimer, setActiveTimer] = useState<Record<string, unknown> | null>(null);
  const [sleepState, setSleepState] = useState<SleepState>({ state: "awake", since: null, activity: null });
  const [sleepActivities, setSleepActivities] = useState<DailyNapSession[]>([]);
  const [confirmedSleepCoverages, setConfirmedSleepCoverages] = useState<ConfirmedSleepCoverage[]>([]);
  const [isChangingSleepState, setIsChangingSleepState] = useState(false);
  const [sleepUndo, setSleepUndo] = useState<{ token: SleepUndoToken; message: string } | null>(null);
  const [sleepNotice, setSleepNotice] = useState<string | null>(null);
  const sleepUndoTimerRef = useRef<number | null>(null);
  const [isEditingSleepSince, setIsEditingSleepSince] = useState(false);
  const [sleepSinceInput, setSleepSinceInput] = useState("");
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
  const dailyMilkTotalsRef = useRef({ totalMl: 0, breastmilkMl: 0, formulaMl: 0 });
  const [recentMilkFeeds, setRecentMilkFeeds] = useState<RecentMilkFeed[]>([]);
  const [breastmilkLibraryMl, setBreastmilkLibraryMl] = useState(0);
  const [breastmilkBatches, setBreastmilkBatches] = useState<PumpedMilkBatch[]>([]);
  const [frozenMilkMl, setFrozenMilkMl] = useState(0);
  const [frozenPackets, setFrozenPackets] = useState<FrozenMilkPacket[]>([]);
  const [bankHistory, setBankHistory] = useState<MilkBankHistoryItem[]>([]);
  const [lastPumpedMl, setLastPumpedMl] = useState(0);
  const [lastPumpedAt, setLastPumpedAt] = useState<number | null>(null);
  const [expectedDailyMilkMl, setExpectedDailyMilkMl] = useState<number | null>(null);
  const [milkHistory, setMilkHistory] = useState<MilkDaySummary[]>([]);
  const [milkHistoryCutoffAt, setMilkHistoryCutoffAt] = useState<number | null>(null);
  const [asOfDayOffset, setAsOfDayOffset] = useState(-1);
  const milkHistoryRequestRef = useRef(0);
  const sickModeRequestRef = useRef(0);
  const sickModeDataBabyIdRef = useRef<string | null>(null);
  const dashboardRequestRef = useRef<AbortController | null>(null);
  const activityRequestRef = useRef<AbortController | null>(null);
  const dashboardSnapshotRef = useRef("");
  const manualRefreshActiveRef = useRef(false);
  const manualRefreshPromiseRef = useRef<Promise<DashboardRefreshResult> | null>(null);
  const refreshFeedbackTimerRef = useRef<number | null>(null);
  const dashboardMountedRef = useRef(true);
  const [refreshFeedback, setRefreshFeedback] = useState<DashboardRefreshFeedback | null>(null);
  const [selectedMilkDate, setSelectedMilkDate] = useState("");
  const [showMilkHistoryChart, setShowMilkHistoryChart] = useState(false);
  const [showMedianInfo, setShowMedianInfo] = useState(false);
  const medianInfoId = useId();
  const [isMilkHistoryLoading, setIsMilkHistoryLoading] = useState(false);
  const [sickMode, setSickMode] = useState<SickModeResponse | null>(null);
  const [sickModeIsStale, setSickModeIsStale] = useState(false);
  const [sickModeLoadedBabyId, setSickModeLoadedBabyId] = useState<string | null>(null);
  const [medicationEntry, setMedicationEntry] = useState<MedicationEntry | null>(null);
  const sickModeActive = Boolean(sickMode?.schemaReady && sickMode.activeEpisode);
  const activeSickEpisodeId = sickModeActive ? sickMode?.activeEpisode?.id : undefined;
  useEffect(() => { setMedicationEntry(current => entryForActiveEpisode(current, activeSickEpisodeId)); }, [activeSickEpisodeId]);
  const [activityDateFilter, setActivityDateFilter] = useState("");
  const [activityTypeFilters, setActivityTypeFilters] = useState<string[]>([]);
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
  useEffect(() => {
    setSelectedMilkDate((current) => current || todayDateKey);
  }, [todayDateKey]);
  const isActivityFiltered = Boolean(activityDateFilter || activityTypeFilters.length > 0);
  const activityActionTypes = ["bottlefeed", "breastfeed", "pump", "diaper", "note", "temperature", ...(sickModeActive ? ["medication"] : [])];
  const activityIcons: Record<string, LucideIcon> = {
    bottlefeed: Milk,
    breastfeed: Heart,
    pump: Droplet,
    diaper: BabyIcon,
    vomit: TriangleAlert,
    bankadjust: Scale,
    bankfreeze: Snowflake,
    bankthaw: Milk,
    bankdiscard: Milk,
    note: NotebookPen,
    temperature: Thermometer,
    medication: Pill,
    sleep: Moon,
  };

  const activityTypeOptions = [
    { value: "bottlefeed", label: "Bottlefeed" },
    { value: "breastfeed", label: "Breastfeed" },
    { value: "pump", label: "Pump" },
    { value: "diaper", label: "Diaper" },
    { value: "note", label: "Note" },
    { value: "temperature", label: "Temperature" },
    { value: "sleep", label: "Sleep" },
    { value: "medication", label: "Medication" },
    { value: "bankadjust", label: "Bank adjustment" },
    { value: "bankfreeze", label: "Milk frozen" },
    { value: "bankthaw", label: "Milk thawed" },
    { value: "bankdiscard", label: "Frozen milk discarded" },
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
  // After any type checkbox change, close this dropdown and return focus to its
  // summary so multi-selection requires an explicit reopen. Multi-select state
  // and date/history semantics are unchanged.
  const handleActivityTypeFilterChange = (target: HTMLInputElement, value: string | null) => {
    if (value === null) setActivityTypeFilters([]);
    else toggleActivityTypeFilter(value);
    const details = target.closest("details");
    if (details) {
      details.open = false;
      details.querySelector("summary")?.focus();
    }
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

  const fetchMilkHistory = useCallback(async (
    babyId: string,
    showLoading = true,
    options: { manual?: boolean; background?: boolean } = {},
  ): Promise<RefreshTaskResult> => {
    if (!householdId || !babyId) return "skipped";
    if (shouldSkipForManualRefresh(manualRefreshActiveRef.current, Boolean(options.background))) return "skipped";
    const requestId = ++milkHistoryRequestRef.current;
    if (showLoading) setIsMilkHistoryLoading(true);
    try {
      const res = await fetch(`/api/milk-history?babyId=${encodeURIComponent(babyId)}&asOf=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load milk history");
      const data = await res.json();
      if (requestId !== milkHistoryRequestRef.current) return "superseded";
      setMilkHistory(Array.isArray(data.days) ? data.days : []);
      const cutoffAt = Number(data.asOfTimestamp);
      setMilkHistoryCutoffAt(Number.isFinite(cutoffAt) ? cutoffAt : null);
      return "success";
    } catch (error) {
      if (requestId !== milkHistoryRequestRef.current) return "superseded";
      console.error("Milk history error:", error);
      return "failed";
    } finally {
      if (requestId === milkHistoryRequestRef.current) setIsMilkHistoryLoading(false);
    }
  }, [householdId]);

  const fetchSickMode = useCallback(async (
    babyId: string,
    options: { manual?: boolean; background?: boolean } = {},
  ): Promise<RefreshTaskResult> => {
    if (!householdId || !babyId) return "skipped";
    if (shouldSkipForManualRefresh(manualRefreshActiveRef.current, Boolean(options.background))) return "skipped";
    const requestId = ++sickModeRequestRef.current;
    try {
      const response = await fetch(`/api/sick-mode?babyId=${encodeURIComponent(babyId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => null) as SickModeResponse | null;
      if (requestId !== sickModeRequestRef.current) return "superseded";
      if (response.ok && data) {
        sickModeDataBabyIdRef.current = babyId;
        setSickMode(data);
        setSickModeIsStale(false);
        publishCareMode({ householdId, babyId, active: data.schemaReady && Boolean(data.activeEpisode) });
        setSickModeLoadedBabyId(babyId);
        return "success";
      } else {
        if (sickModeDataBabyIdRef.current !== babyId) setSickMode(null);
        sickModeDataBabyIdRef.current = babyId;
        setSickModeIsStale(true);
        setSickModeLoadedBabyId(babyId);
        return "failed";
      }
    } catch (error) {
      if (requestId !== sickModeRequestRef.current) return "superseded";
      console.error("Sick mode error:", error);
      if (sickModeDataBabyIdRef.current !== babyId) setSickMode(null);
      sickModeDataBabyIdRef.current = babyId;
      setSickModeIsStale(true);
      setSickModeLoadedBabyId(babyId);
      return "failed";
    }
  }, [householdId]);

  const fetchData = useCallback(async (
    options: { manual?: boolean; background?: boolean; refreshMilkHistory?: boolean } = {},
  ): Promise<RefreshTaskResult> => {
    if (!householdId) return "skipped";
    if (shouldSkipForManualRefresh(manualRefreshActiveRef.current, Boolean(options.background))) return "skipped";

    dashboardRequestRef.current?.abort();
    const controller = new AbortController();
    dashboardRequestRef.current = controller;

    try {
      const res = await fetch("/api/dashboard", { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error("Failed to load dashboard");

      const data = await res.json();
      if (controller.signal.aborted) return "superseded";
      const snapshot = JSON.stringify(data);
      if (snapshot === dashboardSnapshotRef.current) return "success";
      dashboardSnapshotRef.current = snapshot;

      if (data.babies?.length > 0) {
        const selectedBaby = data.babies[0];
        setBaby(selectedBaby);
        if (options.refreshMilkHistory !== false) void fetchMilkHistory(String(selectedBaby.id), false);
        const sleeps = Array.isArray(data.sleepActivities)
          ? data.sleepActivities.filter((item: { baby_id?: unknown }) => String(item.baby_id) === String(selectedBaby.id))
          : [];
        const openSleep = sleeps.find((item: { ended_at?: unknown }) => item.ended_at == null);
        const latestClosed = sleeps.find((item: { ended_at?: unknown }) => item.ended_at != null);
        const coverages: ConfirmedSleepCoverage[] = Array.isArray(data.sleepCoverages)
          ? data.sleepCoverages
            .filter((item: { baby_id?: unknown }) => String(item.baby_id) === String(selectedBaby.id))
            .flatMap((item: { startedAt?: unknown; endedAt?: unknown }) => {
              const startedAt = Number(item.startedAt);
              const endedAt = Number(item.endedAt);
              return Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt > startedAt
                ? [{ startedAt, endedAt }]
                : [];
            })
          : [];
        const confirmedAwakeFallback = coverages.reduce<number | null>((earliest, coverage) =>
          earliest == null || coverage.startedAt < earliest ? coverage.startedAt : earliest, null);
        setSleepActivities(sleeps.map((item: { id?: unknown; started_at?: unknown; ended_at?: unknown }) => ({
          id: item.id == null ? undefined : String(item.id),
          startedAt: Number(item.started_at),
          endedAt: item.ended_at == null ? null : Number(item.ended_at),
        })));
        setConfirmedSleepCoverages(coverages);
        setSleepState(openSleep
          ? { state: "sleeping", since: Number(openSleep.started_at), activity: openSleep as Activity }
          : {
              state: "awake",
              since: latestClosed ? Number(latestClosed.ended_at) : confirmedAwakeFallback,
              activity: latestClosed as Activity | null,
            });
      }
      setActivities(data.activities || []);
      setChildcareMode(data.childcareMode && typeof data.childcareMode === "object"
        ? data.childcareMode as ChildcareModeState
        : { schemaReady: false, activeSession: null, pendingSessions: [], historySessions: [] });
      if (data.household?.inviteCode) {
        setInviteCode(data.household.inviteCode);
      }
      const weight = Number(data.measurement?.weight_g);
      setLatestWeight(Number.isFinite(weight) && weight > 0 ? weight : null);
      const dailyMilkTotals = {
        totalMl: Number(data.dailyMilk?.totalMl ?? 0),
        breastmilkMl: Number(data.dailyMilk?.breastmilkMl ?? 0),
        formulaMl: Number(data.dailyMilk?.formulaMl ?? 0),
      };
      dailyMilkTotalsRef.current = dailyMilkTotals;
      setDailyMilkMl(dailyMilkTotals.totalMl);
      setDailyBreastmilkMl(dailyMilkTotals.breastmilkMl);
      setDailyFormulaMl(dailyMilkTotals.formulaMl);
      setRecentMilkFeeds(Array.isArray(data.recentMilkFeeds) ? data.recentMilkFeeds : []);
      setBreastmilkLibraryMl(Number(data.pumpedMilk?.walletMl ?? 0));
      setBreastmilkBatches(Array.isArray(data.pumpedMilk?.batches) ? data.pumpedMilk.batches : []);
      setFrozenMilkMl(Number(data.pumpedMilk?.frozenMl ?? 0));
      setFrozenPackets(Array.isArray(data.pumpedMilk?.frozenPackets) ? data.pumpedMilk.frozenPackets : []);
      setBankHistory(Array.isArray(data.pumpedMilk?.bankHistory) ? data.pumpedMilk.bankHistory : []);
      setLastPumpedMl(Number(data.pumpedMilk?.lastPumpMl ?? 0));
      const lastPumpAt = Number(data.pumpedMilk?.lastPumpAt);
      setLastPumpedAt(Number.isFinite(lastPumpAt) && lastPumpAt > 0 ? lastPumpAt : null);
      const expectedMilk = Number(data.dailyMilk?.expectedMl);
      setExpectedDailyMilkMl(Number.isFinite(expectedMilk) && expectedMilk > 0 ? expectedMilk : null);
      if (data.timers?.length > 0) {
        setActiveTimer(data.timers[0]);
      } else {
        setActiveTimer(null);
      }
      return "success";
    } catch (error) {
      if ((error as Error).name === "AbortError") return "superseded";
      console.error("Fetch error:", error);
      return "failed";
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
      if (document.visibilityState === "visible") void fetchData({ background: true });
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
      if (document.visibilityState === "visible") void fetchMilkHistory(baby.id, false, { background: true });
    };
    fetchMilkHistory(baby.id);
    document.addEventListener("visibilitychange", refreshMilkHistory);
    return () => {
      document.removeEventListener("visibilitychange", refreshMilkHistory);
    };
  }, [baby?.id, fetchMilkHistory, activityFilterRefresh]);

  useEffect(() => {
    if (!baby?.id) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void fetchSickMode(baby.id, { background: true });
    };
    void fetchSickMode(baby.id);
    const interval = window.setInterval(refreshIfVisible, 30_000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [baby?.id, fetchSickMode, activityFilterRefresh]);

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

  // Abort-safe loader shared by the initial load, the 30s poll, the
  // focus/visibility refresh, and the awaitable manual refresh group. A
  // background load never toggles the loading state, so polling can't replace
  // the rendered diary or reset disclosure, date, or filter selections.
  const fetchFilteredActivities = useCallback(async (
    options: { showLoading?: boolean; manual?: boolean; background?: boolean } = {},
  ): Promise<RefreshTaskResult> => {
    if (!householdId || !baby?.id) return "skipped";
    if (shouldSkipForManualRefresh(manualRefreshActiveRef.current, Boolean(options.background))) return "skipped";

    activityRequestRef.current?.abort();
    const controller = new AbortController();
    activityRequestRef.current = controller;
    const showLoading = options.showLoading ?? false;

    // A chosen (or implicit "today") day should render every record for that
    // day, so request the full set. The unfiltered "All days" view keeps the
    // bounded 500 record window.
    const scopedToSelectedDay = Boolean(activityDateFilter) || !showHistory;
    const params = new URLSearchParams({ limit: scopedToSelectedDay ? "all" : "500", babyId: baby.id });
    if (activityDateFilter) {
      params.set("date", activityDateFilter);
    } else if (!showHistory) {
      params.set("date", todayDateKey);
    }
    activityTypeFilters.forEach((type) => params.append("type", type));

    if (showLoading) setIsActivityFilterLoading(true);
    try {
      const response = await fetch("/api/activities?" + params.toString(), {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Failed to load activities");
      const data = await response.json();
      if (controller.signal.aborted || activityRequestRef.current !== controller) return "superseded";
      setFilteredActivities(data.activities || []);
      return "success";
    } catch (error) {
      if ((error as Error).name === "AbortError") return "superseded";
      console.error("Activity list error:", error);
      return "failed";
    } finally {
      if (activityRequestRef.current === controller) {
        activityRequestRef.current = null;
        setIsActivityFilterLoading(false);
      }
    }
  }, [householdId, baby?.id, activityDateFilter, activityTypeFilters, showHistory, todayDateKey, activityFilterRefresh]);

  useEffect(() => {
    if (!householdId || !baby?.id) return;

    // A user changing the selected diary view owns the newest request even if
    // a manual group is still settling. The superseded group reports partial;
    // interval/focus refreshes below remain suppressed during manual work.
    void fetchFilteredActivities({ showLoading: true });
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void fetchFilteredActivities({ background: true });
    };
    const interval = window.setInterval(refreshIfVisible, 30_000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      activityRequestRef.current?.abort();
      activityRequestRef.current = null;
    };
  }, [householdId, baby?.id, fetchFilteredActivities]);

  const refreshExplicitlyBlocked = isLoading
    || showLogModal
    || showCaretakerImport
    || Boolean(editingActivity)
    || Boolean(editingDose)
    || Boolean(deleteActivity)
    || Boolean(medicationEntry)
    || showLeaveConfirm
    || showMilkHistoryChart
    || isEditingSleepSince
    || isChangingSleepState
    || isDeletingActivity
    || isLeaving
    || isStartingTimer
    || isStoppingTimer
    || pushLoading
    || refreshFeedback?.kind === "refreshing";
  const refreshBlocked = useDashboardRefreshBlocked(refreshExplicitlyBlocked);

  const refreshDashboard = useCallback((): Promise<DashboardRefreshResult> => {
    if (!baby?.id || refreshBlocked) {
      return Promise.resolve({ kind: "failure", message: "Refresh is paused while an editor or dialog is open." });
    }

    return runSingleFlight(manualRefreshPromiseRef, async () => {
      if (refreshFeedbackTimerRef.current != null) {
        window.clearTimeout(refreshFeedbackTimerRef.current);
        refreshFeedbackTimerRef.current = null;
      }
      manualRefreshActiveRef.current = true;
      setRefreshFeedback({ kind: "refreshing", message: "Refreshing dashboard…" });

      let result: DashboardRefreshResult;
      try {
        const outcomes = await Promise.all([
          fetchData({ manual: true, refreshMilkHistory: false }),
          fetchSickMode(baby.id, { manual: true }),
          fetchMilkHistory(baby.id, false, { manual: true }),
          fetchFilteredActivities({ manual: true }),
        ]);
        result = aggregateDashboardRefreshResults(outcomes);
      } catch (error) {
        console.error("Manual dashboard refresh error:", error);
        result = { kind: "failure", message: "Couldn’t refresh the dashboard. Check your connection and retry." };
      } finally {
        manualRefreshActiveRef.current = false;
      }

      if (dashboardMountedRef.current) setRefreshFeedback(result);
      if (result.kind === "success" && dashboardMountedRef.current) {
        refreshFeedbackTimerRef.current = window.setTimeout(() => {
          if (dashboardMountedRef.current) setRefreshFeedback(null);
          refreshFeedbackTimerRef.current = null;
        }, 3200);
      }
      return result;
    });
  }, [baby?.id, fetchData, fetchFilteredActivities, fetchMilkHistory, fetchSickMode, refreshBlocked]);

  useEffect(() => {
    dashboardMountedRef.current = true;
    return () => {
      dashboardMountedRef.current = false;
      manualRefreshActiveRef.current = false;
      milkHistoryRequestRef.current += 1;
      sickModeRequestRef.current += 1;
      dashboardRequestRef.current?.abort();
      activityRequestRef.current?.abort();
      if (refreshFeedbackTimerRef.current != null) window.clearTimeout(refreshFeedbackTimerRef.current);
    };
  }, []);

  const { isStandalone: standalonePullEnabled, pullDistance, pullPhase } = useStandalonePullToRefresh({
    disabled: refreshBlocked,
    onRefresh: () => { void refreshDashboard(); },
  });

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
    if (!deleteActivity || !baby?.id) return;
    const record = deleteActivity;
    const dose = record.medicationDose;
    const historical = record.historicalMedication;
    if (record.type === "medication" && !dose && !historical) {
      alert("This medication activity is missing its source details and can’t be deleted here. Refresh and try again.");
      return;
    }
    setIsDeletingActivity(true);
    try {
      if (record.type === "medication" && !dose && historical) {
        // Imported records are removed through their own revisioned contract,
        // never the sick-mode delete or the generic activity API.
        const res = await fetch("/api/historical-medications", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: record.id, babyId: baby.id, expectedRevision: historical.revision }),
        });
        if (res.status === 409) {
          setDeleteActivity(null);
          await fetchSickMode(baby.id);
          setActivityFilterRefresh((value) => value + 1);
          alert("This activity changed on another device. The latest details have been loaded for review.");
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as { error?: string }).error || "Failed to delete activity");
        }
        setDeleteActivity(null);
        await fetchSickMode(baby.id);
        await fetchData();
        setActivityFilterRefresh((value) => value + 1);
        return;
      }

      if (record.type === "medication" && dose) {
        try {
          await mutateSickMode({
            action: "deleteDose",
            babyId: baby.id,
            episodeId: dose.episodeId,
            medicationId: dose.medicationId,
            doseId: dose.doseId,
            expectedRevision: dose.revision,
          });
        } catch (caught) {
          if ((caught as { status?: number }).status === 409) {
            // Never override the stored revision: close the prompt, reload
            // both views, and ask the caregiver to review the latest record.
            setDeleteActivity(null);
            await fetchSickMode(baby.id);
            setActivityFilterRefresh((value) => value + 1);
            alert("This dose changed on another device. The latest details have been loaded for review.");
            return;
          }
          throw caught;
        }
        setDeleteActivity(null);
        await fetchSickMode(baby.id);
        await fetchData();
        setActivityFilterRefresh((value) => value + 1);
        return;
      }

      const endpoint = BANK_TRANSFER_TYPES.has(record.type)
        ? `/api/milk-bank?id=${encodeURIComponent(record.id)}`
        : `/api/activities?id=${encodeURIComponent(record.id)}`;
      const res = await fetch(endpoint, { method: "DELETE" });
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

  const confirmChildcareOverride = (): boolean => window.confirm(
    `${baby?.name || "Baby"} is currently checked in to childcare. Add this activity anyway?`,
  );
  const confirmChildcareEntry = (): boolean => !childcareMode.activeSession || confirmChildcareOverride();

  const handleStartTimer = async (type: string, side?: string, confirmedChildcareOverride = false) => {
    if (!baby?.id) return null;
    const requestedSide = side || "L";
    try {
      const res = await fetchWithChildcareConfirmation("/api/active-timers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ babyId: baby.id, type, side: requestedSide, childcareOverride: confirmedChildcareOverride }),
      }, confirmChildcareOverride);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) throw new Error(data.error || "Failed to start timer");
      return {
        id: String(data.id),
        type,
        started_at: Number(data.startedAt) || Date.now(),
        current_side: typeof data.side === "string" ? data.side : requestedSide,
      };
    } catch (error) {
      if (error instanceof ChildcareConfirmationDeclinedError) return null;
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
    const confirmedChildcareOverride = childcareMode.activeSession ? confirmChildcareEntry() : false;
    if (childcareMode.activeSession && !confirmedChildcareOverride) return;
    setIsStoppingTimer(true);
    try {
      const params = new URLSearchParams({ babyId: baby.id });
      if (activeTimer.id != null) params.set("id", String(activeTimer.id));
      if (confirmedChildcareOverride) params.set("childcareOverride", "true");
      const res = await fetchWithChildcareConfirmation(`/api/active-timers?${params.toString()}`, { method: "DELETE" }, confirmChildcareOverride);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to stop timer");
      setActiveTimer(null);
      await fetchData();
      setActivityFilterRefresh((value) => value + 1);
    } catch (error) {
      if (error instanceof ChildcareConfirmationDeclinedError) return;
      console.error("Stop timer error:", error);
      alert(error instanceof Error ? error.message : "Could not stop and log the timer. Try again.");
    } finally {
      setIsStoppingTimer(false);
    }
  };

  useEffect(() => () => {
    if (sleepUndoTimerRef.current != null) window.clearTimeout(sleepUndoTimerRef.current);
  }, []);

  const showSleepUndo = (token: SleepUndoToken, message: string) => {
    if (sleepUndoTimerRef.current != null) window.clearTimeout(sleepUndoTimerRef.current);
    setSleepNotice(null);
    setSleepUndo({ token, message });
    sleepUndoTimerRef.current = window.setTimeout(() => {
      setSleepUndo(null);
      sleepUndoTimerRef.current = null;
    }, 5_000);
  };

  const handleSleepTransition = async (target: "awake" | "sleeping") => {
    if (!baby?.id || isChangingSleepState || target === sleepState.state) return;
    const confirmedChildcareOverride = childcareMode.activeSession ? confirmChildcareEntry() : false;
    if (childcareMode.activeSession && !confirmedChildcareOverride) return;
    setIsChangingSleepState(true);
    try {
      const res = await fetchWithChildcareConfirmation("/api/sleep-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ babyId: baby.id, action: target === "sleeping" ? "sleep" : "wake", childcareOverride: confirmedChildcareOverride }),
      }, confirmChildcareOverride);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update sleep state");
      if (data.undoToken) {
        showSleepUndo(data.undoToken as SleepUndoToken, target === "sleeping" ? "Sleep started" : "Marked awake");
      }
      await fetchData();
      setActivityFilterRefresh((value) => value + 1);
    } catch (error) {
      if (error instanceof ChildcareConfirmationDeclinedError) return;
      alert(error instanceof Error ? error.message : "Could not update sleep state. Try again.");
      await fetchData();
    } finally {
      setIsChangingSleepState(false);
    }
  };

  const handleUndoSleep = async () => {
    if (!baby?.id || !sleepUndo || isChangingSleepState) return;
    const pending = sleepUndo;
    if (sleepUndoTimerRef.current != null) window.clearTimeout(sleepUndoTimerRef.current);
    setSleepUndo(null);
    setIsChangingSleepState(true);
    try {
      const res = await fetch("/api/sleep-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ babyId: baby.id, action: "undo", undoToken: pending.token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSleepNotice(data.code === "STALE_UNDO"
          ? "Couldn’t undo: the sleep state changed on another device. Latest state loaded."
          : data.error || "Couldn’t undo the sleep change.");
      } else {
        setSleepNotice("Sleep change undone.");
      }
      await fetchData();
      setActivityFilterRefresh((value) => value + 1);
    } catch {
      setSleepNotice("Couldn’t undo the sleep change. Latest state loaded.");
      await fetchData();
    } finally {
      setIsChangingSleepState(false);
    }
  };

  const startEditingSleepSince = () => {
    if (sleepState.since == null) return;
    const date = new Date(sleepState.since + 8 * 60 * 60 * 1000);
    setSleepSinceInput(date.toISOString().slice(0, 16));
    setIsEditingSleepSince(true);
  };

  const saveSleepSince = async () => {
    if (!baby?.id || !sleepState.activity || !sleepSinceInput) return;
    const correctedAt = Date.parse(sleepSinceInput + ":00+08:00");
    if (!Number.isFinite(correctedAt)) return;
    setIsChangingSleepState(true);
    try {
      const activity = sleepState.activity;
      const res = await fetch("/api/activities", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activity.id,
          babyId: baby.id,
          type: "sleep",
          startedAt: sleepState.state === "sleeping" ? correctedAt : activity.started_at,
          endedAt: sleepState.state === "awake" ? correctedAt : null,
          details: {},
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not correct the start time");
      setIsEditingSleepSince(false);
      await fetchData();
      setActivityFilterRefresh((value) => value + 1);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Could not correct the start time. Try again.");
    } finally {
      setIsChangingSleepState(false);
    }
  };

  const handleActivityAction = async (type: string) => {
    setEditingDose(null);
    const confirmedChildcareOverride = childcareMode.activeSession ? confirmChildcareEntry() : false;
    if (childcareMode.activeSession && !confirmedChildcareOverride) return;
    setChildcareOverride(confirmedChildcareOverride);
    if (type === "medication") {
      if (!activeSickEpisodeId || sickModeIsStale) return;
      setShowActivityMenu(false);
      setMedicationEntry(medicationLogEntry(activeSickEpisodeId));
      return;
    }
    if (type === "breastfeed" && !activeTimer) {
      if (!breastfeedPromptShown) {
        setBreastfeedPromptShown(true);
        return;
      }
      if (isStartingTimer) return;

      setIsStartingTimer(true);
      setBreastfeedPromptShown(false);
      setShowActivityMenu(false);
      const timer = await handleStartTimer("breastfeed", "L", confirmedChildcareOverride);
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

    setEditingActivity(null);
    setLogType(type);
    setShowLogModal(true);
    setShowActivityMenu(false);
  };

  const openCaretakerImport = (session: ChildcareSessionSummary | null = null) => {
    setShowActivityMenu(false);
    setShowLogModal(false);
    setEditingActivity(null);
    setEditingDose(null);
    setDeleteActivity(null);
    setMedicationEntry(null);
    setShowLeaveConfirm(false);
    setShowMilkHistoryChart(false);
    const latestPendingForToday = childcareMode.pendingSessions
      .filter((pendingSession) => pendingSession.pendingImport && sgtDateKeyForTimestamp(pendingSession.checkedInAt) === todayDateKey)
      .sort((left, right) => (right.checkedOutAt ?? right.checkedInAt) - (left.checkedOutAt ?? left.checkedInAt))[0] ?? null;
    setCaretakerImportSession(session ?? childcareMode.activeSession ?? latestPendingForToday);
    setShowCaretakerImport(true);
  };

  const mutateChildcareMode = async (
    action: "checkIn" | "checkOut" | "editCheckIn",
    recordedAt?: number,
    options: { expectedSessionId?: string; suppressImportPrompt?: boolean } = {},
  ): Promise<ChildcareModeCommandResponse | null> => {
    if (!baby?.id || childcareBusy) return null;
    const expectedSessionId = action === "checkOut" || action === "editCheckIn"
      ? options.expectedSessionId ?? childcareMode.activeSession?.id
      : undefined;
    let attempt = childcareCommandRef.current;
    if (
      !attempt ||
      attempt.action !== action ||
      (recordedAt !== undefined && attempt.at !== recordedAt) ||
      attempt.sessionId !== expectedSessionId
    ) {
      attempt = {
        action,
        requestId: crypto.randomUUID(),
        at: recordedAt ?? Date.now(),
        ...(expectedSessionId ? { sessionId: expectedSessionId } : {}),
        ...(action === "editCheckIn" ? { expectedCheckedInAt: childcareMode.activeSession?.checkedInAt } : {}),
      };
      childcareCommandRef.current = attempt;
    }
    if ((action === "checkOut" || action === "editCheckIn") && !attempt.sessionId) {
      childcareCommandRef.current = null;
      await fetchData({ refreshMilkHistory: false });
      return null;
    }
    if (
      action === "editCheckIn" &&
      (attempt.expectedCheckedInAt === undefined || attempt.sessionId !== childcareMode.activeSession?.id)
    ) {
      childcareCommandRef.current = null;
      await fetchData({ refreshMilkHistory: false });
      return null;
    }
    setChildcareBusy(true);
    setChildcareError(null);
    try {
      const response = await fetch("/api/childcare-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          babyId: baby.id,
          requestId: attempt.requestId,
          at: attempt.at,
          ...(action === "checkOut" || action === "editCheckIn" ? { sessionId: attempt.sessionId } : {}),
          ...(action === "editCheckIn" ? { expectedCheckedInAt: attempt.expectedCheckedInAt } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as Partial<ChildcareModeCommandResponse> & { error?: string };
      if (!response.ok || !payload.session) {
        const error = new Error(payload.error || "Could not update childcare status.");
        Object.assign(error, { status: response.status });
        throw error;
      }
      const result: ChildcareModeCommandResponse = {
        schemaReady: Boolean(payload.schemaReady),
        activeSession: payload.activeSession ?? null,
        pendingSessions: Array.isArray(payload.pendingSessions) ? payload.pendingSessions : [],
        historySessions: Array.isArray(payload.historySessions) ? payload.historySessions : [],
        session: payload.session,
        idempotent: Boolean(payload.idempotent),
      };
      setChildcareMode(result);
      childcareCommandRef.current = null;
      if (action === "checkOut" && !options.suppressImportPrompt && window.confirm("Childcare check-out saved. Import the childcare screenshot now?")) {
        openCaretakerImport(payload.session);
      }
      setActivityFilterRefresh((value) => value + 1);
      return result;
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      if (status != null && status >= 400 && status < 500) childcareCommandRef.current = null;
      setChildcareError(caught instanceof Error ? caught.message : "Could not update childcare status.");
      await fetchData({ refreshMilkHistory: false });
      return null;
    } finally {
      setChildcareBusy(false);
    }
  };


  const updateChildcareHistory = async (
    action: "editSession" | "dismissImport" | "removeSession",
    session: ChildcareSessionSummary,
    times?: { checkedInAt: number; checkedOutAt: number },
  ): Promise<boolean> => {
    if (!baby?.id || childcareBusy) return false;
    setChildcareBusy(true);
    setChildcareError(null);
    try {
      const response = await fetch("/api/childcare-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action, babyId: baby.id, sessionId: session.id,
          requestId: crypto.randomUUID(),
          expectedCheckedInAt: session.checkedInAt,
          expectedCheckedOutAt: session.checkedOutAt,
          ...times,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not update this childcare session.");
      setChildcareMode({
        schemaReady: Boolean(payload.schemaReady),
        activeSession: payload.activeSession ?? null,
        pendingSessions: Array.isArray(payload.pendingSessions) ? payload.pendingSessions : [],
        historySessions: Array.isArray(payload.historySessions) ? payload.historySessions : [],
      });
      setActivityFilterRefresh(value => value + 1);
      await fetchData({ refreshMilkHistory: false });
      return true;
    } catch (caught) {
      setChildcareError(caught instanceof Error ? caught.message : "Could not update this childcare session.");
      await fetchData({ refreshMilkHistory: false });
      return false;
    } finally {
      setChildcareBusy(false);
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

    const note = activity.type === "note" ? "" : activityNoteText(details);
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
      case "medication": {
        const name = activity.medicationDose?.medicationName
          ?? activity.historicalMedication?.medicationName
          ?? (typeof d.medicationName === "string" ? d.medicationName : "");
        const givenText = activity.medicationDose?.doseText
          ?? activity.historicalMedication?.doseText
          ?? (typeof d.doseText === "string" ? d.doseText : "");
        // Imported procedures group under the medication filter but are shown
        // as a procedure with no quantity (they carry no amount).
        if (activity.historicalMedication?.eventKind === "procedure") {
          return { title: name || "Procedure", subcategory: "Procedure", quantity: "" };
        }
        return { title: name || "Medication", subcategory: "Medication", quantity: givenText };
      }
      case "bankfreeze":
      case "bankthaw":
      case "bankdiscard": {
        const amount = Number(d.amount);
        const titles: Record<string, string> = {
          bankfreeze: "Milk frozen",
          bankthaw: "Milk thawed",
          bankdiscard: "Frozen milk discarded",
        };
        return {
          title: titles[activity.type],
          subcategory: d.source === "reconcile" ? "Breastmilk bank · reconciled" : "Breastmilk bank",
          quantity: Number.isFinite(amount) && amount > 0 ? `${amount} ml` : "",
        };
      }
      case "temperature": {
        const celsius = Number(d.celsius);
        const methods: Record<string, string> = {
          armpit: "Armpit",
          ear: "Ear",
          oral: "Oral",
          rectal: "Rectal",
          forehead: "Forehead",
          other: "Other",
        };
        return {
          title: "Temperature",
          subcategory: methods[String(d.method)] || "",
          quantity: Number.isFinite(celsius) ? `${celsius} °C` : "",
        };
      }
      case "note":
        return { title: activityNoteText(d) || "Note", subcategory: "", quantity: "" };
      case "sleep": {
        const timelineActivity = activity as TimelineActivity;
        if (timelineActivity.sleepEvent === "start") {
          return { title: "Sleep started", subcategory: "", quantity: "" };
        }
        if (timelineActivity.sleepEvent === "wake") {
          const source = timelineActivity.sourceActivity ?? activity;
          return {
            title: "Woke up",
            subcategory: `Slept ${formatTime(source.started_at)}–${formatTime(Number(source.ended_at))}`,
            quantity: formatElapsedDuration(Number(source.ended_at) - source.started_at) ?? "",
          };
        }
        return { title: "Sleep", subcategory: "", quantity: "" };
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
  const activeSickSummary = sickMode?.schemaReady && sickMode.activeEpisode ? sickMode.summary : null;
  const historicalMilkSummary = milkHistory.find((day) => day.date === activeMilkDate);
  const defaultSelectedMilkSummary: MilkDaySummary = isSelectedMilkToday
    ? { date: todayDateKey, totalMl: dailyMilkMl, breastmilkMl: dailyBreastmilkMl, formulaMl: dailyFormulaMl, expectedMl: expectedDailyMilkMl, asOfNowMl: dailyMilkMl }
    : historicalMilkSummary ?? { date: activeMilkDate, totalMl: 0, breastmilkMl: 0, formulaMl: 0, expectedMl: null, asOfNowMl: 0 };
  const selectedMilkSummary: MilkDaySummary = isSelectedMilkToday && activeSickSummary
    ? {
        ...defaultSelectedMilkSummary,
        totalMl: activeSickSummary.todayConsumedMl,
        breastmilkMl: activeSickSummary.todayBreastmilkMl,
        formulaMl: activeSickSummary.todayFormulaMl,
        asOfNowMl: activeSickSummary.todayConsumedMl,
      }
    : defaultSelectedMilkSummary;
  const selectedExpectedMilkMl = selectedMilkSummary.expectedMl;
  const milkProgress = selectedExpectedMilkMl
    ? Math.min(100, Math.round((selectedMilkSummary.totalMl / selectedExpectedMilkMl) * 100))
    : 0;
  // Whole percentages; when the day is only breastmilk + formula they add to 100.
  const breastmilkPercent = selectedMilkSummary.totalMl > 0
    ? Math.round(selectedMilkSummary.breastmilkMl / selectedMilkSummary.totalMl * 100)
    : 0;
  const formulaPercent = selectedMilkSummary.totalMl <= 0
    ? 0
    : selectedMilkSummary.breastmilkMl + selectedMilkSummary.formulaMl === selectedMilkSummary.totalMl
      ? 100 - breastmilkPercent
      : Math.round(selectedMilkSummary.formulaMl / selectedMilkSummary.totalMl * 100);
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

  // Normal mode uses the latest seven completed non-sick days with milk logs,
  // looking further back to skip sick and no-log days. Sick mode stays pinned to
  // the active episode's saved pre-onset source dates, even if its live summary
  // is temporarily unavailable or the comparison day changes.
  const activeMedianEpisode = sickMode?.schemaReady ? sickMode.activeEpisode : null;
  const medianReference = sameTimeMilkMedianReference(milkHistory, todayDateKey, activeMedianEpisode);
  const medianDataDays = medianReference.days;
  const asOfMedianMl = medianReference.medianMl;
  const medianDataDayCountLabel = medianDataDays.length < 7 && (activeMedianEpisode || medianDataDays.length > 0)
    ? ` (${medianDataDays.length} ${medianDataDays.length === 1 ? "day" : "days"})`
    : "";
  const medianInfoText = activeMedianEpisode
    ? "Uses the saved eligible days from the seven completed calendar days before sick mode began, comparing milk consumed by the current Singapore time on each day. These dates stay fixed for the episode. Recorded sick days and days without milk logs are excluded. Missing days reduce the count; no eligible days means unavailable."
    : "Uses the latest seven completed non-sick days with milk logs, comparing intake by the current Singapore time. Skips sick days and days without logs, looking further back in the available 180-day history. The count shows when fewer than seven qualify.";

  // Signed volume (ml) and % difference of today's intake vs a same-time
  // reference total (comparison day or the 7-day median). Both parts share the
  // same reference. Null when the reference is missing or zero, where a
  // percentage would be meaningless.
  const todayDelta = (referenceMl: number | null | undefined): { ml: string; pct: string } | null => {
    if (referenceMl == null || referenceMl <= 0) return null;
    const todayTotalMl = activeSickSummary?.todayConsumedMl ?? dailyMilkMl;
    const diffMl = Math.round((todayTotalMl - referenceMl) * 100) / 100;
    const normalizedDiffMl = diffMl === 0 ? 0 : diffMl; // normalize -0
    const pct = Math.round(((todayTotalMl - referenceMl) / referenceMl) * 100);
    return {
      ml: `${normalizedDiffMl > 0 ? "+" : ""}${normalizedDiffMl} ml`,
      pct: (pct > 0 ? "+" : "") + pct + "%",
    };
  };
  const comparisonDelta = todayDelta(comparisonMilkSummary?.asOfNowMl);
  const medianDelta = todayDelta(asOfMedianMl);
  const deltaBadgeClass = (delta: string) =>
    delta.startsWith("-")
      ? "bg-danger/10 text-danger"
      : delta === "0%"
        ? "bg-surface-muted text-muted"
        : "bg-success/10 text-success";

  const chartMilkDays = [
    ...milkHistory.filter((day) => day.date !== todayDateKey),
    activeSickSummary
      ? { date: todayDateKey, totalMl: activeSickSummary.todayConsumedMl, breastmilkMl: activeSickSummary.todayBreastmilkMl, formulaMl: activeSickSummary.todayFormulaMl, expectedMl: expectedDailyMilkMl, asOfNowMl: activeSickSummary.todayConsumedMl, isSickDay: true }
      : { date: todayDateKey, totalMl: dailyMilkMl, breastmilkMl: dailyBreastmilkMl, formulaMl: dailyFormulaMl, expectedMl: expectedDailyMilkMl, asOfNowMl: dailyMilkMl },
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(-MILK_CHART_WINDOW_DAYS);

  const asOfMilkDays = chartMilkDays.filter((day) => day.date <= todayDateKey);

  if (shouldHoldDashboardForSickMode(isLoading, baby?.id ?? null, sickModeLoadedBabyId)) {
    return (
      <main className="min-h-dvh bg-cream flex items-center justify-center">
        <p className="text-warm-brown-light">Loading…</p>
      </main>
    );
  }

  const renderHouseholdSettings = (closeMenu: () => void) => (
    <section aria-labelledby="household-settings-title" className="mt-5 space-y-3 border-t border-border pt-4">
      <h3 id="household-settings-title" className="text-sm font-semibold text-warm-brown">Household & settings</h3>
      <ThemePreferenceControl />
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2">
            <span className="min-w-0">
              <span className="block text-xs text-muted">Invite code</span>
              <span className="block font-mono text-base font-semibold tracking-wide text-accent-strong">{inviteCode}</span>
            </span>
            <span className="text-right text-xs text-muted">Share to add a<br />household member</span>
          </div>

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
              className={`inline-flex min-h-8 w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium transition-colors ${
                pushEnabled
                  ? "bg-success text-on-accent"
                  : "bg-surface border border-border text-warm-brown"
              } disabled:opacity-50`}
            >
              {pushEnabled ? <Bell aria-hidden="true" className="h-4 w-4" /> : <BellOff aria-hidden="true" className="h-4 w-4" />}
              <span>{pushLoading ? "Updating…" : pushEnabled ? "Notifications on" : "Enable notifications"}</span>
            </button>
          )}
          <button
            onClick={() => { closeMenu(); setShowLeaveConfirm(true); }}
            className="inline-flex min-h-8 items-center justify-center gap-2 w-full py-3 text-sm text-muted hover:text-danger transition-colors"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            Leave household
          </button>
    </section>
  );

  const childcareDimmed = Boolean(childcareMode.activeSession)
    && childcareBrowseSessionId !== childcareMode.activeSession?.id;

  return (
    <main
      data-care-overview={Boolean(sickMode?.activeEpisode)}
      data-childcare-active={Boolean(childcareMode.activeSession)}
      data-childcare-dimmed={childcareDimmed ? "true" : undefined}
      data-dashboard-refresh-blocked={refreshExplicitlyBlocked ? "true" : undefined}
      className="min-h-dvh bg-cream pb-[calc(8rem+env(safe-area-inset-bottom))]"
    >
      <header className="dashboard-header bg-surface border-b border-border px-4 py-2 sm:px-5 sm:py-3">
        <div className="dashboard-header-inner relative mx-auto max-w-lg">
          <button
            type="button"
            onClick={() => { void refreshDashboard(); }}
            disabled={refreshBlocked}
            aria-label="Refresh dashboard"
            aria-busy={refreshFeedback?.kind === "refreshing"}
            title={refreshBlocked && refreshFeedback?.kind !== "refreshing" ? "Close the active editor or dialog to refresh" : "Refresh dashboard"}
            className="dashboard-header-refresh absolute right-0 top-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-accent-strong shadow-sm transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent-strong/60 disabled:opacity-45"
          >
            <RotateCw aria-hidden="true" className={`h-4 w-4 ${refreshFeedback?.kind === "refreshing" ? "animate-spin motion-reduce:animate-none" : ""}`} />
          </button>
          <div className="dashboard-baby-identity pr-10">
              <BabyCareMenu
                name={baby?.name || "Baby"}
                active={Boolean(sickMode?.activeEpisode)}
                accessory={baby?.id && childcareMode.schemaReady && (
                <ChildcareHeaderMenu
                  key={baby.id}
                  babyName={baby.name || "Baby"}
                  activeSession={childcareMode.activeSession}
                  pendingSessions={childcareMode.pendingSessions}
                  historySessions={childcareMode.historySessions ?? []}
                  onEditSession={(session, times) => updateChildcareHistory("editSession", session, times)}
                  onDismissImport={(session) => updateChildcareHistory("dismissImport", session)}
                  onRemoveSession={(session) => updateChildcareHistory("removeSession", session)}
                  busy={childcareBusy}
                  error={childcareError}
                  onCheckIn={(at) => { void mutateChildcareMode("checkIn", at); }}
                  onCheckOut={(at) => { void mutateChildcareMode("checkOut", at); }}
                  onEditCheckIn={async (at) => Boolean(await mutateChildcareMode("editCheckIn", at))}
                  onImport={(session) => openCaretakerImport(session)}
                  importOpen={showCaretakerImport}
                />
              )}
                subtitle={
            <p className="baby-meta flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-warm-brown-light">
              {baby?.birth_date && <span>{formatAge(baby.birth_date)}</span>}
              {baby?.birth_date && <span aria-hidden="true" className="text-border">·</span>}
              <Link
                href="/weight"
                aria-label={latestWeight ? `Weight ${formatWeight(latestWeight)}, open weight details` : "Add a weight, open weight details"}
                className="-mx-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 font-semibold tabular-nums text-accent-strong underline decoration-terracotta/35 decoration-dotted underline-offset-4 transition-colors hover:bg-terracotta/10"
              >
                {latestWeight ? formatWeight(latestWeight) : "Add weight"}
                <LineChart aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
              {userName && <span aria-label={`Logging as ${userName}`} className="ml-1 border-l border-border pl-2 text-xs">{userName}</span>}
            </p>
                }
              >
                {(closeCareMenu) => <>{baby?.id && <SickModePanel key={baby.id} babyId={baby.id} data={sickMode} isStale={sickModeIsStale} display="controls" onAddMedication={(drafts, episodeId) => { const targetEpisodeId = episodeId ?? activeSickEpisodeId; if (targetEpisodeId) { closeCareMenu(); setMedicationEntry(medicationAddEntry(targetEpisodeId, drafts)); } }} onRefresh={async () => { await fetchSickMode(baby.id); await fetchMilkHistory(baby.id, false); setActivityFilterRefresh((value) => value + 1); }} />}{renderHouseholdSettings(closeCareMenu)}</>}
              </BabyCareMenu>
          </div>
        </div>
      </header>

      {!refreshFeedback && standalonePullEnabled && pullPhase !== "idle" && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed left-1/2 z-[70] -translate-x-1/2 rounded-full border border-border bg-surface/95 px-3 py-1.5 text-xs font-semibold text-warm-brown shadow-lg backdrop-blur transition-[transform,opacity] motion-reduce:transition-none"
          style={{
            top: "calc(env(safe-area-inset-top) + 0.5rem)",
            transform: `translate(-50%, ${Math.min(28, pullDistance * 0.24)}px)`,
          }}
        >
          <span className="inline-flex items-center gap-2">
            <RotateCw className={`h-3.5 w-3.5 text-accent-strong ${pullPhase === "ready" ? "rotate-180" : ""}`} />
            {pullPhase === "ready" ? "Release to refresh" : "Pull to refresh"}
          </span>
        </div>
      )}

      {refreshFeedback && (
        <div
          role={refreshFeedback.kind === "failure" || refreshFeedback.kind === "partial" ? "alert" : "status"}
          aria-live={refreshFeedback.kind === "failure" || refreshFeedback.kind === "partial" ? "assertive" : "polite"}
          className={`fixed left-1/2 z-[70] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur ${refreshFeedback.kind === "failure" || refreshFeedback.kind === "partial" ? "border-warning/35 bg-surface text-warning" : "border-border bg-surface/95 text-warm-brown"}`}
          style={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
        >
          <RotateCw aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-accent-strong ${refreshFeedback.kind === "refreshing" ? "animate-spin motion-reduce:animate-none" : ""}`} />
          <span>{refreshFeedback.message}</span>
          {(refreshFeedback.kind === "failure" || refreshFeedback.kind === "partial") && (
            <button
              type="button"
              onClick={() => { void refreshDashboard(); }}
              disabled={refreshBlocked}
              className="min-h-8 shrink-0 rounded-full bg-terracotta-dark px-3 text-xs font-semibold text-on-accent disabled:opacity-50"
            >
              Retry
            </button>
          )}
        </div>
      )}

      <div className="dashboard-overview max-w-lg mx-auto px-3 py-3 sm:px-5 sm:py-4 space-y-2">
        {childcareMode.activeSession && (
          <div className="childcare-dim-banner flex min-h-11 items-center justify-between gap-3 rounded-lg border border-terracotta/25 bg-terracotta/10 px-3 py-1.5">
            <p className="min-w-0 text-sm font-medium text-warm-brown">
              {baby?.name || "Baby"} is at childcare
            </p>
            <button
              type="button"
              onClick={() => setChildcareBrowseSessionId(childcareDimmed ? childcareMode.activeSession?.id ?? null : null)}
              aria-pressed={!childcareDimmed}
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-terracotta/30 bg-surface px-3 text-xs font-semibold text-accent-strong transition-colors hover:bg-surface-muted"
            >
              {childcareDimmed ? <Eye aria-hidden="true" className="h-3.5 w-3.5" /> : <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />}
              {childcareDimmed ? "Browse anyway" : "Grey out again"}
            </button>
          </div>
        )}
        <section data-sleep-state={sleepState.state} className={"sleep-status-card rounded-xl border p-2.5 shadow-sm transition-[background-color,border-color] duration-700 motion-reduce:transition-none"} aria-label="Sleep status">
          <SleepStateControl
            compact={Boolean(sickMode?.activeEpisode)}
            state={sleepState.state}
            since={sleepState.since}
            disabled={isChangingSleepState}
            onSelect={handleSleepTransition}
          />
          <DailyNapSummary sessions={sleepActivities} confirmedCoverage={confirmedSleepCoverages} trailingAction={sleepState.since != null && sleepState.activity && !isEditingSleepSince ? (
            <button type="button" onClick={startEditingSleepSince} aria-label={`Edit ${sleepState.state === "sleeping" ? "sleep start" : "awake start"} (${formatTime(sleepState.since)})`} title="Edit current state start time" className="flex h-8 w-8 items-center justify-center rounded-lg text-accent-strong hover:bg-surface/60"><Pencil aria-hidden="true" className="h-3.5 w-3.5" /></button>
          ) : undefined} />
          {sleepState.since != null && sleepState.activity && isEditingSleepSince && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-0 flex-1 text-xs text-muted">
                  {sleepState.state === "sleeping" ? "Sleep started" : "Awake since"}
                  <input
                    aria-label="Current state start time"
                    type="datetime-local"
                    value={sleepSinceInput}
                    onChange={(event) => setSleepSinceInput(event.target.value)}
                    className="mt-1 min-h-8 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-warm-brown outline-none focus:border-accent-strong"
                  />
                </label>
                <button type="button" onClick={saveSleepSince} disabled={isChangingSleepState} className="min-h-8 rounded-lg bg-terracotta-dark px-3 py-2 text-sm font-semibold text-on-accent disabled:opacity-60">Save</button>
                <button type="button" onClick={() => setIsEditingSleepSince(false)} className="min-h-8 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-warm-brown">Cancel</button>
              </div>
          )}
          {sleepState.since == null && (
            <p className="mt-2 text-xs text-muted">Awake time starts after the first recorded sleep.</p>
          )}
        </section>
        {baby?.id && (sickMode || sickModeIsStale) && (
          <SickModePanel
            babyId={baby.id}
            data={sickMode}
            isStale={sickModeIsStale}
            onLogActivity={type => { void handleActivityAction(type); }}
            onLogMedication={medicationId => {
              if (sickModeIsStale || !activeSickEpisodeId) return;
              const confirmed = childcareMode.activeSession ? confirmChildcareEntry() : false;
              if (childcareMode.activeSession && !confirmed) return;
              setChildcareOverride(confirmed);
              setShowActivityMenu(false);
              setEditingDose(null);
              setMedicationEntry(medicationLogEntry(activeSickEpisodeId, medicationId));
            }}
            onAddMedication={(drafts?: MedicationPrescriptionDraftInput[], episodeId?: string) => { const targetEpisodeId = episodeId ?? activeSickEpisodeId; if (targetEpisodeId) { setShowActivityMenu(false); setEditingDose(null); setMedicationEntry(medicationAddEntry(targetEpisodeId, drafts)); } }}
            onRefresh={async () => {
              await fetchSickMode(baby.id);
              await fetchData();
              setActivityFilterRefresh((value) => value + 1);
            }}
          />
        )}
        {/* Daily Milk Total */}
        <section className="milk-consumption-card rounded-lg border border-border bg-surface p-2.5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 aria-label={isSelectedMilkToday ? "Today’s milk consumption" : "Milk consumption"} className="glance-card-title text-accent-strong">
                {isSelectedMilkToday ? activeSickSummary ? "Today’s milk" : "Today’s milk consumption" : "Milk consumption"}
              </h2>
              {activeSickSummary && isSelectedMilkToday && <p className="care-milk-total glance-primary-value text-warm-brown">{selectedMilkSummary.totalMl} <span className="glance-value-unit text-muted">ml</span></p>}
              {!isSelectedMilkToday && (
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted">
                  <span>{selectedMilkDateLabel}</span>
                  {selectedMilkSummary.isSickDay === true && (
                    <span className="whitespace-nowrap rounded-full bg-frozen/15 px-1.5 py-0.5 font-medium text-frozen-strong">Sick day</span>
                  )}
                </p>
              )}
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
                className="flex h-8 w-8 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted"
              >
                <BarChart3 aria-hidden="true" className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => selectMilkDate(shiftMilkDate(activeMilkDate, -1))}
                disabled={!canGoToPreviousMilkDay}
                aria-label="Show previous day milk summary"
                title="Previous day"
                className="flex h-8 w-8 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
              >
                <ChevronLeft aria-hidden="true" className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => selectMilkDate(shiftMilkDate(activeMilkDate, 1))}
                disabled={!canGoToNextMilkDay}
                aria-label="Show next day milk summary"
                title="Next day"
                className="flex h-8 w-8 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
              >
                <ChevronRight aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
          </div>

          {!(activeSickSummary && isSelectedMilkToday) && <div className="milk-amounts mt-2 flex items-end justify-between gap-4">
            <div className="flex items-baseline gap-2">
              <span className="glance-primary-value text-warm-brown">
                {selectedMilkSummary.totalMl}
              </span>
              <span className="glance-value-unit text-warm-brown-light">ml</span>
            </div>
            <div className="border-l border-border pl-4 text-right">
              <p className="text-sm text-muted">{activeSickSummary && isSelectedMilkToday ? "Usual daily" : "Expected"}</p>
              <p className="font-display text-xl tabular-nums text-warm-brown">
                {selectedExpectedMilkMl ? selectedExpectedMilkMl + " ml" : "-- ml"}
              </p>
            </div>
          </div>}

          <p className="milk-breakdown mt-1 text-sm leading-snug text-muted">
            {selectedMilkSummary.breastmilkMl}ml breastmilk ({breastmilkPercent}%) + {selectedMilkSummary.formulaMl}ml formula ({formulaPercent}%){activeSickSummary && isSelectedMilkToday ? "" : " consumed"}
          </p>
          {activeSickSummary && isSelectedMilkToday && !activeSickSummary.todayFeedDataAvailable && (
            <p className="mt-1 text-xs font-medium text-muted">No consumed feeds logged yet today.</p>
          )}

          {activeSickSummary && isSelectedMilkToday && sickMode?.activeEpisode ? (
            <SickMilkProgress consumedMl={selectedMilkSummary.totalMl} baselineMl={sickMode.activeEpisode.baselineDailyMl} expectedMl={selectedExpectedMilkMl} baselineKind={sickMode.activeEpisode.baselineKind} />
          ) : <>
            <div className="milk-progress relative mt-3 h-2 rounded-full bg-cream">
              <div className="h-full rounded-full bg-terracotta transition-[width]" style={{ width: selectedExpectedMilkMl ? milkProgress + "%" : "0%" }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-muted"><span>Total for day</span><span>{selectedExpectedMilkMl ? milkProgress + "%" : "Target pending"}</span></div>
          </>}

          <div className="milk-comparison mt-2 flex items-center justify-between gap-3">
            <p className="min-w-0 text-left text-sm text-muted">
              <span className="text-base font-semibold tabular-nums text-warm-brown">{comparisonMilkSummary?.asOfNowMl ?? 0}ml</span>
              {comparisonDelta && (
                <span
                  title="Today vs this reference: volume and percent difference"
                  className={`ml-1.5 inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-xs font-semibold tabular-nums ${deltaBadgeClass(comparisonDelta.pct)}`}
                >
                  {comparisonDelta.ml} · {comparisonDelta.pct}
                </span>
              )}{" "}
              as of {milkHistoryCutoffLabel} {comparisonMilkDateLabel}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setAsOfDayOffset((value) => value - 1)}
                disabled={!canGoToPreviousComparisonDay}
                aria-label="Show same-time milk total for previous day"
                title="Previous comparison day"
                className="flex h-8 w-8 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setAsOfDayOffset((value) => Math.min(-1, value + 1))}
                disabled={!canGoToNextComparisonDay}
                aria-label="Show same-time milk total for next day"
                title="Next comparison day"
                className="flex h-8 w-8 items-center justify-center rounded-full text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="milk-median mt-1 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center">
              <p className="min-w-0 text-left text-sm text-muted">
                <span className="text-base font-semibold tabular-nums text-warm-brown">{asOfMedianMl == null ? "--" : asOfMedianMl}ml</span>
                {medianDelta && (
                  <span
                    title="Today vs this reference: volume and percent difference"
                    className={`ml-1.5 inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-xs font-semibold tabular-nums ${deltaBadgeClass(medianDelta.pct)}`}
                  >
                    {medianDelta.ml} · {medianDelta.pct}
                  </span>
                )}{" "}
                7-day median · same time{medianDataDayCountLabel}
              </p>
              <button
                type="button"
                aria-label="How the milk median is calculated"
                aria-expanded={showMedianInfo}
                aria-controls={medianInfoId}
                onClick={() => setShowMedianInfo((current) => !current)}
                className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface/60 hover:text-warm-brown focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong/60"
              >
                <Info aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <p
            id={medianInfoId}
            hidden={!showMedianInfo}
            className="rounded-lg bg-surface/55 px-3 py-2 text-xs leading-relaxed text-muted"
          >
            {medianInfoText}
          </p>

          <RecentBottleFeeds feeds={activeSickSummary?.latestFeeds?.map((feed) => ({ id: feed.id, startedAt: feed.startedAt, amountMl: feed.totalMl })) ?? recentMilkFeeds} />
        </section>
        {baby?.id && (
            <MilkBank
              standalone
              babyId={baby.id}
              availableMl={breastmilkLibraryMl}
              availableBatches={breastmilkBatches}
              frozenMl={frozenMilkMl}
              frozenPackets={frozenPackets}
              history={bankHistory}
              historyEditRequest={historyEditRequest}
              onChanged={async () => {
                await fetchData();
                setActivityFilterRefresh((value) => value + 1);
              }}
            />
        )}
        {/* Live Timer */}
        {activeTimer && (
          <div className="bg-surface rounded-lg border border-terracotta/30 p-4 shadow-sm">
            <LiveTimerStatus startedAt={Number(activeTimer.started_at)} />
            <div className="flex gap-2 mb-4">
              {["L", "R"].map((s) => (
                <button
                  key={s}
                  onClick={() => handleSwitchSide(s)}
                  className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors ${
                    activeTimer.current_side === s
                      ? "bg-terracotta-dark text-on-accent"
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
              className="min-h-8 w-full rounded-lg bg-success py-3 text-sm font-medium text-on-accent transition-colors hover:bg-warm-brown disabled:opacity-60"
            >
              {isStoppingTimer ? "Stopping & logging…" : "Stop & log"}
            </button>
          </div>
        )}

        {/* Recent activity */}
        <section>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h2 className="glance-card-title text-warm-brown-light">Recent activity</h2>
            <div className="flex items-center gap-1">
              {isActivityFiltered && (
                <button
                  type="button"
                  onClick={() => {
                    setActivityDateFilter("");
                    setActivityTypeFilters([]);
                    setShowHistory(false);
                    setSelectedMilkDate(todayDateKey);
                  }}
                  className="min-h-8 px-2 text-xs font-semibold text-accent-strong transition-colors hover:text-warm-brown"
                >
                  Clear
                </button>
              )}
              {baby?.id && (
                <a
                  href={`/api/activities/export?babyId=${encodeURIComponent(baby.id)}`}
                  download
                  aria-label="Export CSV"
                  title="Export CSV"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-accent-strong shadow-sm transition-colors hover:bg-terracotta/10"
                >
                  <Download aria-hidden="true" className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
          <div className="mb-2 flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
            <button
              type="button"
              onClick={() => shiftActivityDate(-1)}
              disabled={!canGoToPreviousActivityDay}
              aria-label="Show previous day activities"
              title="Previous day"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <div className="relative min-w-0 flex-1">
              <div className="flex h-8 w-full items-center justify-center truncate rounded-md bg-cream px-2 text-xs font-medium tabular-nums text-warm-brown">
                {showHistory && !activityDateFilter
                  ? "All days"
                  : effectiveActivityDate === todayDateKey ? "Today" : formatFilterDate(effectiveActivityDate)}
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
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-30"
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
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
              aria-pressed={showHistory && !activityDateFilter}
              className={`h-8 shrink-0 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold transition-colors ${showHistory && !activityDateFilter ? "bg-terracotta/15 text-accent-strong" : "text-muted hover:bg-surface-muted hover:text-accent-strong"}`}
            >
              All days
            </button>
            <details className="group relative shrink-0">
              <summary
                aria-label={`Activity type: ${activityTypeFilterLabel}`}
                title={activityTypeFilterLabel}
                className={`relative flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/30 [&::-webkit-details-marker]:hidden ${activityTypeFilters.length > 0 ? "bg-terracotta/15 text-accent-strong" : "text-muted hover:bg-surface-muted hover:text-accent-strong"}`}
              >
                <ListFilter aria-hidden="true" className="h-4 w-4" />
                {activityTypeFilters.length > 0 && (
                  <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-terracotta-dark px-1 text-[10px] font-semibold leading-none text-on-accent">
                    {activityTypeFilters.length}
                  </span>
                )}
              </summary>
              <fieldset className="absolute right-0 top-full z-30 mt-2 max-h-[60vh] w-[min(16rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
                <legend className="sr-only">Filter by activity type</legend>
                <label className="flex min-h-8 cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm font-medium text-warm-brown transition-colors hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={activityTypeFilters.length === 0}
                    onChange={(event) => handleActivityTypeFilterChange(event.currentTarget, null)}
                    className="h-4 w-4 accent-terracotta-dark"
                  />
                  All activity types
                </label>
                {activityTypeOptions.map((option) => (
                  <label key={option.value} className="flex min-h-8 cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm text-warm-brown transition-colors last:border-b-0 hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      checked={activityTypeFilters.includes(option.value)}
                      onChange={(event) => handleActivityTypeFilterChange(event.currentTarget, option.value)}
                      className="h-4 w-4 accent-terracotta-dark"
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
            </details>
          </div>
          {activityTypeFilters.length > 0 && (
            <p className="-mt-1 mb-2 truncate px-1 text-[11px] text-muted">Showing {activityTypeFilterLabel}</p>
          )}
          <div>
            {(() => {
              const dateFilter = activityDateFilter || (!showHistory ? todayDateKey : "");
              const visible: TimelineActivity[] = filteredActivities.flatMap((activity) => {
                if (activity.type !== "sleep") return [activity];
                const events: TimelineActivity[] = [{ ...activity, id: `${activity.id}:start`, sleepEvent: "start", sourceActivity: activity }];
                if (activity.ended_at != null) {
                  events.push({ ...activity, id: `${activity.id}:wake`, started_at: activity.ended_at, sleepEvent: "wake", sourceActivity: activity });
                }
                return events;
              }).filter((activity) => !dateFilter || new Date(activity.started_at).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }) === dateFilter)
                .sort((a, b) => b.started_at - a.started_at);
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
                      <p className="pb-0.5 pt-2 text-xs font-medium text-muted first:pt-0">
                        {dateLabel}
                      </p>
                    )}
                    {showHourHeader && (
                      <p className="pb-0.5 pt-1 font-display text-sm font-semibold tabular-nums text-accent-strong">
                        {hourKey}
                      </p>
                    )}
                    <ActivityTimelineCard
                      icon={ActivityIcon}
                      title={display.title}
                      when={formatTime(activity.started_at)}
                      elapsed={timeSince(activity.started_at)}
                      subcategory={display.subcategory || undefined}
                      quantity={display.quantity || undefined}
                      comment={comment || undefined}
                      createdBy={activity.created_by || undefined}
                      multiline={activity.type === "note"}
                      readOnly={Boolean(activity.careBoundary)}
                      onEdit={() => {
                        // Virtual caretaker care markers are display-only and
                        // must never open the generic activity editor.
                        if (activity.careBoundary) return;
                        const record = activity.sourceActivity ?? activity;
                        if (record.type === "medication") {
                          setShowLogModal(false);
                          setEditingActivity(null);
                          setMedicationEntry(null);
                          setEditingDose(null);
                          // A record without its canonical or historical source
                          // reference cannot be safely edited; fail closed
                          // instead of routing it through the generic editor.
                          if (!record.medicationDose && !record.historicalMedication) {
                            alert("This medication activity is missing its source details and can’t be edited here. Refresh and try again.");
                            return;
                          }
                          setEditingDose(record);
                          return;
                        }
                        if (BANK_TRANSFER_TYPES.has(record.type)) {
                          setShowLogModal(false);
                          setEditingActivity(null);
                          setMedicationEntry(null);
                          setEditingDose(null);
                          setHistoryEditRequest((current) => ({ id: record.id, nonce: (current?.nonce ?? 0) + 1 }));
                          return;
                        }
                        setEditingDose(null);
                        setMedicationEntry(null);
                        setEditingActivity(record);
                        setLogType(record.type);
                        setShowLogModal(true);
                      }}
                    />
                  </div>
                );
              });
            })()}
            {!isActivityFiltered && (activities.length > 0 || filteredActivities.length > 0) && !showHistory && (
              <button
                onClick={() => setShowHistory(true)}
                className="w-full py-2 text-sm text-accent-strong transition-colors hover:text-warm-brown"
              >
                View all activities
              </button>
            )}
          </div>
        </section>

      </div>

      {/* Floating Add Activity Menu */}
      <div className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-40 flex flex-col items-end gap-3">
        {showActivityMenu && (
          <div className="activity-picker flex max-h-[calc(100dvh-7rem)] w-[min(320px,calc(100vw-2.5rem))] flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-xl">
            <button
              type="button"
              onClick={() => openCaretakerImport(null)}
              className="mb-1 flex min-h-11 w-full shrink-0 items-center justify-between gap-3 rounded-lg border border-terracotta/25 bg-terracotta/10 px-3 py-2 text-left text-warm-brown transition-colors hover:bg-terracotta/15"
            >
              <span className="flex min-w-0 items-center gap-3">
                <ImageUp aria-hidden="true" className="h-5 w-5 shrink-0 text-accent-strong" />
                <span className="text-sm font-semibold">Import caretaker screenshot</span>
              </span>
              <span className="shrink-0 text-xs text-muted">Review first</span>
            </button>
            {activityActionTypes.map((type) => {
              const last = getLastActivity(type);
              const overdue = isOverdue(type);
              const isBreastfeeding = activeTimer?.type === "breastfeed";
              const isBreastfeed = type === "breastfeed";
              const label = type === "bottlefeed" ? "Bottlefeed" : type === "vomit" ? "Vomit" : type.charAt(0).toUpperCase() + type.slice(1);
              const ActivityIcon = activityIcons[type] ?? BabyIcon;
              const statusMeta = isBreastfeed && isStartingTimer
                ? "Starting…"
                : isBreastfeed && isBreastfeeding
                ? "Feeding…"
                : isBreastfeed && !activeTimer && breastfeedPromptShown
                ? "Tap again to start"
                : last
                ? null
                : type === "medication" ? "Record amount given" : "No entries yet";

              return (
                <button
                  key={type}
                  onClick={() => handleActivityAction(type)}
                  disabled={(isBreastfeed && isStartingTimer) || (type === "medication" && sickModeIsStale)}
                  className={"flex min-h-9 w-full shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors " + (overdue ? "bg-terracotta-dark text-on-accent" : "hover:bg-cream text-warm-brown") + (childcareMode.activeSession ? " opacity-55" : "") + " disabled:opacity-60"}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <ActivityIcon aria-hidden="true" className="h-5 w-5 shrink-0" />
                    <span className="text-sm font-medium">{label}</span>
                  </span>
                  {statusMeta ? (
                    <span className={"shrink-0 text-xs tabular-nums " + (overdue ? "text-on-accent" : "text-muted")}>{statusMeta}</span>
                  ) : last ? (
                    <ActivityRecency startedAt={last.started_at} overdue={overdue} />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
        <button
          onClick={() => setShowActivityMenu((value) => !value)}
          aria-label={showActivityMenu ? "Close activity menu" : "Add activity"}
          aria-expanded={showActivityMenu}
          className={"flex h-12 w-12 items-center justify-center rounded-full bg-terracotta-dark text-on-accent shadow-lg transition-colors hover:bg-warm-brown " + (childcareMode.activeSession ? "opacity-55" : "")}
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
                className="min-h-11 rounded-lg bg-danger px-4 py-3 text-sm font-semibold text-on-accent transition-colors hover:bg-warm-brown disabled:opacity-50"
              >
                {isLeaving ? "Leaving…" : "Leave"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCaretakerImport && baby?.id && (
        <CaretakerImportModal
          babyId={baby.id}
          babyName={baby.name || "Baby"}
          childcareSession={caretakerImportSession}
          onFinishChildcare={async (session, checkedOutAt) => {
            const result = await mutateChildcareMode("checkOut", checkedOutAt, {
              expectedSessionId: session.id,
              suppressImportPrompt: true,
            });
            return result?.session ?? null;
          }}
          onClose={() => { setShowCaretakerImport(false); setCaretakerImportSession(null); }}
          onImported={async () => {
            await Promise.all([
              fetchData({ refreshMilkHistory: false }),
              fetchFilteredActivities({ showLoading: true }),
              fetchMilkHistory(baby.id, false),
              fetchSickMode(baby.id),
            ]);
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteActivity && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-warm-brown/55 px-4 pb-4 sm:items-center sm:pb-0" role="dialog" aria-modal="true" aria-labelledby="delete-activity-title">
          <div className="w-full max-w-sm rounded-lg bg-surface p-5 shadow-xl">
            <h2 id="delete-activity-title" className="font-display text-xl text-warm-brown">Delete activity?</h2>
            <p className="mt-2 text-sm text-warm-brown-light">
              {getActivityDeleteDescription(deleteActivity)} will be permanently removed.
            </p>
            {BANK_TRANSFER_TYPES.has(deleteActivity.type) && (
              <p className="mt-2 text-sm text-warm-brown-light">Available and Frozen totals will be recalculated from the remaining bank history.</p>
            )}
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
                className="min-h-11 flex-1 rounded-lg bg-danger py-3 text-sm font-medium text-on-accent disabled:opacity-50"
              >
                {isDeletingActivity ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {medicationEntry?.kind === "log" && baby?.id && sickModeActive && sickMode?.activeEpisode && medicationEntry.episodeId === sickMode.activeEpisode.id && (
        <MedicationLogModal
          key={`${baby.id}:${sickMode.activeEpisode.id}`}
          babyId={baby.id}
          episodeId={sickMode.activeEpisode.id}
          episodeStartedAt={sickMode.activeEpisode.startedAt}
          medications={sickMode.medications}
          initialMedicationId={medicationEntry.medicationId}
          childcareOverride={childcareOverride}
          isStale={sickModeIsStale}
          onClose={() => { setMedicationEntry(null); setChildcareOverride(false); }}
          onRefresh={async () => {
            await fetchSickMode(baby.id);
            setActivityFilterRefresh((value) => value + 1);
          }}
        />
      )}

      {editingDose && (editingDose.medicationDose || editingDose.historicalMedication) && baby?.id && (
        <MedicationDoseEditModal
          key={`${baby.id}:${editingDose.id}:${editingDose.medicationDose?.doseId ?? editingDose.historicalMedication?.revision ?? ""}`}
          babyId={baby.id}
          activity={{
            id: editingDose.id,
            type: editingDose.type,
            started_at: editingDose.started_at,
            ...(editingDose.medicationDose ? { medicationDose: editingDose.medicationDose } : {}),
            ...(editingDose.historicalMedication ? { historicalMedication: editingDose.historicalMedication } : {}),
          }}
          onClose={() => setEditingDose(null)}
          onDelete={() => {
            const target = editingDose;
            setEditingDose(null);
            setDeleteActivity(target);
          }}
          onRefresh={async () => {
            await fetchSickMode(baby.id);
            await fetchData();
            setActivityFilterRefresh((value) => value + 1);
          }}
        />
      )}

      {medicationEntry?.kind === "add" && baby?.id && sickModeActive && sickMode?.activeEpisode && medicationEntry.episodeId === sickMode.activeEpisode.id && (
        <MedicationPrescriptionModal
          key={`${baby.id}:${sickMode.activeEpisode.id}`}
          babyId={baby.id}
          episodeId={sickMode.activeEpisode.id}
          suggestions={sickMode.medicationSuggestions}
          initialDrafts={medicationEntry.initialDrafts}
          isStale={sickModeIsStale}
          onClose={() => setMedicationEntry(null)}
          onRefresh={async () => { await fetchSickMode(baby.id); }}
        />
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
          childcareOverride={childcareOverride}
          onClose={() => {
            setShowLogModal(false);
            setEditingActivity(null);
            setChildcareOverride(false);
          }}
          onDelete={editingActivity ? () => {
            const target = editingActivity;
            setShowLogModal(false);
            setEditingActivity(null);
            setChildcareOverride(false);
            setDeleteActivity(target);
          } : undefined}
          onSuccess={(saved) => {
            const previous = editingActivity
              ? {
                  id: editingActivity.id,
                  type: editingActivity.type,
                  startedAt: editingActivity.started_at,
                  details: editingActivity.details,
                }
              : null;
            const next = {
              id: saved.id,
              type: saved.type,
              startedAt: saved.startedAt,
              details: saved.details,
            };
            const todayTotals = applyMilkActivityChangeToTotals(
              dailyMilkTotalsRef.current,
              previous,
              next,
              todayDateKey,
            );
            dailyMilkTotalsRef.current = todayTotals;
            setDailyMilkMl(todayTotals.totalMl);
            setDailyBreastmilkMl(todayTotals.breastmilkMl);
            setDailyFormulaMl(todayTotals.formulaMl);
            const previousId = previous?.id ?? null;
            setRecentMilkFeeds((current) => updateRecentMilkFeedList(current, previousId, next));
            setSickMode((current) => {
              if (!current?.summary || current.summary.date !== todayDateKey) return current;
              const summaryTotals = applyMilkActivityChangeToTotals(
                {
                  totalMl: current.summary.todayConsumedMl,
                  breastmilkMl: current.summary.todayBreastmilkMl,
                  formulaMl: current.summary.todayFormulaMl,
                },
                previous,
                next,
                todayDateKey,
              );
              return {
                ...current,
                summary: {
                  ...current.summary,
                  todayConsumedMl: summaryTotals.totalMl,
                  todayBreastmilkMl: summaryTotals.breastmilkMl,
                  todayFormulaMl: summaryTotals.formulaMl,
                  todayFeedDataAvailable: summaryTotals.totalMl > 0,
                  latestFeeds: updateSickLatestMilkFeeds(current.summary.latestFeeds, previousId, next),
                },
              };
            });
            setShowLogModal(false);
            setEditingActivity(null);
            setChildcareOverride(false);
            void fetchData();
            if (baby?.id) void fetchSickMode(baby.id);
            setActivityFilterRefresh((value) => value + 1);
          }}
        />
      )}

      {(sleepUndo || sleepNotice) && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-3 rounded-2xl bg-warm-brown px-4 py-3 text-sm text-on-accent shadow-xl"
        >
          <span>{sleepUndo?.message ?? sleepNotice}</span>
          {sleepUndo && (
            <button
              type="button"
              onClick={handleUndoSleep}
              disabled={isChangingSleepState}
              className="min-h-11 shrink-0 rounded-xl bg-surface/15 px-4 font-semibold text-on-accent transition-colors hover:bg-surface/25 disabled:opacity-50"
            >
              Undo
            </button>
          )}
          {!sleepUndo && (
            <button
              type="button"
              onClick={() => setSleepNotice(null)}
              aria-label="Dismiss sleep message"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-on-accent/80 hover:bg-surface/10"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>
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
  childcareOverride,
  onClose,
  onDelete,
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
  childcareOverride: boolean;
  onClose: () => void;
  /** Present when editing: hands the entry to the shared delete confirmation. */
  onDelete?: () => void;
  onSuccess: (saved: { id: string; type: string; startedAt: number; details: Record<string, unknown> }) => void;
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
  const initialEndSGT = getSGTParts(isEditing && activity?.ended_at ? activity.ended_at : undefined);
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
  const [temperature, setTemperature] = useState(
    isEditing && detailsObj.celsius != null ? String(detailsObj.celsius) : ""
  );
  const [temperatureMethod, setTemperatureMethod] = useState(
    isEditing && detailsObj.method ? String(detailsObj.method) : ""
  );
  const [isLoading, setIsLoading] = useState(false);

  // Custom time picker state (hour/minute as numbers, 24h)
  const [customHour, setCustomHour] = useState(initialSGT.h);
  const [customMinute, setCustomMinute] = useState(initialSGT.m);
  const [customDate, setCustomDate] = useState(initialSGT.date);
  const [endDate, setEndDate] = useState(initialEndSGT.date);
  const [endHour, setEndHour] = useState(initialEndSGT.h);
  const [endMinute, setEndMinute] = useState(initialEndSGT.m);
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
  const temperatureValue = Number(temperature);
  const temperatureIsInvalid = type === "temperature" && (
    !Number.isFinite(temperatureValue) || temperatureValue < 30 || temperatureValue > 45
  );
  const noteIsInvalid = type === "note" && !notes.trim();
  const pumpAgeLabel = (timestamp: number | null) => {
    if (!timestamp) return "";
    return formatElapsedSince(timestamp) ?? "";
  };
  const lastPumpHint = !isEditing && type === "pump" && lastPumpedMl > 0
    ? "Last pump: " + Math.round(lastPumpedMl) + " ml" + (lastPumpedAt ? " · " + pumpAgeLabel(lastPumpedAt) : "")
    : "Enter amount in ml";

  const handleSubmit = async () => {
    if (bottlefeedHasInvalidAmount || pumpHasInvalidAmount) {
      alert("Enter a valid amount, such as 90 or 90-50.");
      return;
    }
    if (noteIsInvalid) {
      alert("Enter a note.");
      return;
    }
    if (temperatureIsInvalid) {
      alert("Enter a temperature between 30 and 45 °C.");
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
    if ((type === "note" || type === "temperature") && startedAt > Date.now() + 2 * 60 * 1000) {
      alert("Time cannot be in the future.");
      setIsLoading(false);
      return;
    }

    let endedAt: number | null | undefined;
    if (type === "sleep" && isEditing) {
      endedAt = activity?.ended_at == null
        ? null
        : Date.parse(endDate + "T" + pad2(endHour) + ":" + pad2(endMinute) + ":00+08:00");
      if (endedAt != null && (!Number.isFinite(endedAt) || endedAt < startedAt)) {
        alert("Wake time must be after sleep time.");
        setIsLoading(false);
        return;
      }
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
    } else if (type === "temperature") {
      details.celsius = temperatureValue;
      details.method = temperatureMethod || null;
    }
    details.notes = notes.trim() || null;

    try {
      const activityPayload = {
          ...(isEditing && activity ? { id: activity.id } : { userId }),
          babyId,
          type,
          startedAt,
          ...(type === "sleep" && isEditing ? { endedAt } : {}),
          details,
          ...(!isEditing && childcareOverride ? { childcareOverride: true } : {}),
      };
      const res = await fetchWithChildcareConfirmation("/api/activities", {
        method: isEditing && activity ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activityPayload),
      }, () => window.confirm("This child is currently checked in to childcare. Add this activity anyway?"));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save activity");
      }

      const saved = await res.json().catch(() => ({})) as { id?: unknown };
      onSuccess({
        id: isEditing && activity ? activity.id : String(saved.id ?? ""),
        type,
        startedAt,
        details,
      });
    } catch (error) {
      if (error instanceof ChildcareConfirmationDeclinedError) return;
      console.error("Log error:", error);
      alert(error instanceof Error ? error.message : "Could not save activity. Try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const whenOptions = [
    { label: "Now", value: "now" },
    { label: "0h 5m ago", value: "5m" },
    { label: "0h 15m ago", value: "15m" },
    { label: "0h 30m ago", value: "30m" },
    { label: "1h 0m ago", value: "1h" },
    { label: "2h 0m ago", value: "2h" },
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
                      ? "bg-terracotta-dark text-on-accent"
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

          {type === "sleep" && isEditing && activity?.ended_at != null && (
            <div>
              <label className="mb-2 block text-sm font-medium text-warm-brown-light">Wake time</label>
              <div className="space-y-3">
                <input
                  aria-label="Sleep end date"
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="w-full rounded-lg border border-border px-4 py-3 outline-none focus:border-accent-strong"
                />
                <div className="flex items-center gap-3">
                  <select
                    aria-label="Sleep end hour"
                    value={endHour}
                    onChange={(event) => setEndHour(Number(event.target.value))}
                    className="flex-1 rounded-lg border border-border bg-surface px-4 py-3 text-center text-lg tabular-nums outline-none focus:border-accent-strong"
                  >
                    {hourOptions.map((hour) => <option key={hour} value={hour}>{pad2(hour)}</option>)}
                  </select>
                  <span className="text-2xl text-warm-brown-light">:</span>
                  <select
                    aria-label="Sleep end minute"
                    value={endMinute}
                    onChange={(event) => setEndMinute(Number(event.target.value))}
                    className="flex-1 rounded-lg border border-border bg-surface px-4 py-3 text-center text-lg tabular-nums outline-none focus:border-accent-strong"
                  >
                    {minuteOptions.map((minute) => <option key={minute} value={minute}>{pad2(minute)}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

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
                            ? "bg-terracotta-dark text-on-accent"
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
                              ? "bg-terracotta-dark text-on-accent"
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
                          ? "bg-terracotta-dark text-on-accent"
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
                        ? "bg-terracotta-dark text-on-accent"
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
                          ? "bg-terracotta-dark text-on-accent"
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
                        ? "bg-terracotta-dark text-on-accent"
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
                          ? "bg-terracotta-dark text-on-accent"
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
                        ? "bg-terracotta-dark text-on-accent"
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
                        ? "bg-terracotta-dark text-on-accent"
                        : "bg-surface border border-border"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {type === "temperature" && (
            <div className="space-y-4">
              <div>
                <label htmlFor="temperature-celsius" className="block text-sm font-medium text-warm-brown-light mb-2">
                  Temperature (°C)
                </label>
                <input
                  id="temperature-celsius"
                  type="number"
                  inputMode="decimal"
                  min="30"
                  max="45"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  placeholder="37.0"
                  className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-warm-brown outline-none focus:border-accent-strong"
                />
                {temperature !== "" && temperatureIsInvalid && (
                  <p className="mt-1.5 text-xs font-medium text-danger">Enter a reading between 30 and 45 °C.</p>
                )}
              </div>
              <div>
                <label htmlFor="temperature-method" className="block text-sm font-medium text-warm-brown-light mb-2">
                  Measurement method (optional)
                </label>
                <select
                  id="temperature-method"
                  value={temperatureMethod}
                  onChange={(e) => setTemperatureMethod(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-warm-brown outline-none focus:border-accent-strong"
                >
                  <option value="">Not specified</option>
                  <option value="armpit">Armpit</option>
                  <option value="ear">Ear</option>
                  <option value="oral">Oral</option>
                  <option value="rectal">Rectal</option>
                  <option value="forehead">Forehead</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="activity-notes" className="block text-sm font-medium text-warm-brown-light mb-2">
              {type === "note" ? "Note" : "Notes"}
            </label>
            <textarea
              id="activity-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={type === "note" ? "What happened?" : "Add a note (optional)"}
              className="w-full resize-none rounded-lg border border-border bg-surface px-4 py-3 text-sm text-warm-brown outline-none transition-colors focus:border-accent-strong"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={isLoading || bottlefeedBreastmilkOverLimit || bottlefeedHasInvalidAmount || pumpHasInvalidAmount || noteIsInvalid || temperatureIsInvalid}
            className="w-full py-4 bg-terracotta-dark text-on-accent font-medium rounded-lg text-lg hover:bg-warm-brown transition-colors disabled:opacity-50"
          >
            {isLoading ? "Saving…" : isEditing ? "Save changes" : "Log activity"}
          </button>
          {isEditing && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={isLoading}
              className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Delete activity
            </button>
          )}
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
    <div data-dashboard-refresh-blocked="true" className="bg-surface p-4 rounded-lg border border-terracotta/30 space-y-2">
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
          className="min-h-11 flex-1 py-2 rounded-lg text-sm bg-terracotta-dark text-on-accent font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
