"use client";

import { useEffect, useState } from "react";
import { Baby, ImageUp, LogIn, LogOut } from "lucide-react";
import type { ChildcareSessionSummary } from "@/lib/childcare-mode-contract";

export interface ChildcareModePanelProps {
  babyName: string;
  activeSession: ChildcareSessionSummary | null;
  pendingSessions: ChildcareSessionSummary[];
  busy: boolean;
  error: string | null;
  onCheckIn: (at?: number) => void;
  onCheckOut: (at?: number) => void;
  onImport: (session: ChildcareSessionSummary) => void;
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
 * Singapore care window for a session, e.g. "09:15 - 17:30", or with the end
 * date spelled out when the stay crosses midnight: "23:40 - 17 Oct 2026, 06:15".
 */
function formatCareWindow(session: ChildcareSessionSummary): string {
  const startTime = formatSgTime(session.checkedInAt);
  if (session.checkedOutAt == null) {
    return startTime + " - in care";
  }
  const endTime = formatSgTime(session.checkedOutAt);
  if (isSameSgDay(session.checkedInAt, session.checkedOutAt)) {
    return startTime + " - " + endTime;
  }
  return startTime + " - " + formatSgDate(session.checkedOutAt) + ", " + endTime;
}

const primaryButtonClass =
  "inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-terracotta/50 bg-terracotta/10 px-3 py-1.5 text-sm font-semibold text-accent-strong transition-colors hover:bg-terracotta/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-terracotta/10";

const secondaryButtonClass =
  "inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-warm-brown transition-colors hover:border-terracotta/30 hover:text-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:text-warm-brown";

/**
 * Presentational childcare check-in/check-out panel. Shows the current in-care
 * state for the baby, offers the matching check-in or check-out action, and
 * lists closed sessions that still need a screenshot import. Pure presentation:
 * the parent owns transitions, confirmations and persistence.
 */
export default function ChildcareModePanel({
  babyName,
  activeSession,
  pendingSessions,
  busy,
  error,
  onCheckIn,
  onCheckOut,
  onImport,
}: ChildcareModePanelProps) {
  const activeId = activeSession ? activeSession.id : null;
  const [customTime, setCustomTime] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  // Any session-id change (fresh check-in, check-out, or leaving care) drops the
  // previous custom time so a stale value can never be reused.
  useEffect(() => {
    setCustomTime("");
    setLocalError(null);
  }, [activeId]);

  const seenIds = new Set<string>();
  const importableSessions = pendingSessions.filter((session) => {
    if (!session.pendingImport) return false;
    if (session.checkedOutAt == null) return false;
    if (session.importCompletedAt != null) return false;
    if (activeId != null && session.id === activeId) return false;
    if (seenIds.has(session.id)) return false;
    seenIds.add(session.id);
    return true;
  });

  const maxSgtNow = toSgDateTimeLocal(Date.now());
  const minSgt = activeSession ? toSgDateTimeLocal(activeSession.checkedInAt) : undefined;
  const alertMessage = error || localError;

  /** One handler per press: check-in or check-out, with the typed time when valid. */
  function handleAction() {
    let at: number | undefined;
    const typed = customTime.trim();
    if (typed !== "") {
      const parsed = parseSgDateTimeLocal(typed);
      if (
        parsed == null ||
        parsed <= 0 ||
        parsed > Date.now() + 2 * 60 * 1000 ||
        (activeSession != null && parsed <= activeSession.checkedInAt)
      ) {
        setLocalError(
          activeSession
            ? "Enter a check-out time after the check-in time and no later than now (Singapore)."
            : "Enter a check-in time no later than now (Singapore).",
        );
        return;
      }
      at = parsed;
    }
    setLocalError(null);
    if (activeSession) {
      onCheckOut(at);
    } else {
      onCheckIn(at);
    }
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
            <p
              role="status"
              className="mt-0.5 break-words text-xs font-medium tabular-nums text-warm-brown-light"
            >
              Checked in {formatSgDate(activeSession.checkedInAt)} at {formatSgTime(activeSession.checkedInAt)} SGT
            </p>
            <p className="mt-1 break-words text-xs text-muted">
              Adding an activity will ask for confirmation.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAction}
            disabled={busy}
            className={primaryButtonClass}
          >
            <LogOut aria-hidden="true" className="h-4 w-4 shrink-0" />
            Check out
          </button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Baby aria-hidden="true" className="h-4 w-4 shrink-0 text-accent-strong" />
            <span className="truncate text-sm font-semibold text-warm-brown">Childcare</span>
            <span role="status" className="min-w-0 truncate text-xs text-muted">
              Not checked in
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

      <details className="mt-3 min-w-0 rounded-lg border border-border bg-surface px-2.5 py-1.5">
        <summary className="cursor-pointer select-none text-xs font-medium text-warm-brown-light transition-colors hover:text-accent-strong">
          Record a different time
        </summary>
        <div className="mt-2 flex w-full min-w-0 max-w-full flex-col gap-1.5">
          <label
            htmlFor="childcare-custom-time"
            className="text-xs font-medium text-warm-brown"
          >
            {activeSession ? "Check-out time (Singapore)" : "Check-in time (Singapore)"}
          </label>
          <input
            id="childcare-custom-time"
            type="datetime-local"
            value={customTime}
            onChange={(event) => setCustomTime(event.target.value)}
            disabled={busy}
            max={maxSgtNow}
            min={minSgt}
            className="w-full min-w-0 max-w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm tabular-nums text-warm-brown focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40"
          />
          <p className="text-xs text-muted">Leave blank to use now.</p>
        </div>
      </details>

      {alertMessage && (
        <p
          role="alert"
          className="mt-3 break-words rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-danger"
        >
          {alertMessage}
        </p>
      )}

      {importableSessions.length > 0 && (
        <div className="mt-3 min-w-0 border-t border-border pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Care logs to import
          </h3>
          <ul className="mt-2 max-h-[60vh] min-w-0 space-y-2 overflow-y-auto pr-0.5">
            {importableSessions.map((session) => (
              <li
                key={session.id}
                className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium text-warm-brown">
                    {formatSgDate(session.checkedInAt)}
                  </p>
                  <p className="break-words text-xs tabular-nums text-warm-brown-light">
                    {formatCareWindow(session)} SGT
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onImport(session)}
                  disabled={busy}
                  className={secondaryButtonClass}
                >
                  <ImageUp aria-hidden="true" className="h-4 w-4 shrink-0" />
                  Import screenshot
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
