"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { ChildcareSessionSummary } from "@/lib/childcare-mode-contract";

export type CareTimesSaveResult = { session: ChildcareSessionSummary } | { error: string };

/** "HH:MM" Singapore time for an instant. */
function sgTime(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

/** "YYYY-MM-DD" Singapore date for an instant. */
function sgDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export type CareEndValidation = { ok: true; checkedOutAt: number } | { ok: false; message: string };

/**
 * A corrected check-out is a Singapore time on the check-in day, after check-in
 * and not later than now. Overlaps and imported naps are checked by the server.
 */
export function validateCareEnd(checkedInAt: number, time: string, now = Date.now()): CareEndValidation {
  if (!/^\d{2}:\d{2}$/.test(time)) return { ok: false, message: "Enter the check-out time." };
  const checkedOutAt = Date.parse(`${sgDate(checkedInAt)}T${time}:00+08:00`);
  if (!Number.isFinite(checkedOutAt)) return { ok: false, message: "Enter the check-out time." };
  if (checkedOutAt <= checkedInAt) {
    return { ok: false, message: `Check-out must be after check-in (${sgTime(checkedInAt)}).` };
  }
  if (checkedOutAt > now + 60 * 1000) return { ok: false, message: "Check-out can't be later than now." };
  return { ok: true, checkedOutAt };
}

export type CareTimesValidation =
  | { ok: true; checkedInAt: number; checkedOutAt: number }
  | { ok: false; message: string };

/**
 * Corrected check-in and check-out: Singapore times on the stay's day (the
 * server keeps a stay within one day), check-out after check-in, neither later
 * than now.
 */
export function validateCareTimes(day: number, startTime: string, endTime: string, now = Date.now()): CareTimesValidation {
  if (!/^\d{2}:\d{2}$/.test(startTime)) return { ok: false, message: "Enter the check-in time." };
  const checkedInAt = Date.parse(`${sgDate(day)}T${startTime}:00+08:00`);
  if (!Number.isFinite(checkedInAt)) return { ok: false, message: "Enter the check-in time." };
  if (checkedInAt > now + 60 * 1000) return { ok: false, message: "Check-in can't be later than now." };
  const end = validateCareEnd(checkedInAt, endTime, now);
  return end.ok ? { ok: true, checkedInAt, checkedOutAt: end.checkedOutAt } : end;
}

/**
 * The recorded check-in and check-out of a closed childcare stay, with an
 * inline editor to correct them; the parent persists the change.
 */
export default function CareTimesEditor({
  session,
  disabled = false,
  disabledReason,
  showTimes = true,
  onSave,
}: {
  session: ChildcareSessionSummary & { checkedOutAt: number };
  disabled?: boolean;
  /** Shown instead of the editor while editing isn't possible (e.g. unsaved review edits). */
  disabledReason?: string;
  /** Show the recorded start and end beside the button (off where they're already shown). */
  showTimes?: boolean;
  onSave: (times: { checkedInAt: number; checkedOutAt: number }) => Promise<CareTimesSaveResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const open = () => {
    setStart(sgTime(session.checkedInAt));
    setValue(sgTime(session.checkedOutAt));
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    const validation = validateCareTimes(session.checkedInAt, start, value);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    // Unchanged minutes keep the recorded instants (seconds included).
    const checkedInAt = start === sgTime(session.checkedInAt) ? session.checkedInAt : validation.checkedInAt;
    const checkedOutAt = value === sgTime(session.checkedOutAt) ? session.checkedOutAt : validation.checkedOutAt;
    if (checkedInAt === session.checkedInAt && checkedOutAt === session.checkedOutAt) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onSave({ checkedInAt, checkedOutAt }).catch(() => ({ error: "Could not save the times. Try again." }));
    setSaving(false);
    if ("error" in result) setError(result.error);
    else setEditing(false);
  };

  const editButton = (
    <button
      type="button"
      onClick={open}
      disabled={disabled || Boolean(disabledReason)}
      aria-label="Edit check-in and check-out times"
      className="hit-44 inline-flex min-h-8 items-center gap-1 rounded-md border border-border bg-surface px-2 text-xs font-semibold text-accent-strong transition-colors hover:bg-surface-muted disabled:opacity-45"
    >
      <Pencil aria-hidden="true" className="h-3 w-3" />
      Edit times
    </button>
  );

  if (!editing) {
    return (
      <div className={showTimes ? "" : "mt-2"}>
        {showTimes ? (
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-muted">Care start <span className="font-semibold tabular-nums text-warm-brown">{sgTime(session.checkedInAt)}</span> · From check-in</p>
              <p className="mt-1 text-muted">Care end <span className="font-semibold tabular-nums text-warm-brown">{sgTime(session.checkedOutAt)}</span> · From check-out</p>
            </div>
            {editButton}
          </div>
        ) : editButton}
        {disabledReason && <p className="mt-1 text-xs text-muted">{disabledReason}</p>}
      </div>
    );
  }

  const inputClass = "mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-accent-strong/45";
  return (
    <div className={showTimes ? "" : "mt-2"}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block min-w-0 text-sm font-semibold">Check-in (Singapore)
          <input type="time" required autoFocus value={start} disabled={saving} onChange={event => { setStart(event.target.value); setError(null); }} className={inputClass} />
        </label>
        <label className="block min-w-0 text-sm font-semibold">Check-out (Singapore)
          <input type="time" required value={value} disabled={saving} onChange={event => { setValue(event.target.value); setError(null); }} className={inputClass} />
        </label>
      </div>
      <p className="mt-1 text-xs text-muted">Corrects this stay&apos;s recorded times. Both stay on the same day.</p>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => { void save(); }} disabled={saving || start === "" || value === ""} className="min-h-11 rounded-xl bg-terracotta-dark px-4 text-sm font-semibold text-on-accent disabled:opacity-45">
          {saving ? "Saving…" : "Save times"}
        </button>
        <button type="button" onClick={() => { setEditing(false); setError(null); }} disabled={saving} className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold text-warm-brown disabled:opacity-45">
          Cancel
        </button>
      </div>
    </div>
  );
}
