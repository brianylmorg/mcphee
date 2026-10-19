"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Baby, Check, ImageUp, LogIn, LogOut, Pencil, Trash2 } from "lucide-react";
import type { ChildcareSessionSummary } from "@/lib/childcare-mode-contract";

export interface ChildcareSessionTimes {
  checkedInAt: number;
  checkedOutAt: number;
}

export interface ChildcareModePanelProps {
  babyName: string;
  activeSession: ChildcareSessionSummary | null;
  pendingSessions: ChildcareSessionSummary[];
  busy: boolean;
  error: string | null;
  onCheckIn: (at?: number) => void;
  onCheckOut: (at?: number) => void;
  /** Clock for the missed check-out check; defaults to now. */
  now?: number;
  /** Required: the parent persists the edited start time and resolves true only on success. */
  onEditCheckIn: (at: number) => Promise<boolean>;
  onImport: (session: ChildcareSessionSummary) => void;
  /**
   * Closed sessions the server reports: screenshot pending, imported or
   * dismissed. Merged with pendingSessions and de-duplicated by id.
   */
  historySessions?: ChildcareSessionSummary[];
  /** Persists corrected attendance times; resolves true only on success. */
  onEditSession?: (
    session: ChildcareSessionSummary,
    times: ChildcareSessionTimes,
  ) => Promise<boolean>;
  /** Discards a pending screenshot draft; already imported activities stay untouched. */
  onDismissImport?: (session: ChildcareSessionSummary) => Promise<boolean>;
  /** Removes a session recorded by mistake; only ever offered for unimported sessions. */
  onRemoveSession?: (session: ChildcareSessionSummary) => Promise<boolean>;
}

const SG_TIME_ZONE = "Asia/Singapore";

/** Singapore runs on UTC+08:00 all year, so a wall-clock time has a fixed offset. */
const SG_UTC_OFFSET = "+08:00";

const sgDateFormatter = new Intl.DateTimeFormat("en-SG", {
  timeZone: SG_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const sgTimeFormatter = new Intl.DateTimeFormat("en-SG", {
  timeZone: SG_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatSgDate(timestamp: number): string {
  return sgDateFormatter.format(new Date(timestamp));
}

function formatSgTime(timestamp: number): string {
  return sgTimeFormatter.format(new Date(timestamp));
}

function isSameSgDay(first: number, second: number): boolean {
  return formatSgDate(first) === formatSgDate(second);
}

const sgDateTimeFormatter = new Intl.DateTimeFormat("en-SG", {
  timeZone: SG_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DATE_TIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Singapore wall-clock moment, as a datetime-local value. */
function toSgDateTimeLocal(timestamp: number): string {
  const parts = sgDateTimeFormatter.formatToParts(new Date(timestamp));
  const read = (type: "year" | "month" | "day" | "hour" | "minute"): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return read("year") + "-" + read("month") + "-" + read("day") + "T" + read("hour") + ":" + read("minute");
}

/**
 * Parses a datetime-local value as a Singapore wall-clock time (UTC+08:00),
 * independent of the browser's own time zone. Returns null for anything that is
 * not a real calendar instant; the round-trip guard rejects 30 Feb or 25:00.
 */
function parseSgDateTimeLocal(value: string): number | null {
  const match = DATE_TIME_LOCAL_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, year = "", month = "", day = "", hour = "", minute = "", second = "00"] = match;
  const wallClock = year + "-" + month + "-" + day + "T" + hour + ":" + minute;
  const parsed = Date.parse(wallClock + ":" + second + SG_UTC_OFFSET);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  if (toSgDateTimeLocal(parsed) !== wallClock) return null;
  return parsed;
}

/**
 * Singapore window between two instants, e.g. "09:15 - 17:30", or with the end
 * date spelled out when the window crosses midnight:
 * "23:40 - 17 Oct 2026, 06:15".
 */
function formatSgWindow(startedAt: number, endedAt: number): string {
  const startTime = formatSgTime(startedAt);
  const endTime = formatSgTime(endedAt);
  if (isSameSgDay(startedAt, endedAt)) {
    return startTime + " - " + endTime;
  }
  return startTime + " - " + formatSgDate(endedAt) + ", " + endTime;
}

/** Care window recorded for a session, e.g. "09:15 - 17:30". */
function formatCareWindow(session: ChildcareSessionSummary): string {
  if (session.checkedOutAt == null) {
    return formatSgTime(session.checkedInAt) + " - in care";
  }
  return formatSgWindow(session.checkedInAt, session.checkedOutAt);
}

type SessionImportStatus = "imported" | "pending" | "none";

const SESSION_STATUS_LABEL: Record<SessionImportStatus, string> = {
  imported: "Imported",
  pending: "Screenshot pending",
  none: "No import needed",
};

const SESSION_STATUS_TEXT_CLASS: Record<SessionImportStatus, string> = {
  imported: "text-success",
  pending: "text-accent-strong",
  none: "text-muted",
};

const primaryButtonClass =
  "inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-terracotta/50 bg-terracotta/10 px-3 py-1.5 text-sm font-semibold text-accent-strong transition-colors hover:bg-terracotta/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-terracotta/10";

const secondaryButtonClass =
  "inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-warm-brown transition-colors hover:border-terracotta/30 hover:text-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:text-warm-brown";

const compactSecondaryButtonClass =
  "inline-flex min-h-6 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-warm-brown transition-colors hover:border-terracotta/30 hover:text-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:text-warm-brown";

const compactDangerButtonClass =
  "inline-flex min-h-6 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-danger/30 bg-danger/5 px-2 py-0.5 text-xs font-medium text-danger transition-colors hover:border-danger/50 hover:bg-danger/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-danger/5";

const dateTimeInputClass =
  "mt-1 w-full min-w-0 max-w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm tabular-nums text-warm-brown focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40";

export interface ChildcareTimesEditorProps {
  /** Imported sessions run the attendance-metadata-only note. */
  isImported: boolean;
  startValue: string;
  endValue: string;
  maxValue?: string;
  error: string | null;
  disabled?: boolean;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * Labelled start/end attendance editor for one closed session. Presentational:
 * the panel owns the draft values, the validation and the save promise.
 */
export function ChildcareTimesEditor({
  isImported,
  startValue,
  endValue,
  maxValue,
  error,
  disabled = false,
  onStartChange,
  onEndChange,
  onSave,
  onCancel,
}: ChildcareTimesEditorProps) {
  return (
    <div className="mt-2 min-w-0 rounded-lg border border-border bg-surface-muted p-2.5">
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor="childcare-history-start" className="text-xs font-medium text-warm-brown">
            Start time (Singapore)
          </label>
          <input
            id="childcare-history-start"
            type="datetime-local"
            value={startValue}
            onChange={(event) => onStartChange(event.target.value)}
            disabled={disabled}
            max={maxValue}
            className={dateTimeInputClass}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="childcare-history-end" className="text-xs font-medium text-warm-brown">
            End time (Singapore)
          </label>
          <input
            id="childcare-history-end"
            type="datetime-local"
            value={endValue}
            onChange={(event) => onEndChange(event.target.value)}
            disabled={disabled}
            max={maxValue}
            className={dateTimeInputClass}
          />
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        {isImported
          ? "Changes check-in and check-out times only. Imported activities stay unchanged."
          : "Updates the recorded care window for this session."}
      </p>
      {error && (
        <p role="alert" className="mt-1 break-words text-xs text-danger">
          {error}
        </p>
      )}
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" onClick={onSave} disabled={disabled} className={primaryButtonClass}>
          Save times
        </button>
        <button type="button" onClick={onCancel} disabled={disabled} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export type SessionTimesValidation =
  | { ok: true; startedAt: number; endedAt: number }
  | { ok: false; message: string };

/**
 * Local attendance-window validation: a real Singapore start, a real Singapore
 * end, end after start and end no later than now. Overlap rules and
 * concurrent-edit protection stay on the server.
 */
export function validateSessionTimes(
  startValue: string,
  endValue: string,
  now: number = Date.now(),
): SessionTimesValidation {
  const startedAt = parseSgDateTimeLocal(startValue);
  if (startedAt == null || startedAt <= 0) {
    return { ok: false, message: "Enter a valid start time (Singapore)." };
  }
  const endedAt = parseSgDateTimeLocal(endValue);
  if (endedAt == null || endedAt <= 0) {
    return { ok: false, message: "Enter a valid end time (Singapore)." };
  }
  if (endedAt <= startedAt) {
    return { ok: false, message: "The end time must be after the start time (Singapore)." };
  }
  if (endedAt > now + 2 * 60 * 1000) {
    return { ok: false, message: "The end time must not be later than now (Singapore)." };
  }
  return { ok: true, startedAt, endedAt };
}

/**
 * Presentational childcare check-in/check-out panel. Shows whether the baby is
 * in childcare, offers check-in or check-out at the current moment, keeps the
 * inline start-time editor for the current stay, and lists the closed sessions
 * (screenshot pending, imported or needing no import) newest first with their
 * per-row attendance, dismiss, edit and remove affordances. Pure presentation:
 * the parent owns transitions, confirmations, persistence, global busy and the
 * global error message.
 */
export default function ChildcareModePanel({
  babyName,
  activeSession,
  pendingSessions,
  busy,
  error,
  onCheckIn,
  onCheckOut,
  onEditCheckIn,
  onImport,
  historySessions,
  onEditSession,
  onDismissImport,
  onRemoveSession,
  now = Date.now(),
}: ChildcareModePanelProps) {
  const activeId = activeSession ? activeSession.id : null;
  const activeCheckedInAt = activeSession ? activeSession.checkedInAt : null;
  const [editingCheckIn, setEditingCheckIn] = useState(false);
  const [missedCheckOutTime, setMissedCheckOutTime] = useState("");
  const [missedCheckOutError, setMissedCheckOutError] = useState<string | null>(null);
  const [editCheckInTime, setEditCheckInTime] = useState("");
  const [editCheckInError, setEditCheckInError] = useState<string | null>(null);
  const [savingCheckIn, setSavingCheckIn] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editTimesError, setEditTimesError] = useState<string | null>(null);
  const [savingTimes, setSavingTimes] = useState(false);
  const [rowAction, setRowAction] = useState<{ id: string; kind: "dismiss" | "remove" } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // Bumped whenever the active session changes so a save that resolves late can
  // never write editor state onto a session it no longer belongs to.
  const editTokenRef = useRef(0);
  // The same guard for the per-row history editors and their async actions.
  const historyTokenRef = useRef(0);

  // Any session-id or start-time change (fresh check-in, check-out, an edited
  // start time, or leaving care) closes the inline editor and discards a pending
  // save's stale resolution.
  useEffect(() => {
    editTokenRef.current += 1;
    setEditingCheckIn(false);
    setEditCheckInTime("");
    setEditCheckInError(null);
    setSavingCheckIn(false);
    setMissedCheckOutTime("");
    setMissedCheckOutError(null);
  }, [activeId, activeCheckedInAt]);

  const pendingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of pendingSessions) {
      if (session.checkedOutAt == null) continue;
      if (session.importCompletedAt != null) continue;
      ids.add(session.id);
    }
    return ids;
  }, [pendingSessions]);

  /** One row per closed session: history and pending merged, newest first. */
  const sessions = useMemo(() => {
    const byId = new Map<string, ChildcareSessionSummary>();
    for (const source of [historySessions ?? [], pendingSessions]) {
      for (const session of source) {
        if (session.checkedOutAt == null) continue;
        if (session.removedAt != null) continue;
        if (byId.has(session.id)) continue;
        byId.set(session.id, session);
      }
    }
    return [...byId.values()]
      .filter((session) => activeId == null || session.id !== activeId)
      .sort(
        (first, second) =>
          second.checkedInAt - first.checkedInAt || first.id.localeCompare(second.id),
      );
  }, [activeId, historySessions, pendingSessions]);

  const sessionsKey = sessions.map((session) => session.id).join("|");

  // A changed set of listed sessions drops any open row editor, row action and
  // row error, so nothing leaks onto a session that is no longer presented.
  useEffect(() => {
    historyTokenRef.current += 1;
    setEditingId(null);
    setEditStart("");
    setEditEnd("");
    setEditTimesError(null);
    setSavingTimes(false);
    setRowAction(null);
    setRowError(null);
  }, [sessionsKey]);

  const maxSgtNow = toSgDateTimeLocal(Date.now());
  const alertMessage = error || editCheckInError;

  function sessionStatus(session: ChildcareSessionSummary): SessionImportStatus {
    if (session.importCompletedAt != null) return "imported";
    if (pendingIds.has(session.id) || session.pendingImport) return "pending";
    return "none";
  }

  /**
   * One handler per press. Check-in and check-out always record the current
   * moment; a wrong time is corrected afterwards by editing the session.
   */
  function handleAction() {
    if (busy) return;
    if (activeSession) {
      onCheckOut();
    } else {
      onCheckIn();
    }
  }

  // A stay checked in on an earlier Singapore day can't be checked out "now":
  // check-out has to fall on the check-in day, so ask when they left that day.
  const missedCheckOut = activeSession != null && !isSameSgDay(activeSession.checkedInAt, now);

  function handleMissedCheckOut() {
    if (busy || !activeSession) return;
    if (!/^\d{2}:\d{2}$/.test(missedCheckOutTime)) {
      setMissedCheckOutError("Enter the time " + babyName + " left.");
      return;
    }
    const checkInDate = toSgDateTimeLocal(activeSession.checkedInAt).slice(0, 10);
    const at = parseSgDateTimeLocal(checkInDate + "T" + missedCheckOutTime);
    if (at == null || at <= activeSession.checkedInAt) {
      setMissedCheckOutError("Pick a time after check-in (" + formatSgTime(activeSession.checkedInAt) + ").");
      return;
    }
    setMissedCheckOutError(null);
    onCheckOut(at);
  }

  /** Opens the inline editor prefilled with the active stay's start time. */
  function openCheckInEditor(at: number) {
    setEditCheckInTime(toSgDateTimeLocal(at));
    setEditCheckInError(null);
    setEditingCheckIn(true);
  }

  /** Local only: cancelling never saves, checks out or notifies the parent. */
  function closeCheckInEditor() {
    setEditingCheckIn(false);
    setEditCheckInTime("");
    setEditCheckInError(null);
  }

  async function handleSaveCheckIn() {
    if (savingCheckIn) return;
    const parsed = parseSgDateTimeLocal(editCheckInTime);
    if (parsed == null || parsed <= 0 || parsed > Date.now() + 2 * 60 * 1000) {
      setEditCheckInError("Enter a start time no later than now (Singapore).");
      return;
    }
    editTokenRef.current += 1;
    const token = editTokenRef.current;
    setEditCheckInError(null);
    setSavingCheckIn(true);
    let saved = false;
    try {
      saved = await onEditCheckIn(parsed);
    } catch {
      saved = false;
    }
    // A session change already reset the editor; ignore this stale resolution.
    if (editTokenRef.current !== token) return;
    setSavingCheckIn(false);
    if (saved) {
      closeCheckInEditor();
    } else {
      setEditCheckInError("Could not save the start time. Please try again.");
    }
  }

  /** Opens a closed session's editor prefilled with its recorded times. */
  function openTimesEditor(session: ChildcareSessionSummary) {
    setEditingId(session.id);
    setEditStart(toSgDateTimeLocal(session.checkedInAt));
    setEditEnd(session.checkedOutAt != null ? toSgDateTimeLocal(session.checkedOutAt) : "");
    setEditTimesError(null);
    setRowError(null);
  }

  /** Local only: cancelling never saves and never notifies the parent. */
  function closeTimesEditor() {
    setEditingId(null);
    setEditStart("");
    setEditEnd("");
    setEditTimesError(null);
  }

  /**
   * Validates the attendance window locally; overlap and concurrent-edit rules
   * belong to the server.
   */
  async function handleSaveTimes(session: ChildcareSessionSummary) {
    if (savingTimes || rowAction != null) return;
    if (!onEditSession) return;
    const validation = validateSessionTimes(editStart, editEnd);
    if (!validation.ok) {
      setEditTimesError(validation.message);
      return;
    }
    const { startedAt, endedAt } = validation;
    const token = historyTokenRef.current;
    setEditTimesError(null);
    setSavingTimes(true);
    let saved = false;
    try {
      saved = await onEditSession(session, { checkedInAt: startedAt, checkedOutAt: endedAt });
    } catch {
      saved = false;
    }
    // The listed sessions changed underneath us; ignore this stale resolution.
    if (historyTokenRef.current !== token) return;
    setSavingTimes(false);
    if (saved) {
      closeTimesEditor();
    } else {
      // Keep the open editor and its typed values so the retry is one press.
      setEditTimesError("Could not save the new times. Please try again.");
    }
  }

  /** Shared runner so a repeated press can never fire a second row action. */
  async function runRowAction(
    session: ChildcareSessionSummary,
    kind: "dismiss" | "remove",
    action: (target: ChildcareSessionSummary) => Promise<boolean>,
    failureMessage: string,
  ) {
    const token = historyTokenRef.current;
    setRowError(null);
    setRowAction({ id: session.id, kind });
    let succeeded = false;
    try {
      succeeded = await action(session);
    } catch {
      succeeded = false;
    }
    if (historyTokenRef.current !== token) return;
    setRowAction(null);
    if (!succeeded) {
      setRowError({ id: session.id, message: failureMessage });
    }
  }

  function handleDismissImport(session: ChildcareSessionSummary) {
    if (!onDismissImport || busy || rowAction != null || savingTimes) return;
    const confirmed =
      typeof window === "undefined"
        ? false
        : window.confirm(
            "Skip the screenshot for this session? It stops asking for one and discards any unsaved screenshot draft. The session itself is kept.",
          );
    if (!confirmed) return;
    void runRowAction(
      session,
      "dismiss",
      onDismissImport,
      "Could not skip the screenshot. Please try again.",
    );
  }

  function handleRemoveSession(session: ChildcareSessionSummary) {
    if (!onRemoveSession || busy || rowAction != null || savingTimes) return;
    const confirmed =
      typeof window === "undefined"
        ? false
        : window.confirm(
            "Remove this session? Use this only for a session recorded by mistake: it is removed from your history and any uncommitted review for it is discarded.",
          );
    if (!confirmed) return;
    void runRowAction(
      session,
      "remove",
      onRemoveSession,
      "Could not remove the session. Please try again.",
    );
  }

  return (
    <section
      aria-label="Childcare"
      className="w-full min-w-0 rounded-xl border border-border bg-surface p-3 sm:p-4"
    >
      {activeSession ? (
        <div className="flex min-w-0 flex-wrap items-start gap-3 rounded-xl border border-terracotta/40 bg-terracotta/5 p-3">
          <Baby aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-accent-strong" />
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-sm font-semibold text-warm-brown sm:text-base">
              {babyName} is in childcare
            </h3>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p
                role="status"
                className="min-w-0 break-words text-xs font-medium tabular-nums text-warm-brown-light"
              >
                Checked in {formatSgDate(activeSession.checkedInAt)} at {formatSgTime(activeSession.checkedInAt)} SGT
              </p>
              <button
                type="button"
                onClick={() => openCheckInEditor(activeSession.checkedInAt)}
                disabled={busy || editingCheckIn}
                aria-label="Edit start time"
                aria-expanded={editingCheckIn}
                className={compactSecondaryButtonClass}
              >
                <Pencil aria-hidden="true" className="h-3 w-3 shrink-0" />
                Edit start time
              </button>
            </div>
            <p className="mt-1 break-words text-xs text-muted">
              Adding an activity will ask for confirmation.
            </p>
          </div>
          {missedCheckOut ? (
            <div className="w-full min-w-0 basis-full rounded-lg border border-terracotta/40 bg-surface p-2.5">
              <p className="text-xs leading-relaxed text-warm-brown">
                Check-out wasn&apos;t recorded on {formatSgDate(activeSession.checkedInAt)}. What time did {babyName} leave that day?
              </p>
              <div className="mt-2 grid gap-2">
                <label htmlFor="childcare-missed-checkout-time" className="block text-xs font-medium text-warm-brown">
                  Left at (Singapore time)
                  <input
                    id="childcare-missed-checkout-time"
                    type="time"
                    value={missedCheckOutTime}
                    onChange={(event) => { setMissedCheckOutTime(event.target.value); setMissedCheckOutError(null); }}
                    disabled={busy}
                    className={dateTimeInputClass}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleMissedCheckOut}
                  disabled={busy || missedCheckOutTime === ""}
                  className={primaryButtonClass + " w-full"}
                >
                  <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
                  Check out at this time
                </button>
              </div>
              {missedCheckOutError && (
                <p role="alert" className="mt-1.5 text-xs text-danger">{missedCheckOutError}</p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleAction}
              disabled={busy || editingCheckIn}
              className={primaryButtonClass}
            >
              <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
              Check out
            </button>
          )}
          {editingCheckIn && (
            <div className="w-full min-w-0 basis-full rounded-lg border border-border bg-surface p-2.5">
              <label
                htmlFor="childcare-edit-checkin-time"
                className="text-xs font-medium text-warm-brown"
              >
                Start time (Singapore)
              </label>
              <input
                id="childcare-edit-checkin-time"
                type="datetime-local"
                value={editCheckInTime}
                onChange={(event) => setEditCheckInTime(event.target.value)}
                disabled={busy || savingCheckIn}
                max={maxSgtNow}
                className={dateTimeInputClass}
              />
              <p className="mt-1 text-xs text-muted">
                Enter the actual start time; it must not be later than now (Singapore).
              </p>
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveCheckIn()}
                  disabled={busy || savingCheckIn}
                  className={primaryButtonClass}
                >
                  Save start time
                </button>
                <button
                  type="button"
                  onClick={closeCheckInEditor}
                  disabled={busy || savingCheckIn}
                  className={secondaryButtonClass}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Baby aria-hidden="true" className="h-4 w-4 shrink-0 text-accent-strong" />
            <span className="truncate text-sm font-semibold text-warm-brown">Childcare</span>
            <span role="status" className="min-w-0 truncate text-xs text-muted">
              Not in childcare
            </span>
          </div>
          <button
            type="button"
            onClick={handleAction}
            disabled={busy}
            className={primaryButtonClass}
          >
            <LogIn aria-hidden="true" className="h-4 w-4 shrink-0" />
            Check in
          </button>
        </div>
      )}

      {alertMessage && (
        <p
          role="alert"
          className="mt-3 break-words rounded-lg border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-xs text-danger"
        >
          {alertMessage}
        </p>
      )}

      {sessions.length > 0 && (
        <div className="mt-3 min-w-0 border-t border-border pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Previous sessions
          </h3>
          <ul className="mt-2 max-h-[60vh] min-w-0 space-y-2 overflow-y-auto pr-0.5">
            {sessions.map((session) => {
              const status = sessionStatus(session);
              const isImported = status === "imported";
              const isPending = status === "pending";
              const isEditing = editingId === session.id;
              const canSkip = isPending && Boolean(onDismissImport);
              const canRemove = !isImported && Boolean(onRemoveSession);
              const hasRowMenu = Boolean(onEditSession) || canSkip || canRemove;
              const rowBusy = busy || savingTimes || rowAction?.id === session.id;

              return (
                <li key={session.id} className="min-w-0 rounded-lg border border-border bg-surface p-2">
                  <div className="flex min-w-0 flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="break-words text-sm font-medium text-warm-brown">
                          {formatSgDate(session.checkedInAt)}
                        </p>
                        <span
                          className={`inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium ${SESSION_STATUS_TEXT_CLASS[status]}`}
                        >
                          {status === "imported" && <Check aria-hidden="true" className="h-3 w-3 shrink-0" />}
                          {SESSION_STATUS_LABEL[status]}
                        </span>
                      </div>
                      <p className="break-words text-xs tabular-nums text-warm-brown-light">
                        {formatCareWindow(session)} SGT
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {isPending && (
                        <button
                          type="button"
                          onClick={() => onImport(session)}
                          disabled={rowBusy}
                          aria-label="Import screenshot"
                          title="Import screenshot"
                          className={`${compactSecondaryButtonClass} h-8 w-8 text-accent-strong`}
                        >
                          <ImageUp aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      )}
                      {hasRowMenu && (
                        <button
                          type="button"
                          onClick={() => (isEditing ? closeTimesEditor() : openTimesEditor(session))}
                          disabled={rowBusy}
                          aria-expanded={isEditing}
                          aria-label="Edit session"
                          title="Edit session"
                          className={`${compactSecondaryButtonClass} h-8 w-8`}
                        >
                          <Pencil aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing && onEditSession && (
                    <ChildcareTimesEditor
                      isImported={isImported}
                      startValue={editStart}
                      endValue={editEnd}
                      maxValue={maxSgtNow}
                      error={editTimesError}
                      disabled={busy || savingTimes}
                      onStartChange={setEditStart}
                      onEndChange={setEditEnd}
                      onSave={() => void handleSaveTimes(session)}
                      onCancel={closeTimesEditor}
                    />
                  )}

                  {isEditing && (canSkip || canRemove) && (
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 border-t border-border pt-2">
                      {canSkip && (
                        <button
                          type="button"
                          onClick={() => handleDismissImport(session)}
                          disabled={rowBusy}
                          className={compactDangerButtonClass}
                        >
                          Skip screenshot
                        </button>
                      )}
                      {canRemove && (
                        <button
                          type="button"
                          onClick={() => handleRemoveSession(session)}
                          disabled={rowBusy}
                          className={compactDangerButtonClass}
                        >
                          <Trash2 aria-hidden="true" className="h-3 w-3 shrink-0" />
                          Remove session
                        </button>
                      )}
                    </div>
                  )}

                  {rowError?.id === session.id && (
                    <p role="alert" className="mt-1 break-words text-xs text-danger">
                      {rowError.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
